import Graph from 'graphology';
import { bidirectional } from 'graphology-shortest-path/dijkstra.js';
import type { ConnectorId } from '../../shared/src/geometry/pieceGeometry.ts';
import { pathLength } from '../../shared/src/geometry/primitives.ts';
import { otherPort, type LayoutIndex } from '../../shared/src/layout/index.ts';
import { portKey, type TrackPosition } from '../../shared/src/layout/schema.ts';
import type { Traversal } from '../../shared/src/domain/train.ts';

/**
 * Directed traversal graph over the layout.
 *
 * Node = "entering piece P through connector C" (`P|C`). Edge = travelling one path of P
 * from C to its far connector and stepping through the joint into the next piece. Because
 * the direction of travel is part of the node, driving a piece forwards and backwards are
 * two different edges over the same rail — a train can drive back over its own route
 * without the model ever registering a 180° turn.
 */

export interface TraversalEdge {
  pieceId: string;
  pathId: string;
  /** +1 when the path is driven from → to, -1 the other way. */
  dir: 1 | -1;
  lengthMm: number;
  /** Turnout state that must be set for this edge to be passable (undefined = plain track). */
  requiredState?: string;
  /** Connector through which the piece is left. */
  exitConnector: ConnectorId;
  /** Synthetic edge: the train stops on this piece and reverses out through `exitConnector` (kopmaken). */
  reversal?: boolean;
}

export type TrackGraph = Graph<{ pieceId: string; connectorId: ConnectorId }, TraversalEdge>;

export function nodeId(pieceId: string, connectorId: ConnectorId): string {
  return `${pieceId}|${connectorId}`;
}

export function buildTrackGraph(index: LayoutIndex): TrackGraph {
  const graph: TrackGraph = new Graph({ type: 'directed', multi: true });

  for (const view of index.pieces.values()) {
    for (const c of view.geom.connectors) {
      graph.addNode(nodeId(view.piece.id, c.id), { pieceId: view.piece.id, connectorId: c.id });
    }
  }

  for (const view of index.pieces.values()) {
    for (const path of view.geom.paths) {
      const len = pathLength(path.primitives);
      const requiredState = view.geom.states?.find((s) => s.paths.includes(path.id))?.id;
      for (const [entry, exit, dir] of [
        [path.from, path.to, 1],
        [path.to, path.from, -1],
      ] as const) {
        const joint = index.jointByPort.get(portKey({ pieceId: view.piece.id, connectorId: exit }));
        if (!joint) continue;
        const next = otherPort(joint, { pieceId: view.piece.id, connectorId: exit });
        if (!index.pieces.has(next.pieceId)) continue;
        graph.addEdge(nodeId(view.piece.id, entry), nodeId(next.pieceId, next.connectorId), {
          pieceId: view.piece.id,
          pathId: path.id,
          dir,
          lengthMm: len,
          requiredState,
          exitConnector: exit,
        });
      }
    }
  }
  return graph;
}

/** Entry node of a traversal: the connector the train came in through. */
export function entryNodeOf(index: LayoutIndex, t: Traversal): string {
  const view = index.pieces.get(t.pos.pieceId)!;
  const path = view.geom.paths.find((p) => p.id === t.pos.pathId)!;
  return nodeId(t.pos.pieceId, t.dir === 1 ? path.from : path.to);
}

/** Node reached when leaving the current piece in the direction of travel. */
export function exitNodeOf(index: LayoutIndex, t: Traversal): string | null {
  const view = index.pieces.get(t.pos.pieceId)!;
  const path = view.geom.paths.find((p) => p.id === t.pos.pathId)!;
  const exit = t.dir === 1 ? path.to : path.from;
  const joint = index.jointByPort.get(portKey({ pieceId: t.pos.pieceId, connectorId: exit }));
  if (!joint) return null;
  const next = otherPort(joint, { pieceId: t.pos.pieceId, connectorId: exit });
  return nodeId(next.pieceId, next.connectorId);
}

/** Unconstrained shortest rail distance between two entry nodes (Dijkstra, graphology). */
export function shortestNodePath(graph: TrackGraph, from: string, to: string): string[] | null {
  if (!graph.hasNode(from) || !graph.hasNode(to)) return null;
  return bidirectional(graph, from, to, (_edge: string, attrs: TraversalEdge) => attrs.lengthMm);
}

export interface EdgeStep {
  edge: string;
  attrs: TraversalEdge;
  from: string;
  to: string;
}

export interface SearchOptions {
  /** Extra cost or Infinity to forbid an edge. */
  cost: (attrs: TraversalEdge, fromNode: string, toNode: string) => number;
  /**
   * Optional reversal move from a node ("entered piece P at C"): the train runs onto P,
   * stops and drives back out through C into the neighbour — returned as the node to
   * continue from plus its cost. `null` when there is no room to reverse here.
   */
  reversal?: (node: string) => { to: string; cost: number } | null;
}

/**
 * Cost-aware Dijkstra returning the edge sequence. Used by the route planner, which
 * needs to forbid edges (claims, driving constraints), penalise turnout changes and
 * optionally allow reversing moves.
 */
export function searchEdges(graph: TrackGraph, source: string, targets: Set<string>, options: SearchOptions): EdgeStep[] | null {
  const dist = new Map<string, number>([[source, 0]]);
  const prev = new Map<string, EdgeStep>();
  const done = new Set<string>();
  const open: { node: string; d: number }[] = [{ node: source, d: 0 }];

  while (open.length) {
    open.sort((a, b) => a.d - b.d);
    const { node, d } = open.shift()!;
    if (done.has(node)) continue;
    done.add(node);
    if (targets.has(node) && node !== source) {
      const steps: EdgeStep[] = [];
      let cur = node;
      while (cur !== source) {
        const step = prev.get(cur)!;
        steps.unshift(step);
        cur = step.from;
      }
      return steps;
    }
    graph.forEachOutEdge(node, (edge: string, attrs: TraversalEdge, _s: string, target: string) => {
      const extra = options.cost(attrs, node, target);
      if (!Number.isFinite(extra)) return;
      const nd = d + attrs.lengthMm + extra;
      if (nd < (dist.get(target) ?? Infinity)) {
        dist.set(target, nd);
        prev.set(target, { edge, attrs, from: node, to: target });
        open.push({ node: target, d: nd });
      }
    });
    const rev = options.reversal?.(node);
    if (rev && graph.hasNode(rev.to)) {
      const nd = d + rev.cost;
      if (nd < (dist.get(rev.to) ?? Infinity)) {
        const attrs = graph.getNodeAttributes(node);
        dist.set(rev.to, nd);
        prev.set(rev.to, {
          edge: `reverse@${node}`,
          attrs: { pieceId: attrs.pieceId, pathId: '', dir: 1, lengthMm: 0, exitConnector: attrs.connectorId, reversal: true },
          from: node,
          to: rev.to,
        });
        open.push({ node: rev.to, d: nd });
      }
    }
  }
  return null;
}

/** Track position at the start of an edge (entry connector side). */
export function edgeStartPosition(index: LayoutIndex, attrs: TraversalEdge): TrackPosition {
  const view = index.pieces.get(attrs.pieceId)!;
  const path = view.geom.paths.find((p) => p.id === attrs.pathId)!;
  return { pieceId: attrs.pieceId, pathId: attrs.pathId, s: attrs.dir === 1 ? 0 : pathLength(path.primitives) };
}
