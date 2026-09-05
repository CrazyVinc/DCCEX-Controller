import EventEmitter from 'node:events';
import { createActor, createMachine } from 'xstate';
import type { DispatchJob, DispatchRequest } from '../../shared/src/domain/dispatch.ts';
import { occupiedPieces } from '../../shared/src/domain/pose.ts';
import { standingTurnoutStates } from '../../shared/src/domain/trainGeometry.ts';
import { speedForStep } from '../../shared/src/domain/speedModel.ts';
import { blockCentre, blockLengthMm, blockWorldSegments } from '../../shared/src/layout/blockGeometry.ts';
import { otherPort, type LayoutIndex } from '../../shared/src/layout/index.ts';
import type { Destination, TrackPosition } from '../../shared/src/layout/schema.ts';
import { advance } from '../../shared/src/layout/traverse.ts';
import type { TrainPose } from '../../shared/src/domain/train.ts';
import { newId } from '../../shared/src/util/id.ts';
import type { ConsistStore } from '../services/consistStore.ts';
import type { LayoutStore } from '../services/layoutStore.ts';
import type { RollingStockService } from '../services/rollingStock.ts';
import { dryRun } from './dryRun.ts';
import type { Interlocking } from './interlocking.ts';
import type { LiveService } from './liveService.ts';
import { consistServiceClass, planRoute, type Route } from './routePlanner.ts';
import { buildTrackGraph } from './trackGraph.ts';
import type { TrainStateManager } from './trainState.ts';
import type { TurnoutStateStore } from './turnoutState.ts';

export interface DispatcherEvents {
  jobs: [DispatchJob[]];
}

interface Deps {
  layoutStore: LayoutStore;
  consistStore: ConsistStore;
  rollingStock: RollingStockService;
  trainState: TrainStateManager;
  turnouts: TurnoutStateStore;
  interlocking: Interlocking;
  liveService: LiveService;
}

/** Lifecycle of one dispatch job. */
const jobMachine = createMachine({
  id: 'dispatch',
  initial: 'planned',
  states: {
    planned: { on: { VALIDATED: 'validated', REJECT: 'rejected' } },
    validated: { on: { START: 'running', REJECT: 'rejected', ABORT: 'aborted' } },
    running: { on: { HOLD: 'held', ARRIVED: 'arrived', ABORT: 'aborted', REJECT: 'rejected' } },
    held: { on: { RESUME: 'running', ABORT: 'aborted', REJECT: 'rejected' } },
    arrived: { type: 'final' },
    rejected: { type: 'final' },
    aborted: { type: 'final' },
  },
});

interface ActiveJob {
  job: DispatchJob;
  actor: ReturnType<typeof createActor<typeof jobMachine>>;
  route: Route | null;
  /** Index of the leg currently being driven. */
  legIndex: number;
  /** Set while the train waits at a reversal point for the point motors. */
  legTimer: NodeJS.Timeout | null;
  released: Set<string>;
  monitor: NodeJS.Timeout | null;
  cleanup?: () => void;
}

/** Margin between the nose and the platform end when the train stops. */
const PLATFORM_STOP_MARGIN_MM = 25;
const RECHECK_INTERVAL_MS = 1000;

/** Put the turnout states the train stands on in front of the first leg's (and the route's) requirements. */
function withStandingTurnouts(route: Route, standing: { pieceId: string; state: string }[]): Route {
  const first = route.legs[0]!;
  const missing = standing.filter((t) => !first.turnoutStates.some((x) => x.pieceId === t.pieceId));
  if (!missing.length) return route;
  return {
    ...route,
    legs: [{ ...first, turnoutStates: [...missing, ...first.turnoutStates] }, ...route.legs.slice(1)],
    turnoutStates: [...missing.filter((t) => !route.turnoutStates.some((x) => x.pieceId === t.pieceId)), ...route.turnoutStates],
  };
}

/**
 * Automatic running: station request → route → dry-run → atomic claims → turnouts →
 * approved throttle → progressive release → arrival. Nothing is sent to the layout
 * without a validated dry-run, and the remaining route is re-validated while running.
 */
export class Dispatcher extends EventEmitter<DispatcherEvents> {
  private readonly jobs = new Map<string, ActiveJob>();
  private readonly deps: Deps;

  constructor(deps: Deps) {
    super();
    this.deps = deps;
    // Trains cannot move without track power: hold running jobs; `recheck` resumes them once power is back.
    deps.liveService.on('power', ({ power }) => {
      if (!power) this.holdAll('Holding: track power is off');
    });
    // The operator took the throttle: the train keeps doing what the operator says, the job is over.
    deps.liveService.on('manualOverride', ({ consistId }) => this.releaseToManual(consistId));
  }

  /** Drop the active job of a consist without touching the train (it is under manual control now). */
  private releaseToManual(consistId: string): void {
    for (const active of this.jobs.values()) {
      if (active.job.consistId !== consistId) continue;
      if (active.job.state !== 'running' && active.job.state !== 'held' && active.job.state !== 'validated') continue;
      this.deps.liveService.simulation.setStopPoint(consistId, null);
      this.deps.interlocking.releaseAll(consistId);
      this.deps.liveService.gate.revoke(consistId);
      active.actor.send({ type: 'ABORT' });
      this.stopMonitor(active);
      this.update(active, { reason: 'Taken over manually' });
    }
  }

  private holdAll(reason: string): void {
    for (const active of this.jobs.values()) {
      if (active.job.state !== 'running') continue;
      this.deps.liveService.stopTrain(active.job.consistId, 'dispatcher');
      active.actor.send({ type: 'HOLD' });
      this.update(active, { reason });
    }
  }

  list(): DispatchJob[] {
    return [...this.jobs.values()].map((j) => j.job).sort((a, b) => b.createdAt - a.createdAt);
  }

  /** Station names available in the layout (destinations flagged as station). */
  stations(): { name: string; platforms: { id: string; lengthMm: number }[] }[] {
    const index = this.deps.layoutStore.getIndex();
    const map = new Map<string, { id: string; lengthMm: number }[]>();
    for (const d of index.doc.destinations) {
      if (!d.isStation) continue;
      const list = map.get(d.name) ?? [];
      list.push({ id: d.id, lengthMm: blockLengthMm(index, d) });
      map.set(d.name, list);
    }
    return [...map.entries()].map(([name, platforms]) => ({ name, platforms }));
  }

  async dispatch(request: DispatchRequest): Promise<DispatchJob> {
    const { layoutStore, consistStore, trainState, interlocking } = this.deps;
    const index = layoutStore.getIndex();
    const consist = consistStore.get(request.consistId);
    const live = trainState.get(request.consistId);
    const active: ActiveJob = {
      job: {
        id: newId('job'),
        consistId: request.consistId,
        station: request.station,
        platformId: null,
        state: 'planned',
        reason: null,
        issues: [],
        warnings: [],
        speedStep: request.speedStep,
        movement: null,
        routePieceIds: [],
        turnoutStates: [],
        stopAt: null,
        routeLengthMm: 0,
        estimatedDurationMs: 0,
        progress: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
      actor: createActor(jobMachine),
      route: null,
      legIndex: 0,
      legTimer: null,
      released: new Set(),
      monitor: null,
    };
    active.actor.start();
    this.jobs.set(active.job.id, active);

    const reject = (reason: string, issues: string[] = []) => {
      active.actor.send({ type: 'REJECT' });
      this.update(active, { reason, issues });
      return active.job;
    };

    if (!consist) return reject('Unknown consist');
    if (!live?.pose) return reject('Train has no position on the layout');
    if (live.pose.confidence < 0.8) return reject('Train position is not confirmed');
    if (this.deps.liveService.safety.level === 'EMERGENCY') return reject('Layout is in EMERGENCY');
    if ([...this.jobs.values()].some((j) => j !== active && j.job.consistId === consist.id && (j.job.state === 'running' || j.job.state === 'held' || j.job.state === 'validated'))) {
      return reject('Train already has an active job');
    }

    const length = consistStore.totalLengthMm(consist);
    const platforms = index.doc.destinations.filter((d) => d.isStation && d.name === request.station);
    if (!platforms.length) return reject(`No station named "${request.station}"`);

    // Pieces we may not use: claimed by others, occupied by others.
    const forbidden = interlocking.foreignPieces(consist.id);
    for (const other of trainState.list()) {
      if (other.consistId === consist.id) continue;
      for (const id of other.occupiedPieceIds) forbidden.add(id);
    }
    const serviceClass = consistServiceClass(consist, (wagonId) => this.deps.rollingStock.getWagonById(wagonId)?.serviceClass);
    const graph = buildTrackGraph(index);

    // Choose the shortest route to a free platform. On a platform long enough the train
    // stops just inside the far end; on a shorter platform it is centred on the platform
    // (it overhangs both ends) and the job carries a warning.
    const planOptions = {
      turnoutStates: this.deps.turnouts.resolver,
      allowReverse: request.allowReverse,
      serviceClass,
      // Reversing halfway (kopmaken) is allowed when the operator allows tail-first running.
      trainLengthMm: request.allowReverse ? length : undefined,
    };
    let best: { route: Route; platform: Destination; warnings: string[] } | null = null;
    const notes: string[] = [];
    for (const platform of platforms) {
      const platformLength = blockLengthMm(index, platform);
      const platformPieces = blockWorldSegments(index, platform).map((s) => s.pieceId);
      if (platformPieces.some((id) => forbidden.has(id))) {
        notes.push(`Platform ${platform.id} is occupied or claimed`);
        continue;
      }
      const forbiddenForRoute = new Set(forbidden);
      const warnings: string[] = [];
      let chosen: Route | null = null;
      let alreadyThere = false;

      if (platformLength >= length) {
        // Stop 25 mm inside the far end, or less when the platform is barely longer than the train.
        const margin = Math.min(PLATFORM_STOP_MARGIN_MM, (platformLength - length) / 2);
        const candidates: Route[] = [];
        for (const anchor of [platform.start, platform.end]) {
          const { target, arrivalDir } = this.stopPointInside(index, platform, anchor, margin);
          const planned = planRoute(index, graph, consist.id, live.pose, target, { ...planOptions, forbiddenPieceIds: forbiddenForRoute });
          if (planned === 'already-there') alreadyThere = true;
          // The leading end must arrive from the platform interior; from the other side the train would stand outside it.
          if (typeof planned === 'object' && planned.legs[planned.legs.length - 1]!.arrivalDir === arrivalDir) candidates.push(planned);
        }
        candidates.sort((a, b) => a.legs.length - b.legs.length || a.lengthMm - b.lengthMm);
        chosen = candidates[0] ?? null;
      } else {
        warnings.push(`Platform ${platform.id} is ${platformLength.toFixed(0)} mm, train is ${length} mm: the train is centred on the platform and overhangs both ends`);
        const centred = this.planCentred(index, graph, consist.id, live.pose, platform, length, { ...planOptions, forbiddenPieceIds: forbiddenForRoute }, warnings);
        if (centred === 'already-there') alreadyThere = true;
        else chosen = centred;
      }
      if (!chosen) {
        notes.push(alreadyThere ? `Train already stands at platform ${platform.id}` : `No route to platform ${platform.id}`);
        continue;
      }
      if (!best || chosen.legs.length < best.route.legs.length || (chosen.legs.length === best.route.legs.length && chosen.lengthMm < best.route.lengthMm)) {
        best = { route: chosen, platform, warnings };
      }
    }
    if (!best) return reject(notes.length && notes.every((n) => n.startsWith('Train already')) ? 'Train is already at this station' : 'No reachable free platform', notes);

    // Turnouts the train already stands on must match its paths before it moves (first leg).
    const route = withStandingTurnouts(best.route, standingTurnoutStates(index, live.pose, length, this.deps.turnouts.resolver));
    const { platform, warnings } = best;
    this.update(active, {
      platformId: platform.id,
      movement: route.movement,
      routePieceIds: route.pieceIds,
      turnoutStates: route.turnoutStates,
      stopAt: route.stopAt,
      routeLengthMm: route.lengthMm,
      warnings,
      reason: route.legs.length > 1 ? `Route reverses ${route.legs.length - 1}× on the way` : null,
    });
    active.route = route;

    // Dry-run on a clone of the live simulation.
    const targetMmS = speedForStep(this.deps.liveService.calibrationFor(consist.id), request.speedStep);
    const result = dryRun({
      index,
      simulation: this.deps.liveService.simulation,
      route,
      targetMmS,
      foreignPieceIds: forbidden,
      switchTimeMs: (pieceId) => index.pieces.get(pieceId)?.piece.switchTimeMs ?? 400,
    });
    if (result.status !== 'validated') return reject('Dry-run failed', result.issues);
    this.update(active, { estimatedDurationMs: result.durationMs, issues: [] });
    active.actor.send({ type: 'VALIDATED' });
    this.update(active, {});

    // Atomic claim, then turnouts, then approval, then go.
    const claim = interlocking.tryClaim({ consistId: consist.id, pieceIds: route.pieceIds, turnoutStates: route.turnoutStates });
    if (!claim.ok) {
      const deadlocks = interlocking.detectDeadlocks();
      return reject(
        deadlocks.some((c) => c.includes(consist.id)) ? 'Deadlock: trains are waiting for each other' : 'Route is claimed by another train',
        claim.conflicts.map((c) => `${c.pieceId} held by ${c.heldBy}`),
      );
    }
    const firstLeg = route.legs[0]!;
    for (const t of firstLeg.turnoutStates) {
      if (!this.deps.turnouts.set(t.pieceId, t.state)) {
        interlocking.releaseAll(consist.id);
        return reject(`Turnout ${t.pieceId} cannot be set to ${t.state}`);
      }
    }
    const maxSwitch = Math.max(0, ...firstLeg.turnoutStates.map((t) => index.pieces.get(t.pieceId)?.piece.switchTimeMs ?? 400));
    const throwBeforeDeparture = result.turnoutSchedule.some((s) => s.throwBeforeDeparture);
    this.deps.liveService.gate.approve({ consistId: consist.id, maxSpeedStep: request.speedStep, validUntil: Date.now() + result.durationMs * 3 + 120_000 });

    const go = () => {
      if (active.job.state !== 'validated') return;
      this.deps.liveService.simulation.setStopPoint(consist.id, firstLeg.stopAt);
      const verdict = this.deps.liveService.drive(consist.id, firstLeg.movement, request.speedStep, 'dispatcher');
      if (!verdict.ok) {
        interlocking.releaseAll(consist.id);
        this.deps.liveService.gate.revoke(consist.id);
        reject(verdict.reason);
        return;
      }
      active.actor.send({ type: 'START' });
      this.update(active, {});
      this.startMonitor(active);
    };
    // Wait for the point motors when the first turnout is right in front of the train.
    if (throwBeforeDeparture && maxSwitch > 0) setTimeout(go, maxSwitch + 300);
    else go();
    return active.job;
  }

  /** Reversal point reached: set the next leg's turnouts, wait for the motors, drive the other way. */
  private startNextLeg(active: ActiveJob): void {
    const route = active.route!;
    const next = route.legs[active.legIndex + 1]!;
    const index = this.deps.layoutStore.getIndex();
    const { consistId } = active.job;
    let wait = 0;
    for (const t of next.turnoutStates) {
      if (this.deps.turnouts.get(t.pieceId) === t.state) continue;
      this.deps.interlocking.setTurnoutState(consistId, t.pieceId, t.state);
      if (!this.deps.turnouts.set(t.pieceId, t.state)) {
        this.fail(active, `Turnout ${t.pieceId} cannot be set to ${t.state}`);
        return;
      }
      wait = Math.max(wait, (index.pieces.get(t.pieceId)?.piece.switchTimeMs ?? 400) + 300);
    }
    this.update(active, { reason: `Reversing (leg ${active.legIndex + 2} of ${route.legs.length})` });
    active.legTimer = setTimeout(() => {
      active.legTimer = null;
      if (active.job.state !== 'running' && active.job.state !== 'held') return;
      active.legIndex++;
      this.deps.liveService.simulation.setStopPoint(consistId, next.stopAt);
      const verdict = this.deps.liveService.drive(consistId, next.movement, active.job.speedStep, 'dispatcher');
      if (!verdict.ok) this.fail(active, verdict.reason);
      else this.update(active, { movement: next.movement, reason: null });
    }, wait);
  }

  private fail(active: ActiveJob, reason: string): void {
    this.deps.liveService.stopTrain(active.job.consistId, 'dispatcher');
    this.deps.interlocking.releaseAll(active.job.consistId);
    this.deps.liveService.gate.revoke(active.job.consistId);
    active.actor.send({ type: 'REJECT' });
    this.stopMonitor(active);
    this.update(active, { reason });
  }

  abort(jobId: string): DispatchJob | null {
    const active = this.jobs.get(jobId);
    if (!active) return null;
    if (active.job.state === 'running' || active.job.state === 'held' || active.job.state === 'validated') {
      this.deps.liveService.stopTrain(active.job.consistId, 'dispatcher');
      this.deps.liveService.simulation.setStopPoint(active.job.consistId, null);
      this.deps.interlocking.releaseAll(active.job.consistId);
      this.deps.liveService.gate.revoke(active.job.consistId);
      active.actor.send({ type: 'ABORT' });
      this.stopMonitor(active);
      this.update(active, { reason: 'Aborted by operator' });
    }
    return active.job;
  }

  /**
   * Route that puts the middle of the train on the middle of a platform that is shorter
   * than the train: the leading end passes the centre and stops half a train length
   * beyond it. Both approach sides are planned; a route only counts when its leading end
   * really arrives travelling away from the centre — a route reaching the same point from
   * the other side would leave the whole train next to the platform.
   */
  private planCentred(
    index: LayoutIndex,
    graph: ReturnType<typeof buildTrackGraph>,
    consistId: string,
    pose: TrainPose,
    platform: Destination,
    trainLength: number,
    options: Parameters<typeof planRoute>[5],
    warnings: string[],
  ): Route | 'already-there' | null {
    const centre = blockCentre(index, platform);
    if (!centre) return null;
    const candidates: { route: Route; shortByMm: number }[] = [];
    let alreadyThere = false;
    for (const dir of [1, -1] as const) {
      const beyond = advance(index, { pos: centre, dir }, trainLength / 2, this.deps.turnouts.resolver);
      if (beyond.moved <= 1e-6) continue;
      const route = planRoute(index, graph, consistId, pose, beyond.pos, options);
      if (route === 'already-there') alreadyThere = true;
      if (typeof route === 'string') continue;
      if (route.legs[route.legs.length - 1]!.arrivalDir !== beyond.dir) continue;
      candidates.push({ route, shortByMm: trainLength / 2 - beyond.moved });
    }
    if (!candidates.length) return alreadyThere ? 'already-there' : null;
    // Properly centred first, then fewest legs, then shortest.
    candidates.sort((a, b) => a.shortByMm - b.shortByMm || a.route.legs.length - b.route.legs.length || a.route.lengthMm - b.route.lengthMm);
    const best = candidates[0]!;
    if (best.shortByMm > 1e-6) {
      warnings.push(`Only ${(trainLength / 2 - best.shortByMm).toFixed(0)} mm of track beyond the platform centre (${(trainLength / 2).toFixed(0)} mm needed): the train stops short of being centred`);
    }
    return best.route;
  }

  /**
   * Stop point inside the platform: the anchor moved `marginMm` toward the platform interior,
   * plus the direction along the path in which a leading end coming from the interior arrives there.
   */
  private stopPointInside(index: LayoutIndex, platform: Destination, anchor: TrackPosition, marginMm: number): { target: TrackPosition; arrivalDir: 1 | -1 } {
    const view = index.pieces.get(anchor.pieceId)!;
    const path = view.geom.paths.find((p) => p.id === anchor.pathId)!;
    const pathLen = path.primitives.reduce((sum, p) => sum + (p.kind === 'line' ? p.length : Math.abs(p.sweep) * p.radius), 0);
    const otherAnchor = anchor === platform.start ? platform.end : platform.start;
    let towardHigherS: boolean;
    if (platform.pieceIds.length <= 1 || otherAnchor.pieceId === anchor.pieceId) {
      towardHigherS = otherAnchor.s > anchor.s;
    } else {
      // Interior lies toward the neighbouring piece of the chain: find the connector joined to it.
      const neighbour = anchor === platform.start ? platform.pieceIds[1]! : platform.pieceIds[platform.pieceIds.length - 2]!;
      let exit: string | null = null;
      for (const c of view.geom.connectors) {
        const joint = index.jointByPort.get(`${anchor.pieceId}:${c.id}`);
        if (joint && otherPort(joint, { pieceId: anchor.pieceId, connectorId: c.id }).pieceId === neighbour) exit = c.id;
      }
      towardHigherS = exit === path.to;
    }
    const s = towardHigherS ? anchor.s + marginMm : anchor.s - marginMm;
    return { target: { ...anchor, s: Math.min(pathLen, Math.max(0, s)) }, arrivalDir: towardHigherS ? -1 : 1 };
  }

  private startMonitor(active: ActiveJob): void {
    const { consistId } = active.job;
    const sim = this.deps.liveService.simulation;
    const onArrived = ({ consistId: id }: { consistId: string }) => {
      if (id !== consistId || !active.route) return;
      if (active.legIndex < active.route.legs.length - 1) this.startNextLeg(active);
      else this.finish(active, 'arrived');
    };
    const onBlocked = ({ consistId: id, reason }: { consistId: string; reason: string }) => {
      if (id !== consistId) return;
      this.fail(active, `Stopped: ${reason}`);
    };
    sim.on('arrived', onArrived);
    sim.on('blocked', onBlocked);
    active.monitor = setInterval(() => this.recheck(active), RECHECK_INTERVAL_MS);
    active.cleanup = () => {
      sim.off('arrived', onArrived);
      sim.off('blocked', onBlocked);
    };
  }

  private stopMonitor(active: ActiveJob): void {
    if (active.monitor) clearInterval(active.monitor);
    active.monitor = null;
    if (active.legTimer) clearTimeout(active.legTimer);
    active.legTimer = null;
    active.cleanup?.();
  }

  private finish(active: ActiveJob, state: 'arrived'): void {
    this.deps.interlocking.releaseAll(active.job.consistId);
    this.deps.liveService.gate.revoke(active.job.consistId);
    active.actor.send({ type: 'ARRIVED' });
    this.stopMonitor(active);
    this.update(active, { progress: 1, reason: state === 'arrived' ? 'Arrived at platform' : null });
  }

  /** Rolling re-validation: release cleared pieces, hold when the way ahead is no longer free. */
  private recheck(active: ActiveJob): void {
    const { consistId } = active.job;
    const live = this.deps.trainState.get(consistId);
    const index = this.deps.layoutStore.getIndex();
    if (!live?.pose || !active.route) return;
    const length = this.deps.consistStore.totalLengthMm(this.deps.consistStore.require(consistId));
    const occupied = new Set(occupiedPieces(index, live.pose, length, this.deps.turnouts.resolver));
    const legs = active.route.legs;
    const leg = legs[active.legIndex]!;

    // Pieces still needed: the rest of the current leg (from the rear onward) and every later leg.
    const rearIdx = leg.pieceIds.findIndex((id) => occupied.has(id));
    const stillNeeded = new Set<string>([...leg.pieceIds.slice(Math.max(rearIdx, 0)), ...legs.slice(active.legIndex + 1).flatMap((l) => l.pieceIds)]);
    const held = this.deps.interlocking.claimsOf(consistId);
    if (held) {
      const behind = [...held.pieces].filter((id) => !occupied.has(id) && !stillNeeded.has(id) && !active.released.has(id));
      if (behind.length) {
        for (const id of behind) active.released.add(id);
        this.deps.interlocking.release(consistId, behind);
      }
    }

    // Progress over all legs, by pieces of the current leg already behind the train.
    const covered = Math.max(rearIdx, 0);
    const legProgress = leg.pieceIds.length > 1 ? Math.min(1, covered / (leg.pieceIds.length - 1)) : 0;
    const progress = Math.min(1, (active.legIndex + legProgress) / legs.length);

    if (active.legTimer) {
      if (Math.abs(progress - active.job.progress) > 0.01) this.update(active, { progress });
      return; // waiting at a reversal point for the point motors
    }

    // Way ahead: any piece of the remaining route occupied by another train → hold.
    const ahead = new Set([...leg.pieceIds.slice(rearIdx + 1), ...legs.slice(active.legIndex + 1).flatMap((l) => l.pieceIds)]);
    for (const id of occupied) ahead.delete(id);
    let blocked = false;
    for (const other of this.deps.trainState.list()) {
      if (other.consistId === consistId) continue;
      if (other.occupiedPieceIds.some((id) => ahead.has(id))) blocked = true;
    }
    if (blocked && active.job.state === 'running') {
      this.deps.liveService.stopTrain(consistId, 'dispatcher');
      active.actor.send({ type: 'HOLD' });
      this.update(active, { progress, reason: 'Holding: another train ahead on the route' });
      return;
    }
    if (!blocked && active.job.state === 'held') {
      this.deps.liveService.simulation.setStopPoint(consistId, leg.stopAt);
      const verdict = this.deps.liveService.drive(consistId, leg.movement, active.job.speedStep, 'dispatcher');
      if (verdict.ok) {
        active.actor.send({ type: 'RESUME' });
        this.update(active, { progress, reason: null });
      }
      return;
    }
    if (Math.abs(progress - active.job.progress) > 0.01) this.update(active, { progress });
  }

  private update(active: ActiveJob, patch: Partial<DispatchJob>): void {
    const value = active.actor.getSnapshot().value;
    active.job = { ...active.job, ...patch, state: (typeof value === 'string' ? value : 'planned') as DispatchJob['state'], updatedAt: Date.now() };
    this.emit('jobs', this.list());
  }
}
