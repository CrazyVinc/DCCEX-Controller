import { requireTrackDef, type TrackDef } from '../catalog/index.ts';
import { rotateFrameAbout, translateFrame, type Frame, type Vec2 } from '../geometry/frame.ts';
import { buildPieceGeometry, type ConnectorId } from '../geometry/pieceGeometry.ts';
import { newId } from '../util/id.ts';
import { buildLayoutIndex, isPortAttachable, pieceFrameForConnectorAt, type LayoutIndex } from './index.ts';
import { getLevelHeightMm, portKey, type Joint, type LayoutDocument, type PlacedPiece, type PortRef } from './schema.ts';

/**
 * Pure document operations. Every mutation returns a new, normalised document
 * (frames re-derived from the component roots) so stored frames always agree
 * with the joints.
 */

export type PieceMeta = Partial<
  Pick<PlacedPiece, 'level' | 'zMm' | 'gradePercent' | 'automationId' | 'switchTimeMs' | 'drivingConstraint' | 'railTypes' | 'flexShape'>
>;

/** Re-derive all piece frames from the joints and write them back. */
export function normalizeLayout(doc: LayoutDocument): LayoutDocument {
  const index = buildLayoutIndex(doc);
  let changed = false;
  const pieces = doc.pieces.map((p) => {
    const view = index.pieces.get(p.id);
    if (!view) return p;
    const f = view.frame;
    if (f.x === p.frame.x && f.y === p.frame.y && f.theta === p.frame.theta) return p;
    changed = true;
    return { ...p, frame: f };
  });
  return changed ? { ...doc, pieces } : doc;
}

function newPiece(def: TrackDef, frame: Frame, doc: LayoutDocument, meta: PieceMeta): PlacedPiece {
  const level = meta.level ?? doc.activeLevel;
  const piece: PlacedPiece = {
    id: newId('pc'),
    defId: def.id,
    frame,
    level,
    zMm: meta.zMm ?? getLevelHeightMm(doc, level),
  };
  if (meta.gradePercent != null) piece.gradePercent = meta.gradePercent;
  if (meta.automationId) piece.automationId = meta.automationId;
  if (meta.switchTimeMs != null) piece.switchTimeMs = meta.switchTimeMs;
  if (meta.drivingConstraint) piece.drivingConstraint = meta.drivingConstraint;
  if (meta.railTypes?.length) piece.railTypes = meta.railTypes;
  if (meta.flexShape?.length) piece.flexShape = meta.flexShape;
  return piece;
}

/** Place a new piece as its own component at a free world frame. */
export function placeFreePiece(doc: LayoutDocument, defId: string, frame: Frame, meta: PieceMeta = {}): { doc: LayoutDocument; pieceId: string } {
  const def = requireTrackDef(defId);
  const piece = newPiece(def, frame, doc, meta);
  return { doc: normalizeLayout({ ...doc, pieces: [...doc.pieces, piece] }), pieceId: piece.id };
}

/**
 * Add a new piece coupled with `connectorId` onto an open `target` port. The new
 * piece's frame follows from the target connector — no snapping involved.
 */
export function attachNewPiece(
  doc: LayoutDocument,
  defId: string,
  connectorId: ConnectorId,
  target: PortRef,
  meta: PieceMeta = {},
  index: LayoutIndex = buildLayoutIndex(doc),
): { doc: LayoutDocument; pieceId: string; jointId: string } {
  if (!isPortAttachable(index, target)) {
    throw new Error(`Port ${portKey(target)} is not attachable`);
  }
  const def = requireTrackDef(defId);
  const targetView = index.pieces.get(target.pieceId)!;
  const targetWorld = targetView.connectorWorld.get(target.connectorId)!;
  const geom = buildPieceGeometry(def, meta.flexShape);
  const frame = pieceFrameForConnectorAt(geom, connectorId, targetWorld);
  const piece = newPiece(def, frame, doc, { level: targetView.piece.level, zMm: targetView.piece.zMm, ...meta });
  const joint: Joint = { id: newId('jt'), a: { pieceId: piece.id, connectorId }, b: target };
  return {
    doc: normalizeLayout({ ...doc, pieces: [...doc.pieces, piece], joints: [...doc.joints, joint] }),
    pieceId: piece.id,
    jointId: joint.id,
  };
}

/**
 * Join two existing open ports. When both belong to the same component this closes a
 * loop and the mismatch is reported through `LayoutIndex.jointGaps`; when they belong
 * to different components the second component is moved to fit exactly.
 */
export function joinPorts(doc: LayoutDocument, a: PortRef, b: PortRef, index: LayoutIndex = buildLayoutIndex(doc)): { doc: LayoutDocument; jointId: string } {
  if (!isPortAttachable(index, a) || !isPortAttachable(index, b)) {
    throw new Error('Both ports must be open');
  }
  if (a.pieceId === b.pieceId) {
    throw new Error('Cannot join a piece to itself');
  }
  const joint: Joint = { id: newId('jt'), a, b };
  return { doc: normalizeLayout({ ...doc, joints: [...doc.joints, joint] }), jointId: joint.id };
}

export function setJointForced(doc: LayoutDocument, jointId: string, forced: boolean): LayoutDocument {
  return { ...doc, joints: doc.joints.map((j) => (j.id === jointId ? { ...j, forced: forced || undefined } : j)) };
}

/** Break a joint; the detached part keeps its current world position (it becomes its own component). */
export function removeJoint(doc: LayoutDocument, jointId: string): LayoutDocument {
  return normalizeLayout({ ...doc, joints: doc.joints.filter((j) => j.id !== jointId) });
}

/** Remove pieces together with their joints and any block/anchor referencing them. */
export function removePieces(doc: LayoutDocument, pieceIds: Iterable<string>): LayoutDocument {
  const ids = new Set(pieceIds);
  const touches = (b: { start: { pieceId: string }; end: { pieceId: string }; pieceIds: string[] }) =>
    ids.has(b.start.pieceId) || ids.has(b.end.pieceId) || b.pieceIds.some((id) => ids.has(id));
  return normalizeLayout({
    ...doc,
    pieces: doc.pieces.filter((p) => !ids.has(p.id)),
    joints: doc.joints.filter((j) => !ids.has(j.a.pieceId) && !ids.has(j.b.pieceId)),
    trackBlocks: doc.trackBlocks.filter((b) => !touches(b)),
    destinations: doc.destinations.filter((b) => !touches(b)),
    speedRestrictions: doc.speedRestrictions.filter((b) => !touches(b)),
    accessories: doc.accessories.filter((a) => !(a.anchor && ids.has(a.anchor.pieceId))),
  });
}

export function updatePiece(doc: LayoutDocument, pieceId: string, patch: PieceMeta): LayoutDocument {
  const pieces = doc.pieces.map((p) => {
    if (p.id !== pieceId) return p;
    const next: PlacedPiece = { ...p, ...patch };
    for (const key of ['gradePercent', 'automationId', 'switchTimeMs', 'drivingConstraint', 'railTypes', 'flexShape'] as const) {
      const v = next[key];
      if (v === undefined || v === '' || (Array.isArray(v) && v.length === 0)) delete next[key];
    }
    return next;
  });
  return normalizeLayout({ ...doc, pieces });
}

/** Piece ids of the component containing `pieceId`. */
export function componentPieceIds(index: LayoutIndex, pieceId: string): string[] {
  const view = index.pieces.get(pieceId);
  if (!view) return [];
  return [...index.pieces.values()].filter((v) => v.component === view.component).map((v) => v.piece.id);
}

function transformComponentRoot(doc: LayoutDocument, pieceId: string, fn: (frame: Frame) => Frame, index: LayoutIndex): LayoutDocument {
  const view = index.pieces.get(pieceId);
  if (!view) return doc;
  const rootId = index.roots[view.component]!;
  return normalizeLayout({ ...doc, pieces: doc.pieces.map((p) => (p.id === rootId ? { ...p, frame: fn(index.pieces.get(rootId)!.frame) } : p)) });
}

/** Move the whole component of `pieceId` by (dx, dy). */
export function translateComponent(doc: LayoutDocument, pieceId: string, dx: number, dy: number, index: LayoutIndex = buildLayoutIndex(doc)): LayoutDocument {
  return transformComponentRoot(doc, pieceId, (f) => translateFrame(f, dx, dy), index);
}

/** Rotate the whole component of `pieceId` about `pivot` by `dTheta` radians. */
export function rotateComponent(doc: LayoutDocument, pieceId: string, pivot: Vec2, dTheta: number, index: LayoutIndex = buildLayoutIndex(doc)): LayoutDocument {
  return transformComponentRoot(doc, pieceId, (f) => rotateFrameAbout(f, pivot, dTheta), index);
}

/** Set the exact world frame of a piece; the rest of its component follows rigidly. */
export function setPieceFrame(doc: LayoutDocument, pieceId: string, frame: Frame, index: LayoutIndex = buildLayoutIndex(doc)): LayoutDocument {
  const view = index.pieces.get(pieceId);
  if (!view) return doc;
  const rootId = index.roots[view.component]!;
  if (rootId === pieceId) {
    return normalizeLayout({ ...doc, pieces: doc.pieces.map((p) => (p.id === pieceId ? { ...p, frame } : p)) });
  }
  // Move by the rigid transform that takes the piece's current frame onto `frame`.
  const current = view.frame;
  const dTheta = frame.theta - current.theta;
  const rotated = rotateFrameAbout(index.pieces.get(rootId)!.frame, current, dTheta);
  const moved = translateFrame(rotated, frame.x - current.x, frame.y - current.y);
  return normalizeLayout({ ...doc, pieces: doc.pieces.map((p) => (p.id === rootId ? { ...p, frame: moved } : p)) });
}
