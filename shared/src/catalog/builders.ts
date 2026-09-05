import type { CrossingDef, CurveDef, ElectricalSystem, FlexDef, StraightDef, TrackDef, TurnoutDef, TurnoutGeometryMode } from './types.ts';

/**
 * Small constructors so every brand file stays pure data. `prefix` becomes the id
 * prefix (`roco-line`, `piko-a`, …); ids must be unique across the whole catalogue.
 */
export interface Family {
  prefix: string;
  brand: string;
  system: string;
  electrical: ElectricalSystem;
}

export function family(prefix: string, brand: string, system: string, electrical: ElectricalSystem): Family {
  return { prefix, brand, system, electrical };
}

const base = (f: Family, artNo: string, label?: string) => ({ brand: f.brand, system: f.system, artNo, label, electrical: f.electrical });

export function straight(f: Family, artNo: string, lengthMm: number, label?: string, extra: Partial<StraightDef> = {}): StraightDef {
  return { kind: 'straight', id: `${f.prefix}-s-${artNo}`, ...base(f, artNo, label), lengthMm, ...extra };
}

export function curve(f: Family, artNo: string, radiusMm: number, angleDeg: number, label?: string): CurveDef {
  return { kind: 'curve', id: `${f.prefix}-c-${artNo}`, ...base(f, artNo, label), radiusMm, angleDeg };
}

export function turnout(
  f: Family,
  artNo: string,
  hand: 'L' | 'R',
  lengthMm: number,
  divergeDeg: number,
  branchRadiusMm: number | undefined,
  label?: string,
  geometryMode: TurnoutGeometryMode = 'standard',
  mainRadiusMm?: number,
  mainAngleDeg?: number,
): TurnoutDef {
  return {
    kind: 'turnout',
    id: `${f.prefix}-t-${artNo}-${hand}`,
    ...base(f, artNo, label),
    geometryMode,
    lengthMm,
    divergeDeg,
    branchRadiusMm,
    mainRadiusMm,
    mainAngleDeg,
    hand,
  };
}

export function crossing(f: Family, artNo: string, lengthMm: number, angleDeg: number, label?: string): CrossingDef {
  return { kind: 'crossing', id: `${f.prefix}-x-${artNo}`, ...base(f, artNo, label), lengthMm, angleDeg };
}

export function flex(f: Family, artNo: string, maxLengthMm: number, minRadiusMm: number, label?: string): FlexDef {
  return { kind: 'flex', id: `${f.prefix}-flex-${artNo}`, ...base(f, artNo, label), maxLengthMm, defaultLengthMm: maxLengthMm, minRadiusMm };
}

/** Transition piece: connector A couples to this family, connector B to `to`. */
export function transition(f: Family, artNo: string, lengthMm: number, to: Family, label?: string): StraightDef {
  return straight(f, artNo, lengthMm, label ?? `transition ${f.system}→${to.brand} ${to.system}`, {
    transitionTo: { brand: to.brand, system: to.system, electrical: to.electrical },
  });
}

export type { TrackDef };
