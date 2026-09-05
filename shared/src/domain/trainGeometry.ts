import { compose, type Frame } from '../geometry/frame.ts';
import { getPath } from '../geometry/pieceGeometry.ts';
import { pathLength, pathPoseAt, slicePath } from '../geometry/primitives.ts';
import { blockWorldSegments, type WorldSegment } from '../layout/blockGeometry.ts';
import { pathWorldStart, type LayoutIndex } from '../layout/index.ts';
import { advance, type TurnoutStates } from '../layout/traverse.ts';
import type { TrainPose } from './train.ts';

/**
 * Exact rail segments covered by a train, from the rear to the front. Walks the track
 * piece by piece with `advance`, so the result follows the same turnout positions the
 * train itself is standing on.
 */
export function trainWorldSegments(index: LayoutIndex, pose: TrainPose, lengthMm: number, states?: TurnoutStates): WorldSegment[] {
  const out: WorldSegment[] = [];
  let t = pose.rear;
  let remaining = lengthMm;
  let guard = 0;
  while (remaining > 1e-6 && guard++ < 10_000) {
    const view = index.pieces.get(t.pos.pieceId);
    if (!view) break;
    const path = getPath(view.geom, t.pos.pathId);
    const len = pathLength(path.primitives);
    const room = t.dir === 1 ? len - t.pos.s : t.pos.s;
    const take = Math.min(room, remaining);
    const s0 = t.dir === 1 ? t.pos.s : t.pos.s - take;
    const s1 = s0 + take;
    if (take > 1e-9) {
      const prims = slicePath(path.primitives, s0, s1);
      const start = compose(pathWorldStart(view, path.id), pathPoseAt(path.primitives, s0));
      out.push({ pieceId: view.piece.id, pathId: path.id, primitives: prims, start, lengthMm: take, pathFromS: t.dir === 1 ? s0 : s1, pathToS: t.dir === 1 ? s1 : s0 });
    }
    remaining -= take;
    if (remaining <= 1e-6) break;
    // Step into the next piece by advancing an infinitesimal amount past the connector.
    const step = advance(index, { pos: { ...t.pos, s: t.dir === 1 ? len : 0 }, dir: t.dir }, 1e-6, states);
    if (step.blocked || step.entered.length === 0) break;
    t = { pos: step.pos, dir: step.dir };
    // Rewind the tiny step so the next slice starts exactly at the connector.
    t = { pos: { ...t.pos, s: t.dir === 1 ? 0 : pathLength(getPath(index.pieces.get(t.pos.pieceId)!.geom, t.pos.pathId).primitives) }, dir: t.dir };
  }
  return out;
}

/**
 * Turnouts under a standing train, each with the state that matches the path the train
 * stands on (front and rear paths come from the pose itself, pieces in between from the
 * current states). They must be in these positions before the train moves, otherwise a
 * wheel set would run against the points.
 */
export function standingTurnoutStates(index: LayoutIndex, pose: TrainPose, lengthMm: number, states?: TurnoutStates): { pieceId: string; state: string }[] {
  const pathUnder = new Map<string, string>();
  for (const seg of trainWorldSegments(index, pose, lengthMm, states)) pathUnder.set(seg.pieceId, seg.pathId);
  pathUnder.set(pose.rear.pos.pieceId, pose.rear.pos.pathId);
  pathUnder.set(pose.front.pos.pieceId, pose.front.pos.pathId);
  const out: { pieceId: string; state: string }[] = [];
  for (const [pieceId, pathId] of pathUnder) {
    const state = index.pieces.get(pieceId)?.geom.states?.find((s) => s.paths.includes(pathId));
    if (state) out.push({ pieceId, state: state.id });
  }
  return out;
}

/** Arc-length interval a train covers on one path (s0 ≤ s1). */
export interface TrackInterval {
  pieceId: string;
  pathId: string;
  s0: number;
  s1: number;
}

/** Exact intervals occupied by a train, per piece path. */
export function trainIntervals(index: LayoutIndex, pose: TrainPose, lengthMm: number, states?: TurnoutStates): TrackInterval[] {
  return trainWorldSegments(index, pose, lengthMm, states).map((seg) => ({
    pieceId: seg.pieceId,
    pathId: seg.pathId,
    s0: Math.min(seg.pathFromS, seg.pathToS),
    s1: Math.max(seg.pathFromS, seg.pathToS),
  }));
}

/** Whether two trains physically overlap somewhere (same path, overlapping intervals). */
export function trainsOverlap(a: TrackInterval[], b: TrackInterval[], toleranceMm = 1e-6): TrackInterval | null {
  for (const x of a) {
    for (const y of b) {
      if (x.pieceId !== y.pieceId || x.pathId !== y.pathId) continue;
      if (x.s0 < y.s1 - toleranceMm && y.s0 < x.s1 - toleranceMm) return x;
    }
  }
  return null;
}

/** World pose (position + heading) of the nose. */
export function noseFrame(index: LayoutIndex, pose: TrainPose): Frame {
  const view = index.pieces.get(pose.front.pos.pieceId)!;
  const path = getPath(view.geom, pose.front.pos.pathId);
  const f = compose(pathWorldStart(view, path.id), pathPoseAt(path.primitives, pose.front.pos.s));
  return pose.front.dir === 1 ? f : { x: f.x, y: f.y, theta: f.theta + Math.PI };
}

export { blockWorldSegments };
