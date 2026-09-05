import { crossing, curve, family, flex, straight, turnout, type TrackDef } from './builders.ts';

/** PIKO A-Gleis (2-rail DC). */
export const PIKO_A = family('piko-a', 'PIKO', 'A', 'dc2');
const P = PIKO_A;

export const PIKO_CATALOG: TrackDef[] = [
  straight(P, '55200', 231, 'G231'),
  straight(P, '55201', 119.54, 'G119'),
  straight(P, '55202', 115.46, 'G115'),
  straight(P, '55203', 62, 'G62'),
  straight(P, '55204', 107.32, 'G107'),
  straight(P, '55205', 239.07, 'G239'),
  straight(P, '55206', 940, 'G940'),
  flex(P, '55209', 940, 360, 'Flex 940 mm'),
  curve(P, '55211', 360, 30, 'R1'),
  curve(P, '55212', 421.88, 30, 'R2'),
  curve(P, '55213', 483.75, 30, 'R3'),
  curve(P, '55214', 545.63, 30, 'R4'),
  curve(P, '55219', 907.97, 15, 'R9'),
  curve(P, '55251', 360, 7.5, 'R1 7.5°'),
  curve(P, '55252', 421.88, 7.5, 'R2 7.5°'),
  turnout(P, '55220', 'L', 239.07, 15, 907.97, 'WL'),
  turnout(P, '55221', 'R', 239.07, 15, 907.97, 'WR'),
  turnout(P, '55222', 'L', 239.07, 30, 421.88, 'BWL curved', 'bogen', 483.75, 30),
  turnout(P, '55223', 'R', 239.07, 30, 421.88, 'BWR curved', 'bogen', 483.75, 30),
  turnout(P, '55225', 'L', 239.07, 15, 907.97, 'W3 three-way', 'threeWay'),
  turnout(P, '55224', 'L', 239.07, 15, undefined, 'DKW double slip', 'doubleSlip'),
  crossing(P, '55240', 239.07, 15, 'K15'),
  crossing(P, '55241', 119.54, 30, 'K30'),
  straight(P, '55270', 231, 'uncoupler', { feature: 'uncoupler' }),
  straight(P, '55280', 62, 'buffer stop track', { bufferStop: true }),
];
