import { crossing, curve, family, flex, straight, turnout, type TrackDef } from './builders.ts';

/** Roco Line (2-rail DC, with or without bedding) — published Roco geometry. */
export const ROCO_LINE = family('roco-line', 'Roco', 'Line', 'dc2');
/** Roco GeoLine (2-rail DC, integrated bedding). */
export const ROCO_GEOLINE = family('roco-geoline', 'Roco', 'GeoLine', 'dc2');

const L = ROCO_LINE;
const G = ROCO_GEOLINE;

export const ROCO_CATALOG: TrackDef[] = [
  straight(L, '42410', 230, 'G1'),
  straight(L, '42412', 115, 'G½'),
  straight(L, '42413', 57.5, 'G¼'),
  straight(L, '42411', 119, 'DG1 (diagonal filler)'),
  flex(L, '42400', 920, 358, 'Flex 920 mm'),
  curve(L, '42422', 358, 30, 'R2'),
  curve(L, '42423', 419.6, 30, 'R3'),
  curve(L, '42424', 481.2, 30, 'R4'),
  curve(L, '42425', 542.8, 30, 'R5'),
  curve(L, '42426', 604.4, 30, 'R6'),
  curve(L, '42427', 826.4, 15, 'R9'),
  curve(L, '42428', 888, 15, 'R10'),
  curve(L, '42429', 1962, 5, 'R20'),
  turnout(L, '42538', 'L', 230, 15, 873.5, 'Wl15'),
  turnout(L, '42539', 'R', 230, 15, 873.5, 'Wr15'),
  turnout(L, '42440', 'L', 345, 10, 1946, 'Wl10'),
  turnout(L, '42441', 'R', 345, 10, 1946, 'Wr10'),
  turnout(L, '42464', 'L', 230, 30, 358, 'BWl2/3 curved', 'bogen', 419.6, 30),
  turnout(L, '42465', 'R', 230, 30, 358, 'BWr2/3 curved', 'bogen', 419.6, 30),
  turnout(L, '42497', 'L', 230, 15, 873.5, 'DWW15 three-way', 'threeWay'),
  turnout(L, '42496', 'L', 230, 15, undefined, 'DKW15 double slip', 'doubleSlip'),
  crossing(L, '42498', 230, 15, 'K15'),
  crossing(L, '42499', 345, 10, 'K10'),
  straight(G, '61110', 200, 'G200'),
  straight(G, '61111', 100, 'G100'),
  straight(G, '61112', 50, 'G50'),
  straight(G, '61113', 25, 'G25'),
  straight(G, '61120', 200, 'G200 feeder', { feature: 'feeder' }),
  curve(G, '61122', 358, 30, 'R2'),
  curve(G, '61123', 434.5, 30, 'R3'),
  curve(G, '61124', 511.1, 30, 'R4'),
  curve(G, '61125', 587.7, 30, 'R5'),
  curve(G, '61126', 434.5, 15, 'R3 15°'),
  turnout(G, '61140', 'L', 200, 22.5, 502.7, 'Wl'),
  turnout(G, '61141', 'R', 200, 22.5, 502.7, 'Wr'),
  turnout(G, '61142', 'L', 200, 30, 358, 'BWl curved', 'bogen', 434.5, 30),
  turnout(G, '61143', 'R', 200, 30, 358, 'BWr curved', 'bogen', 434.5, 30),
  turnout(G, '61180', 'L', 200, 22.5, undefined, 'DKW double slip', 'doubleSlip'),
  crossing(G, '61160', 200, 22.5, 'K22.5'),
  straight(G, '61190', 200, 'transition GeoLine→Roco Line', { transitionTo: { brand: 'Roco', system: 'Line', electrical: 'dc2' } }),
];
