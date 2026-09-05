import EventEmitter from 'node:events';
import { movePose, occupiedPieces, type PlacementError } from '../../shared/src/domain/pose.ts';
import { brakingDistance, speedLimitForRestriction, type SpeedCalibration } from '../../shared/src/domain/speedModel.ts';
import type { Consist, TrainPose, TrainStateId, Traversal } from '../../shared/src/domain/train.ts';
import { trainIntervals, trainsOverlap } from '../../shared/src/domain/trainGeometry.ts';
import { blockWorldSegments } from '../../shared/src/layout/blockGeometry.ts';
import type { LayoutIndex } from '../../shared/src/layout/index.ts';
import { advance, type TurnoutStates } from '../../shared/src/layout/traverse.ts';
import type { TrackPosition } from '../../shared/src/layout/schema.ts';
import { createTrainActor, trainStateIdOf, type TrainActor } from './trainMachine.ts';

export interface SimulationDeps {
  getIndex: () => LayoutIndex;
  turnoutStates: TurnoutStates;
  getConsist: (consistId: string) => Consist | undefined;
  getLength: (consistId: string) => number;
  /** Calibration of the leading locomotive (speed per DCC step). */
  getCalibration: (consistId: string) => SpeedCalibration | undefined;
}

export interface SimTrain {
  consistId: string;
  pose: TrainPose;
  actor: TrainActor;
  /** Desired speed magnitude (mm/s) set by the operator or the dispatcher. */
  targetMmS: number;
  /** Optional stop point the train must not pass (distance measured along the movement). */
  stopAt: TrackPosition | null;
  /** Extra speed cap from the interlocking / dispatcher (mm/s), Infinity = none. */
  externalLimitMmS: number;
  blocked?: PlacementError;
  /** Direction change requested while moving: applied once the train has stopped. */
  pendingMovement?: 'forward' | 'reverse';
  pendingTarget?: number;
}

export interface SimulationEvents {
  /** Emitted every step for trains whose pose changed. */
  moved: [{ consistId: string; pose: TrainPose; state: TrainStateId }];
  /** A train hit an open end / buffer / turnout against it and was emergency-stopped. */
  blocked: [{ consistId: string; reason: PlacementError; pose: TrainPose }];
  /** The train reached its stop point. */
  arrived: [{ consistId: string; pose: TrainPose }];
  /** Two trains physically overlap: both were emergency-stopped. */
  collision: [{ consistIds: [string, string]; pieceId: string }];
}

/** Fixed simulation step (ms). Every run — live or dry-run — uses the same step size. */
export const SIM_STEP_MS = 20;
/** A moving train keeps at least this much clear track between itself and the train ahead. */
export const COLLISION_GAP_MM = 40;

/**
 * Deterministic fixed-step simulation of train motion on the exact track geometry.
 * Speed is integrated with constant acceleration/braking per consist; positions move
 * along arc length through `movePose`, so front and rear stay exactly one train
 * length apart along the rail.
 *
 * The same class drives the live layout and the dry-run: `step()` is pure with respect
 * to its inputs, the wall clock only decides how many steps to run.
 */
export class Simulation extends EventEmitter<SimulationEvents> {
  readonly trains = new Map<string, SimTrain>();
  readonly deps: SimulationDeps;
  private timer: NodeJS.Timeout | null = null;
  private accumulatorMs = 0;
  private lastTick = 0;
  simTimeMs = 0;

  constructor(deps: SimulationDeps) {
    super();
    this.deps = deps;
  }

  /** Register (or replace) a train at a pose; keeps its machine when already known. */
  track(consistId: string, pose: TrainPose, state: TrainStateId = 'stopped'): SimTrain {
    const existing = this.trains.get(consistId);
    if (existing) {
      existing.pose = pose;
      return existing;
    }
    const t: SimTrain = { consistId, pose, actor: createTrainActor(state), targetMmS: 0, stopAt: null, externalLimitMmS: Infinity };
    this.trains.set(consistId, t);
    return t;
  }

  untrack(consistId: string): void {
    const t = this.trains.get(consistId);
    if (t) t.actor.stop();
    this.trains.delete(consistId);
  }

  /** Copy of the simulation with cloned trains (for dry-runs); dependencies may be overridden. */
  clone(overrides: Partial<SimulationDeps> = {}): Simulation {
    const sim = new Simulation({ ...this.deps, ...overrides });
    for (const t of this.trains.values()) {
      const copy = sim.track(t.consistId, structuredClone(t.pose), trainStateIdOf(t.actor));
      copy.targetMmS = t.targetMmS;
      copy.stopAt = t.stopAt ? { ...t.stopAt } : null;
      copy.externalLimitMmS = t.externalLimitMmS;
      if (t.targetMmS > 0) copy.actor.send({ type: 'SET_TARGET', targetMmS: t.targetMmS });
    }
    sim.simTimeMs = this.simTimeMs;
    return sim;
  }

  /** Set the desired speed (magnitude) and movement direction. */
  drive(consistId: string, movement: 'forward' | 'reverse', targetMmS: number): void {
    const t = this.trains.get(consistId);
    if (!t) return;
    const state = trainStateIdOf(t.actor);
    if (state === 'emergency') t.actor.send({ type: 'RESET' });
    if (state === 'unknown') t.actor.send({ type: 'CONFIRMED' });
    if (t.pose.speedMmS > 0.5 && t.pose.movement !== movement) {
      // Direction change while moving: brake to a stop first, then the new direction applies.
      t.targetMmS = 0;
      t.actor.send({ type: 'STOP' });
      t.pendingMovement = movement;
      t.pendingTarget = targetMmS;
      return;
    }
    t.pose = { ...t.pose, movement: targetMmS > 0 ? movement : t.pose.movement };
    t.targetMmS = targetMmS;
    t.actor.send(targetMmS > 0 ? { type: 'SET_TARGET', targetMmS } : { type: 'STOP' });
    t.blocked = undefined;
  }

  stop(consistId: string): void {
    const t = this.trains.get(consistId);
    if (!t) return;
    t.targetMmS = 0;
    t.pendingMovement = undefined;
    t.actor.send({ type: 'STOP' });
  }

  emergencyStop(consistId?: string): void {
    for (const t of this.trains.values()) {
      if (consistId && t.consistId !== consistId) continue;
      t.targetMmS = 0;
      t.pendingMovement = undefined;
      t.pose = { ...t.pose, speedMmS: 0, movement: 'stopped' };
      t.actor.send({ type: 'EMERGENCY' });
      this.emit('moved', { consistId: t.consistId, pose: t.pose, state: 'emergency' });
    }
  }

  reset(consistId: string): void {
    const t = this.trains.get(consistId);
    if (!t) return;
    t.actor.send({ type: 'RESET' });
    t.blocked = undefined;
  }

  setStopPoint(consistId: string, stopAt: TrackPosition | null): void {
    const t = this.trains.get(consistId);
    if (t) t.stopAt = stopAt;
  }

  setExternalLimit(consistId: string, limitMmS: number): void {
    const t = this.trains.get(consistId);
    if (t) t.externalLimitMmS = limitMmS;
  }

  stateOf(consistId: string): TrainStateId {
    const t = this.trains.get(consistId);
    return t ? trainStateIdOf(t.actor) : 'unknown';
  }

  /** Speed cap from speed restrictions on the pieces under and directly ahead of the train. */
  speedLimitFor(t: SimTrain, index: LayoutIndex, lookaheadMm: number): number {
    const cal = this.deps.getCalibration(t.consistId);
    const length = this.deps.getLength(t.consistId);
    const under = occupiedPieces(index, t.pose, length, this.deps.turnoutStates);
    const lead = t.pose.movement === 'reverse' ? { pos: t.pose.rear.pos, dir: (t.pose.rear.dir === 1 ? -1 : 1) as 1 | -1 } : t.pose.front;
    const ahead = advance(index, lead, lookaheadMm, this.deps.turnoutStates).entered;
    const pieces = new Set([...under, ...ahead]);
    let limit = t.externalLimitMmS;
    for (const r of index.doc.speedRestrictions) {
      if (blockWorldSegments(index, r).some((s) => pieces.has(s.pieceId))) {
        limit = Math.min(limit, speedLimitForRestriction(cal, r.maxSpeedStep));
      }
    }
    return limit;
  }

  /** Distance along the movement from the leading end to the stop point, or null when not ahead. */
  distanceToStop(t: SimTrain, index: LayoutIndex, maxMm: number): number | null {
    if (!t.stopAt) return null;
    const lead = t.pose.movement === 'reverse' ? { pos: t.pose.rear.pos, dir: (t.pose.rear.dir === 1 ? -1 : 1) as 1 | -1 } : t.pose.front;
    // Walk ahead in small exact hops until the stop piece/path is reached.
    let remaining = maxMm;
    let cur = lead;
    let travelled = 0;
    let guard = 0;
    while (remaining > 0 && guard++ < 10_000) {
      if (cur.pos.pieceId === t.stopAt.pieceId && cur.pos.pathId === t.stopAt.pathId) {
        const d = cur.dir === 1 ? t.stopAt.s - cur.pos.s : cur.pos.s - t.stopAt.s;
        if (d >= -1e-6) return travelled + Math.max(0, d);
      }
      const view = index.pieces.get(cur.pos.pieceId);
      if (!view) return null;
      const path = view.geom.paths.find((p) => p.id === cur.pos.pathId)!;
      const len = path.primitives.reduce((sum, p) => sum + (p.kind === 'line' ? p.length : Math.abs(p.sweep) * p.radius), 0);
      const room = cur.dir === 1 ? len - cur.pos.s : cur.pos.s;
      const hop = Math.min(room + 1e-3, remaining);
      const r = advance(index, cur, hop, this.deps.turnoutStates);
      if (r.blocked) return null;
      travelled += r.moved;
      remaining -= r.moved;
      cur = { pos: r.pos, dir: r.dir };
      if (r.moved <= 1e-9) break;
    }
    return null;
  }

  /** Leading end of a train in its direction of movement (nose when forward, tail when reversing). */
  private leadingEnd(t: SimTrain): Traversal {
    return t.pose.movement === 'reverse' ? { pos: t.pose.rear.pos, dir: (t.pose.rear.dir === 1 ? -1 : 1) as 1 | -1 } : t.pose.front;
  }

  /**
   * Distance along the movement from the leading end to the nearest other train (its
   * closest end), or null when no train is within `maxMm`. Pieces occupied by another
   * train whose ends lie on a different path (e.g. the other leg of a turnout) count from
   * the moment we would enter that piece.
   */
  obstacleDistance(t: SimTrain, index: LayoutIndex, maxMm: number): { distance: number; consistId: string } | null {
    const others = [...this.trains.values()].filter(
      (o) => o.consistId !== t.consistId && index.pieces.has(o.pose.front.pos.pieceId) && index.pieces.has(o.pose.rear.pos.pieceId),
    );
    if (!others.length) return null;
    const ends: { pos: TrackPosition; consistId: string }[] = [];
    const occupiedBy = new Map<string, string>();
    for (const o of others) {
      ends.push({ pos: o.pose.front.pos, consistId: o.consistId }, { pos: o.pose.rear.pos, consistId: o.consistId });
      for (const id of occupiedPieces(index, o.pose, this.deps.getLength(o.consistId), this.deps.turnoutStates)) occupiedBy.set(id, o.consistId);
    }

    let cur = this.leadingEnd(t);
    let remaining = maxMm;
    let travelled = 0;
    let guard = 0;
    let first = true;
    while (remaining > 0 && guard++ < 10_000) {
      let best: { distance: number; consistId: string } | null = null;
      for (const e of ends) {
        if (e.pos.pieceId !== cur.pos.pieceId || e.pos.pathId !== cur.pos.pathId) continue;
        const d = cur.dir === 1 ? e.pos.s - cur.pos.s : cur.pos.s - e.pos.s;
        if (d >= -1e-6 && (!best || travelled + d < best.distance)) best = { distance: travelled + Math.max(0, d), consistId: e.consistId };
      }
      if (best) return best;
      // A freshly entered piece that another train occupies (ends on another path of it): stop at its edge.
      if (!first && occupiedBy.has(cur.pos.pieceId)) return { distance: travelled, consistId: occupiedBy.get(cur.pos.pieceId)! };
      first = false;

      const view = index.pieces.get(cur.pos.pieceId);
      if (!view) return null;
      const path = view.geom.paths.find((p) => p.id === cur.pos.pathId)!;
      const len = path.primitives.reduce((sum, p) => sum + (p.kind === 'line' ? p.length : Math.abs(p.sweep) * p.radius), 0);
      const room = cur.dir === 1 ? len - cur.pos.s : cur.pos.s;
      const hop = Math.min(room + 1e-3, remaining);
      const r = advance(index, cur, hop, this.deps.turnoutStates);
      if (r.blocked) return null;
      travelled += r.moved;
      remaining -= r.moved;
      cur = { pos: r.pos, dir: r.dir };
      if (r.moved <= 1e-9) break;
    }
    return null;
  }

  /** Pairs of trains that physically overlap right now. */
  detectCollisions(index: LayoutIndex): { a: string; b: string; pieceId: string }[] {
    const list = [...this.trains.values()].filter((o) => index.pieces.has(o.pose.front.pos.pieceId) && index.pieces.has(o.pose.rear.pos.pieceId));
    const intervals = new Map(list.map((o) => [o.consistId, trainIntervals(index, o.pose, this.deps.getLength(o.consistId), this.deps.turnoutStates)]));
    const out: { a: string; b: string; pieceId: string }[] = [];
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const hit = trainsOverlap(intervals.get(list[i]!.consistId)!, intervals.get(list[j]!.consistId)!);
        if (hit) out.push({ a: list[i]!.consistId, b: list[j]!.consistId, pieceId: hit.pieceId });
      }
    }
    return out;
  }

  /** Stop every train where it stands (track power lost / shutdown): no emergency, just a hard stop. */
  haltAll(): void {
    for (const t of this.trains.values()) {
      t.targetMmS = 0;
      t.stopAt = null;
      t.pendingMovement = undefined;
      t.pendingTarget = undefined;
      if (t.pose.speedMmS > 0 || t.pose.movement !== 'stopped') {
        t.pose = { ...t.pose, speedMmS: 0, movement: 'stopped' };
      }
      const state = trainStateIdOf(t.actor);
      if (state !== 'emergency' && state !== 'unknown') {
        t.actor.send({ type: 'STOP' });
        t.actor.send({ type: 'TICK', speedMmS: 0 });
      }
      this.emit('moved', { consistId: t.consistId, pose: t.pose, state: trainStateIdOf(t.actor) });
    }
  }

  /** Advance the whole simulation by one fixed step. */
  step(dtMs: number = SIM_STEP_MS): void {
    const dt = dtMs / 1000;
    const index = this.deps.getIndex();
    this.simTimeMs += dtMs;

    for (const t of this.trains.values()) {
      const consist = this.deps.getConsist(t.consistId);
      if (!consist) continue;
      if (!index.pieces.has(t.pose.front.pos.pieceId) || !index.pieces.has(t.pose.rear.pos.pieceId)) continue;
      const state = trainStateIdOf(t.actor);
      if (state === 'emergency' || state === 'unknown') continue;

      const v0 = t.pose.speedMmS;
      const accel = consist.accelerationMmS2;
      const brake = consist.brakingMmS2;
      const lookahead = brakingDistance(v0, brake) + 300;
      const limit = this.speedLimitFor(t, index, lookahead);
      let target = Math.min(t.targetMmS, limit);

      // Stop point: brake so that we come to rest exactly there.
      let toStop = this.distanceToStop(t, index, lookahead + 50);
      if (toStop != null) {
        const vAllowed = Math.sqrt(Math.max(0, 2 * brake * toStop));
        target = Math.min(target, vAllowed);
      }

      // Collision protection: never get closer than COLLISION_GAP_MM to the train ahead.
      if (t.targetMmS > 0 || v0 > 0) {
        const obstacle = this.obstacleDistance(t, index, lookahead + COLLISION_GAP_MM + 50);
        if (obstacle) {
          const room = Math.max(0, obstacle.distance - COLLISION_GAP_MM);
          target = Math.min(target, Math.sqrt(2 * brake * room));
          toStop = toStop == null ? room : Math.min(toStop, room);
        }
      }

      // Keep the state machine informed about the effective target (restrictions, stop points).
      if (Math.abs(t.actor.getSnapshot().context.targetMmS - target) > 0.5) {
        t.actor.send({ type: 'SET_TARGET', targetMmS: target });
      }

      let v1: number;
      if (target > v0) v1 = Math.min(target, v0 + accel * dt);
      else v1 = Math.max(target, v0 - brake * dt);
      if (v1 < 0.5 && target < 0.5) v1 = 0;

      let distance = ((v0 + v1) / 2) * dt;
      if (toStop != null) distance = Math.min(distance, toStop);

      if (t.pose.movement === 'stopped' && v1 > 0) {
        t.pose = { ...t.pose, movement: 'forward' };
      }

      let pose: TrainPose = { ...t.pose, speedMmS: v1 };
      if (distance > 0 && pose.movement !== 'stopped') {
        const moved = movePose(index, pose, distance, this.deps.turnoutStates);
        pose = moved.pose;
        if (moved.blocked) {
          t.blocked = moved.blocked;
          t.targetMmS = 0;
          t.pose = { ...pose, speedMmS: 0, movement: 'stopped' };
          t.actor.send({ type: 'EMERGENCY' });
          this.emit('blocked', { consistId: t.consistId, reason: moved.blocked, pose: t.pose });
          this.emit('moved', { consistId: t.consistId, pose: t.pose, state: 'emergency' });
          continue;
        }
      }

      // "Arrived" only refers to the train's own stop point, not to a halt behind another train.
      const ownStop = this.distanceToStop(t, index, lookahead + 50);
      const arrived = ownStop != null && ownStop - distance <= 1e-6 && v1 <= 0.5;
      if (arrived) {
        pose = { ...pose, speedMmS: 0 };
        t.stopAt = null;
        t.targetMmS = 0;
      }
      t.actor.send({ type: 'TICK', speedMmS: pose.speedMmS });
      const nextState = trainStateIdOf(t.actor);
      if (nextState === 'stopped') {
        pose = { ...pose, speedMmS: 0 };
        if (t.pendingMovement) {
          const movement = t.pendingMovement;
          const target2 = t.pendingTarget ?? 0;
          t.pendingMovement = undefined;
          t.pendingTarget = undefined;
          t.pose = pose;
          this.drive(t.consistId, movement, target2);
          this.emit('moved', { consistId: t.consistId, pose: t.pose, state: trainStateIdOf(t.actor) });
          continue;
        }
      }
      const changed = pose !== t.pose && (pose.speedMmS !== t.pose.speedMmS || pose.front.pos.s !== t.pose.front.pos.s || pose.front.pos.pieceId !== t.pose.front.pos.pieceId);
      t.pose = pose;
      if (changed || nextState !== state) {
        this.emit('moved', { consistId: t.consistId, pose, state: nextState });
      }
      if (arrived) this.emit('arrived', { consistId: t.consistId, pose });
    }

    // Last line of defence: trains that overlap anyway (manual placement, sensor snap) are stopped.
    for (const hit of this.detectCollisions(index)) {
      for (const id of [hit.a, hit.b]) {
        const t = this.trains.get(id)!;
        if (trainStateIdOf(t.actor) === 'emergency') continue;
        t.targetMmS = 0;
        t.pose = { ...t.pose, speedMmS: 0, movement: 'stopped' };
        t.actor.send({ type: 'EMERGENCY' });
        this.emit('moved', { consistId: id, pose: t.pose, state: 'emergency' });
      }
      this.emit('collision', { consistIds: [hit.a, hit.b], pieceId: hit.pieceId });
    }
  }

  /** Run in real time: accumulate wall-clock time and execute whole fixed steps. */
  start(): void {
    if (this.timer) return;
    this.lastTick = performance.now();
    this.timer = setInterval(() => {
      const now = performance.now();
      this.accumulatorMs += Math.min(500, now - this.lastTick);
      this.lastTick = now;
      while (this.accumulatorMs >= SIM_STEP_MS) {
        this.step(SIM_STEP_MS);
        this.accumulatorMs -= SIM_STEP_MS;
      }
    }, SIM_STEP_MS);
  }

  stopClock(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  get running(): boolean {
    return this.timer !== null;
  }
}
