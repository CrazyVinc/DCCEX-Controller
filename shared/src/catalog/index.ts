import { FLEISCHMANN_CATALOG } from './fleischmann.ts';
import { MARKLIN_CATALOG } from './marklin.ts';
import { PECO_CATALOG } from './peco.ts';
import { PIKO_CATALOG } from './piko.ts';
import { ROCO_CATALOG } from './roco.ts';
import { TILLIG_CATALOG } from './tillig.ts';
import { TRIX_CATALOG } from './trix.ts';
import type { TrackDef } from './types.ts';

export * from './types.ts';
export * from './compat.ts';

/** Every known track piece definition across all brands (one data file per brand). */
export const TRACK_CATALOG: TrackDef[] = [
  ...MARKLIN_CATALOG,
  ...TRIX_CATALOG,
  ...ROCO_CATALOG,
  ...PIKO_CATALOG,
  ...FLEISCHMANN_CATALOG,
  ...PECO_CATALOG,
  ...TILLIG_CATALOG,
];

const byId = new Map<string, TrackDef>();
for (const def of TRACK_CATALOG) {
  if (byId.has(def.id)) {
    throw new Error(`Duplicate track def id ${def.id}`);
  }
  byId.set(def.id, def);
}

export function getTrackDef(id: string): TrackDef | undefined {
  return byId.get(id);
}

export function requireTrackDef(id: string): TrackDef {
  const def = byId.get(id);
  if (!def) {
    throw new Error(`Unknown track def ${id}`);
  }
  return def;
}

export interface CatalogFamily {
  brand: string;
  system: string;
  key: string;
  electrical: TrackDef['electrical'];
  defs: TrackDef[];
}

/** Catalogue grouped per brand/system family, in catalogue order. */
export function catalogFamilies(): CatalogFamily[] {
  const map = new Map<string, CatalogFamily>();
  for (const def of TRACK_CATALOG) {
    const key = `${def.brand}/${def.system}`;
    let fam = map.get(key);
    if (!fam) {
      fam = { brand: def.brand, system: def.system, key, electrical: def.electrical, defs: [] };
      map.set(key, fam);
    }
    fam.defs.push(def);
  }
  return [...map.values()];
}
