import type { Consist, TrainPose, Traversal } from '../../shared/src/domain/train.ts';
import { pathLength } from '../../shared/src/geometry/primitives.ts';
import { otherPort, type LayoutIndex } from '../../shared/src/layout/index.ts';
import { portKey, type RailType, type TrackPosition } from '../../shared/src/layout/schema.ts';
import { advance, enterAt, reverseTraversal } from '../../shared/src/layout/traverse.ts';
import { exitNodeOf, nodeId, searchEdges, type EdgeStep, type TrackGraph, type TraversalEdge } from './trackGraph.ts';

export interface RouteStep {
  pieceId: string;
  pathId: string;
  dir: 1 | -1;
  lengthMm: number;
  requiredState?: string;
}

export type Movement = 'forward' | 'reverse';

/**
 * One uninterrupted run in a single movement direction. A route with several legs
 * reverses between them (kopmaken): the train stops at `stopAt`, the turnouts of the
 * next leg are set, and it continues with the opposite movement.
 */
export interface RouteLeg {
  movement: Movement;
  /** Pieces traversed after the leg's starting piece, in order. */
  steps: RouteStep[];
  /** Turnout positions this leg needs. */
  turnoutStates: { pieceId: string; state: string }[];
  /** Where the leading end comes to rest at the end of this leg. */
  stopAt: TrackPosition;
  /** Direction along `stopAt`'s path in which the leading end arrives (+1 = from → to). */
  arrivalDir: 1 | -1;
  /** Distance the leading end travels in this leg. */
  lengthMm: number;
  /** Every piece the train covers during this leg. */
  pieceIds: string[];
}

export interface Route {
  consistId: string;
  legs: RouteLeg[];
  /** Movement of the first leg (forward = nose first). */
  movement: Movement;
  /** All traversal steps of all legs, in order. */
  steps: RouteStep[];
  /** Turnout positions needed at departure (first leg) plus the later legs' first requirements. */
  turnoutStates: { pieceId: string; state: string }[];
  /** Every piece the train will cover, including the ones it stands on now. */
  pieceIds: string[];
  /** Total distance driven by the leading ends over all legs. */
  lengthMm: number;
  /** Final resting position of the leading end of the last leg. */
  stopAt: TrackPosition;
}

export interface PlanOptions {
  /** Pieces currently claimed or occupied by other trains (forbidden). */
  forbiddenPieceIds?: Set<string>;
  /** Current turnout positions: changing one costs extra. */
  turnoutStates?: (pieceId: string) => string | undefined;
  /** Allow driving tail first when that is shorter (or the only option). */
  allowReverse?: boolean;
  /** Service class of the consist for `railTypes` restrictions. */
  serviceClass?: RailType;
  /**
   * Train length: enables reversing moves in the middle of a route (kopmaken). The train
   * must fit completely beyond the turnout before it can come back over the other leg.
   */
  trainLengthMm?: number;
  /** Extra clearance past the turnout when reversing (mm). */
  reversalMarginMm?: number;
}

export type PlanFailure = 'no-route' | 'already-there' | 'unknown-target';

const TURNOUT_CHANGE_PENALTY_MM = 250;
/** Reversing costs time: modelled as extra distance so plain routes win when they exist. */
const REVERSAL_PENALTY_MM = 1500;
const DEFAULT_REVERSAL_MARGIN_MM = 40;

/** Derive the service class of a consist from its wagons (loco-only = shunting). */
export function consistServiceClass(consist: Consist, wagonClass: (wagonId: string) => string | undefined): RailType {
  for (const u of consist.units) {
    if (u.kind !== 'wagon') continue;
    const cls = wagonClass(u.wagonId);
    if (cls === 'passenger') return 'passenger';
    if (cls === 'goods') return 'freight';
  }
  return consist.units.some((u) => u.kind === 'wagon') ? 'freight' : 'shunting';
}

function edgeAllowed(index: LayoutIndex, attrs: TraversalEdge, options: PlanOptions): boolean {
  if (options.forbiddenPieceIds?.has(attrs.pieceId)) return false;
  const view = index.pieces.get(attrs.pieceId);
  if (!view) return false;
  const constraint = view.piece.drivingConstraint;
  if (constraint === 'forward' && attrs.dir !== 1) return false;
  if (constraint === 'reverse' && attrs.dir !== -1) return false;
  const types = view.piece.railTypes;
  if (types?.length && options.serviceClass && !types.includes(options.serviceClass)) return false;
  return true;
}

/**
 * Where the leading end must stop to reverse after entering `pieceId` at `connectorId`:
 * the whole train plus a margin has to be clear of the joint it came through.
 */
function reversalPoint(index: LayoutIndex, pieceId: string, connectorId: 'A' | 'B' | 'C' | 'D', options: PlanOptions): { stopAt: TrackPosition; arrivalDir: 1 | -1; pieceIds: string[]; runInMm: number } | null {
  const runIn = (options.trainLengthMm ?? 0) + (options.reversalMarginMm ?? DEFAULT_REVERSAL_MARGIN_MM);
  const entry = enterAt(index, pieceId, connectorId, options.turnoutStates);
  if (!entry) return null;
  const r = advance(index, entry, runIn, options.turnoutStates);
  if (r.blocked) return null;
  const pieceIds = [pieceId, ...r.entered];
  if (pieceIds.some((id) => options.forbiddenPieceIds?.has(id))) return null;
  return { stopAt: r.pos, arrivalDir: r.dir, pieceIds, runInMm: runIn };
}

function splitNode(node: string): { pieceId: string; connectorId: 'A' | 'B' | 'C' | 'D' } {
  const i = node.lastIndexOf('|');
  return { pieceId: node.slice(0, i), connectorId: node.slice(i + 1) as 'A' | 'B' | 'C' | 'D' };
}

interface LeadPlan {
  legs: RouteLeg[];
  lengthMm: number;
}

/**
 * Plan for the leading end `lead` (position + direction of travel) to reach `target`.
 * The leading end is the nose when driving forward and the tail when reversing.
 */
function planFromLead(index: LayoutIndex, graph: TrackGraph, lead: Traversal, movement: Movement, target: TrackPosition, options: PlanOptions): LeadPlan | null {
  const leadView = index.pieces.get(lead.pos.pieceId);
  const targetView = index.pieces.get(target.pieceId);
  if (!leadView || !targetView) return null;
  const leadPath = leadView.geom.paths.find((p) => p.id === lead.pos.pathId)!;
  const leadLen = pathLength(leadPath.primitives);
  const targetPath = targetView.geom.paths.find((p) => p.id === target.pathId)!;
  const targetLen = pathLength(targetPath.primitives);
  const targetState = targetView.geom.states?.find((s) => s.paths.includes(target.pathId));
  const finalTurnout = targetState ? [{ pieceId: target.pieceId, state: targetState.id }] : [];

  const single = (steps: RouteStep[], lengthMm: number, pieceIds: string[], arrivalDir: 1 | -1): LeadPlan => {
    const turnoutStates = steps.filter((s) => s.requiredState).map((s) => ({ pieceId: s.pieceId, state: s.requiredState! }));
    for (const t of finalTurnout) if (!turnoutStates.some((x) => x.pieceId === t.pieceId)) turnoutStates.push(t);
    return { legs: [{ movement, steps, turnoutStates, stopAt: target, arrivalDir, lengthMm, pieceIds }], lengthMm };
  };

  // Same piece and path, target ahead: no graph search needed.
  if (lead.pos.pieceId === target.pieceId && lead.pos.pathId === target.pathId) {
    const d = lead.dir === 1 ? target.s - lead.pos.s : lead.pos.s - target.s;
    if (d >= 0) return single([], d, [lead.pos.pieceId], lead.dir);
  }

  const source = exitNodeOf(index, lead);
  if (!source) return null;
  const targets = new Set([nodeId(target.pieceId, targetPath.from), nodeId(target.pieceId, targetPath.to)]);
  // The remaining distance on the current piece.
  const firstLeg = lead.dir === 1 ? leadLen - lead.pos.s : lead.pos.s;

  if (targets.has(source)) {
    const enterVia = splitNode(source).connectorId;
    const dir: 1 | -1 = enterVia === targetPath.from ? 1 : -1;
    const onTarget = dir === 1 ? target.s : targetLen - target.s;
    return single([], firstLeg + onTarget, [lead.pos.pieceId, target.pieceId], dir);
  }

  const canReverse = options.trainLengthMm != null && options.trainLengthMm > 0;
  const found = searchEdges(graph, source, targets, {
    cost: (attrs) => {
      if (!edgeAllowed(index, attrs, options)) return Infinity;
      if (attrs.requiredState && options.turnoutStates && options.turnoutStates(attrs.pieceId) !== attrs.requiredState) return TURNOUT_CHANGE_PENALTY_MM;
      return 0;
    },
    reversal: canReverse
      ? (node) => {
          const { pieceId, connectorId } = splitNode(node);
          const joint = index.jointByPort.get(portKey({ pieceId, connectorId }));
          if (!joint) return null;
          const point = reversalPoint(index, pieceId, connectorId, options);
          if (!point) return null;
          const back = otherPort(joint, { pieceId, connectorId });
          return { to: nodeId(back.pieceId, back.connectorId), cost: 2 * point.runInMm + REVERSAL_PENALTY_MM };
        }
      : undefined,
  });
  if (!found) return null;

  // Cut the edge sequence into legs at the reversal edges.
  const legs: RouteLeg[] = [];
  let legSteps: RouteStep[] = [];
  let legPieces: string[] = [lead.pos.pieceId];
  let legLength = firstLeg;
  let legMovement = movement;
  const toStep = (s: EdgeStep): RouteStep => ({ pieceId: s.attrs.pieceId, pathId: s.attrs.pathId, dir: s.attrs.dir, lengthMm: s.attrs.lengthMm, requiredState: s.attrs.requiredState });

  for (const s of found) {
    if (!s.attrs.reversal) {
      legSteps.push(toStep(s));
      legPieces.push(s.attrs.pieceId);
      legLength += s.attrs.lengthMm;
      continue;
    }
    const point = reversalPoint(index, s.attrs.pieceId, s.attrs.exitConnector, options)!;
    legLength += point.runInMm;
    legs.push({
      movement: legMovement,
      steps: legSteps,
      turnoutStates: legSteps.filter((x) => x.requiredState).map((x) => ({ pieceId: x.pieceId, state: x.requiredState! })),
      stopAt: point.stopAt,
      arrivalDir: point.arrivalDir,
      lengthMm: legLength,
      pieceIds: [...new Set([...legPieces, ...point.pieceIds])],
    });
    legMovement = legMovement === 'forward' ? 'reverse' : 'forward';
    legSteps = [];
    legPieces = [...point.pieceIds];
    legLength = point.runInMm;
  }
  const last = found[found.length - 1]!;
  const enterVia = splitNode(last.to).connectorId;
  const dir: 1 | -1 = enterVia === targetPath.from ? 1 : -1;
  const onTarget = dir === 1 ? target.s : targetLen - target.s;
  legLength += onTarget;
  const finalStates = legSteps.filter((x) => x.requiredState).map((x) => ({ pieceId: x.pieceId, state: x.requiredState! }));
  for (const t of finalTurnout) if (!finalStates.some((x) => x.pieceId === t.pieceId)) finalStates.push(t);
  legs.push({
    movement: legMovement,
    steps: legSteps,
    turnoutStates: finalStates,
    stopAt: target,
    arrivalDir: dir,
    lengthMm: legLength,
    pieceIds: [...new Set([...legPieces, target.pieceId])],
  });
  return { legs, lengthMm: legs.reduce((sum, l) => sum + l.lengthMm, 0) };
}

/** Plan a route for a consist standing at `pose` to bring its leading end to `target`. */
export function planRoute(index: LayoutIndex, graph: TrackGraph, consistId: string, pose: TrainPose, target: TrackPosition, options: PlanOptions = {}): Route | PlanFailure {
  if (!index.pieces.has(target.pieceId)) return 'unknown-target';
  const candidates: Route[] = [];

  const forward = planFromLead(index, graph, pose.front, 'forward', target, options);
  if (forward) candidates.push(toRoute(consistId, pose, forward));

  if (options.allowReverse) {
    const reverse = planFromLead(index, graph, reverseTraversal(pose.rear), 'reverse', target, options);
    if (reverse) candidates.push(toRoute(consistId, pose, reverse));
  }
  if (!candidates.length) return 'no-route';
  // Prefer fewer legs, then shorter.
  candidates.sort((a, b) => a.legs.length - b.legs.length || a.lengthMm - b.lengthMm);
  const best = candidates[0]!;
  if (best.lengthMm <= 1e-6) return 'already-there';
  return best;
}

function toRoute(consistId: string, pose: TrainPose, plan: LeadPlan): Route {
  const turnoutStates: { pieceId: string; state: string }[] = [];
  for (const leg of plan.legs) {
    for (const t of leg.turnoutStates) if (!turnoutStates.some((x) => x.pieceId === t.pieceId)) turnoutStates.push(t);
  }
  const pieceIds = [...new Set([pose.rear.pos.pieceId, pose.front.pos.pieceId, ...plan.legs.flatMap((l) => l.pieceIds)])];
  return {
    consistId,
    legs: plan.legs,
    movement: plan.legs[0]!.movement,
    steps: plan.legs.flatMap((l) => l.steps),
    turnoutStates,
    pieceIds,
    lengthMm: plan.lengthMm,
    stopAt: plan.legs[plan.legs.length - 1]!.stopAt,
  };
}
