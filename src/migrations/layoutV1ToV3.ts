import { getTrackDef } from '../../shared/src/catalog/index.ts';
import { applyToPoint, degToRad, distance, headingDifference, normalizeAngle } from '../../shared/src/geometry/frame.ts';
import { buildPieceGeometry } from '../../shared/src/geometry/pieceGeometry.ts';
import { pathLength, type Primitive } from '../../shared/src/geometry/primitives.ts';
import { buildLayoutIndex } from '../../shared/src/layout/index.ts';
import { normalizeLayout } from '../../shared/src/layout/ops.ts';
import type { Joint, LayoutDocument, PlacedAccessory, PlacedPiece, TrackPosition } from '../../shared/src/layout/schema.ts';
import { newId } from '../../shared/src/util/id.ts';

/**
 * One-time migration of the free-placement layout document (v1: centre + rotation per
 * piece, connections inferred while editing) to the graph-first v3 document (piece
 * frames at connector A, explicit joints, exact track positions).
 *
 * Joints are inferred **once** here from proximity of the old coupling points; after
 * that the graph is authoritative. Loop closures that did not really fit are reported
 * as joint gaps instead of being snapped shut.
 *
 * @migrationAdded 2026-09-03
 * @migrationRemoveAfter 2026-11-03
 */

interface V1Anchor {
  pieceId: string;
  t: number;
  turnoutRoute?: 'main' | 'branch' | 'branch2';
}

interface V1Block {
  id: string;
  level: number;
  start: V1Anchor;
  end: V1Anchor;
  pathPieceIds: string[];
  name?: string;
  isStation?: boolean;
  maxSpeedStep?: number;
}

interface V1Piece {
  id: string;
  defId: string;
  x: number;
  y: number;
  rotationDeg: number;
  level: number;
  zMm?: number;
  flexLengthMm?: number;
  gradePercent?: number;
  automationId?: string;
  drivingConstraint?: 'forward' | 'reverse' | 'both';
  railTypes?: ('passenger' | 'freight' | 'shunting')[];
}

interface V1Accessory {
  id: string;
  defId: string;
  anchor?: V1Anchor;
  x?: number;
  y?: number;
  rotationDeg: number;
  level: number;
  zMm: number;
  automationId?: string;
}

export interface V1LayoutDocument {
  version: 1;
  name: string;
  pieces: V1Piece[];
  trackBlocks?: V1Block[];
  destinations?: V1Block[];
  speedRestrictions?: V1Block[];
  accessories?: V1Accessory[];
  activeLevel?: number;
  levelHeightsMm?: Record<string, number>;
}

export interface MigrationReport {
  pieces: number;
  joints: number;
  skippedPieces: string[];
  gaps: { jointId: string; gapMm: number; gapDeg: number }[];
}

/** Old straights that are crossings in the new catalogue. */
const DEF_ID_RENAMES: Record<string, string> = {
  'c-s-24640': 'c-x-24640',
  'c-s-24740': 'c-x-24740',
  'k-s-2257': 'k-x-2257',
  'k-s-2258': 'k-x-2258',
  'k-s-2259': 'k-x-2259',
  'm-s-5207': 'm-x-5207',
};

const ROUTE_TO_PATH: Record<string, string> = { main: 'AB', branch: 'AC', branch2: 'AD' };

/** Max coupling distance / heading error for inferring a joint from old free placement. */
const JOIN_MAX_MM = 10;
const JOIN_MAX_DEG = 12;

export function isV1Layout(raw: unknown): raw is V1LayoutDocument {
  return typeof raw === 'object' && raw !== null && (raw as { version?: unknown }).version === 1 && Array.isArray((raw as { pieces?: unknown }).pieces);
}

function convertPiece(old: V1Piece): PlacedPiece | null {
  const defId = DEF_ID_RENAMES[old.defId] ?? old.defId;
  const def = getTrackDef(defId);
  if (!def) return null;
  const theta = degToRad(old.rotationDeg);
  const oldFrame = { x: old.x, y: old.y, theta };
  let frame = { ...oldFrame };
  let flexShape: Primitive[] | undefined;

  switch (def.kind) {
    case 'straight':
    case 'crossing': {
      // v1 straights/crossings were centred on their midpoint; connector A is now the origin.
      const p = applyToPoint(oldFrame, { x: -def.lengthMm / 2, y: 0 });
      frame = { x: p.x, y: p.y, theta };
      break;
    }
    case 'flex': {
      const len = Math.min(def.maxLengthMm, Math.max(40, old.flexLengthMm ?? def.defaultLengthMm));
      flexShape = [{ kind: 'line', length: len }];
      const p = applyToPoint(oldFrame, { x: -len / 2, y: 0 });
      frame = { x: p.x, y: p.y, theta };
      break;
    }
    case 'curve': {
      // v1 curves: chord on the local x axis from (-h, 0) to (h, 0), arc bulging toward -y,
      // so the A-end heading is rotation - α/2 and the sweep is +α (matches the new curve path).
      const alpha = degToRad(def.angleDeg);
      const h = def.radiusMm * Math.sin(alpha / 2);
      const p = applyToPoint(oldFrame, { x: -h, y: 0 });
      frame = { x: p.x, y: p.y, theta: normalizeAngle(theta - alpha / 2) };
      break;
    }
    case 'turnout': {
      if (def.geometryMode === 'doubleSlip') {
        const p = applyToPoint(oldFrame, { x: -def.lengthMm / 2, y: 0 });
        frame = { x: p.x, y: p.y, theta };
      }
      // Standard / Bogen / three-way turnouts already had the heel at the local origin heading +x.
      break;
    }
  }

  const piece: PlacedPiece = {
    id: old.id,
    defId,
    frame,
    level: old.level ?? 0,
    zMm: old.zMm ?? 0,
  };
  if (old.gradePercent != null) piece.gradePercent = old.gradePercent;
  if (old.automationId) piece.automationId = old.automationId;
  if (old.drivingConstraint) piece.drivingConstraint = old.drivingConstraint;
  if (old.railTypes?.length) piece.railTypes = old.railTypes;
  if (flexShape) piece.flexShape = flexShape;
  return piece;
}

function convertAnchor(a: V1Anchor, pieces: Map<string, PlacedPiece>): TrackPosition | null {
  const piece = pieces.get(a.pieceId);
  if (!piece) return null;
  const def = getTrackDef(piece.defId)!;
  const geom = buildPieceGeometry(def, piece.flexShape);
  const pathId = ROUTE_TO_PATH[a.turnoutRoute ?? ''] ?? 'AB';
  const path = geom.paths.find((p) => p.id === pathId) ?? geom.paths[0]!;
  const len = pathLength(path.primitives);
  return { pieceId: piece.id, pathId: path.id, s: Math.min(len, Math.max(0, a.t * len)) };
}

function convertBlock(b: V1Block, pieces: Map<string, PlacedPiece>) {
  const start = convertAnchor(b.start, pieces);
  const end = convertAnchor(b.end, pieces);
  if (!start || !end) return null;
  return {
    id: b.id,
    level: b.level ?? 0,
    start,
    end,
    pieceIds: b.pathPieceIds.filter((id) => pieces.has(id)),
  };
}

/** Infer joints from coupling points that (nearly) coincide with opposite headings. */
function inferJoints(doc: LayoutDocument): Joint[] {
  const index = buildLayoutIndex(doc);
  const ports = index.openPorts.map((ref) => ({ ref, frame: index.pieces.get(ref.pieceId)!.connectorWorld.get(ref.connectorId)! }));
  const candidates: { i: number; j: number; d: number }[] = [];
  for (let i = 0; i < ports.length; i++) {
    for (let j = i + 1; j < ports.length; j++) {
      const a = ports[i]!;
      const b = ports[j]!;
      if (a.ref.pieceId === b.ref.pieceId) continue;
      const d = distance(a.frame, b.frame);
      if (d > JOIN_MAX_MM) continue;
      const headingErr = headingDifference(a.frame.theta + Math.PI, b.frame.theta);
      if (headingErr > degToRad(JOIN_MAX_DEG)) continue;
      candidates.push({ i, j, d });
    }
  }
  candidates.sort((x, y) => x.d - y.d);
  const used = new Set<number>();
  const joints: Joint[] = [];
  for (const c of candidates) {
    if (used.has(c.i) || used.has(c.j)) continue;
    used.add(c.i);
    used.add(c.j);
    joints.push({ id: newId('jt'), a: ports[c.i]!.ref, b: ports[c.j]!.ref });
  }
  return joints;
}

export function migrateLayoutV1ToV3(old: V1LayoutDocument): { doc: LayoutDocument; report: MigrationReport } {
  const pieces: PlacedPiece[] = [];
  const skippedPieces: string[] = [];
  for (const p of old.pieces) {
    const converted = convertPiece(p);
    if (converted) pieces.push(converted);
    else skippedPieces.push(`${p.id} (${p.defId})`);
  }
  const pieceMap = new Map(pieces.map((p) => [p.id, p]));

  const base: LayoutDocument = {
    version: 3,
    name: old.name ?? 'Layout',
    pieces,
    joints: [],
    trackBlocks: [],
    destinations: [],
    speedRestrictions: [],
    accessories: [],
    activeLevel: old.activeLevel ?? 0,
    levelHeightsMm: old.levelHeightsMm,
  };

  const joints = inferJoints(base);
  const withJoints: LayoutDocument = { ...base, joints };

  for (const b of old.trackBlocks ?? []) {
    const block = convertBlock(b, pieceMap);
    if (block) withJoints.trackBlocks.push(block);
  }
  for (const d of old.destinations ?? []) {
    const block = convertBlock(d, pieceMap);
    if (block && d.name) withJoints.destinations.push({ ...block, name: d.name, isStation: d.isStation === true || undefined });
  }
  for (const s of old.speedRestrictions ?? []) {
    const block = convertBlock(s, pieceMap);
    if (block) withJoints.speedRestrictions.push({ ...block, maxSpeedStep: Math.min(14, Math.max(1, Math.round(s.maxSpeedStep ?? 14))) });
  }
  for (const a of old.accessories ?? []) {
    const acc: PlacedAccessory = { id: a.id, defId: a.defId, rotationDeg: a.rotationDeg ?? 0, level: a.level ?? 0, zMm: a.zMm ?? 0 };
    if (a.anchor) {
      const anchor = convertAnchor(a.anchor, pieceMap);
      if (!anchor) continue;
      acc.anchor = anchor;
    } else {
      if (typeof a.x === 'number') acc.x = a.x;
      if (typeof a.y === 'number') acc.y = a.y;
    }
    if (a.automationId) acc.automationId = a.automationId;
    withJoints.accessories.push(acc);
  }

  const doc = normalizeLayout(withJoints);
  const index = buildLayoutIndex(doc);
  return {
    doc,
    report: {
      pieces: pieces.length,
      joints: joints.length,
      skippedPieces,
      gaps: [...index.jointGaps.values()].map((g) => ({ jointId: g.jointId, gapMm: g.gapMm, gapDeg: g.gapDeg })),
    },
  };
}
