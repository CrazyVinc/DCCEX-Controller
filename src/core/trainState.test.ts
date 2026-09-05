import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { poseFromFront } from '../../shared/src/domain/pose.ts';
import { buildLayoutIndex } from '../../shared/src/layout/index.ts';
import { attachNewPiece, placeFreePiece } from '../../shared/src/layout/ops.ts';
import { emptyLayout } from '../../shared/src/layout/schema.ts';
import { TrainStateManager } from './trainState.ts';
import { TurnoutStateStore } from './turnoutState.ts';

const dirs: string[] = [];

async function setup() {
  let { doc, pieceId: a } = placeFreePiece(emptyLayout(), 'k-s-2200', { x: 0, y: 0, theta: 0 });
  const b = attachNewPiece(doc, 'k-s-2200', 'A', { pieceId: a, connectorId: 'B' });
  doc = attachNewPiece(b.doc, 'k-s-2200', 'A', { pieceId: b.pieceId, connectorId: 'B' }).doc;
  const index = buildLayoutIndex(doc);
  const turnouts = new TurnoutStateStore(() => index);
  const dir = await mkdtemp(path.join(os.tmpdir(), 'dcc-trainstate-'));
  dirs.push(dir);
  const persistence = { stateFile: path.join(dir, 'state.json'), correctionsFile: path.join(dir, 'corrections.jsonl') };
  const make = () => new TrainStateManager({ getIndex: () => index, getLength: () => 100, turnoutStates: turnouts.resolver, persistence });
  const pose = poseFromFront(index, { pos: { pieceId: b.pieceId, pathId: 'AB', s: 150 }, dir: 1 }, 100);
  if ('error' in pose) throw new Error(pose.error);
  return { make, pose: pose.pose, persistence };
}

afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

describe('train state persistence', () => {
  it('flush writes the poses immediately with the shutdown metadata', async () => {
    const s = await setup();
    const manager = s.make();
    await manager.setPose('t1', { ...s.pose, speedMmS: 120, movement: 'forward' }, 'running');
    await manager.flush({ cleanShutdown: true, trackPower: false });
    const raw = JSON.parse(await readFile(s.persistence.stateFile, 'utf-8'));
    expect(raw.meta).toEqual({ cleanShutdown: true, trackPower: false });
    expect(raw.trains.t1.pose.front.pos).toEqual(s.pose.front.pos);
  });

  it('restores poses from an orderly shutdown as stopped and trustworthy', async () => {
    const s = await setup();
    const before = s.make();
    await before.setPose('t1', { ...s.pose, confidence: 1 }, 'stopped');
    await before.flush({ cleanShutdown: true, trackPower: false });

    const after = s.make();
    await after.load();
    const entry = after.get('t1')!;
    expect(entry.state).toBe('stopped');
    expect(entry.pose!.confidence).toBe(0.8);
    expect(entry.pose!.speedMmS).toBe(0);
    expect(entry.pose!.movement).toBe('stopped');
    expect(entry.pose!.front.pos).toEqual(s.pose.front.pos);
    expect(entry.pose!.rear.pos).toEqual(s.pose.rear.pos);
  });

  it('restores poses from a crash as unconfirmed', async () => {
    const s = await setup();
    const before = s.make();
    await before.setPose('t1', { ...s.pose, confidence: 1 }, 'running');
    await before.flush(); // running write: not a clean shutdown

    const after = s.make();
    await after.load();
    const entry = after.get('t1')!;
    expect(entry.state).toBe('unknown');
    expect(entry.pose!.confidence).toBe(0.4);
    expect(entry.pose!.front.pos).toEqual(s.pose.front.pos);
  });

  it('does not trust a clean shutdown that left the track power on', async () => {
    const s = await setup();
    const before = s.make();
    await before.setPose('t1', { ...s.pose, confidence: 1 }, 'stopped');
    await before.flush({ cleanShutdown: true, trackPower: true });

    const after = s.make();
    await after.load();
    expect(after.get('t1')!.pose!.confidence).toBe(0.4);
    expect(after.get('t1')!.state).toBe('unknown');
  });
});
