import { getTrackDef, type TrackDef } from '../catalog/index.ts';
import {
  compose,
  distance,
  flipHeading,
  headingDifference,
  invert,
  radToDeg,
  type Frame,
} from '../geometry/frame.ts';
import {
  buildPieceGeometry,
  getConnector,
  pathStartFrame,
  type ConnectorId,
  type PieceGeometry,
} from '../geometry/pieceGeometry.ts';
import { portKey, type Joint, type LayoutDocument, type PlacedPiece, type PortRef } from './schema.ts';

/** Fully resolved view of one placed piece. */
export interface PieceView {
  piece: PlacedPiece;
  def: TrackDef;
  geom: PieceGeometry;
  /** Derived world frame (connector A origin). */
  frame: Frame;
  /** World frame per connector (outward heading). */
  connectorWorld: Map<ConnectorId, Frame>;
  /** Index of the connected component this piece belongs to. */
  component: number;
}

export interface JointGap {
  jointId: string;
  gapMm: number;
  gapDeg: number;
}

export interface LayoutIndex {
  doc: LayoutDocument;
  pieces: Map<string, PieceView>;
  /** Joint attached to a port (`pieceId:connectorId`). */
  jointByPort: Map<string, Joint>;
  /** Loop-closure mismatch per joint that is not part of the spanning tree. */
  jointGaps: Map<string, JointGap>;
  /** Root piece id per component index. */
  roots: string[];
  /** Ports without a joint (attachable unless blocked). */
  openPorts: PortRef[];
  /** Pieces whose catalogue definition is unknown (kept in the document, not rendered). */
  unknownDefs: string[];
}

/** Gap tolerances above which a joint is considered a forced (imperfect) closure. */
export const JOINT_GAP_TOLERANCE_MM = 0.5;
export const JOINT_GAP_TOLERANCE_DEG = 0.3;

/** World frame of a connector given the piece frame. */
export function connectorWorldFrame(pieceFrame: Frame, geom: PieceGeometry, connectorId: ConnectorId): Frame {
  return compose(pieceFrame, getConnector(geom, connectorId).frame);
}

/**
 * Piece frame that puts `connectorId` exactly onto `target` (a world connector frame
 * of another piece): same position, heading opposite.
 */
export function pieceFrameForConnectorAt(geom: PieceGeometry, connectorId: ConnectorId, target: Frame): Frame {
  return compose(flipHeading(target), invert(getConnector(geom, connectorId).frame));
}

export function otherPort(joint: Joint, ref: PortRef): PortRef {
  return joint.a.pieceId === ref.pieceId && joint.a.connectorId === ref.connectorId ? joint.b : joint.a;
}

export function jointGapBetween(a: Frame, b: Frame): { gapMm: number; gapDeg: number } {
  return {
    gapMm: distance(a, b),
    gapDeg: radToDeg(headingDifference(a.theta + Math.PI, b.theta)),
  };
}

/**
 * Resolve geometry and world frames for the whole document.
 *
 * Frames are derived by walking each connected component from its root (the piece
 * placed first) through a spanning tree of joints, so every tree joint is exact by
 * construction. The tree is built from the oldest joints (document order, Kruskal), so a
 * joint added later to close a loop never moves existing track: it becomes a closure
 * joint whose mismatch is measured and reported at exactly the two ends that were joined.
 */
export function buildLayoutIndex(doc: LayoutDocument): LayoutIndex {
  const pieces = new Map<string, PieceView>();
  const unknownDefs: string[] = [];
  const geoms = new Map<string, { def: TrackDef; geom: PieceGeometry }>();

  for (const piece of doc.pieces) {
    const def = getTrackDef(piece.defId);
    if (!def) {
      unknownDefs.push(piece.id);
      continue;
    }
    geoms.set(piece.id, { def, geom: buildPieceGeometry(def, piece.flexShape) });
  }

  const pieceById = new Map(doc.pieces.map((p) => [p.id, p]));
  const orderedIds = doc.pieces.filter((p) => geoms.has(p.id)).map((p) => p.id);

  // Kruskal over the joints in document order: the first joint that connects two so far
  // separate groups becomes a tree joint, a joint between already connected pieces closes a loop.
  const parent = new Map(orderedIds.map((id) => [id, id]));
  const find = (id: string): string => {
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root)!;
    let cur = id;
    while (parent.get(cur) !== root) {
      const next = parent.get(cur)!;
      parent.set(cur, root);
      cur = next;
    }
    return root;
  };
  const jointByPort = new Map<string, Joint>();
  const treeJointsByPiece = new Map<string, Joint[]>();
  const closureJoints: Joint[] = [];
  for (const joint of doc.joints) {
    if (!geoms.has(joint.a.pieceId) || !geoms.has(joint.b.pieceId)) continue;
    jointByPort.set(portKey(joint.a), joint);
    jointByPort.set(portKey(joint.b), joint);
    const ra = find(joint.a.pieceId);
    const rb = find(joint.b.pieceId);
    if (ra === rb) {
      closureJoints.push(joint);
      continue;
    }
    parent.set(ra, rb);
    for (const id of [joint.a.pieceId, joint.b.pieceId]) {
      if (!treeJointsByPiece.has(id)) treeJointsByPiece.set(id, []);
      treeJointsByPiece.get(id)!.push(joint);
    }
  }

  const frames = new Map<string, Frame>();
  const componentOf = new Map<string, number>();
  const roots: string[] = [];
  const jointGaps = new Map<string, JointGap>();

  for (const rootId of orderedIds) {
    if (frames.has(rootId)) continue;
    const component = roots.length;
    roots.push(rootId);
    frames.set(rootId, pieceById.get(rootId)!.frame);
    componentOf.set(rootId, component);

    const queue = [rootId];
    while (queue.length) {
      const currentId = queue.shift()!;
      const current = geoms.get(currentId)!;
      const currentFrame = frames.get(currentId)!;
      for (const joint of treeJointsByPiece.get(currentId) ?? []) {
        const mine = joint.a.pieceId === currentId ? joint.a : joint.b;
        const theirs = otherPort(joint, mine);
        if (frames.has(theirs.pieceId)) continue;
        const myWorld = connectorWorldFrame(currentFrame, current.geom, mine.connectorId);
        frames.set(theirs.pieceId, pieceFrameForConnectorAt(geoms.get(theirs.pieceId)!.geom, theirs.connectorId, myWorld));
        componentOf.set(theirs.pieceId, component);
        queue.push(theirs.pieceId);
      }
    }
  }

  for (const joint of closureJoints) {
    const a = connectorWorldFrame(frames.get(joint.a.pieceId)!, geoms.get(joint.a.pieceId)!.geom, joint.a.connectorId);
    const b = connectorWorldFrame(frames.get(joint.b.pieceId)!, geoms.get(joint.b.pieceId)!.geom, joint.b.connectorId);
    const gap = jointGapBetween(a, b);
    if (gap.gapMm > 1e-6 || gap.gapDeg > 1e-7) {
      jointGaps.set(joint.id, { jointId: joint.id, ...gap });
    }
  }

  for (const [id, { def, geom }] of geoms) {
    const frame = frames.get(id)!;
    const connectorWorld = new Map<ConnectorId, Frame>();
    for (const c of geom.connectors) {
      connectorWorld.set(c.id, compose(frame, c.frame));
    }
    pieces.set(id, { piece: pieceById.get(id)!, def, geom, frame, connectorWorld, component: componentOf.get(id)! });
  }

  const openPorts: PortRef[] = [];
  for (const view of pieces.values()) {
    for (const c of view.geom.connectors) {
      const ref = { pieceId: view.piece.id, connectorId: c.id };
      if (!jointByPort.has(portKey(ref))) openPorts.push(ref);
    }
  }

  return { doc, pieces, jointByPort, jointGaps, roots, openPorts, unknownDefs };
}

/** World frame at the start of a path (connector position, heading into the piece). */
export function pathWorldStart(view: PieceView, pathId: string): Frame {
  const path = view.geom.paths.find((p) => p.id === pathId);
  if (!path) throw new Error(`Path ${pathId} does not exist on ${view.piece.id}`);
  return compose(view.frame, pathStartFrame(getConnector(view.geom, path.from)));
}

export function requirePiece(index: LayoutIndex, pieceId: string): PieceView {
  const view = index.pieces.get(pieceId);
  if (!view) throw new Error(`Piece ${pieceId} not found`);
  return view;
}

/** Whether a port can accept a joint: exists, not already joined and not a buffer end. */
export function isPortAttachable(index: LayoutIndex, ref: PortRef): boolean {
  const view = index.pieces.get(ref.pieceId);
  if (!view) return false;
  const c = view.geom.connectors.find((x) => x.id === ref.connectorId);
  if (!c || c.blocked) return false;
  return !index.jointByPort.has(portKey(ref));
}

/** Joints whose mismatch exceeds the tolerance and were not explicitly accepted. */
export function unresolvedGaps(index: LayoutIndex): JointGap[] {
  const forced = new Set(index.doc.joints.filter((j) => j.forced).map((j) => j.id));
  return [...index.jointGaps.values()].filter(
    (g) => !forced.has(g.jointId) && (g.gapMm > JOINT_GAP_TOLERANCE_MM || g.gapDeg > JOINT_GAP_TOLERANCE_DEG),
  );
}
