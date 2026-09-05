import { radToDeg } from '../geometry/frame.ts';
import type { LayoutIndex } from '../layout/index.ts';
import { advance, piecesAlong, reverseTraversal, worldPoseAt, type TurnoutStates } from '../layout/traverse.ts';
import type { TrainPose, Traversal } from './train.ts';

/**
 * Pose helpers built on the exact traversal primitives. A pose is fully determined by
 * the front traversal and the train length; the rear is stored as well so a turnout
 * changing under a standing train never "teleports" its tail.
 */

export interface PlacementResult {
  pose: TrainPose;
  occupiedPieceIds: string[];
}

export type PlacementError = 'open-end' | 'buffer-stop' | 'turnout-against';

/**
 * Build a standing pose from the front traversal: the rear is found by walking
 * `lengthMm` back along the track (through the current turnout positions).
 */
export function poseFromFront(index: LayoutIndex, front: Traversal, lengthMm: number, states?: TurnoutStates): PlacementResult | { error: PlacementError; fits: number } {
  const back = advance(index, reverseTraversal(front), lengthMm, states);
  if (back.blocked) {
    return { error: back.blocked, fits: back.moved };
  }
  const rear: Traversal = reverseTraversal({ pos: back.pos, dir: back.dir });
  return {
    pose: { front, rear, movement: 'stopped', speedMmS: 0, confidence: 1 },
    occupiedPieceIds: uniqueInOrder([front.pos.pieceId, ...back.entered]),
  };
}

/** Pieces between rear and front, rear first. */
export function occupiedPieces(index: LayoutIndex, pose: TrainPose, lengthMm: number, states?: TurnoutStates): string[] {
  return uniqueInOrder(piecesAlong(index, pose.rear, lengthMm, states));
}

/** Compass heading of the nose in degrees. */
export function facingDegOf(index: LayoutIndex, pose: TrainPose): number {
  return radToDeg(worldPoseAt(index, pose.front).theta);
}

/**
 * Move the train by `distanceMm` (≥ 0) in the direction given by `movement`.
 * Forward: the front leads and the rear follows; reverse: the rear leads. Facing is
 * untouched — the same traversal direction is kept on both ends.
 */
export function movePose(
  index: LayoutIndex,
  pose: TrainPose,
  distanceMm: number,
  states?: TurnoutStates,
): { pose: TrainPose; moved: number; blocked?: PlacementError } {
  if (pose.movement === 'stopped' || distanceMm <= 0) return { pose, moved: 0 };
  // The leading end limits the move first; if the trailing end is stopped earlier (e.g. a
  // turnout set against it), the whole train stops there — a train never compresses.
  const forward = pose.movement === 'forward';
  const leadStart = forward ? pose.front : reverseTraversal(pose.rear);
  const trailStart = forward ? pose.rear : reverseTraversal(pose.front);
  let lead = advance(index, leadStart, distanceMm, states);
  let trail = advance(index, trailStart, lead.moved, states);
  let blocked = lead.blocked;
  if (trail.moved < lead.moved - 1e-9) {
    lead = advance(index, leadStart, trail.moved, states);
    blocked = trail.blocked;
  }
  const leadT: Traversal = { pos: lead.pos, dir: lead.dir };
  const trailT: Traversal = { pos: trail.pos, dir: trail.dir };
  return {
    pose: forward
      ? { ...pose, front: leadT, rear: trailT }
      : { ...pose, rear: reverseTraversal(leadT), front: reverseTraversal(trailT) },
    moved: Math.min(lead.moved, trail.moved),
    blocked,
  };
}

/** Flip movement without touching the facing. */
export function reverseMovement(pose: TrainPose): TrainPose {
  return { ...pose, movement: pose.movement === 'forward' ? 'reverse' : 'forward' };
}

/**
 * DCC direction bit for one locomotive of a consist: 1 = the loco drives toward its own
 * cab 1. A loco coupled backwards (`orientation: 'reverse'`) gets the opposite bit so all
 * locos of a double-traction consist push the same way.
 */
export function locoDirectionBit(movement: 'forward' | 'reverse', orientation: 'forward' | 'reverse'): 0 | 1 {
  const towardConsistFront = movement === 'forward';
  const cabTowardConsistFront = orientation === 'forward';
  return towardConsistFront === cabTowardConsistFront ? 1 : 0;
}

function uniqueInOrder(ids: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    if (!seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}
