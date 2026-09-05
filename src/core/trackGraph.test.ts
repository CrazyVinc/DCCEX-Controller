import { describe, expect, it } from 'vitest';
import { buildLayoutIndex } from '../../shared/src/layout/index.ts';
import { attachNewPiece, joinPorts, placeFreePiece } from '../../shared/src/layout/ops.ts';
import { emptyLayout } from '../../shared/src/layout/schema.ts';
import { buildTrackGraph, nodeId, searchEdges, shortestNodePath } from './trackGraph.ts';

describe('track graph', () => {
  it('models both directions of every rail as separate edges', () => {
    let { doc, pieceId: a } = placeFreePiece(emptyLayout(), 'k-s-2200', { x: 0, y: 0, theta: 0 });
    const b = attachNewPiece(doc, 'k-s-2200', 'A', { pieceId: a, connectorId: 'B' });
    doc = b.doc;
    const index = buildLayoutIndex(doc);
    const graph = buildTrackGraph(index);
    // A→B on piece a leads into piece b at A; B→A on piece b leads back into a at B.
    expect(graph.hasEdge(nodeId(a, 'A'), nodeId(b.pieceId, 'A'))).toBe(true);
    expect(graph.hasEdge(nodeId(b.pieceId, 'B'), nodeId(a, 'B'))).toBe(true);
    // Open ends have no outgoing edge.
    expect(graph.outDegree(nodeId(a, 'B'))).toBe(0);
    expect(graph.outDegree(nodeId(b.pieceId, 'A'))).toBe(0);
  });

  it('finds the shortest route around a loop and honours turnout requirements', () => {
    let { doc, pieceId: first } = placeFreePiece(emptyLayout(), 'k-c-2221', { x: 0, y: 0, theta: 0 });
    const ids = [first];
    for (let i = 1; i < 12; i++) {
      const r = attachNewPiece(doc, 'k-c-2221', 'A', { pieceId: ids[i - 1]!, connectorId: 'B' });
      doc = r.doc;
      ids.push(r.pieceId);
    }
    doc = joinPorts(doc, { pieceId: ids[11]!, connectorId: 'B' }, { pieceId: ids[0]!, connectorId: 'A' }).doc;
    const index = buildLayoutIndex(doc);
    const graph = buildTrackGraph(index);
    const path = shortestNodePath(graph, nodeId(ids[0]!, 'A'), nodeId(ids[3]!, 'A'));
    expect(path).toEqual([nodeId(ids[0]!, 'A'), nodeId(ids[1]!, 'A'), nodeId(ids[2]!, 'A'), nodeId(ids[3]!, 'A')]);
    // Going the other way round is 9 pieces; the search picks the 3-piece direction.
    const steps = searchEdges(graph, nodeId(ids[0]!, 'A'), new Set([nodeId(ids[3]!, 'A')]), { cost: () => 0 });
    expect(steps?.length).toBe(3);
    expect(steps?.every((s) => s.attrs.dir === 1)).toBe(true);
  });

  it('exposes the turnout state a route depends on', () => {
    let { doc, pieceId: a } = placeFreePiece(emptyLayout(), 'k-s-2200', { x: 0, y: 0, theta: 0 });
    const t = attachNewPiece(doc, 'k-t-2263-R', 'A', { pieceId: a, connectorId: 'B' });
    const branch = attachNewPiece(t.doc, 'k-s-2200', 'A', { pieceId: t.pieceId, connectorId: 'C' });
    const index = buildLayoutIndex(branch.doc);
    const graph = buildTrackGraph(index);
    const steps = searchEdges(graph, nodeId(a, 'A'), new Set([nodeId(branch.pieceId, 'A')]), { cost: () => 0 })!;
    expect(steps.map((s) => s.attrs.requiredState)).toEqual([undefined, 'branch']);
  });
});
