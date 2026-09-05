import { catalogFamilies, connectorCompatibility, familyAtConnector, type TrackDef } from '@shared/catalog/index.ts';
import { degToRad, distance, headingDifference, normalizeAngle, type Frame } from '@shared/geometry/frame.ts';
import { buildLayoutIndex, isPortAttachable } from '@shared/layout/index.ts';
import { joinPorts, placeFreePiece } from '@shared/layout/ops.ts';
import type { LayoutDocument } from '@shared/layout/schema.ts';
import type { VisionElement } from '@shared/vision/schema.ts';

export interface PhotoImportOptions {
  familyKey: string;
  /** Real width of the photographed area in layout millimetres. */
  imageWidthMm: number;
  /** Image height / width. */
  aspect: number;
  level: number;
  /** Elements below this confidence are flagged for review. */
  lowConfidenceBelow?: number;
}

export interface PhotoImportResult {
  doc: LayoutDocument;
  pieceIds: string[];
  lowConfidence: Set<string>;
  skipped: { element: VisionElement; reason: string }[];
  joints: number;
}

const JOIN_TOL_MM = 20;
const JOIN_TOL_DEG = 15;

function nearestBy<T>(items: T[], score: (t: T) => number): T | undefined {
  let best: T | undefined;
  let bestScore = Infinity;
  for (const it of items) {
    const s = score(it);
    if (s < bestScore) {
      bestScore = s;
      best = it;
    }
  }
  return best;
}

/** Choose the catalogue piece that best matches one detected element. */
export function matchElement(element: VisionElement, defs: TrackDef[], imageWidthMm: number): TrackDef | null {
  const lengthMm = element.lengthRel * imageWidthMm;
  switch (element.type) {
    case 'straight':
      return nearestBy(
        defs.filter((d): d is Extract<TrackDef, { kind: 'straight' }> => d.kind === 'straight' && !d.bufferStop && !d.transitionTo && !d.feature),
        (d) => Math.abs(d.lengthMm - lengthMm),
      ) ?? null;
    case 'curve': {
      const sweep = Math.abs(element.sweepDeg ?? 30);
      const curves = defs.filter((d): d is Extract<TrackDef, { kind: 'curve' }> => d.kind === 'curve');
      // Prefer the sweep the model saw, then the radius whose chord matches the visible length.
      return nearestBy(curves, (d) => Math.abs(d.angleDeg - sweep) * 10 + Math.abs(2 * d.radiusMm * Math.sin(degToRad(d.angleDeg) / 2) - lengthMm) / 50) ?? null;
    }
    case 'turnout-left':
    case 'turnout-right': {
      const hand = element.type === 'turnout-left' ? 'L' : 'R';
      const turnouts = defs.filter((d): d is Extract<TrackDef, { kind: 'turnout' }> => d.kind === 'turnout' && d.hand === hand && d.geometryMode === 'standard');
      return nearestBy(turnouts, (d) => Math.abs(d.lengthMm - lengthMm)) ?? null;
    }
    case 'crossing':
      return defs.find((d) => d.kind === 'crossing') ?? null;
  }
}

/** Free frame so that the piece's centre line centre sits at the detected centre with the detected heading. */
function frameFor(def: TrackDef, element: VisionElement, opts: PhotoImportOptions): Frame {
  const cx = element.x * opts.imageWidthMm;
  const cy = element.y * opts.imageWidthMm * opts.aspect;
  const theta = degToRad(element.angleDeg);
  if (def.kind === 'curve') {
    const alpha = degToRad(def.angleDeg);
    const h = def.radiusMm * Math.sin(alpha / 2);
    // Chord direction: flip for counter-clockwise curves so the arc bulges to the other side.
    const chordTheta = (element.sweepDeg ?? 30) < 0 ? theta + Math.PI : theta;
    return { x: cx - h * Math.cos(chordTheta), y: cy - h * Math.sin(chordTheta), theta: normalizeAngle(chordTheta - alpha / 2) };
  }
  const length = def.kind === 'straight' || def.kind === 'turnout' || def.kind === 'crossing' ? def.lengthMm : def.kind === 'flex' ? def.defaultLengthMm : 0;
  return { x: cx - (length / 2) * Math.cos(theta), y: cy - (length / 2) * Math.sin(theta), theta };
}

/** Couple open ends that (nearly) meet, repeatedly, until nothing more fits. */
export function autoJoin(doc: LayoutDocument, onlyPieces?: Set<string>): { doc: LayoutDocument; joints: number } {
  let joints = 0;
  for (let round = 0; round < 500; round++) {
    const index = buildLayoutIndex(doc);
    let made = false;
    const ports = index.openPorts.filter((p) => isPortAttachable(index, p) && (!onlyPieces || onlyPieces.has(p.pieceId)));
    outer: for (let i = 0; i < ports.length; i++) {
      for (let j = i + 1; j < ports.length; j++) {
        const a = ports[i]!;
        const b = ports[j]!;
        if (a.pieceId === b.pieceId) continue;
        const fa = index.pieces.get(a.pieceId)!.connectorWorld.get(a.connectorId)!;
        const fb = index.pieces.get(b.pieceId)!.connectorWorld.get(b.connectorId)!;
        if (distance(fa, fb) > JOIN_TOL_MM) continue;
        if (headingDifference(fa.theta + Math.PI, fb.theta) > degToRad(JOIN_TOL_DEG)) continue;
        if (connectorCompatibility(familyAtConnector(index.pieces.get(a.pieceId)!.def, a.connectorId), familyAtConnector(index.pieces.get(b.pieceId)!.def, b.connectorId)) !== null) continue;
        doc = joinPorts(doc, a, b, index).doc;
        joints++;
        made = true;
        break outer;
      }
    }
    if (!made) break;
  }
  return { doc, joints };
}

/**
 * Turn vision candidates into real catalogue pieces: match, place free, then couple the
 * ends that meet. Low-confidence pieces are returned for highlighting; nothing here is
 * final until the user saves the layout.
 */
export function importCandidates(doc: LayoutDocument, elements: VisionElement[], opts: PhotoImportOptions): PhotoImportResult {
  const family = catalogFamilies().find((f) => f.key === opts.familyKey);
  if (!family) throw new Error(`Unknown track family ${opts.familyKey}`);
  const threshold = opts.lowConfidenceBelow ?? 0.6;
  const pieceIds: string[] = [];
  const lowConfidence = new Set<string>();
  const skipped: PhotoImportResult['skipped'] = [];
  let next = doc;
  for (const element of elements) {
    const def = matchElement(element, family.defs, opts.imageWidthMm);
    if (!def) {
      skipped.push({ element, reason: `No ${element.type} in ${family.brand} ${family.system}` });
      continue;
    }
    const placed = placeFreePiece(next, def.id, frameFor(def, element, opts), { level: opts.level });
    next = placed.doc;
    pieceIds.push(placed.pieceId);
    if (element.confidence < threshold) lowConfidence.add(placed.pieceId);
  }
  const joined = autoJoin(next, new Set(pieceIds));
  return { doc: joined.doc, pieceIds, lowConfidence, skipped, joints: joined.joints };
}
