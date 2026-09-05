import type { CrossingDef, CurveDef, FlexDef, StraightDef, TrackDef, TurnoutDef, TurnoutGeometryMode } from './types.ts';

/**
 * Märklin H0 three-rail catalogue (C, K and M track). Sources: Märklin Gleisformate
 * datasheets. Curved-turnout (`Bogenweiche`) radii follow the catalogue: outer stock
 * arc R2, inner branch arc R1.
 */

type Sys = 'C' | 'K' | 'M';

const base = (system: Sys, artNo: string, label?: string) => ({
  brand: 'Marklin',
  system,
  artNo,
  label,
  electrical: 'ac3' as const,
});

const S = (system: Sys, artNo: string, lengthMm: number, label?: string, extra: Partial<StraightDef> = {}): StraightDef => ({
  kind: 'straight',
  id: `${system.toLowerCase()}-s-${artNo}`,
  ...base(system, artNo, label),
  lengthMm,
  ...extra,
});

const Cv = (system: Sys, artNo: string, radiusMm: number, angleDeg: number, label?: string): CurveDef => ({
  kind: 'curve',
  id: `${system.toLowerCase()}-c-${artNo}`,
  ...base(system, artNo, label),
  radiusMm,
  angleDeg,
});

const T = (
  system: Sys,
  artNo: string,
  hand: 'L' | 'R',
  lengthMm: number,
  divergeDeg: number,
  branchRadiusMm: number | undefined,
  label?: string,
  geometryMode: TurnoutGeometryMode = 'standard',
  mainRadiusMm?: number,
  mainAngleDeg?: number,
): TurnoutDef => ({
  kind: 'turnout',
  id: `${system.toLowerCase()}-t-${artNo}-${hand}`,
  ...base(system, artNo, label),
  geometryMode,
  lengthMm,
  divergeDeg,
  branchRadiusMm,
  mainRadiusMm,
  mainAngleDeg,
  hand,
});

const X = (system: Sys, artNo: string, lengthMm: number, angleDeg: number, label?: string): CrossingDef => ({
  kind: 'crossing',
  id: `${system.toLowerCase()}-x-${artNo}`,
  ...base(system, artNo, label),
  lengthMm,
  angleDeg,
});

/** 14°26′ slim K turnout */
const K_SLIM_DIV = 14 + 26 / 60;

const C_TRACK: TrackDef[] = [
  S('C', '24064', 64.3, 'offset R3↔R4'),
  S('C', '24071', 70.8, 'filler slim / DKW'),
  S('C', '24077', 77.5, 'std parallel spacing'),
  S('C', '24094', 94.2),
  S('C', '24172', 171.7, 'pairs 24188 → 360'),
  S('C', '24188', 188.3, 'standard'),
  S('C', '24229', 229.3, 'long slim family'),
  S('C', '24360', 360, 'long'),
  Cv('C', '24130', 360, 30, 'R1 30°'),
  Cv('C', '24230', 437.5, 30, 'R2 30°'),
  Cv('C', '24330', 515, 30, 'R3 30°'),
  Cv('C', '24430', 579.3, 30, 'R4 30°'),
  Cv('C', '24530', 643.6, 30, 'R5 30°'),
  Cv('C', '24115', 360, 15, 'R1 15°'),
  Cv('C', '24215', 437.5, 15, 'R2 15°'),
  Cv('C', '24315', 515, 15, 'R3 15°'),
  Cv('C', '24224', 437.5, 24.3, 'Weichenbogen R2 (24611/12 family)'),
  Cv('C', '20224', 437.5, 24.3, 'START UP retail — same geometry as 24224'),
  Cv('C', '24206', 437.5, 5.7, 'fine R2 arc (+24224 → 30° steps)'),
  Cv('C', '24194', 360, 15, 'Schaltgleis R1'),
  Cv('C', '24294', 437.5, 15, 'Schaltgleis R2'),
  T('C', '24611', 'L', 188.3, 24.3, 437.5, 'std L'),
  T('C', '24612', 'R', 188.3, 24.3, 437.5, 'std R'),
  T('C', '24630', 'L', 188.3, 24.3, 437.5, 'three-way', 'threeWay'),
  T('C', '24671', 'L', 188.3, 30, 360, 'curved Bogen L R1/R2 30°', 'bogen', 437.5, 30),
  T('C', '24672', 'R', 188.3, 30, 360, 'curved Bogen R R1/R2 30°', 'bogen', 437.5, 30),
  T('C', '24711', 'L', 236.1, 12.1, 1114.6, 'slim L'),
  T('C', '24712', 'R', 236.1, 12.1, 1114.6, 'slim R'),
  T('C', '24771', 'L', 188.3, 30, 515, 'wide curved L R3/R4 30°', 'bogen', 579.3, 30),
  T('C', '24772', 'R', 188.3, 30, 515, 'wide curved R R3/R4 30°', 'bogen', 579.3, 30),
  T('C', '24624', 'L', 188.3, 24.3, undefined, 'DKW double slip', 'doubleSlip'),
  T('C', '24720', 'L', 236.1, 12.1, undefined, 'slim DKW', 'doubleSlip'),
  X('C', '24640', 188.3, 24.3, 'crossing 24.3°'),
  X('C', '24740', 236.1, 12.1, 'slim crossing 12.1°'),
  S('C', '24994', 94.2, 'Schaltgleis momentary', { feature: 'switching' }),
  S('C', '24997', 94.2, 'uncoupler', { feature: 'uncoupler' }),
  S('C', '24995', 94.2, 'contact rail (set 2×94.2)', { feature: 'contact' }),
  S('C', '24977', 82.5, 'buffer stop', { bufferStop: true }),
  S('C', '24922', 180, 'transition C→K', { transitionTo: { brand: 'Marklin', system: 'K', electrical: 'ac3' } }),
  S('C', '24951', 180, 'transition C→M', { transitionTo: { brand: 'Marklin', system: 'M', electrical: 'ac3' } }),
];

const K_TRACK: TrackDef[] = [
  S('K', '2200', 180, '1/1'),
  S('K', '2201', 90, '1/2'),
  S('K', '2202', 45, '1/4'),
  S('K', '2203', 30),
  S('K', '2204', 22.5, '1/8'),
  S('K', '2206', 168.9, 'turnout length'),
  S('K', '2207', 156),
  S('K', '2208', 35.1),
  S('K', '2209', 217.9),
  S('K', '2290', 180, 'connecting straight', { feature: 'feeder' }),
  S('K', '2292', 180, 'connecting slim profile', { feature: 'feeder' }),
  S('K', '2293', 41.3),
  S('K', '2295', 90, 'contact set (2×90)', { feature: 'contact' }),
  S('K', '2299', 90, 'Schaltgleis', { feature: 'switching' }),
  S('K', '2297', 90, 'uncoupler', { feature: 'uncoupler' }),
  {
    kind: 'flex',
    id: 'k-flex-2205',
    ...base('K', '2205', 'Flex (cut ≤900 mm)'),
    maxLengthMm: 900,
    defaultLengthMm: 900,
    minRadiusMm: 300,
  } satisfies FlexDef,
  Cv('K', '2221', 360, 30, 'K R1'),
  Cv('K', '2231', 424.6, 30, 'K R2'),
  Cv('K', '2241', 553.9, 30, 'K R4'),
  Cv('K', '2251', 681.5, 30, 'K R5'),
  Cv('K', '2235', 360, 3, '3° trim'),
  Cv('K', '2224', 360, 7, '7° inner'),
  Cv('K', '2234', 424.6, 7, '7° outer'),
  Cv('K', '2223', 360, 15, '15° inner'),
  Cv('K', '2233', 424.6, 15, '15° outer'),
  Cv('K', '2232', 424.6, 22, '22°'),
  Cv('K', '2210', 360, 45, '45° industrial'),
  Cv('K', '2229', 360, 30, 'Schaltgleis curved R1'),
  Cv('K', '2239', 424.6, 30, 'Schaltgleis curved R2'),
  T('K', '2164', 'L', 168.9, 22.5, 424.6, 'manual L (2164L)'),
  T('K', '2165', 'R', 168.9, 22.5, 424.6, 'manual R'),
  T('K', '2261', 'L', 168.9, 22.5, 424.6, 'pair set (era)'),
  T('K', '2262', 'L', 168.9, 22.5, 424.6, 'std L'),
  T('K', '2263', 'R', 168.9, 22.5, 424.6, 'std R'),
  T('K', '2265', 'L', 168.9, 22.5, 424.6, 'variant L'),
  T('K', '2266', 'R', 168.9, 22.5, 424.6, 'variant R'),
  T('K', '2272', 'L', 225, K_SLIM_DIV, 902.4, 'slim L'),
  T('K', '2273', 'R', 225, K_SLIM_DIV, 902.4, 'slim R'),
  T('K', '22715', 'L', 225, 12, 902.4, 'large L'),
  T('K', '22716', 'R', 225, 12, 902.4, 'large R'),
  T('K', '2268', 'L', 168.9, 30, 360, 'curved turnout L (K R1/R2 bogen)', 'bogen', 424.6, 30),
  T('K', '2269', 'R', 168.9, 30, 360, 'curved turnout R (K R1/R2 bogen)', 'bogen', 424.6, 30),
  T('K', '2270', 'L', 168.9, 22.5, 424.6, 'three-way', 'threeWay'),
  T('K', '2260', 'L', 168.9, 22, undefined, 'double slip', 'doubleSlip'),
  T('K', '2275', 'L', 225, 12, undefined, 'double slip large', 'doubleSlip'),
  X('K', '2257', 225, K_SLIM_DIV, 'crossing 14°26′'),
  X('K', '2258', 90, 90, 'crossing 90°'),
  X('K', '2259', 168.9, 22.5, 'crossing 22°30′'),
  S('K', '2291', 180, 'transition K→M', { transitionTo: { brand: 'Marklin', system: 'M', electrical: 'ac3' } }),
];

const M_TRACK: TrackDef[] = [
  S('M', '5106', 180, 'M 1/1'),
  S('M', '5107', 90, 'M 1/2'),
  S('M', '5110', 22.5, 'M 1/8'),
  S('M', '5111', 180, 'M connecting 1/1', { feature: 'feeder' }),
  S('M', '5112', 90, 'M uncoupler 1/2', { feature: 'uncoupler' }),
  Cv('M', '5100', 360, 30, 'M standard'),
  Cv('M', '5120', 286, 45, 'M industrial'),
  T('M', '5202', 'L', 180, 24.28, undefined, 'EM turnout L'),
  T('M', '5202', 'R', 180, 24.28, undefined, 'EM turnout R'),
  T('M', '5140', 'L', 180, 30, 360, 'curved pair L', 'bogen', 437.4, 30),
  T('M', '5140', 'R', 180, 30, 360, 'curved pair R', 'bogen', 437.4, 30),
  T('M', '5141', 'L', 180, 30, 360, 'curved L 30°', 'bogen', 437.4, 30),
  T('M', '5141', 'R', 180, 30, 360, 'curved R 30°', 'bogen', 437.4, 30),
  X('M', '5207', 180, 90, 'crossing 90°'),
];

export const MARKLIN_CATALOG: TrackDef[] = [...C_TRACK, ...K_TRACK, ...M_TRACK];
