import { crossing, curve, family, flex, straight, turnout, type TrackDef } from './builders.ts';

/** Peco Streamline Code 100 (2-rail DC, flexible system with 12° turnouts). */
export const PECO_STREAMLINE_100 = family('peco-sl100', 'Peco', 'Streamline Code 100', 'dc2');
/** Peco Streamline Code 75 — same geometry as Code 100, finer rail. */
export const PECO_STREAMLINE_75 = family('peco-sl75', 'Peco', 'Streamline Code 75', 'dc2');
/** Peco Setrack Code 100 (sectional, 22.5° geometry). */
export const PECO_SETRACK = family('peco-setrack', 'Peco', 'Setrack', 'dc2');

function streamline(f: typeof PECO_STREAMLINE_100, suffix: string): TrackDef[] {
  return [
    flex(f, `SL-100${suffix}`, 914, 457, 'Flex 914 mm (36")'),
    turnout(f, `SL-91${suffix}`, 'L', 185, 12, 610, 'small radius L'),
    turnout(f, `SL-92${suffix}`, 'R', 185, 12, 610, 'small radius R'),
    turnout(f, `SL-95${suffix}`, 'L', 219, 12, 914, 'medium radius L'),
    turnout(f, `SL-96${suffix}`, 'R', 219, 12, 914, 'medium radius R'),
    turnout(f, `SL-88${suffix}`, 'L', 258, 12, 1524, 'large radius L'),
    turnout(f, `SL-89${suffix}`, 'R', 258, 12, 1524, 'large radius R'),
    turnout(f, `SL-86${suffix}`, 'L', 258, 12, 762, 'curved L (nominal)', 'bogen', 1524, 12),
    turnout(f, `SL-87${suffix}`, 'R', 258, 12, 762, 'curved R (nominal)', 'bogen', 1524, 12),
    turnout(f, `SL-99${suffix}`, 'L', 219, 12, 914, 'three-way (asymmetric, modelled symmetric)', 'threeWay'),
    turnout(f, `SL-90${suffix}`, 'L', 249, 12, undefined, 'double slip', 'doubleSlip'),
    crossing(f, `SL-93${suffix}`, 249, 12, 'short crossing 12°'),
    crossing(f, `SL-94${suffix}`, 249, 24, 'long crossing 24°'),
  ];
}

const S = PECO_SETRACK;

export const PECO_CATALOG: TrackDef[] = [
  ...streamline(PECO_STREAMLINE_100, ''),
  ...streamline(PECO_STREAMLINE_75, 'F'),
  straight(S, 'ST-200', 168, 'standard straight'),
  straight(S, 'ST-201', 79, 'short straight'),
  straight(S, 'ST-202', 41, 'quarter straight'),
  straight(S, 'ST-204', 18, 'filler'),
  curve(S, 'ST-220', 371.5, 22.5, 'R1'),
  curve(S, 'ST-221', 371.5, 11.25, 'R1 half'),
  curve(S, 'ST-225', 438, 22.5, 'R2'),
  curve(S, 'ST-226', 438, 11.25, 'R2 half'),
  curve(S, 'ST-230', 505, 22.5, 'R3'),
  curve(S, 'ST-231', 571.5, 22.5, 'R4'),
  turnout(S, 'ST-240', 'L', 168, 22.5, 438, 'R2 turnout L'),
  turnout(S, 'ST-241', 'R', 168, 22.5, 438, 'R2 turnout R'),
  turnout(S, 'ST-244', 'L', 168, 22.5, 371.5, 'curved R1/R2 L', 'bogen', 438, 22.5),
  turnout(S, 'ST-245', 'R', 168, 22.5, 371.5, 'curved R1/R2 R', 'bogen', 438, 22.5),
  turnout(S, 'ST-247', 'L', 168, 22.5, 438, 'Y turnout (modelled three-way)', 'threeWay'),
  crossing(S, 'ST-250', 168, 22.5, 'crossing 22.5°'),
  straight(S, 'ST-273', 79, 'buffer stop', { bufferStop: true }),
  straight(S, 'ST-260', 168, 'transition Setrack→Streamline', { transitionTo: { brand: 'Peco', system: 'Streamline Code 100', electrical: 'dc2' } }),
];
