import type { LayoutIndex } from '@shared/layout/index.ts';
import { otherPort } from '@shared/layout/index.ts';
import { portKey } from '@shared/layout/schema.ts';

/**
 * Shortest chain of pieces (by piece count) from `fromPieceId` to `toPieceId`
 * through the joints, ignoring turnout states. Used to define blocks,
 * destinations and speed restrictions between two picked track positions.
 */
export function findPieceChain(index: LayoutIndex, fromPieceId: string, toPieceId: string): string[] | null {
  if (fromPieceId === toPieceId) return [fromPieceId];
  const prev = new Map<string, string>();
  const queue = [fromPieceId];
  const seen = new Set([fromPieceId]);
  while (queue.length) {
    const cur = queue.shift()!;
    const view = index.pieces.get(cur);
    if (!view) continue;
    for (const c of view.geom.connectors) {
      const joint = index.jointByPort.get(portKey({ pieceId: cur, connectorId: c.id }));
      if (!joint) continue;
      const next = otherPort(joint, { pieceId: cur, connectorId: c.id }).pieceId;
      if (seen.has(next)) continue;
      seen.add(next);
      prev.set(next, cur);
      if (next === toPieceId) {
        const chain = [next];
        let p: string | undefined = cur;
        while (p) {
          chain.unshift(p);
          p = prev.get(p);
        }
        return chain;
      }
      queue.push(next);
    }
  }
  return null;
}
