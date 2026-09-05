import { describe, expect, it } from 'vitest';
import { buildLayoutIndex, type LayoutIndex } from '../layout/index.ts';
import { attachNewPiece, joinPorts, placeFreePiece } from '../layout/ops.ts';
import { emptyLayout, type LayoutDocument } from '../layout/schema.ts';
import { worldPoseAt } from '../layout/traverse.ts';
import { facingDegOf, locoDirectionBit, movePose, poseFromFront, reverseMovement } from './pose.ts';
import type { TrainPose, Traversal } from './train.ts';

/**
 * Orientation suite — the invariant of the whole project:
 * facing (physical front) ≠ movement (forward/reverse) ≠ heading (track tangent).
 */

function chain(defIds: string[], attachTo: ('B' | 'C')[] = []): { doc: LayoutDocument; ids: string[]; index: LayoutIndex } {
  let { doc, pieceId } = placeFreePiece(emptyLayout(), defIds[0]!, { x: 0, y: 0, theta: 0 });
  const ids = [pieceId];
  for (let i = 1; i < defIds.length; i++) {
    const r = attachNewPiece(doc, defIds[i]!, 'A', { pieceId: ids[i - 1]!, connectorId: attachTo[i - 1] ?? 'B' });
    doc = r.doc;
    ids.push(r.pieceId);
  }
  return { doc, ids, index: buildLayoutIndex(doc) };
}

function place(index: LayoutIndex, front: Traversal, length: number, states?: (id: string) => string | undefined): TrainPose {
  const r = poseFromFront(index, front, length, states);
  if ('error' in r) throw new Error(`does not fit: ${r.error}`);
  return r.pose;
}

const TRAIN_LENGTH = 250;

describe('orientation invariants', () => {
  it('forward: nose leads, facing unchanged', () => {
    const { ids, index } = chain(['k-s-2200', 'k-s-2200', 'k-s-2200', 'k-s-2200']);
    const pose = place(index, { pos: { pieceId: ids[1]!, pathId: 'AB', s: 170 }, dir: 1 }, TRAIN_LENGTH);
    expect(pose.rear.pos.pieceId).toBe(ids[0]);
    expect(pose.rear.pos.s).toBeCloseTo(180 - (TRAIN_LENGTH - 170), 9);
    const moved = movePose(index, { ...pose, movement: 'forward' }, 100).pose;
    expect(moved.front.pos.pieceId).toBe(ids[2]);
    expect(moved.front.pos.s).toBeCloseTo(90, 9);
    expect(moved.front.dir).toBe(pose.front.dir);
    expect(facingDegOf(index, moved)).toBeCloseTo(facingDegOf(index, pose), 9);
  });

  it('reverse: tail leads, the physical front still points the same way', () => {
    const { ids, index } = chain(['k-s-2200', 'k-s-2200', 'k-s-2200', 'k-s-2200']);
    const pose = place(index, { pos: { pieceId: ids[2]!, pathId: 'AB', s: 100 }, dir: 1 }, TRAIN_LENGTH);
    const reversed = reverseMovement({ ...pose, movement: 'forward' });
    expect(reversed.movement).toBe('reverse');
    const moved = movePose(index, reversed, 150).pose;
    // Both ends moved backwards along the track…
    expect(moved.front.pos.pieceId).toBe(ids[1]);
    expect(moved.front.pos.s).toBeCloseTo(130, 9);
    // …but facing is identical: same traversal direction and same compass heading.
    expect(moved.front.dir).toBe(pose.front.dir);
    expect(facingDegOf(index, moved)).toBeCloseTo(facingDegOf(index, pose), 9);
  });

  it('turnout A→B forward and B→A back: no 180° flip, pose restored exactly', () => {
    const { ids, index } = chain(['k-s-2200', 'k-s-2200', 'k-t-2263-R', 'k-s-2200', 'k-s-2200']);
    const states = () => 'main';
    const start = place(index, { pos: { pieceId: ids[1]!, pathId: 'AB', s: 150 }, dir: 1 }, TRAIN_LENGTH, states);
    const facing0 = facingDegOf(index, start);
    // 30 mm left on ids[1] + 168.9 mm turnout + 101.1 mm onto ids[3].
    const over = movePose(index, { ...start, movement: 'forward' }, 300, states).pose;
    expect(over.front.pos.pieceId).toBe(ids[3]);
    expect(over.front.pos.s).toBeCloseTo(101.1, 9);
    expect(facingDegOf(index, over)).toBeCloseTo(facing0, 9);
    const back = movePose(index, reverseMovement(over), 300, states).pose;
    expect(back.front.pos.pieceId).toBe(start.front.pos.pieceId);
    expect(back.front.pos.s).toBeCloseTo(start.front.pos.s, 9);
    expect(back.rear.pos.pieceId).toBe(start.rear.pos.pieceId);
    expect(back.rear.pos.s).toBeCloseTo(start.rear.pos.s, 9);
    expect(back.front.dir).toBe(start.front.dir);
    expect(facingDegOf(index, back)).toBeCloseTo(facing0, 9);
  });

  it('curve: heading follows the rail tangent continuously', () => {
    const { ids, index } = chain(['k-s-2200', 'k-c-2221', 'k-c-2221']);
    const arcLen = (360 * Math.PI) / 6;
    // Nose exactly at the start of the first curve, rear 100 mm back on the straight.
    let pose = place(index, { pos: { pieceId: ids[1]!, pathId: 'AB', s: 0 }, dir: 1 }, 100);
    const headings: number[] = [facingDegOf(index, pose)];
    pose = { ...pose, movement: 'forward' };
    for (let i = 0; i < 6; i++) {
      pose = movePose(index, pose, arcLen / 3).pose;
      headings.push(facingDegOf(index, pose));
    }
    // 0 → 10 → 20 → 30 → 40 → 50 → 60 degrees, in steps of 10 through two 30° curves.
    for (let i = 1; i < headings.length; i++) {
      expect(headings[i]! - headings[i - 1]!).toBeCloseTo(10, 6);
    }
    expect(pose.front.dir).toBe(1);
  });

  it('loop: a full circle turns the heading by 360° only because the rail does', () => {
    const { doc, ids } = chain(Array(12).fill('k-c-2221'));
    const closed = joinPorts(doc, { pieceId: ids[11]!, connectorId: 'B' }, { pieceId: ids[0]!, connectorId: 'A' }).doc;
    const index = buildLayoutIndex(closed);
    const arcLen = (360 * Math.PI) / 6;
    const start = place(index, { pos: { pieceId: ids[0]!, pathId: 'AB', s: arcLen / 2 }, dir: 1 }, 100);
    const facing0 = facingDegOf(index, start);
    const half = movePose(index, { ...start, movement: 'forward' }, 6 * arcLen).pose;
    const halfDiff = (((facingDegOf(index, half) - facing0) % 360) + 360) % 360;
    expect(Math.abs(halfDiff - 180)).toBeLessThan(1e-6);
    const full = movePose(index, half, 6 * arcLen).pose;
    expect(full.front.pos.pieceId).toBe(start.front.pos.pieceId);
    expect(full.front.pos.s).toBeCloseTo(start.front.pos.s, 6);
    expect(facingDegOf(index, full)).toBeCloseTo(facing0, 6);
    expect(full.front.dir).toBe(start.front.dir);
  });

  it('reverse after taking the branch: the tail leads back over the turnout, facing intact', () => {
    // Straight → turnout; branch (C) continues with a straight, main (B) with another straight.
    const base = chain(['k-s-2200', 'k-s-2200', 'k-t-2263-R']);
    const withMain = attachNewPiece(base.doc, 'k-s-2200', 'A', { pieceId: base.ids[2]!, connectorId: 'B' });
    const withBranch = attachNewPiece(withMain.doc, 'k-s-2200', 'A', { pieceId: base.ids[2]!, connectorId: 'C' });
    const index = buildLayoutIndex(withBranch.doc);
    const states = () => 'branch';
    const start = place(index, { pos: { pieceId: base.ids[1]!, pathId: 'AB', s: 170 }, dir: 1 }, TRAIN_LENGTH, states);
    const facing0 = facingDegOf(index, start);
    const out = movePose(index, { ...start, movement: 'forward' }, 300, states).pose;
    expect(out.front.pos.pieceId).toBe(withBranch.pieceId);
    // Heading now includes the 22.5° divergence of the branch.
    expect(facingDegOf(index, out) - facing0).toBeCloseTo(22.5, 6);
    const back = movePose(index, reverseMovement(out), 300, states).pose;
    expect(back.front.pos.pieceId).toBe(start.front.pos.pieceId);
    expect(back.front.pos.s).toBeCloseTo(170, 9);
    expect(back.front.dir).toBe(1);
    expect(facingDegOf(index, back)).toBeCloseTo(facing0, 6);
    // A turnout set against the train blocks the reverse move instead of teleporting it.
    const blocked = movePose(index, reverseMovement(out), 300, () => 'main');
    expect(blocked.blocked).toBe('turnout-against');
  });

  it('double traction with a reversed loco: direction bits differ per loco, same physical push', () => {
    expect(locoDirectionBit('forward', 'forward')).toBe(1);
    expect(locoDirectionBit('forward', 'reverse')).toBe(0);
    expect(locoDirectionBit('reverse', 'forward')).toBe(0);
    expect(locoDirectionBit('reverse', 'reverse')).toBe(1);
  });

  it('world pose of the rear points toward the front', () => {
    const { ids, index } = chain(['k-s-2200', 'k-s-2200']);
    const pose = place(index, { pos: { pieceId: ids[1]!, pathId: 'AB', s: 100 }, dir: 1 }, 150);
    const front = worldPoseAt(index, pose.front);
    const rear = worldPoseAt(index, pose.rear);
    expect(front.x - rear.x).toBeCloseTo(150, 9);
    expect(rear.theta).toBeCloseTo(front.theta, 12);
  });
});
