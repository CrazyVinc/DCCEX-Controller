import { describe, expect, it } from 'vitest';
import { poseFromFront } from '../../shared/src/domain/pose.ts';
import type { Consist } from '../../shared/src/domain/train.ts';
import { buildLayoutIndex } from '../../shared/src/layout/index.ts';
import { attachNewPiece, placeFreePiece } from '../../shared/src/layout/ops.ts';
import { emptyLayout } from '../../shared/src/layout/schema.ts';
import { COLLISION_GAP_MM, SIM_STEP_MS, Simulation } from './simulation.ts';

const consist: Consist = {
  id: 'c1',
  name: 'Test',
  units: [{ kind: 'loco', dccId: '3', orientation: 'forward' }],
  couplingGapMm: 0,
  accelerationMmS2: 100,
  brakingMmS2: 200,
};
const LENGTH = 200;
const calibration = { Distance: 100, Duration: 1, Step: 10 }; // 10 mm/s per step → 1260 mm/s at step 126

function straightLine(count: number) {
  let { doc, pieceId } = placeFreePiece(emptyLayout(), 'k-s-2200', { x: 0, y: 0, theta: 0 });
  const ids = [pieceId];
  for (let i = 1; i < count; i++) {
    const r = attachNewPiece(doc, 'k-s-2200', 'A', { pieceId: ids[i - 1]!, connectorId: 'B' });
    doc = r.doc;
    ids.push(r.pieceId);
  }
  return { index: buildLayoutIndex(doc), ids };
}

function makeSim(index: ReturnType<typeof buildLayoutIndex>) {
  return new Simulation({
    getIndex: () => index,
    turnoutStates: () => undefined,
    getConsist: () => consist,
    getLength: () => LENGTH,
    getCalibration: () => calibration,
  });
}

function run(sim: Simulation, seconds: number) {
  const steps = Math.round((seconds * 1000) / SIM_STEP_MS);
  for (let i = 0; i < steps; i++) sim.step(SIM_STEP_MS);
}

describe('simulation', () => {
  it('accelerates to the target with constant acceleration and moves front and rear together', () => {
    const { index, ids } = straightLine(20);
    const placed = poseFromFront(index, { pos: { pieceId: ids[2]!, pathId: 'AB', s: 100 }, dir: 1 }, LENGTH);
    if ('error' in placed) throw new Error(placed.error);
    const sim = makeSim(index);
    sim.track('c1', placed.pose);
    sim.drive('c1', 'forward', 300);
    run(sim, 3); // 100 mm/s² → 300 mm/s after 3 s
    const t = sim.trains.get('c1')!;
    expect(t.pose.speedMmS).toBeCloseTo(300, 6);
    expect(sim.stateOf('c1')).toBe('running');
    // Distance covered ≈ ½·a·t² = 450 mm (trapezoidal integration is exact for constant acceleration).
    const frontAdvanced = (ids.indexOf(t.pose.front.pos.pieceId) - 2) * 180 + t.pose.front.pos.s - 100;
    expect(frontAdvanced).toBeCloseTo(450, 3);
    const rearAdvanced = ids.indexOf(t.pose.rear.pos.pieceId) * 180 + t.pose.rear.pos.s - (placed.pose.rear.pos.s + ids.indexOf(placed.pose.rear.pos.pieceId) * 180);
    expect(rearAdvanced).toBeCloseTo(450, 3);
  });

  it('is deterministic: identical inputs produce identical trajectories', () => {
    const { index, ids } = straightLine(20);
    const placed = poseFromFront(index, { pos: { pieceId: ids[2]!, pathId: 'AB', s: 100 }, dir: 1 }, LENGTH);
    if ('error' in placed) throw new Error(placed.error);
    const a = makeSim(index);
    const b = makeSim(index);
    a.track('c1', placed.pose);
    b.track('c1', placed.pose);
    a.drive('c1', 'forward', 250);
    b.drive('c1', 'forward', 250);
    run(a, 4.2);
    run(b, 4.2);
    expect(a.trains.get('c1')!.pose).toEqual(b.trains.get('c1')!.pose);
  });

  it('brakes to rest exactly at a stop point', () => {
    const { index, ids } = straightLine(30);
    const placed = poseFromFront(index, { pos: { pieceId: ids[2]!, pathId: 'AB', s: 100 }, dir: 1 }, LENGTH);
    if ('error' in placed) throw new Error(placed.error);
    const sim = makeSim(index);
    sim.track('c1', placed.pose);
    sim.drive('c1', 'forward', 400);
    sim.setStopPoint('c1', { pieceId: ids[12]!, pathId: 'AB', s: 50 });
    const arrivals: string[] = [];
    sim.on('arrived', (e) => arrivals.push(e.consistId));
    run(sim, 20);
    const t = sim.trains.get('c1')!;
    expect(t.pose.speedMmS).toBe(0);
    expect(t.pose.front.pos.pieceId).toBe(ids[12]);
    expect(t.pose.front.pos.s).toBeCloseTo(50, 3);
    expect(arrivals).toEqual(['c1']);
    expect(sim.stateOf('c1')).toBe('stopped');
  });

  it('emergency-stops at an open end instead of leaving the rails', () => {
    const { index, ids } = straightLine(4);
    const placed = poseFromFront(index, { pos: { pieceId: ids[2]!, pathId: 'AB', s: 100 }, dir: 1 }, LENGTH);
    if ('error' in placed) throw new Error(placed.error);
    const sim = makeSim(index);
    sim.track('c1', placed.pose);
    const blocked: string[] = [];
    sim.on('blocked', (e) => blocked.push(e.reason));
    sim.drive('c1', 'forward', 500);
    run(sim, 10);
    expect(blocked).toEqual(['open-end']);
    expect(sim.stateOf('c1')).toBe('emergency');
    const t = sim.trains.get('c1')!;
    expect(t.pose.front.pos.pieceId).toBe(ids[3]);
    expect(t.pose.front.pos.s).toBeCloseTo(180, 6);
  });

  it('respects a speed restriction on the track ahead', () => {
    const { index, ids } = straightLine(20);
    index.doc.speedRestrictions.push({ id: 'spd', level: 0, start: { pieceId: ids[5]!, pathId: 'AB', s: 0 }, end: { pieceId: ids[8]!, pathId: 'AB', s: 180 }, pieceIds: [ids[5]!, ids[6]!, ids[7]!, ids[8]!], maxSpeedStep: 2 });
    const placed = poseFromFront(index, { pos: { pieceId: ids[2]!, pathId: 'AB', s: 100 }, dir: 1 }, LENGTH);
    if ('error' in placed) throw new Error(placed.error);
    const sim = makeSim(index);
    sim.track('c1', placed.pose);
    sim.drive('c1', 'forward', 1000);
    let maxInside = 0;
    for (let i = 0; i < 1500; i++) {
      sim.step(SIM_STEP_MS);
      const t = sim.trains.get('c1')!;
      if (t.pose.front.pos.pieceId === ids[7]) maxInside = Math.max(maxInside, t.pose.speedMmS);
    }
    // Step 2 of 14 → DCC step 18 → 180 mm/s with this calibration.
    expect(maxInside).toBeLessThanOrEqual(180 + 1e-6);
    expect(maxInside).toBeGreaterThan(100);
  });

  it('stops behind a standing train and never touches it', () => {
    const { index, ids } = straightLine(30);
    const a = poseFromFront(index, { pos: { pieceId: ids[2]!, pathId: 'AB', s: 100 }, dir: 1 }, LENGTH);
    const b = poseFromFront(index, { pos: { pieceId: ids[12]!, pathId: 'AB', s: 100 }, dir: 1 }, LENGTH);
    if ('error' in a || 'error' in b) throw new Error('placement failed');
    const sim = makeSim(index);
    sim.track('a', a.pose);
    sim.track('b', b.pose);
    const collisions: string[] = [];
    sim.on('collision', (e) => collisions.push(...e.consistIds));
    sim.drive('a', 'forward', 600);
    let minGap = Infinity;
    for (let i = 0; i < 1500; i++) {
      sim.step(SIM_STEP_MS);
      const front = sim.trains.get('a')!.pose.front.pos;
      const rear = sim.trains.get('b')!.pose.rear.pos;
      const gap = (ids.indexOf(rear.pieceId) - ids.indexOf(front.pieceId)) * 180 + rear.s - front.s;
      minGap = Math.min(minGap, gap);
    }
    expect(collisions).toEqual([]);
    expect(sim.stateOf('a')).toBe('stopped');
    expect(sim.stateOf('b')).toBe('stopped');
    expect(minGap).toBeGreaterThanOrEqual(COLLISION_GAP_MM - 1e-6);
    expect(minGap).toBeLessThan(COLLISION_GAP_MM + 5);
    // The standing train was never disturbed.
    expect(sim.trains.get('b')!.pose).toEqual(b.pose);
  });

  it('a train that is driven into the back of another one closes up and then stops', () => {
    const { index, ids } = straightLine(30);
    const a = poseFromFront(index, { pos: { pieceId: ids[2]!, pathId: 'AB', s: 100 }, dir: 1 }, LENGTH);
    const b = poseFromFront(index, { pos: { pieceId: ids[8]!, pathId: 'AB', s: 100 }, dir: 1 }, LENGTH);
    if ('error' in a || 'error' in b) throw new Error('placement failed');
    const sim = makeSim(index);
    sim.track('a', a.pose);
    sim.track('b', b.pose);
    sim.drive('a', 'forward', 300);
    sim.drive('b', 'forward', 100);
    run(sim, 30);
    // Both keep driving; a is limited to b's speed with the safety gap in between.
    expect(sim.trains.get('a')!.pose.speedMmS).toBeCloseTo(100, 0);
    const front = sim.trains.get('a')!.pose.front.pos;
    const rear = sim.trains.get('b')!.pose.rear.pos;
    const gap = (ids.indexOf(rear.pieceId) - ids.indexOf(front.pieceId)) * 180 + rear.s - front.s;
    expect(gap).toBeGreaterThanOrEqual(COLLISION_GAP_MM - 1e-6);
  });

  it('emergency-stops both trains when they overlap', () => {
    const { index, ids } = straightLine(10);
    const a = poseFromFront(index, { pos: { pieceId: ids[2]!, pathId: 'AB', s: 100 }, dir: 1 }, LENGTH);
    const b = poseFromFront(index, { pos: { pieceId: ids[2]!, pathId: 'AB', s: 150 }, dir: 1 }, LENGTH);
    if ('error' in a || 'error' in b) throw new Error('placement failed');
    const sim = makeSim(index);
    sim.track('a', a.pose);
    sim.track('b', b.pose);
    const collisions: [string, string][] = [];
    sim.on('collision', (e) => collisions.push(e.consistIds));
    sim.step(SIM_STEP_MS);
    expect(collisions).toEqual([['a', 'b']]);
    expect(sim.stateOf('a')).toBe('emergency');
    expect(sim.stateOf('b')).toBe('emergency');
  });

  it('haltAll stops every train where it stands', () => {
    const { index, ids } = straightLine(30);
    const placed = poseFromFront(index, { pos: { pieceId: ids[2]!, pathId: 'AB', s: 100 }, dir: 1 }, LENGTH);
    if ('error' in placed) throw new Error(placed.error);
    const sim = makeSim(index);
    sim.track('c1', placed.pose);
    sim.drive('c1', 'forward', 300);
    run(sim, 3);
    sim.haltAll();
    const pose = sim.trains.get('c1')!.pose;
    expect(pose.speedMmS).toBe(0);
    expect(pose.movement).toBe('stopped');
    expect(sim.stateOf('c1')).toBe('stopped');
    run(sim, 2);
    expect(sim.trains.get('c1')!.pose).toEqual(pose);
  });

  it('changing direction while moving brakes first and then reverses, facing unchanged', () => {
    const { index, ids } = straightLine(30);
    const placed = poseFromFront(index, { pos: { pieceId: ids[10]!, pathId: 'AB', s: 100 }, dir: 1 }, LENGTH);
    if ('error' in placed) throw new Error(placed.error);
    const sim = makeSim(index);
    sim.track('c1', placed.pose);
    sim.drive('c1', 'forward', 200);
    run(sim, 3);
    const beforeDir = sim.trains.get('c1')!.pose.front.dir;
    sim.drive('c1', 'reverse', 200);
    run(sim, 6);
    const t = sim.trains.get('c1')!;
    expect(t.pose.movement).toBe('reverse');
    expect(t.pose.speedMmS).toBeCloseTo(200, 6);
    expect(t.pose.front.dir).toBe(beforeDir);
  });
});
