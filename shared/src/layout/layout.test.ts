import { describe, expect, it } from 'vitest';
import { degToRad, distance, radToDeg } from '../geometry/frame.ts';
import { solveBiarc } from '../geometry/flexSolver.ts';
import { nearestOnPath } from '../geometry/nearest.ts';
import { arc, line, pathEnd } from '../geometry/primitives.ts';
import { buildLayoutIndex, unresolvedGaps } from './index.ts';
import { attachNewPiece, joinPorts, placeFreePiece, removeJoint, translateComponent } from './ops.ts';
import { emptyLayout, type LayoutDocument, type PortRef } from './schema.ts';
import { advance, worldPoseAt } from './traverse.ts';

function chain(defIds: string[]): { doc: LayoutDocument; ids: string[] } {
  let { doc, pieceId } = placeFreePiece(emptyLayout(), defIds[0]!, { x: 0, y: 0, theta: 0 });
  const ids = [pieceId];
  for (const defId of defIds.slice(1)) {
    const r = attachNewPiece(doc, defId, 'A', { pieceId: ids[ids.length - 1]!, connectorId: 'B' });
    doc = r.doc;
    ids.push(r.pieceId);
  }
  return { doc, ids };
}

describe('graph-first layout', () => {
  it('twelve R1 30° curves close into an exact circle (gap 0)', () => {
    const { doc, ids } = chain(Array(12).fill('k-c-2221'));
    const closed = joinPorts(doc, { pieceId: ids[11]!, connectorId: 'B' }, { pieceId: ids[0]!, connectorId: 'A' });
    const index = buildLayoutIndex(closed.doc);
    const gap = index.jointGaps.get(closed.jointId);
    expect(gap?.gapMm ?? 0).toBeLessThan(1e-6);
    expect(gap?.gapDeg ?? 0).toBeLessThan(1e-7);
    expect(unresolvedGaps(index)).toHaveLength(0);
    expect(index.openPorts).toHaveLength(0);
  });

  it('an incomplete loop reports the measurable mismatch instead of snapping', () => {
    const { doc, ids } = chain(Array(11).fill('k-c-2221'));
    const closed = joinPorts(doc, { pieceId: ids[10]!, connectorId: 'B' }, { pieceId: ids[0]!, connectorId: 'A' });
    const index = buildLayoutIndex(closed.doc);
    // Exactly one joint (the one outside the spanning tree) carries the mismatch; all others stay exact.
    expect(index.jointGaps.size).toBe(1);
    const gap = [...index.jointGaps.values()][0]!;
    // Missing one 30° piece: the chord of a 30° R1 arc is left open.
    expect(gap.gapMm).toBeCloseTo(2 * 360 * Math.sin(degToRad(15)), 6);
    expect(gap.gapDeg).toBeCloseTo(30, 6);
    expect(unresolvedGaps(index)).toHaveLength(1);
    expect(closed.jointId).toBeTruthy();
  });

  it('closing a loop with the join tool never moves existing track; the mismatch lands on the new joint', () => {
    const { doc, ids } = chain(Array(11).fill('k-c-2221'));
    const before = buildLayoutIndex(doc);
    const closed = joinPorts(doc, { pieceId: ids[10]!, connectorId: 'B' }, { pieceId: ids[0]!, connectorId: 'A' });
    const after = buildLayoutIndex(closed.doc);
    for (const id of ids) expect(after.pieces.get(id)!.frame).toEqual(before.pieces.get(id)!.frame);
    expect([...after.jointGaps.keys()]).toEqual([closed.jointId]);
    // Regardless of how the ids sort: the joints that existed first define the geometry.
    const shuffled = { ...closed.doc, joints: closed.doc.joints.map((j, i) => ({ ...j, id: `jt_${String(99 - i).padStart(3, '0')}` })) };
    const shuffledIndex = buildLayoutIndex(shuffled);
    for (const id of ids) expect(shuffledIndex.pieces.get(id)!.frame).toEqual(before.pieces.get(id)!.frame);
    expect([...shuffledIndex.jointGaps.keys()]).toEqual([shuffled.joints[shuffled.joints.length - 1]!.id]);
  });

  it('joining two separate groups moves the group that was placed later', () => {
    const first = chain(['k-s-2200', 'k-s-2200']);
    let { doc } = first;
    const other = placeFreePiece(doc, 'k-s-2200', { x: 1000, y: 500, theta: 1 });
    doc = other.doc;
    const before = buildLayoutIndex(doc);
    const joined = joinPorts(doc, { pieceId: first.ids[1]!, connectorId: 'B' }, { pieceId: other.pieceId, connectorId: 'A' });
    const after = buildLayoutIndex(joined.doc);
    for (const id of first.ids) expect(after.pieces.get(id)!.frame).toEqual(before.pieces.get(id)!.frame);
    expect(after.pieces.get(other.pieceId)!.frame).not.toEqual(before.pieces.get(other.pieceId)!.frame);
    expect(after.jointGaps.size).toBe(0);
    expect(after.roots).toEqual([first.ids[0]]);
  });

  it('attached pieces meet exactly and the whole component moves rigidly', () => {
    const { doc, ids } = chain(['k-s-2200', 'k-c-2231', 'k-t-2263-R']);
    const index = buildLayoutIndex(doc);
    const a = index.pieces.get(ids[0]!)!.connectorWorld.get('B')!;
    const b = index.pieces.get(ids[1]!)!.connectorWorld.get('A')!;
    expect(distance(a, b)).toBeLessThan(1e-9);
    expect(Math.abs(Math.abs(a.theta - b.theta) - Math.PI)).toBeLessThan(1e-9);

    const moved = translateComponent(doc, ids[2]!, 100, -50);
    const movedIndex = buildLayoutIndex(moved);
    for (const id of ids) {
      const before = index.pieces.get(id)!.frame;
      const after = movedIndex.pieces.get(id)!.frame;
      expect(after.x - before.x).toBeCloseTo(100, 9);
      expect(after.y - before.y).toBeCloseTo(-50, 9);
      expect(after.theta).toBeCloseTo(before.theta, 12);
    }
  });

  it('removing a joint leaves the detached part where it was', () => {
    const { doc, ids } = chain(['k-s-2200', 'k-s-2201']);
    const before = buildLayoutIndex(doc).pieces.get(ids[1]!)!.frame;
    const cut = removeJoint(doc, doc.joints[0]!.id);
    const index = buildLayoutIndex(cut);
    expect(index.roots).toHaveLength(2);
    expect(index.pieces.get(ids[1]!)!.frame).toEqual(before);
  });

  it('advance follows turnout states, stops at open ends and reports entered pieces', () => {
    const { doc, ids } = chain(['k-s-2200', 'k-t-2263-R']);
    const straight = attachNewPiece(doc, 'k-s-2201', 'A', { pieceId: ids[1]!, connectorId: 'B' });
    const branch = attachNewPiece(straight.doc, 'k-s-2202', 'A', { pieceId: ids[1]!, connectorId: 'C' });
    const index = buildLayoutIndex(branch.doc);
    const start = { pos: { pieceId: ids[0]!, pathId: 'AB', s: 100 }, dir: 1 as const };

    const viaMain = advance(index, start, 80 + 168.9 + 40, () => 'main');
    expect(viaMain.entered).toEqual([ids[1], straight.pieceId]);
    expect(viaMain.pos.pieceId).toBe(straight.pieceId);
    expect(viaMain.pos.s).toBeCloseTo(40, 9);
    expect(viaMain.blocked).toBeUndefined();

    const viaBranch = advance(index, start, 80 + 1000, () => 'branch');
    expect(viaBranch.entered).toEqual([ids[1], branch.pieceId]);
    expect(viaBranch.blocked).toBe('open-end');
    expect(viaBranch.pos.pieceId).toBe(branch.pieceId);
    expect(viaBranch.pos.s).toBeCloseTo(45, 9);

    // Coming back through the branch while the turnout is set to main = trailing against the points.
    const back = advance(index, { pos: { pieceId: branch.pieceId, pathId: 'AB', s: 10 }, dir: -1 }, 100, () => 'main');
    expect(back.blocked).toBe('turnout-against');
    expect(back.moved).toBeCloseTo(10, 9);
  });

  it('a curve changes the heading continuously along its tangent', () => {
    const { doc, ids } = chain(['k-c-2221']);
    const index = buildLayoutIndex(doc);
    const len = (360 * Math.PI) / 6;
    const headings = [0, 0.25, 0.5, 0.75, 1].map((f) => radToDeg(worldPoseAt(index, { pos: { pieceId: ids[0]!, pathId: 'AB', s: f * len }, dir: 1 }).theta));
    expect(headings.map((h) => Math.round(h * 1e6) / 1e6)).toEqual([0, 7.5, 15, 22.5, 30]);
    const reversed = worldPoseAt(index, { pos: { pieceId: ids[0]!, pathId: 'AB', s: 0.5 * len }, dir: -1 });
    expect(radToDeg(reversed.theta)).toBeCloseTo(15 - 180, 9);
  });
});

describe('flex solver (biarc)', () => {
  it('connects arbitrary poses with two tangent-continuous arcs', () => {
    const cases = [
      { start: { x: 0, y: 0, theta: 0 }, end: { x: 400, y: 120, theta: 0 } },
      { start: { x: 0, y: 0, theta: 0 }, end: { x: 300, y: 300, theta: Math.PI / 2 } },
      { start: { x: 50, y: 20, theta: 0.3 }, end: { x: 600, y: -100, theta: -0.4 } },
      { start: { x: 0, y: 0, theta: 0 }, end: { x: 500, y: 0, theta: 0 } },
    ];
    for (const c of cases) {
      const sol = solveBiarc(c.start, c.end);
      expect(sol, JSON.stringify(c)).not.toBeNull();
      const reached = pathEnd(sol!.primitives);
      const s = c.start;
      const wx = s.x + reached.x * Math.cos(s.theta) - reached.y * Math.sin(s.theta);
      const wy = s.y + reached.x * Math.sin(s.theta) + reached.y * Math.cos(s.theta);
      expect(Math.hypot(wx - c.end.x, wy - c.end.y)).toBeLessThan(1e-6);
      expect(sol!.endErrorMm).toBeLessThan(1e-6);
    }
  });
});

describe('nearest point on path', () => {
  it('finds the exact arc-length parameter on lines and arcs', () => {
    const prims = [line(100), arc(200, Math.PI / 2)];
    const onLine = nearestOnPath(prims, { x: 0, y: 0, theta: 0 }, { x: 40, y: 5 });
    expect(onLine.s).toBeCloseTo(40, 9);
    expect(onLine.distance).toBeCloseTo(5, 9);
    // Point on the arc at 45°: centre (100, 200), radius 200.
    const p = { x: 100 + 200 * Math.sin(Math.PI / 4), y: 200 - 200 * Math.cos(Math.PI / 4) };
    const onArc = nearestOnPath(prims, { x: 0, y: 0, theta: 0 }, p);
    expect(onArc.s).toBeCloseTo(100 + (Math.PI / 4) * 200, 6);
    expect(onArc.distance).toBeLessThan(1e-9);
  });
});

describe('port refs', () => {
  it('cannot attach to an occupied port', () => {
    const { doc, ids } = chain(['k-s-2200', 'k-s-2200']);
    const occupied: PortRef = { pieceId: ids[0]!, connectorId: 'B' };
    expect(() => attachNewPiece(doc, 'k-s-2200', 'A', occupied)).toThrow();
  });
});
