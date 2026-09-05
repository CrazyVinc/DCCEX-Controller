import { describe, expect, it } from 'vitest';
import { catalogFamilies, connectorCompatibility, familyAtConnector, requireTrackDef, TRACK_CATALOG } from './index.ts';

describe('track catalogue', () => {
  it('covers all planned brands as separate data families', () => {
    const keys = catalogFamilies().map((f) => f.key);
    for (const expected of ['Marklin/C', 'Marklin/K', 'Marklin/M', 'Trix/C', 'Roco/Line', 'Roco/GeoLine', 'PIKO/A', 'Fleischmann/Profi', 'Peco/Streamline Code 100', 'Peco/Streamline Code 75', 'Peco/Setrack', 'Tillig/Elite']) {
      expect(keys).toContain(expected);
    }
    expect(TRACK_CATALOG.length).toBeGreaterThan(200);
  });

  it('Trix C mirrors Märklin C geometry with 2-rail DC electrics', () => {
    const m = requireTrackDef('c-t-24611-L');
    const t = requireTrackDef('trix-c-t-62611-L');
    expect(t.kind).toBe('turnout');
    if (m.kind === 'turnout' && t.kind === 'turnout') {
      expect(t.lengthMm).toBe(m.lengthMm);
      expect(t.divergeDeg).toBe(m.divergeDeg);
      expect(t.branchRadiusMm).toBe(m.branchRadiusMm);
    }
    expect(m.electrical).toBe('ac3');
    expect(t.electrical).toBe('dc2');
  });

  it('flags electrical and mechanical incompatibility, and lets transition pieces bridge families', () => {
    const c = requireTrackDef('c-s-24188');
    const k = requireTrackDef('k-s-2200');
    const roco = requireTrackDef('roco-line-s-42410');
    const cToK = requireTrackDef('c-s-24922');
    expect(connectorCompatibility(familyAtConnector(c, 'B'), familyAtConnector(roco, 'A'))).toBe('electrical');
    expect(connectorCompatibility(familyAtConnector(c, 'B'), familyAtConnector(k, 'A'))).toBe('mechanical');
    expect(connectorCompatibility(familyAtConnector(c, 'B'), familyAtConnector(cToK, 'A'))).toBeNull();
    expect(connectorCompatibility(familyAtConnector(cToK, 'B'), familyAtConnector(k, 'A'))).toBeNull();
    expect(connectorCompatibility(familyAtConnector(cToK, 'B'), familyAtConnector(c, 'A'))).toBe('mechanical');
  });
});
