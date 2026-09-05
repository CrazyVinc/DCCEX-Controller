import { compose, flipHeading, type Frame } from '../geometry/frame.ts';
import { getPath, pathsAtConnector, type PiecePath } from '../geometry/pieceGeometry.ts';
import { pathLength, pathPoseAt } from '../geometry/primitives.ts';
import { otherPort, pathWorldStart, requirePiece, type LayoutIndex, type PieceView } from './index.ts';
import { portKey, type TrackPosition } from './schema.ts';

/** Direction of travel along a path: +1 from `from` toward `to`, -1 the other way. */
export type TravelDir = 1 | -1;

export interface Traversal {
  pos: TrackPosition;
  dir: TravelDir;
}

export type BlockReason = 'open-end' | 'buffer-stop' | 'turnout-against';

export interface AdvanceResult extends Traversal {
  /** Distance actually covered (equals the request unless blocked). */
  moved: number;
  blocked?: BlockReason;
  /** Pieces entered during this move, in order. */
  entered: string[];
}

/** Lookup of the current position of every turnout (`pieceId` → state id). */
export type TurnoutStates = (pieceId: string) => string | undefined;

export function pathLengthOf(view: PieceView, pathId: string): number {
  return pathLength(getPath(view.geom, pathId).primitives);
}

/** World pose at a track position, heading in the direction of travel. */
export function worldPoseAt(index: LayoutIndex, t: Traversal): Frame {
  const view = requirePiece(index, t.pos.pieceId);
  const path = getPath(view.geom, t.pos.pathId);
  const pose = compose(pathWorldStart(view, path.id), pathPoseAt(path.primitives, t.pos.s));
  return t.dir === 1 ? pose : flipHeading(pose);
}

/** Height (mm) of the rail at a track position from the piece's base height and grade. */
export function heightAt(index: LayoutIndex, pos: TrackPosition): number {
  const view = requirePiece(index, pos.pieceId);
  const grade = (view.piece.gradePercent ?? 0) / 100;
  return view.piece.zMm + grade * pos.s;
}

function enterPiece(view: PieceView, connectorId: PiecePath['from'], states: TurnoutStates): Traversal | null {
  const candidates = pathsAtConnector(view.geom, connectorId, states(view.piece.id));
  const path = candidates[0];
  if (!path) return null;
  return path.from === connectorId
    ? { pos: { pieceId: view.piece.id, pathId: path.id, s: 0 }, dir: 1 }
    : { pos: { pieceId: view.piece.id, pathId: path.id, s: pathLength(path.primitives) }, dir: -1 };
}

/** Traversal that starts on `pieceId` right at `connectorId`, heading into the piece (given the turnout states). */
export function enterAt(index: LayoutIndex, pieceId: string, connectorId: PiecePath['from'], states: TurnoutStates = () => undefined): Traversal | null {
  const view = index.pieces.get(pieceId);
  return view ? enterPiece(view, connectorId, states) : null;
}

/**
 * Move `distance` mm (≥ 0) along the track, crossing joints and following the
 * current turnout positions. Stops early at open ends, buffer stops or turnouts
 * set against the movement.
 */
export function advance(index: LayoutIndex, start: Traversal, distance: number, states: TurnoutStates = () => undefined): AdvanceResult {
  let { pos, dir } = start;
  let remaining = Math.max(0, distance);
  const entered: string[] = [];
  let view = requirePiece(index, pos.pieceId);
  let path = getPath(view.geom, pos.pathId);
  let guard = 0;

  for (;;) {
    if (guard++ > 100_000) throw new Error('advance: runaway traversal');
    const len = pathLength(path.primitives);
    const room = dir === 1 ? len - pos.s : pos.s;
    if (remaining <= room + 1e-9) {
      const s = Math.min(len, Math.max(0, pos.s + dir * remaining));
      return { pos: { ...pos, s }, dir, moved: distance, entered };
    }
    remaining -= room;
    const exitConnector = dir === 1 ? path.to : path.from;
    const exitPos: TrackPosition = { ...pos, s: dir === 1 ? len : 0 };
    const connector = view.geom.connectors.find((c) => c.id === exitConnector)!;
    if (connector.blocked) {
      return { pos: exitPos, dir, moved: distance - remaining, blocked: 'buffer-stop', entered };
    }
    const joint = index.jointByPort.get(portKey({ pieceId: view.piece.id, connectorId: exitConnector }));
    if (!joint) {
      return { pos: exitPos, dir, moved: distance - remaining, blocked: 'open-end', entered };
    }
    const next = otherPort(joint, { pieceId: view.piece.id, connectorId: exitConnector });
    const nextView = requirePiece(index, next.pieceId);
    const entry = enterPiece(nextView, next.connectorId, states);
    if (!entry) {
      return { pos: exitPos, dir, moved: distance - remaining, blocked: 'turnout-against', entered };
    }
    view = nextView;
    path = getPath(view.geom, entry.pos.pathId);
    pos = entry.pos;
    dir = entry.dir;
    entered.push(view.piece.id);
  }
}

/** The same physical spot, traversed the other way. */
export function reverseTraversal(t: Traversal): Traversal {
  return { pos: t.pos, dir: t.dir === 1 ? -1 : 1 };
}

/**
 * Piece ids covered when moving from `start` over `distance` mm (start piece included).
 * Useful for occupancy: the pieces between a train's rear and front.
 */
export function piecesAlong(index: LayoutIndex, start: Traversal, distance: number, states?: TurnoutStates): string[] {
  const result = advance(index, start, distance, states);
  return [start.pos.pieceId, ...result.entered];
}
