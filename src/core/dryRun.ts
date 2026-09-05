import { facingDegOf, occupiedPieces } from '../../shared/src/domain/pose.ts';
import type { TrainPose } from '../../shared/src/domain/train.ts';
import type { LayoutIndex } from '../../shared/src/layout/index.ts';
import type { Route } from './routePlanner.ts';
import { SIM_STEP_MS, type Simulation } from './simulation.ts';

/** One recorded moment of a dry-run: the same fields the live engine produces. */
export interface SimulationStep {
  timestampMs: number;
  front: TrainPose['front'];
  rear: TrainPose['rear'];
  facingDeg: number;
  movement: TrainPose['movement'];
  speedMmS: number;
  occupiedPieceIds: string[];
  claimedPieceIds: string[];
  turnoutStates: Record<string, string>;
}

export interface TurnoutSchedule {
  pieceId: string;
  state: string;
  /** Simulated time at which the leading end reaches the turnout. */
  arrivalMs: number;
  /** Latest moment the throw command may be sent (arrival − switch time − margin). */
  latestCommandMs: number;
  /** Whether the throw must happen before departure (arrival is too soon otherwise). */
  throwBeforeDeparture: boolean;
}

export interface DryRunOptions {
  index: LayoutIndex;
  /** Live simulation to clone; other trains stay where they are as obstacles. */
  simulation: Simulation;
  route: Route;
  /** Speed step to drive at (DCC), converted with the consist calibration. */
  targetMmS: number;
  /** Pieces claimed by other trains — entering one is a conflict. */
  foreignPieceIds: Set<string>;
  /** Switch time per turnout piece (ms). */
  switchTimeMs: (pieceId: string) => number;
  /** Abort after this much simulated time. */
  maxSimMs?: number;
  /** Record a step every `sampleMs` of simulated time. */
  sampleMs?: number;
}

export interface DryRunResult {
  status: 'validated' | 'failed';
  issues: string[];
  steps: SimulationStep[];
  durationMs: number;
  turnoutSchedule: TurnoutSchedule[];
  arrivalPose: TrainPose | null;
}

const SWITCH_MARGIN_MS = 300;
/** A train that stands still this long (simulated) without having arrived is stuck. */
const STALL_LIMIT_MS = 3000;

/**
 * Virtual run of a route on a cloned simulation with the very same step size and rules
 * as the live engine. Nothing may be sent to the layout unless the result is `validated`.
 */
export function dryRun(options: DryRunOptions): DryRunResult {
  const { index, route } = options;
  const sampleMs = options.sampleMs ?? 250;
  const maxSimMs = options.maxSimMs ?? 20 * 60 * 1000;
  const issues: string[] = [];
  if (!options.simulation.trains.has(route.consistId)) {
    return { status: 'failed', issues: ['Train has no position'], steps: [], durationMs: 0, turnoutSchedule: [], arrivalPose: null };
  }

  // Turnouts of the current leg are assumed thrown; everything else keeps its current state.
  // Later legs may need the same turnout in another position (reversing over it).
  const legs = route.legs.length ? route.legs : [{ movement: route.movement, steps: route.steps, turnoutStates: route.turnoutStates, stopAt: route.stopAt, lengthMm: route.lengthMm, pieceIds: route.pieceIds }];
  let legIndex = 0;
  const wanted = new Map(legs[0]!.turnoutStates.map((t) => [t.pieceId, t.state]));
  const baseStates = options.simulation.deps.turnoutStates;
  const states = (pieceId: string) => wanted.get(pieceId) ?? baseStates(pieceId);
  const simWithStates = options.simulation.clone({ turnoutStates: states });
  // Other trains are frozen obstacles during the dry-run.
  for (const t of simWithStates.trains.values()) {
    if (t.consistId !== route.consistId) {
      t.targetMmS = 0;
      t.pose = { ...t.pose, speedMmS: 0, movement: 'stopped' };
    }
  }
  const me = simWithStates.trains.get(route.consistId)!;
  const lengthOf = (id: string) => simWithStates.deps.getLength(id);
  // Other trains are obstacles — unless their pose refers to track that no longer exists (stale after a layout edit).
  const otherTrains = [...simWithStates.trains.values()].filter(
    (t) => t.consistId !== route.consistId && index.pieces.has(t.pose.front.pos.pieceId) && index.pieces.has(t.pose.rear.pos.pieceId),
  );
  const otherOccupied = new Set<string>();
  for (const o of otherTrains) {
    for (const id of occupiedPieces(index, o.pose, lengthOf(o.consistId), states)) otherOccupied.add(id);
  }
  // A train standing on the route can never be passed (the collision protection would hold us behind it).
  for (const id of route.pieceIds) {
    if (otherOccupied.has(id)) issues.push(`Conflict: piece ${id} is occupied by another train`);
  }
  if (issues.length) return { status: 'failed', issues, steps: [], durationMs: 0, turnoutSchedule: [], arrivalPose: null };

  const steps: SimulationStep[] = [];
  const arrivals = new Map<string, number>();
  let arrived = false;
  let blocked: string | null = null;
  let t = 0;
  /** Simulated time at which the next leg may start (point motors of the reversal turnouts). */
  let holdUntil = -1;
  let pendingLeg = false;

  const startLeg = (i: number) => {
    const leg = legs[i]!;
    for (const ts of leg.turnoutStates) wanted.set(ts.pieceId, ts.state);
    simWithStates.drive(route.consistId, leg.movement, options.targetMmS);
    simWithStates.setStopPoint(route.consistId, leg.stopAt);
  };
  startLeg(0);

  simWithStates.on('arrived', () => {
    if (legIndex < legs.length - 1) {
      // Reversal point reached: wait for the turnouts of the next leg, then continue the other way.
      const next = legs[legIndex + 1]!;
      const switching = next.turnoutStates.filter((ts) => wanted.get(ts.pieceId) !== ts.state);
      const wait = switching.length ? Math.max(...switching.map((ts) => options.switchTimeMs(ts.pieceId))) + SWITCH_MARGIN_MS : 0;
      holdUntil = t + wait;
      pendingLeg = true;
      return;
    }
    arrived = true;
  });
  simWithStates.on('blocked', (e) => {
    blocked = e.reason;
  });

  let nextSample = 0;
  const record = () => {
    const pose = me.pose;
    const occ = occupiedPieces(index, pose, lengthOf(route.consistId), states);
    steps.push({
      timestampMs: t,
      front: pose.front,
      rear: pose.rear,
      facingDeg: facingDegOf(index, pose),
      movement: pose.movement,
      speedMmS: pose.speedMmS,
      occupiedPieceIds: occ,
      claimedPieceIds: route.pieceIds,
      turnoutStates: Object.fromEntries(wanted),
    });
    for (const id of occ) {
      if (options.foreignPieceIds.has(id) && !issues.some((i) => i.includes(id))) issues.push(`Conflict: piece ${id} is claimed by another train`);
      if (otherOccupied.has(id) && !issues.some((i) => i.includes(id))) issues.push(`Conflict: piece ${id} is occupied by another train`);
      if (wanted.has(id) && !arrivals.has(id)) arrivals.set(id, t);
    }
  };
  record();

  /** Simulated time since the train last moved while it was supposed to (held by an obstacle, etc.). */
  let stalledMs = 0;
  while (t < maxSimMs && !arrived && !blocked && stalledMs < STALL_LIMIT_MS) {
    if (pendingLeg && t >= holdUntil) {
      pendingLeg = false;
      legIndex++;
      startLeg(legIndex);
    }
    simWithStates.step(SIM_STEP_MS);
    t += SIM_STEP_MS;
    if (t >= nextSample) {
      record();
      nextSample += sampleMs;
    }
    stalledMs = !pendingLeg && me.pose.speedMmS === 0 && t > 1000 ? stalledMs + SIM_STEP_MS : 0;
  }
  record();

  if (blocked) issues.push(`Route is blocked: ${blocked}`);
  if (!arrived && !blocked) issues.push(t >= maxSimMs ? 'Train did not reach its destination within the time limit' : 'Train stopped before reaching its destination');

  const turnoutSchedule: TurnoutSchedule[] = route.turnoutStates.map((ts) => {
    const arrivalMs = arrivals.get(ts.pieceId) ?? Infinity;
    const latest = arrivalMs - options.switchTimeMs(ts.pieceId) - SWITCH_MARGIN_MS;
    return { pieceId: ts.pieceId, state: ts.state, arrivalMs, latestCommandMs: latest, throwBeforeDeparture: latest <= 0 };
  });
  for (const ts of turnoutSchedule) {
    if (!Number.isFinite(ts.arrivalMs)) issues.push(`Turnout ${ts.pieceId} on the route is never reached`);
  }

  return {
    status: issues.length ? 'failed' : 'validated',
    issues,
    steps,
    durationMs: t,
    turnoutSchedule,
    arrivalPose: arrived ? me.pose : null,
  };
}
