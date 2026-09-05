import { describe, expect, it } from 'vitest';
import { buildLayoutIndex } from '@shared/layout/index.ts';
import { emptyLayout } from '@shared/layout/schema.ts';
import type { VisionElement } from '@shared/vision/schema.ts';
import { importCandidates, matchElement } from './photoImport.ts';
import { catalogFamilies } from '@shared/catalog/index.ts';

const K = catalogFamilies().find((f) => f.key === 'Marklin/K')!;

describe('photo import matching', () => {
  it('matches detected elements to the nearest catalogue pieces', () => {
    expect(matchElement({ type: 'straight', x: 0, y: 0, angleDeg: 0, lengthRel: 0.09, confidence: 1 }, K.defs, 2000)?.artNo).toBe('2200');
    expect(matchElement({ type: 'straight', x: 0, y: 0, angleDeg: 0, lengthRel: 0.045, confidence: 1 }, K.defs, 2000)?.artNo).toBe('2201');
    expect(matchElement({ type: 'curve', x: 0, y: 0, angleDeg: 0, lengthRel: 0.09, sweepDeg: 30, confidence: 1 }, K.defs, 2000)?.artNo).toBe('2221');
    expect(matchElement({ type: 'turnout-left', x: 0, y: 0, angleDeg: 0, lengthRel: 0.08, confidence: 1 }, K.defs, 2000)?.artNo).toBe('2164');
    expect(matchElement({ type: 'crossing', x: 0, y: 0, angleDeg: 0, lengthRel: 0.08, confidence: 1 }, K.defs, 2000)?.kind).toBe('crossing');
  });

  it('places candidates, couples ends that meet and flags low confidence', () => {
    // Two 180 mm straights in a row on a 2000 mm wide photo: centres 0.09 apart.
    const elements: VisionElement[] = [
      { type: 'straight', x: 0.1, y: 0.5, angleDeg: 0, lengthRel: 0.09, confidence: 0.9 },
      { type: 'straight', x: 0.19, y: 0.5, angleDeg: 0, lengthRel: 0.09, confidence: 0.4 },
      { type: 'curve', x: 0.5, y: 0.5, angleDeg: 90, lengthRel: 0.09, sweepDeg: 30, confidence: 0.8 },
    ];
    const result = importCandidates(emptyLayout(), elements, { familyKey: 'Marklin/K', imageWidthMm: 2000, aspect: 0.75, level: 0 });
    expect(result.pieceIds).toHaveLength(3);
    expect(result.joints).toBe(1);
    expect(result.lowConfidence.size).toBe(1);
    const index = buildLayoutIndex(result.doc);
    expect(index.roots).toHaveLength(2);
    // The joined straights are exact after coupling.
    expect(index.jointGaps.size).toBe(0);
    const first = index.pieces.get(result.pieceIds[0]!)!;
    expect(first.frame.x).toBeCloseTo(200 - 90, 6);
    expect(first.frame.y).toBeCloseTo(0.5 * 2000 * 0.75, 6);
  });
});
