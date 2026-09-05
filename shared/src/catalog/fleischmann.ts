import { crossing, curve, family, flex, straight, turnout, type TrackDef } from './builders.ts';

/** Fleischmann Profi-Gleis (2-rail DC, bedding). */
export const FLEISCHMANN_PROFI = family('fleischmann-profi', 'Fleischmann', 'Profi', 'dc2');
const F = FLEISCHMANN_PROFI;

export const FLEISCHMANN_CATALOG: TrackDef[] = [
  straight(F, '6101', 200, 'G1'),
  straight(F, '6102', 105, 'G½'),
  straight(F, '6103', 52.5, 'G¼'),
  straight(F, '6107', 21, 'filler'),
  straight(F, '6108', 26.5, 'filler'),
  flex(F, '6106', 800, 356.5, 'Flex 800 mm'),
  curve(F, '6120', 356.5, 36, 'R1'),
  curve(F, '6122', 356.5, 18, 'R1 18°'),
  curve(F, '6125', 420, 36, 'R2'),
  curve(F, '6127', 420, 18, 'R2 18°'),
  curve(F, '6131', 483.5, 36, 'R3'),
  curve(F, '6133', 483.5, 18, 'R3 18°'),
  curve(F, '6138', 547, 36, 'R4'),
  curve(F, '6139', 547, 18, 'R4 18°'),
  turnout(F, '6170', 'L', 200, 15, 647.5, 'W15 L'),
  turnout(F, '6171', 'R', 200, 15, 647.5, 'W15 R'),
  turnout(F, '6178', 'L', 200, 15, 647.5, 'DW three-way', 'threeWay'),
  turnout(F, '6142', 'L', 200, 36, 356.5, 'curved R1/R2 L', 'bogen', 420, 36),
  turnout(F, '6143', 'R', 200, 36, 356.5, 'curved R1/R2 R', 'bogen', 420, 36),
  turnout(F, '6164', 'L', 200, 15, undefined, 'DKW double slip', 'doubleSlip'),
  crossing(F, '6160', 200, 15, 'K15'),
  crossing(F, '6161', 105, 30, 'K30'),
  straight(F, '6111', 200, 'feeder', { feature: 'feeder' }),
  straight(F, '6112', 105, 'uncoupler', { feature: 'uncoupler' }),
];
