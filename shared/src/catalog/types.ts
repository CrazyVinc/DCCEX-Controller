/**
 * Track catalogue data model. All dimensions are **H0 model millimetres** as the
 * manufacturer publishes them for the physical pieces. Geometry is derived from
 * these parameters by `pieceGeometry.ts`; the catalogue itself is pure data so
 * new brands can be added as plain data files.
 */

/** Electrical system of a track family. Pieces of different systems only couple via a transition piece. */
export type ElectricalSystem = 'ac3' | 'dc2';

export interface TrackDefBase {
  id: string;
  /** Manufacturer, e.g. `Marklin`, `Roco`. */
  brand: string;
  /** Track family within the brand, e.g. `C`, `K`, `M`, `Line`, `GeoLine`. */
  system: string;
  artNo: string;
  label?: string;
  electrical: ElectricalSystem;
  /** Family the far (B) end couples to for transition pieces. */
  transitionTo?: { brand: string; system: string; electrical: ElectricalSystem };
  /** Piece ends in a buffer stop: connector `B` is not attachable. */
  bufferStop?: boolean;
  /** Functional tag that does not change the geometry. */
  feature?: 'uncoupler' | 'contact' | 'switching' | 'feeder';
}

export interface StraightDef extends TrackDefBase {
  kind: 'straight';
  lengthMm: number;
}

export interface CurveDef extends TrackDefBase {
  kind: 'curve';
  radiusMm: number;
  angleDeg: number;
}

/**
 * How a turnout's routes are built:
 * - `standard`: straight stock route + one diverging arc from the toe
 * - `bogen`: curved turnout, both routes are arcs of the same sweep
 * - `threeWay`: straight stock route + symmetric left/right arcs
 * - `doubleSlip`: two straights crossing at `divergeDeg` with two slip arcs
 */
export type TurnoutGeometryMode = 'standard' | 'bogen' | 'threeWay' | 'doubleSlip';

export interface TurnoutDef extends TrackDefBase {
  kind: 'turnout';
  geometryMode: TurnoutGeometryMode;
  /** Straight stock-route length (standard/threeWay/doubleSlip). */
  lengthMm: number;
  divergeDeg: number;
  /** Radius of the diverging arc; when absent it is derived so the branch ends at x = lengthMm. */
  branchRadiusMm?: number;
  /** Bogen only: radius / sweep of the (outer) stock arc. */
  mainRadiusMm?: number;
  mainAngleDeg?: number;
  hand: 'L' | 'R';
}

export interface CrossingDef extends TrackDefBase {
  kind: 'crossing';
  lengthMm: number;
  angleDeg: number;
}

export interface FlexDef extends TrackDefBase {
  kind: 'flex';
  maxLengthMm: number;
  defaultLengthMm: number;
  /** Smallest radius the rail may be bent to. */
  minRadiusMm: number;
}

export type TrackDef = StraightDef | CurveDef | TurnoutDef | CrossingDef | FlexDef;

export type TrackKind = TrackDef['kind'];

/** Turn direction sign for a hand: left turns have negative sweep in our y-down convention. */
export function handSign(hand: 'L' | 'R'): 1 | -1 {
  return hand === 'L' ? -1 : 1;
}
