import { compose, type Frame } from '../geometry/frame.ts';
import type { ConnectorId, PiecePath } from '../geometry/pieceGeometry.ts';
import { pathLength, pathPoseAt, slicePath, type Primitive } from '../geometry/primitives.ts';
import { otherPort, pathWorldStart, type LayoutIndex, type PieceView } from './index.ts';
import { portKey, type TrackBlock, type TrackPosition } from './schema.ts';

/** A drawable/measurable piece of rail: primitives placed at a world start frame. */
export interface WorldSegment {
  pieceId: string;
  pathId: string;
  primitives: Primitive[];
  start: Frame;
  lengthMm: number;
  /** Path arc length where the block enters this segment (in block order)… */
  pathFromS: number;
  /** …and where it leaves it. `pathToS < pathFromS` when the block runs against the path direction. */
  pathToS: number;
}

function connectorJoinedTo(index: LayoutIndex, pieceId: string, otherPieceId: string): ConnectorId | null {
  const view = index.pieces.get(pieceId);
  if (!view) return null;
  for (const c of view.geom.connectors) {
    const joint = index.jointByPort.get(portKey({ pieceId, connectorId: c.id }));
    if (joint && otherPort(joint, { pieceId, connectorId: c.id }).pieceId === otherPieceId) return c.id;
  }
  return null;
}

function pathBetween(view: PieceView, a: ConnectorId | null, b: ConnectorId | null): PiecePath | null {
  const paths = view.geom.paths;
  if (a && b) {
    const exact = paths.find((p) => (p.from === a && p.to === b) || (p.from === b && p.to === a));
    if (exact) return exact;
  }
  const touching = paths.find((p) => p.from === (a ?? b) || p.to === (a ?? b));
  return touching ?? paths[0] ?? null;
}

function segmentFor(view: PieceView, path: PiecePath, s0: number, s1: number): WorldSegment {
  const a = Math.min(s0, s1);
  const b = Math.max(s0, s1);
  const prims = slicePath(path.primitives, a, b);
  const start = compose(pathWorldStart(view, path.id), pathPoseAt(path.primitives, a));
  return { pieceId: view.piece.id, pathId: path.id, primitives: prims, start, lengthMm: pathLength(prims), pathFromS: s0, pathToS: s1 };
}

/**
 * Exact track position `distanceMm` along a block measured from its start anchor
 * (clamped to the block). Useful for "the middle of the platform".
 */
export function blockPositionAt(index: LayoutIndex, block: TrackBlock, distanceMm: number): TrackPosition | null {
  const segments = blockWorldSegments(index, block);
  if (!segments.length) return null;
  let remaining = Math.max(0, distanceMm);
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]!;
    if (remaining <= seg.lengthMm + 1e-9 || i === segments.length - 1) {
      const d = Math.min(remaining, seg.lengthMm);
      const s = seg.pathToS >= seg.pathFromS ? seg.pathFromS + d : seg.pathFromS - d;
      return { pieceId: seg.pieceId, pathId: seg.pathId, s };
    }
    remaining -= seg.lengthMm;
  }
  return null;
}

/** Position halfway along a block. */
export function blockCentre(index: LayoutIndex, block: TrackBlock): TrackPosition | null {
  return blockPositionAt(index, block, blockLengthMm(index, block) / 2);
}

/**
 * World segments covered by a block: partial first/last piece between the anchors and
 * whole paths for the pieces in between (following the chain through the joints).
 */
export function blockWorldSegments(index: LayoutIndex, block: TrackBlock): WorldSegment[] {
  const chain = block.pieceIds.length ? block.pieceIds : [block.start.pieceId];
  const out: WorldSegment[] = [];
  if (chain.length === 1) {
    const view = index.pieces.get(chain[0]!);
    if (!view) return out;
    const path = view.geom.paths.find((p) => p.id === block.start.pathId) ?? view.geom.paths[0]!;
    out.push(segmentFor(view, path, block.start.s, block.end.s));
    return out;
  }
  for (let i = 0; i < chain.length; i++) {
    const id = chain[i]!;
    const view = index.pieces.get(id);
    if (!view) continue;
    const prevId = i > 0 ? chain[i - 1]! : null;
    const nextId = i < chain.length - 1 ? chain[i + 1]! : null;
    const fromPrev = prevId ? connectorJoinedTo(index, id, prevId) : null;
    const toNext = nextId ? connectorJoinedTo(index, id, nextId) : null;
    if (i === 0) {
      const path = view.geom.paths.find((p) => p.id === block.start.pathId) ?? pathBetween(view, toNext, null);
      if (!path) continue;
      const exitS = toNext === path.to ? pathLength(path.primitives) : toNext === path.from ? 0 : pathLength(path.primitives);
      out.push(segmentFor(view, path, block.start.s, exitS));
    } else if (i === chain.length - 1) {
      const path = view.geom.paths.find((p) => p.id === block.end.pathId) ?? pathBetween(view, fromPrev, null);
      if (!path) continue;
      const entryS = fromPrev === path.from ? 0 : fromPrev === path.to ? pathLength(path.primitives) : 0;
      out.push(segmentFor(view, path, entryS, block.end.s));
    } else {
      const path = pathBetween(view, fromPrev, toNext);
      if (!path) continue;
      out.push(segmentFor(view, path, 0, pathLength(path.primitives)));
    }
  }
  return out;
}

export function blockLengthMm(index: LayoutIndex, block: TrackBlock): number {
  return blockWorldSegments(index, block).reduce((sum, s) => sum + s.lengthMm, 0);
}
