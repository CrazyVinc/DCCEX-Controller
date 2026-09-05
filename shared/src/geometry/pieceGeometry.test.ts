import { describe, expect, it } from 'vitest';
import { TRACK_CATALOG, requireTrackDef } from '../catalog/index.ts';
import { compose, distance, headingDifference, radToDeg } from './frame.ts';
import { buildPieceGeometry, getConnector, pathStartFrame } from './pieceGeometry.ts';
import { pathEnd, pathLength } from './primitives.ts';

describe('piece geometry', () => {
  it('every catalogue path ends exactly on its target connector, heading outward', () => {
    for (const def of TRACK_CATALOG) {
      const geom = buildPieceGeometry(def);
      expect(geom.paths.length).toBeGreaterThan(0);
      for (const path of geom.paths) {
        const from = getConnector(geom, path.from);
        const to = getConnector(geom, path.to);
        const end = compose(pathStartFrame(from), pathEnd(path.primitives));
        expect(distance(end, to.frame), `${def.id} ${path.id} position`).toBeLessThan(1e-6);
        expect(headingDifference(end.theta, to.frame.theta), `${def.id} ${path.id} heading`).toBeLessThan(1e-9);
      }
    }
  });

  it('turnout states only reference existing paths and every connector is reachable', () => {
    for (const def of TRACK_CATALOG) {
      const geom = buildPieceGeometry(def);
      const pathIds = new Set(geom.paths.map((p) => p.id));
      for (const state of geom.states ?? []) {
        for (const id of state.paths) expect(pathIds.has(id), `${def.id} state ${state.id}`).toBe(true);
      }
      for (const c of geom.connectors) {
        const touching = geom.paths.some((p) => p.from === c.id || p.to === c.id);
        expect(touching, `${def.id} connector ${c.id}`).toBe(true);
      }
    }
  });

  it('C-track R1 30° curve has the catalogue arc length and chord', () => {
    const geom = buildPieceGeometry(requireTrackDef('c-c-24130'));
    const path = geom.paths[0]!;
    expect(pathLength(path.primitives)).toBeCloseTo((360 * Math.PI) / 6, 9);
    const b = getConnector(geom, 'B').frame;
    expect(Math.hypot(b.x, b.y)).toBeCloseTo(2 * 360 * Math.sin(Math.PI / 12), 9);
    expect(radToDeg(b.theta)).toBeCloseTo(30, 9);
  });

  it('standard turnout branch and 24224 counter-curve give the 77.5 mm parallel spacing', () => {
    const turnout = buildPieceGeometry(requireTrackDef('c-t-24612-R'));
    const c = getConnector(turnout, 'C').frame;
    // A counter-curve of the same radius/angle brings the heading back to 0 and doubles the offset.
    const curve = buildPieceGeometry(requireTrackDef('c-c-24224'));
    const curveEnd = getConnector(curve, 'B').frame;
    // Attaching the curve's B end at C means traversing it B→A, i.e. turning the opposite way.
    const end = compose({ x: c.x, y: c.y, theta: c.theta }, { x: curveEnd.x, y: -curveEnd.y, theta: -curveEnd.theta });
    expect(radToDeg(end.theta)).toBeCloseTo(0, 6);
    expect(end.y).toBeCloseTo(77.5, 0);
  });

  it('left-hand turnouts diverge toward -y, right-hand toward +y', () => {
    const left = getConnector(buildPieceGeometry(requireTrackDef('k-t-2262-L')), 'C').frame;
    const right = getConnector(buildPieceGeometry(requireTrackDef('k-t-2263-R')), 'C').frame;
    expect(left.y).toBeLessThan(0);
    expect(right.y).toBeGreaterThan(0);
    expect(left.y).toBeCloseTo(-right.y, 9);
  });

  it('double slip: slip arcs are tangent to both straights and the DKW exposes two states', () => {
    const geom = buildPieceGeometry(requireTrackDef('c-t-24624-L'));
    expect(geom.connectors.map((c) => c.id)).toEqual(['A', 'B', 'C', 'D']);
    expect(geom.states?.map((s) => s.id)).toEqual(['straight', 'crossed']);
    const slip = geom.paths.find((p) => p.id === 'AC')!.primitives[0]!;
    expect(slip.kind).toBe('arc');
    if (slip.kind === 'arc') {
      expect(slip.radius).toBeCloseTo(188.3 / 2 / Math.tan((24.3 * Math.PI) / 360), 9);
    }
  });

  it('buffer stop blocks connector B', () => {
    const geom = buildPieceGeometry(requireTrackDef('c-s-24977'));
    expect(getConnector(geom, 'B').blocked).toBe(true);
    expect(getConnector(geom, 'A').blocked).toBeUndefined();
  });
});
