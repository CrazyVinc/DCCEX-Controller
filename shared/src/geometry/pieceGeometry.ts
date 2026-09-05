import { handSign, type TrackDef, type TurnoutDef } from '../catalog/types.ts';
import { compose, degToRad, flipHeading, normalizeAngle, type Frame } from './frame.ts';
import { arc, line, pathEnd, type Primitive } from './primitives.ts';

/** Connector (coupling point) ids. Straights/curves use A/B; turnouts add C (and D). */
export type ConnectorId = 'A' | 'B' | 'C' | 'D';

export interface Connector {
  id: ConnectorId;
  /** Local frame of the coupling point; `theta` is the OUTWARD heading (away from the piece). */
  frame: Frame;
  /** Buffer stops end here: nothing can be attached. */
  blocked?: boolean;
}

/**
 * A traversable centre line between two connectors, in the piece's local frame.
 * The primitives start at `from` heading INTO the piece (= from.frame.theta + π)
 * and end exactly on `to` heading outward (= to.frame.theta).
 */
export interface PiecePath {
  id: string;
  from: ConnectorId;
  to: ConnectorId;
  primitives: Primitive[];
}

/** One selectable position of a turnout and the paths that are open in it. */
export interface TurnoutStateDef {
  id: string;
  label: string;
  paths: string[];
}

export interface PieceGeometry {
  connectors: Connector[];
  paths: PiecePath[];
  /** Only for pieces with moving parts; absent = every path is always available (plain track, crossings). */
  states?: TurnoutStateDef[];
  defaultState?: string;
}

/** Local frame of connector A for every piece: at the origin, pointing outward along -x. */
const CONNECTOR_A: Connector = { id: 'A', frame: { x: 0, y: 0, theta: Math.PI } };

/** Frame a path starts in: connector position, heading turned to point into the piece. */
export function pathStartFrame(connector: Connector): Frame {
  return flipHeading(connector.frame);
}

function connectorAtPathEnd(id: ConnectorId, prims: Primitive[], blocked?: boolean): Connector {
  const end = compose(pathStartFrame(CONNECTOR_A), pathEnd(prims));
  return { id, frame: end, ...(blocked ? { blocked: true } : {}) };
}

function twoConnectorPiece(prims: Primitive[], blocked = false): PieceGeometry {
  return {
    connectors: [CONNECTOR_A, connectorAtPathEnd('B', prims, blocked)],
    paths: [{ id: 'AB', from: 'A', to: 'B', primitives: prims }],
  };
}

function branchRadius(def: TurnoutDef): number {
  if (def.branchRadiusMm && def.branchRadiusMm > 0) return def.branchRadiusMm;
  // No catalogue radius: choose the arc whose end lies at x = lengthMm (classic M-track design).
  return def.lengthMm / Math.sin(degToRad(def.divergeDeg));
}

function standardTurnout(def: TurnoutDef): PieceGeometry {
  const main = [line(def.lengthMm)];
  const branch = [arc(branchRadius(def), handSign(def.hand) * degToRad(def.divergeDeg))];
  return {
    connectors: [CONNECTOR_A, connectorAtPathEnd('B', main), connectorAtPathEnd('C', branch)],
    paths: [
      { id: 'AB', from: 'A', to: 'B', primitives: main },
      { id: 'AC', from: 'A', to: 'C', primitives: branch },
    ],
    states: [
      { id: 'main', label: 'Straight', paths: ['AB'] },
      { id: 'branch', label: 'Diverging', paths: ['AC'] },
    ],
    defaultState: 'main',
  };
}

function threeWayTurnout(def: TurnoutDef): PieceGeometry {
  const main = [line(def.lengthMm)];
  const R = branchRadius(def);
  const left = [arc(R, -degToRad(def.divergeDeg))];
  const right = [arc(R, degToRad(def.divergeDeg))];
  return {
    connectors: [
      CONNECTOR_A,
      connectorAtPathEnd('B', main),
      connectorAtPathEnd('C', left),
      connectorAtPathEnd('D', right),
    ],
    paths: [
      { id: 'AB', from: 'A', to: 'B', primitives: main },
      { id: 'AC', from: 'A', to: 'C', primitives: left },
      { id: 'AD', from: 'A', to: 'D', primitives: right },
    ],
    states: [
      { id: 'main', label: 'Straight', paths: ['AB'] },
      { id: 'left', label: 'Left', paths: ['AC'] },
      { id: 'right', label: 'Right', paths: ['AD'] },
    ],
    defaultState: 'main',
  };
}

function bogenTurnout(def: TurnoutDef): PieceGeometry {
  const sweep = handSign(def.hand) * degToRad(def.mainAngleDeg ?? def.divergeDeg);
  const rOuter = def.mainRadiusMm!;
  const rInner = def.branchRadiusMm!;
  const main = [arc(rOuter, sweep)];
  const branch = [arc(rInner, sweep)];
  return {
    connectors: [CONNECTOR_A, connectorAtPathEnd('B', main), connectorAtPathEnd('C', branch)],
    paths: [
      { id: 'AB', from: 'A', to: 'B', primitives: main },
      { id: 'AC', from: 'A', to: 'C', primitives: branch },
    ],
    states: [
      { id: 'main', label: 'Outer', paths: ['AB'] },
      { id: 'branch', label: 'Inner', paths: ['AC'] },
    ],
    defaultState: 'main',
  };
}

/**
 * Two straights of length L crossing at their midpoints under angle α. Connector D
 * is the start of the second straight (entering toward the centre at heading α),
 * connector C its end. Slip arcs (double slip only) are tangent to both straights:
 * R = (L/2) / tan(α/2).
 */
function crossingConnectors(lengthMm: number, angleRad: number): { connectors: Connector[]; straights: PiecePath[] } {
  const half = lengthMm / 2;
  const cx = half;
  const c = Math.cos(angleRad);
  const s = Math.sin(angleRad);
  const B: Connector = { id: 'B', frame: { x: lengthMm, y: 0, theta: 0 } };
  const C: Connector = { id: 'C', frame: { x: cx + half * c, y: half * s, theta: normalizeAngle(angleRad) } };
  const D: Connector = { id: 'D', frame: { x: cx - half * c, y: -half * s, theta: normalizeAngle(angleRad + Math.PI) } };
  return {
    connectors: [CONNECTOR_A, B, C, D],
    straights: [
      { id: 'AB', from: 'A', to: 'B', primitives: [line(lengthMm)] },
      { id: 'DC', from: 'D', to: 'C', primitives: [line(lengthMm)] },
    ],
  };
}

function doubleSlip(def: TurnoutDef): PieceGeometry {
  const a = handSign(def.hand) * degToRad(def.divergeDeg);
  const { connectors, straights } = crossingConnectors(def.lengthMm, a);
  const R = def.lengthMm / 2 / Math.tan(Math.abs(a) / 2);
  return {
    connectors,
    paths: [
      ...straights,
      { id: 'AC', from: 'A', to: 'C', primitives: [arc(R, a)] },
      { id: 'DB', from: 'D', to: 'B', primitives: [arc(R, -a)] },
    ],
    states: [
      { id: 'straight', label: 'Straight', paths: ['AB', 'DC'] },
      { id: 'crossed', label: 'Crossed', paths: ['AC', 'DB'] },
    ],
    defaultState: 'straight',
  };
}

/**
 * Build the exact local geometry for a catalogue piece. Flex rail needs the placed
 * shape (solved primitives); without it the default straight length is used.
 */
export function buildPieceGeometry(def: TrackDef, flexShape?: Primitive[]): PieceGeometry {
  switch (def.kind) {
    case 'straight':
      return twoConnectorPiece([line(def.lengthMm)], def.bufferStop === true);
    case 'curve':
      return twoConnectorPiece([arc(def.radiusMm, degToRad(def.angleDeg))]);
    case 'flex':
      return twoConnectorPiece(flexShape && flexShape.length > 0 ? flexShape : [line(def.defaultLengthMm)]);
    case 'crossing': {
      const { connectors, straights } = crossingConnectors(def.lengthMm, degToRad(def.angleDeg));
      return { connectors, paths: straights };
    }
    case 'turnout':
      switch (def.geometryMode) {
        case 'threeWay':
          return threeWayTurnout(def);
        case 'bogen':
          return bogenTurnout(def);
        case 'doubleSlip':
          return doubleSlip(def);
        default:
          return standardTurnout(def);
      }
  }
}

export function getConnector(geom: PieceGeometry, id: ConnectorId): Connector {
  const c = geom.connectors.find((x) => x.id === id);
  if (!c) throw new Error(`Connector ${id} does not exist`);
  return c;
}

export function getPath(geom: PieceGeometry, id: string): PiecePath {
  const p = geom.paths.find((x) => x.id === id);
  if (!p) throw new Error(`Path ${id} does not exist`);
  return p;
}

/** Paths that touch a connector, optionally restricted to a turnout state. */
export function pathsAtConnector(geom: PieceGeometry, connectorId: ConnectorId, stateId?: string): PiecePath[] {
  let candidates = geom.paths.filter((p) => p.from === connectorId || p.to === connectorId);
  if (geom.states) {
    const state = geom.states.find((s) => s.id === (stateId ?? geom.defaultState)) ?? geom.states[0]!;
    candidates = candidates.filter((p) => state.paths.includes(p.id));
  }
  return candidates;
}
