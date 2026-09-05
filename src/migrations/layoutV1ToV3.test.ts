import { describe, expect, it } from 'vitest';
import { requireTrackDef } from '../../shared/src/catalog/index.ts';
import { degToRad, distance } from '../../shared/src/geometry/frame.ts';
import { buildLayoutIndex } from '../../shared/src/layout/index.ts';
import { migrateLayoutV1ToV3, type V1LayoutDocument } from './layoutV1ToV3.ts';

/** Old-format endpoints of a straight (centre origin) and a curve (chord on x, arc toward -y). */
function oldStraight(id: string, x: number, y: number, rotationDeg: number, defId = 'k-s-2200') {
  return { id, defId, x, y, rotationDeg, level: 0, zMm: 0 };
}

describe('layout v1 → v3 migration', () => {
  it('converts a v1 straight + curve chain into exact joints', () => {
    // Straight 2200 (180 mm) centred at (90, 0): endpoints (0,0) and (180,0).
    // Curve R1 30° (chord 2h) placed so its A end sits at (180, 0): centre at (180 + h, 0) rotated by +15° about A…
    const R = 360;
    const alpha = degToRad(30);
    const h = R * Math.sin(alpha / 2);
    // In v1 the curve local frame has chord along x; A end at local (-h, 0). Heading at A = rot - 15°.
    // We want heading at A = 0 → rot = 15°. Then the centre = A + rot(15°)·(h, 0).
    const cx = 180 + h * Math.cos(degToRad(15));
    const cy = 0 + h * Math.sin(degToRad(15));
    const v1: V1LayoutDocument = {
      version: 1,
      name: 'test',
      pieces: [oldStraight('a', 90, 0, 0), { id: 'b', defId: 'k-c-2221', x: cx, y: cy, rotationDeg: 15, level: 0, zMm: 0 }],
      trackBlocks: [{ id: 'blk', level: 0, start: { pieceId: 'a', t: 0.5 }, end: { pieceId: 'b', t: 0.5 }, pathPieceIds: ['a', 'b'] }],
      activeLevel: 0,
    };
    const { doc, report } = migrateLayoutV1ToV3(v1);
    expect(report.pieces).toBe(2);
    expect(report.joints).toBe(1);
    expect(report.gaps).toHaveLength(0);

    const index = buildLayoutIndex(doc);
    const straightB = index.pieces.get('a')!.connectorWorld.get('B')!;
    const curveA = index.pieces.get('b')!.connectorWorld.get('A')!;
    expect(distance(straightB, curveA)).toBeLessThan(1e-6);
    expect(straightB.x).toBeCloseTo(180, 6);
    // Curve heading at A is 0 (pointing +x into the curve), and it turns right (toward +y).
    const curveB = index.pieces.get('b')!.connectorWorld.get('B')!;
    expect(curveB.y).toBeGreaterThan(0);

    expect(doc.trackBlocks[0]!.start).toEqual({ pieceId: 'a', pathId: 'AB', s: 90 });
    expect(doc.trackBlocks[0]!.end.s).toBeCloseTo((R * alpha) / 2, 9);
  });

  it('keeps the heel of a turnout at its old origin and renames crossings', () => {
    const v1: V1LayoutDocument = {
      version: 1,
      name: 't',
      pieces: [
        { id: 't1', defId: 'k-t-2263-R', x: 10, y: 20, rotationDeg: 90, level: 1, zMm: 80, automationId: '12' },
        oldStraight('x1', 500, 500, 0, 'k-s-2258'),
      ],
    };
    const { doc } = migrateLayoutV1ToV3(v1);
    const t1 = doc.pieces.find((p) => p.id === 't1')!;
    expect(t1.frame.x).toBeCloseTo(10, 9);
    expect(t1.frame.y).toBeCloseTo(20, 9);
    expect(t1.frame.theta).toBeCloseTo(Math.PI / 2, 9);
    expect(t1.automationId).toBe('12');
    expect(t1.level).toBe(1);
    const x1 = doc.pieces.find((p) => p.id === 'x1')!;
    expect(x1.defId).toBe('k-x-2258');
    expect(requireTrackDef(x1.defId).kind).toBe('crossing');
  });
});
