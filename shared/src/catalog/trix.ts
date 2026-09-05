import { crossing, curve, family, flex, straight, turnout, type TrackDef } from './builders.ts';
import { MARKLIN_CATALOG } from './marklin.ts';

/**
 * Trix C-Gleis: the 2-rail DC twin of Märklin C — identical geometry, 62xxx article
 * numbers. Generated from the Märklin C entries so both stay in sync.
 */
export const TRIX_C = family('trix-c', 'Trix', 'C', 'dc2');

export const TRIX_CATALOG: TrackDef[] = MARKLIN_CATALOG.filter((d) => d.system === 'C' && !d.transitionTo).map((d): TrackDef => {
  const artNo = d.artNo.replace(/^24/, '62');
  switch (d.kind) {
    case 'straight':
      return straight(TRIX_C, artNo, d.lengthMm, d.label, { bufferStop: d.bufferStop, feature: d.feature });
    case 'curve':
      return curve(TRIX_C, artNo, d.radiusMm, d.angleDeg, d.label);
    case 'turnout':
      return turnout(TRIX_C, artNo, d.hand, d.lengthMm, d.divergeDeg, d.branchRadiusMm, d.label, d.geometryMode, d.mainRadiusMm, d.mainAngleDeg);
    case 'crossing':
      return crossing(TRIX_C, artNo, d.lengthMm, d.angleDeg, d.label);
    case 'flex':
      return flex(TRIX_C, artNo, d.maxLengthMm, d.minRadiusMm, d.label);
  }
});
