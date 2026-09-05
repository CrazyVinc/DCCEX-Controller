import { connectorCompatibility, describeCompatIssue, familyAtConnector } from '@shared/catalog/index.ts';
import { unresolvedGaps, type LayoutIndex } from '@shared/layout/index.ts';
import { getConnector } from '@shared/geometry/pieceGeometry.ts';

export type IssueSeverity = 'error' | 'warning' | 'info';

export interface LayoutIssue {
  id: string;
  severity: IssueSeverity;
  message: string;
  pieceId?: string;
  jointId?: string;
}

/** Structural checks on the resolved layout. */
export function validateLayout(index: LayoutIndex): LayoutIssue[] {
  const issues: LayoutIssue[] = [];

  for (const gap of unresolvedGaps(index)) {
    issues.push({
      id: `gap:${gap.jointId}`,
      severity: 'error',
      message: `Joint does not close: ${gap.gapMm.toFixed(1)} mm / ${gap.gapDeg.toFixed(1)}° mismatch`,
      jointId: gap.jointId,
    });
  }

  for (const id of index.unknownDefs) {
    issues.push({ id: `def:${id}`, severity: 'error', message: `Unknown catalogue piece on ${id}`, pieceId: id });
  }

  // Electrical / mechanical compatibility at every joint (transition pieces bridge families).
  for (const joint of index.doc.joints) {
    const a = index.pieces.get(joint.a.pieceId);
    const b = index.pieces.get(joint.b.pieceId);
    if (!a || !b) continue;
    const fa = familyAtConnector(a.def, joint.a.connectorId);
    const fb = familyAtConnector(b.def, joint.b.connectorId);
    const issue = connectorCompatibility(fa, fb);
    if (issue) {
      issues.push({
        id: `compat:${joint.id}`,
        severity: issue === 'electrical' ? 'error' : 'warning',
        message: describeCompatIssue(issue, fa, fb),
        jointId: joint.id,
      });
    }
  }

  let openEnds = 0;
  for (const ref of index.openPorts) {
    const view = index.pieces.get(ref.pieceId)!;
    if (getConnector(view.geom, ref.connectorId).blocked) continue;
    openEnds++;
  }
  if (openEnds > 0) {
    issues.push({ id: 'open-ends', severity: 'info', message: `${openEnds} open track end${openEnds === 1 ? '' : 's'}` });
  }

  for (const view of index.pieces.values()) {
    const grade = view.piece.gradePercent ?? 0;
    if (Math.abs(grade) > 6) {
      issues.push({ id: `grade:${view.piece.id}`, severity: 'warning', message: `Grade ${grade.toFixed(1)}% exceeds 6% on ${view.def.artNo}`, pieceId: view.piece.id });
    }
    if (view.def.kind === 'turnout' && !view.piece.automationId) {
      issues.push({ id: `turnout:${view.piece.id}`, severity: 'info', message: `Turnout ${view.def.artNo} has no DCC-EX id (manual)`, pieceId: view.piece.id });
    }
    if (view.def.kind === 'flex' && view.def.minRadiusMm) {
      const minR = Math.min(...(view.piece.flexShape ?? []).map((p) => (p.kind === 'arc' ? p.radius : Infinity)));
      if (minR < view.def.minRadiusMm) {
        issues.push({ id: `flexr:${view.piece.id}`, severity: 'warning', message: `Flex radius ${minR.toFixed(0)} mm below ${view.def.minRadiusMm} mm`, pieceId: view.piece.id });
      }
    }
  }

  const order: Record<IssueSeverity, number> = { error: 0, warning: 1, info: 2 };
  return issues.sort((a, b) => order[a.severity] - order[b.severity]);
}
