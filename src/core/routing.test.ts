import { describe, expect, it } from 'vitest';
import { poseFromFront } from '../../shared/src/domain/pose.ts';
import type { Consist } from '../../shared/src/domain/train.ts';
import { buildLayoutIndex, type LayoutIndex } from '../../shared/src/layout/index.ts';
import { attachNewPiece, placeFreePiece } from '../../shared/src/layout/ops.ts';
import { emptyLayout, type LayoutDocument } from '../../shared/src/layout/schema.ts';
import { dryRun } from './dryRun.ts';
import { Interlocking } from './interlocking.ts';
import { planRoute } from './routePlanner.ts';
import { Simulation } from './simulation.ts';
import { buildTrackGraph } from './trackGraph.ts';

const consist: Consist = { id: 'c1', name: 'A', units: [{ kind: 'loco', dccId: '3', orientation: 'forward' }], couplingGapMm: 0, accelerationMmS2: 150, brakingMmS2: 250 };
const LENGTH = 150;

/**
 * Yard: straight ── turnout ─(main)─ straight ── straight
 *                       └─(branch)─ straight ── straight
 */
function yard() {
  let { doc, pieceId: s0 } = placeFreePiece(emptyLayout(), 'k-s-2200', { x: 0, y: 0, theta: 0 });
  const s1 = attachNewPiece(doc, 'k-s-2200', 'A', { pieceId: s0, connectorId: 'B' });
  const t = attachNewPiece(s1.doc, 'k-t-2263-R', 'A', { pieceId: s1.pieceId, connectorId: 'B' });
  const m1 = attachNewPiece(t.doc, 'k-s-2200', 'A', { pieceId: t.pieceId, connectorId: 'B' });
  const m2 = attachNewPiece(m1.doc, 'k-s-2200', 'A', { pieceId: m1.pieceId, connectorId: 'B' });
  const b1 = attachNewPiece(m2.doc, 'k-s-2200', 'A', { pieceId: t.pieceId, connectorId: 'C' });
  const b2 = attachNewPiece(b1.doc, 'k-s-2200', 'A', { pieceId: b1.pieceId, connectorId: 'B' });
  doc = b2.doc as LayoutDocument;
  const index = buildLayoutIndex(doc);
  return { index, ids: { s0, s1: s1.pieceId, t: t.pieceId, m1: m1.pieceId, m2: m2.pieceId, b1: b1.pieceId, b2: b2.pieceId } };
}

function simFor(index: LayoutIndex, states: (id: string) => string | undefined) {
  return new Simulation({
    getIndex: () => index,
    turnoutStates: states,
    getConsist: () => consist,
    getLength: () => LENGTH,
    getCalibration: () => ({ Distance: 100, Duration: 1, Step: 10 }),
  });
}

describe('route planner', () => {
  it('plans through the diverging branch and lists the required turnout state', () => {
    const { index, ids } = yard();
    const graph = buildTrackGraph(index);
    const placed = poseFromFront(index, { pos: { pieceId: ids.s1, pathId: 'AB', s: 170 }, dir: 1 }, LENGTH);
    if ('error' in placed) throw new Error(placed.error);
    const route = planRoute(index, graph, 'c1', placed.pose, { pieceId: ids.b2, pathId: 'AB', s: 90 }, { turnoutStates: () => 'main' });
    expect(typeof route).toBe('object');
    if (typeof route === 'string') return;
    expect(route.movement).toBe('forward');
    expect(route.steps.map((s) => s.pieceId)).toEqual([ids.t, ids.b1]);
    expect(route.turnoutStates).toEqual([{ pieceId: ids.t, state: 'branch' }]);
    // 10 mm left on s1 + branch arc (424.6 mm × 22.5°) + 180 + 90.
    expect(route.lengthMm).toBeCloseTo(10 + 424.6 * (22.5 * Math.PI) / 180 + 180 + 90, 6);
  });

  it('refuses pieces claimed by others and falls back to reversing when allowed', () => {
    const { index, ids } = yard();
    const graph = buildTrackGraph(index);
    const placed = poseFromFront(index, { pos: { pieceId: ids.m1, pathId: 'AB', s: 170 }, dir: 1 }, LENGTH);
    if ('error' in placed) throw new Error(placed.error);
    // Target lies behind the train (on s0): only reachable by reversing.
    const noReverse = planRoute(index, graph, 'c1', placed.pose, { pieceId: ids.s0, pathId: 'AB', s: 90 });
    expect(noReverse).toBe('no-route');
    const withReverse = planRoute(index, graph, 'c1', placed.pose, { pieceId: ids.s0, pathId: 'AB', s: 90 }, { allowReverse: true });
    expect(typeof withReverse).toBe('object');
    if (typeof withReverse === 'string') return;
    expect(withReverse.movement).toBe('reverse');
    expect(withReverse.steps.map((s) => s.pieceId)).toEqual([ids.t, ids.s1]);
    // A claim on s1 by another train blocks the only route.
    const blocked = planRoute(index, graph, 'c1', placed.pose, { pieceId: ids.s0, pathId: 'AB', s: 90 }, { allowReverse: true, forbiddenPieceIds: new Set([ids.s1]) });
    expect(blocked).toBe('no-route');
  });

  it('honours one-way pieces', () => {
    const { index, ids } = yard();
    index.pieces.get(ids.m1)!.piece.drivingConstraint = 'reverse';
    const graph = buildTrackGraph(index);
    const placed = poseFromFront(index, { pos: { pieceId: ids.s1, pathId: 'AB', s: 170 }, dir: 1 }, LENGTH);
    if ('error' in placed) throw new Error(placed.error);
    expect(planRoute(index, graph, 'c1', placed.pose, { pieceId: ids.m2, pathId: 'AB', s: 90 })).toBe('no-route');
  });
});

/**
 * The "Test → idk" situation: the train stands on the straight leg behind a turnout and the
 * target lies beyond the diverging leg. The only way there is to run through the turnout
 * onto the stub past its toe, stop, and come back over the other leg (kopmaken).
 *
 *   stub s0 ── s1 ──A[turnout]B── m1 ── m2 (train, facing the turnout)
 *                           C── b1 ── b2 (target)
 */
function reversalYard() {
  let { doc, pieceId: s0 } = placeFreePiece(emptyLayout(), 'k-s-2200', { x: 0, y: 0, theta: 0 });
  const s1 = attachNewPiece(doc, 'k-s-2200', 'A', { pieceId: s0, connectorId: 'B' });
  const t = attachNewPiece(s1.doc, 'k-t-2263-R', 'A', { pieceId: s1.pieceId, connectorId: 'B' });
  const m1 = attachNewPiece(t.doc, 'k-s-2200', 'A', { pieceId: t.pieceId, connectorId: 'B' });
  const m2 = attachNewPiece(m1.doc, 'k-s-2200', 'A', { pieceId: m1.pieceId, connectorId: 'B' });
  const b1 = attachNewPiece(m2.doc, 'k-s-2200', 'A', { pieceId: t.pieceId, connectorId: 'C' });
  const b2 = attachNewPiece(b1.doc, 'k-s-2200', 'A', { pieceId: b1.pieceId, connectorId: 'B' });
  doc = b2.doc as LayoutDocument;
  const index = buildLayoutIndex(doc);
  return { index, ids: { s0, s1: s1.pieceId, t: t.pieceId, m1: m1.pieceId, m2: m2.pieceId, b1: b1.pieceId, b2: b2.pieceId } };
}

describe('route planner with reversal (kopmaken)', () => {
  it('plans two legs through the stub when the target is only reachable over the other turnout leg', () => {
    const { index, ids } = reversalYard();
    const graph = buildTrackGraph(index);
    // Nose on m2 pointing toward m1/turnout (path direction -1), tail further along m2.
    const placed = poseFromFront(index, { pos: { pieceId: ids.m2, pathId: 'AB', s: 20 }, dir: -1 }, LENGTH);
    if ('error' in placed) throw new Error(placed.error);

    const without = planRoute(index, graph, 'c1', placed.pose, { pieceId: ids.b2, pathId: 'AB', s: 90 }, { turnoutStates: () => 'main', allowReverse: true });
    expect(without).toBe('no-route');

    const route = planRoute(index, graph, 'c1', placed.pose, { pieceId: ids.b2, pathId: 'AB', s: 90 }, { turnoutStates: () => 'main', allowReverse: true, trainLengthMm: LENGTH });
    expect(typeof route).toBe('object');
    if (typeof route === 'string') return;
    expect(route.legs).toHaveLength(2);
    expect(route.legs[0]!.movement).toBe('forward');
    expect(route.legs[1]!.movement).toBe('reverse');
    // Leg 1: through the turnout (straight, B→A) onto the stub; stop when the whole train + margin is past the toe.
    expect(route.legs[0]!.steps.map((s) => s.pieceId)).toEqual([ids.m1, ids.t]);
    expect(route.legs[0]!.turnoutStates).toEqual([{ pieceId: ids.t, state: 'main' }]);
    expect(route.legs[0]!.stopAt.pieceId).toBe(ids.s0);
    expect(route.legs[0]!.stopAt.s).toBeCloseTo(180 - (LENGTH + 40 - 180), 6);
    // Leg 2: back into the turnout at the toe and out over the branch.
    expect(route.legs[1]!.steps.map((s) => s.pieceId)).toEqual([ids.t, ids.b1]);
    expect(route.legs[1]!.turnoutStates).toEqual([{ pieceId: ids.t, state: 'branch' }]);
    expect(route.stopAt).toEqual({ pieceId: ids.b2, pathId: 'AB', s: 90 });
    expect(route.pieceIds).toEqual(expect.arrayContaining([ids.s0, ids.s1, ids.t, ids.b1, ids.b2, ids.m1, ids.m2]));
  });

  it('refuses to reverse when the stub is too short for the train', () => {
    const { index, ids } = reversalYard();
    const graph = buildTrackGraph(index);
    const placed = poseFromFront(index, { pos: { pieceId: ids.m2, pathId: 'AB', s: 20 }, dir: -1 }, LENGTH);
    if ('error' in placed) throw new Error(placed.error);
    // Stub is 360 mm; a 400 mm train cannot clear the toe.
    const route = planRoute(index, graph, 'c1', placed.pose, { pieceId: ids.b2, pathId: 'AB', s: 90 }, { turnoutStates: () => 'main', allowReverse: true, trainLengthMm: 400 });
    expect(route).toBe('no-route');
  });

  it('dry-runs both legs including the turnout change at the reversal point', () => {
    const { index, ids } = reversalYard();
    const graph = buildTrackGraph(index);
    const sim = simFor(index, () => 'main');
    const placed = poseFromFront(index, { pos: { pieceId: ids.m2, pathId: 'AB', s: 20 }, dir: -1 }, LENGTH);
    if ('error' in placed) throw new Error(placed.error);
    sim.track('c1', placed.pose);
    const route = planRoute(index, graph, 'c1', placed.pose, { pieceId: ids.b2, pathId: 'AB', s: 90 }, { turnoutStates: () => 'main', allowReverse: true, trainLengthMm: LENGTH });
    if (typeof route === 'string') throw new Error(route);
    const result = dryRun({ index, simulation: sim, route, targetMmS: 300, foreignPieceIds: new Set(), switchTimeMs: () => 400 });
    expect(result.issues).toEqual([]);
    expect(result.status).toBe('validated');
    // The last leg is driven tail first, so the rear is the leading end that stops at the target…
    expect(result.arrivalPose?.rear.pos.pieceId).toBe(ids.b2);
    expect(result.arrivalPose?.rear.pos.s).toBeCloseTo(90, 2);
    // …and the nose trails 150 mm behind it on b1, still facing the same way as at departure (no 180° flip).
    expect(result.arrivalPose?.front.pos.pieceId).toBe(ids.b1);
    expect(result.arrivalPose?.front.dir).toBe(placed.pose.front.dir);
    // The recorded steps show both movements.
    const movements = new Set(result.steps.map((s) => s.movement));
    expect(movements.has('forward')).toBe(true);
    expect(movements.has('reverse')).toBe(true);
  });
});

describe('interlocking', () => {
  it('claims atomically, locks turnouts and releases behind the train', () => {
    const il = new Interlocking();
    expect(il.tryClaim({ consistId: 'a', pieceIds: ['p1', 'p2', 't1'], turnoutStates: [{ pieceId: 't1', state: 'branch' }] })).toEqual({ ok: true });
    const denied = il.tryClaim({ consistId: 'b', pieceIds: ['p2', 'p3'], turnoutStates: [] });
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.conflicts).toEqual([{ pieceId: 'p2', heldBy: 'a' }]);
    expect(il.holderOf('p3')).toBeNull(); // nothing of b's request was taken
    expect(il.canThrow('t1', 'b')).toBe(false);
    expect(il.canThrow('t1', 'a')).toBe(true);
    expect(il.lockedState('t1')).toBe('branch');
    il.release('a', ['p1', 'p2']);
    expect(il.tryClaim({ consistId: 'b', pieceIds: ['p2', 'p3'], turnoutStates: [] }).ok).toBe(true);
    il.release('a', ['t1']);
    expect(il.canThrow('t1')).toBe(true);
  });

  it('detects a circular wait between two trains', () => {
    const il = new Interlocking();
    il.tryClaim({ consistId: 'a', pieceIds: ['p1'], turnoutStates: [] });
    il.tryClaim({ consistId: 'b', pieceIds: ['p2'], turnoutStates: [] });
    il.tryClaim({ consistId: 'a', pieceIds: ['p2'], turnoutStates: [] });
    il.tryClaim({ consistId: 'b', pieceIds: ['p1'], turnoutStates: [] });
    const cycles = il.detectDeadlocks();
    expect(cycles.length).toBe(1);
    expect(new Set(cycles[0])).toEqual(new Set(['a', 'b']));
  });
});

describe('dry-run', () => {
  it('validates a clear route, reports arrival and schedules the turnout throw', () => {
    const { index, ids } = yard();
    const graph = buildTrackGraph(index);
    const sim = simFor(index, () => 'main');
    const placed = poseFromFront(index, { pos: { pieceId: ids.s1, pathId: 'AB', s: 170 }, dir: 1 }, LENGTH);
    if ('error' in placed) throw new Error(placed.error);
    sim.track('c1', placed.pose);
    const route = planRoute(index, graph, 'c1', placed.pose, { pieceId: ids.b2, pathId: 'AB', s: 90 }, { turnoutStates: () => 'main' });
    if (typeof route === 'string') throw new Error(route);
    const result = dryRun({ index, simulation: sim, route, targetMmS: 300, foreignPieceIds: new Set(), switchTimeMs: () => 400 });
    expect(result.status).toBe('validated');
    expect(result.issues).toEqual([]);
    expect(result.arrivalPose?.front.pos.pieceId).toBe(ids.b2);
    expect(result.arrivalPose?.front.pos.s).toBeCloseTo(90, 2);
    expect(result.steps.length).toBeGreaterThan(3);
    expect(result.turnoutSchedule).toHaveLength(1);
    // The train starts 10 mm before the turnout: the throw must happen before departure.
    expect(result.turnoutSchedule[0]!.throwBeforeDeparture).toBe(true);
    // The live simulation was not touched.
    expect(sim.trains.get('c1')!.pose).toEqual(placed.pose);
  });

  it('fails when the route runs into a train standing on it', () => {
    const { index, ids } = yard();
    const graph = buildTrackGraph(index);
    const sim = simFor(index, () => 'main');
    const placed = poseFromFront(index, { pos: { pieceId: ids.s1, pathId: 'AB', s: 170 }, dir: 1 }, LENGTH);
    const other = poseFromFront(index, { pos: { pieceId: ids.m2, pathId: 'AB', s: 170 }, dir: 1 }, LENGTH);
    if ('error' in placed || 'error' in other) throw new Error('setup');
    sim.track('c1', placed.pose);
    sim.track('c2', other.pose);
    const route = planRoute(index, graph, 'c1', placed.pose, { pieceId: ids.m2, pathId: 'AB', s: 150 }, { turnoutStates: () => 'main' });
    if (typeof route === 'string') throw new Error(route);
    const result = dryRun({ index, simulation: sim, route, targetMmS: 300, foreignPieceIds: new Set(), switchTimeMs: () => 400 });
    expect(result.status).toBe('failed');
    expect(result.issues.some((i) => i.includes('occupied by another train'))).toBe(true);
  });
});
