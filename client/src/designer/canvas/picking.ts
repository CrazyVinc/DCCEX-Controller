import { distance, headingDifference, type Vec2 } from '@shared/geometry/frame.ts';
import { nearestOnPath } from '@shared/geometry/nearest.ts';
import { buildPieceGeometry, getConnector } from '@shared/geometry/pieceGeometry.ts';
import { isPortAttachable, pathWorldStart, pieceFrameForConnectorAt, type LayoutIndex } from '@shared/layout/index.ts';
import type { Frame } from '@shared/geometry/frame.ts';
import { connectorCompatibility, familyAtConnector, getTrackDef } from '@shared/catalog/index.ts';
import { compose } from '@shared/geometry/frame.ts';
import { pathPoseAt } from '@shared/geometry/primitives.ts';
import { blockWorldSegments } from '@shared/layout/blockGeometry.ts';
import type { PortRef, TrackBlock, TrackPosition } from '@shared/layout/schema.ts';
import type { BlockKind, Placing } from '../store/editorStore.ts';

export interface TrackHit {
  pos: TrackPosition;
  distance: number;
}

/** Pieces considered for picking/snapping: active level only, or everything. */
export function visiblePieceIds(index: LayoutIndex, activeLevel: number, showAll: boolean): string[] {
  const out: string[] = [];
  for (const v of index.pieces.values()) {
    if (showAll || v.piece.level === activeLevel) out.push(v.piece.id);
  }
  return out;
}

/** Closest track centre line to a world point within `tolMm`. */
export function pickTrack(index: LayoutIndex, pieceIds: Iterable<string>, world: Vec2, tolMm: number): TrackHit | null {
  let best: TrackHit | null = null;
  for (const id of pieceIds) {
    const view = index.pieces.get(id);
    if (!view) continue;
    for (const path of view.geom.paths) {
      const n = nearestOnPath(path.primitives, pathWorldStart(view, path.id), world);
      if (n.distance <= tolMm && (!best || n.distance < best.distance)) {
        best = { pos: { pieceId: id, pathId: path.id, s: n.s }, distance: n.distance };
      }
    }
  }
  return best;
}

export interface PortHit {
  ref: PortRef;
  frame: Frame;
  distance: number;
}

/** Closest open, attachable port within `tolMm`; `accept` can veto ports (e.g. incompatible track systems). */
export function pickOpenPort(index: LayoutIndex, pieceIds: Iterable<string>, world: Vec2, tolMm: number, exclude?: Set<string>, accept?: (ref: PortRef) => boolean): PortHit | null {
  const visible = new Set(pieceIds);
  let best: PortHit | null = null;
  for (const ref of index.openPorts) {
    if (!visible.has(ref.pieceId) || exclude?.has(ref.pieceId)) continue;
    if (!isPortAttachable(index, ref)) continue;
    if (accept && !accept(ref)) continue;
    const frame = index.pieces.get(ref.pieceId)!.connectorWorld.get(ref.connectorId)!;
    const d = distance(frame, world);
    if (d <= tolMm && (!best || d < best.distance)) best = { ref, frame, distance: d };
  }
  return best;
}

export interface JointHit {
  jointId: string;
  position: Vec2;
  distance: number;
}

/** Closest joint marker within `tolMm`. */
export function pickJoint(index: LayoutIndex, pieceIds: Iterable<string>, world: Vec2, tolMm: number): JointHit | null {
  const visible = new Set(pieceIds);
  let best: JointHit | null = null;
  for (const joint of index.doc.joints) {
    if (!visible.has(joint.a.pieceId) && !visible.has(joint.b.pieceId)) continue;
    const view = index.pieces.get(joint.a.pieceId);
    const frame = view?.connectorWorld.get(joint.a.connectorId);
    if (!frame) continue;
    const d = distance(frame, world);
    if (d <= tolMm && (!best || d < best.distance)) best = { jointId: joint.id, position: { x: frame.x, y: frame.y }, distance: d };
  }
  return best;
}

export interface BlockHit {
  kind: BlockKind;
  id: string;
  distance: number;
}

/** World position of a block's label: the middle of its first segment (same rule as the scene). */
export function blockLabelPosition(index: LayoutIndex, block: TrackBlock): Vec2 | null {
  const seg = blockWorldSegments(index, block)[0];
  return seg ? compose(seg.start, pathPoseAt(seg.primitives, seg.lengthMm / 2)) : null;
}

/** Closest block / destination / speed-restriction label within `tolMm` (stations first). */
export function pickBlockLabel(index: LayoutIndex, activeLevel: number, showAll: boolean, world: Vec2, tolMm: number): BlockHit | null {
  const doc = index.doc;
  const lists: [BlockKind, TrackBlock[]][] = [
    ['destination', doc.destinations],
    ['speed', doc.speedRestrictions],
    ['block', doc.trackBlocks.filter((b) => b.sensorId != null)],
  ];
  let best: BlockHit | null = null;
  for (const [kind, blocks] of lists) {
    for (const block of blocks) {
      if (!showAll && block.level !== activeLevel) continue;
      const at = blockLabelPosition(index, block);
      if (!at) continue;
      const d = distance(at, world);
      if (d <= tolMm && (!best || d < best.distance)) best = { kind, id: block.id, distance: d };
    }
  }
  return best;
}

export interface GhostPlacement {
  frame: Frame;
  target: PortRef | null;
}

/** Where a piece being placed would land: snapped onto the nearest open port, else free at the cursor. */
export function ghostPlacement(index: LayoutIndex, pieceIds: Iterable<string>, placing: Placing, world: Vec2, snapTolMm: number): GhostPlacement | null {
  const def = getTrackDef(placing.defId);
  if (!def) return null;
  const geom = buildPieceGeometry(def);
  const mine = familyAtConnector(def, placing.connectorId);
  // Only snap onto ports of the same track family (or a matching transition piece end).
  const port = pickOpenPort(index, pieceIds, world, snapTolMm, undefined, (ref) => {
    const view = index.pieces.get(ref.pieceId);
    return !!view && connectorCompatibility(mine, familyAtConnector(view.def, ref.connectorId)) === null;
  });
  if (port) {
    return { frame: pieceFrameForConnectorAt(geom, placing.connectorId, port.frame), target: port.ref };
  }
  // Free placement: the chosen connector sits at the cursor and the piece extends along `theta`.
  const connector = getConnector(geom, placing.connectorId);
  const virtualTarget: Frame = { x: world.x, y: world.y, theta: placing.theta + Math.PI };
  const frame = pieceFrameForConnectorAt(geom, connector.id, virtualTarget);
  return { frame: compose(frame, { x: 0, y: 0, theta: 0 }), target: null };
}

/**
 * After dragging components, find an open port of the moved pieces that (nearly) meets an
 * open port of a piece that was not moved — the candidate for an automatic join.
 */
export function findDragJoin(index: LayoutIndex, movedPieceIds: Set<string>, tolMm: number, maxHeadingRad: number): { a: PortRef; b: PortRef } | null {
  let best: { a: PortRef; b: PortRef; d: number } | null = null;
  for (const ref of index.openPorts) {
    if (!movedPieceIds.has(ref.pieceId) || !isPortAttachable(index, ref)) continue;
    const fa = index.pieces.get(ref.pieceId)!.connectorWorld.get(ref.connectorId)!;
    for (const other of index.openPorts) {
      if (movedPieceIds.has(other.pieceId) || !isPortAttachable(index, other)) continue;
      const fb = index.pieces.get(other.pieceId)!.connectorWorld.get(other.connectorId)!;
      const d = distance(fa, fb);
      if (d > tolMm) continue;
      if (headingDifference(fa.theta + Math.PI, fb.theta) > maxHeadingRad) continue;
      const famA = familyAtConnector(index.pieces.get(ref.pieceId)!.def, ref.connectorId);
      const famB = familyAtConnector(index.pieces.get(other.pieceId)!.def, other.connectorId);
      if (connectorCompatibility(famA, famB) !== null) continue;
      if (!best || d < best.d) best = { a: ref, b: other, d };
    }
  }
  return best ? { a: best.a, b: best.b } : null;
}
