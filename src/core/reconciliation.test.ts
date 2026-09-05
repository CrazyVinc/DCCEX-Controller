import { describe, expect, it } from 'vitest';
import { poseFromFront } from '../../shared/src/domain/pose.ts';
import { buildLayoutIndex } from '../../shared/src/layout/index.ts';
import { attachNewPiece, placeFreePiece } from '../../shared/src/layout/ops.ts';
import { emptyLayout } from '../../shared/src/layout/schema.ts';
import { Interlocking } from './interlocking.ts';
import { Reconciliation } from './reconciliation.ts';
import { SafetyMonitor } from './safety.ts';
import { SensorBus } from './sensorBus.ts';
import { TrainStateManager } from './trainState.ts';
import { TurnoutStateStore } from './turnoutState.ts';

function setup() {
  let { doc, pieceId: a } = placeFreePiece(emptyLayout(), 'k-s-2200', { x: 0, y: 0, theta: 0 });
  const b = attachNewPiece(doc, 'k-s-2200', 'A', { pieceId: a, connectorId: 'B' });
  const c = attachNewPiece(b.doc, 'k-s-2200', 'A', { pieceId: b.pieceId, connectorId: 'B' });
  doc = c.doc;
  doc.trackBlocks.push(
    { id: 'blkA', level: 0, start: { pieceId: a, pathId: 'AB', s: 0 }, end: { pieceId: a, pathId: 'AB', s: 180 }, pieceIds: [a], sensorId: 1 },
    { id: 'blkC', level: 0, start: { pieceId: c.pieceId, pathId: 'AB', s: 0 }, end: { pieceId: c.pieceId, pathId: 'AB', s: 180 }, pieceIds: [c.pieceId], sensorId: 3 },
  );
  const index = buildLayoutIndex(doc);
  const turnouts = new TurnoutStateStore(() => index);
  const trainState = new TrainStateManager({ getIndex: () => index, getLength: () => 100, turnoutStates: turnouts.resolver, persistence: false });
  const sensors = new SensorBus();
  const interlocking = new Interlocking();
  const safety = new SafetyMonitor();
  let stops = 0;
  const reconciliation = new Reconciliation({ getIndex: () => index, trainState, sensors, interlocking, safety, turnouts, emergencyStop: () => stops++ });
  reconciliation.start();
  return { index, ids: { a, b: b.pieceId, c: c.pieceId }, trainState, sensors, interlocking, safety, reconciliation, stops: () => stops };
}

describe('reconciliation', () => {
  it('confirms a train when its block sensor goes active', async () => {
    const s = setup();
    const pose = poseFromFront(s.index, { pos: { pieceId: s.ids.a, pathId: 'AB', s: 150 }, dir: 1 }, 100);
    if ('error' in pose) throw new Error(pose.error);
    await s.trainState.setPose('t1', { ...pose.pose, confidence: 0.4 }, 'unknown');
    s.sensors.set(1, true, 'hardware');
    await new Promise((r) => setTimeout(r, 0));
    expect(s.trainState.get('t1')!.pose!.confidence).toBe(1);
    expect(s.safety.level).toBe('NORMAL');
    expect(s.stops()).toBe(0);
  });

  it('raises EMERGENCY and stops everything on unexpected occupancy', async () => {
    const s = setup();
    s.sensors.set(3, true, 'hardware');
    await new Promise((r) => setTimeout(r, 0));
    expect(s.safety.level).toBe('EMERGENCY');
    expect(s.stops()).toBe(1);
    s.safety.reset();
    expect(s.safety.level).toBe('NORMAL');
  });

  it('ignores virtual sensors (simulation mode)', async () => {
    const s = setup();
    s.sensors.set(3, true, 'virtual');
    await new Promise((r) => setTimeout(r, 0));
    expect(s.safety.level).toBe('NORMAL');
  });

  it('treats a turnout feedback that contradicts a locked route as an emergency', () => {
    const s = setup();
    s.interlocking.tryClaim({ consistId: 't1', pieceIds: ['tw'], turnoutStates: [{ pieceId: 'tw', state: 'branch' }] });
    s.reconciliation.onTurnoutFeedback('tw', 'main');
    expect(s.safety.level).toBe('EMERGENCY');
    expect(s.stops()).toBe(1);
  });

  it('recovery after restart confirms trains whose sensors are active', async () => {
    const s = setup();
    const pose = poseFromFront(s.index, { pos: { pieceId: s.ids.a, pathId: 'AB', s: 150 }, dir: 1 }, 100);
    if ('error' in pose) throw new Error(pose.error);
    await s.trainState.setPose('t1', { ...pose.pose, confidence: 0.4 }, 'unknown');
    s.sensors.set(1, true, 'hardware');
    const result = await s.reconciliation.recover();
    expect(result.confirmed).toEqual(['t1']);
    // Block-level confirmation: the train is known to be in the block (0.8), not yet at an exact spot.
    expect(s.trainState.get('t1')!.pose!.confidence).toBeGreaterThanOrEqual(0.8);
  });
});
