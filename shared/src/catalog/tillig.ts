import { crossing, curve, family, flex, straight, turnout, type TrackDef } from './builders.ts';

/** Tillig Elite H0 (2-rail DC, code 83). */
export const TILLIG_ELITE = family('tillig-elite', 'Tillig', 'Elite', 'dc2');
const T = TILLIG_ELITE;

export const TILLIG_CATALOG: TrackDef[] = [
  straight(T, '85120', 166, 'G1'),
  straight(T, '85121', 83, 'G2'),
  straight(T, '85122', 41.5, 'G3'),
  straight(T, '85123', 55.5, 'G4'),
  straight(T, '85124', 28, 'G5'),
  flex(T, '85125', 890, 353, 'Flex 890 mm'),
  curve(T, '85130', 353, 30, 'R11'),
  curve(T, '85131', 353, 15, 'R11 15°'),
  curve(T, '85132', 396, 30, 'R21'),
  curve(T, '85133', 396, 15, 'R21 15°'),
  curve(T, '85134', 439.7, 30, 'R31'),
  curve(T, '85135', 439.7, 15, 'R31 15°'),
  curve(T, '85136', 482.5, 30, 'R41'),
  curve(T, '85137', 631, 15, 'R51'),
  turnout(T, '85321', 'L', 166, 15, 631, 'EW1 L'),
  turnout(T, '85322', 'R', 166, 15, 631, 'EW1 R'),
  turnout(T, '85323', 'L', 228, 12, 1350, 'EW2 L'),
  turnout(T, '85324', 'R', 228, 12, 1350, 'EW2 R'),
  turnout(T, '85325', 'L', 240, 9.4, 2500, 'EW3 L'),
  turnout(T, '85326', 'R', 240, 9.4, 2500, 'EW3 R'),
  turnout(T, '85328', 'L', 166, 30, 353, 'IBW curved L', 'bogen', 396, 30),
  turnout(T, '85329', 'R', 166, 30, 353, 'IBW curved R', 'bogen', 396, 30),
  turnout(T, '85330', 'L', 166, 15, 631, 'DWW three-way', 'threeWay'),
  turnout(T, '85331', 'L', 166, 15, undefined, 'DKW double slip', 'doubleSlip'),
  crossing(T, '85340', 166, 15, 'K15'),
  crossing(T, '85341', 228, 12, 'K12'),
];
