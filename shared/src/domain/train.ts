import { z } from 'zod';
import { TrackPositionSchema } from '../layout/schema.ts';

/**
 * Train domain model. The three orientation concepts are kept strictly apart:
 *
 * - **facing** — where the physical front of the train points. Encoded by the front
 *   traversal (`front.pos` + `front.dir`): the direction along the rail in which the
 *   nose points. It never changes because the train reverses.
 * - **movement** — `forward` (nose leads), `reverse` (tail leads) or `stopped`.
 * - **heading** — the momentary compass direction of the nose, derived from the track
 *   tangent at `front` (see `worldPoseAt`); it changes continuously through curves.
 */

export const TravelDirSchema = z.union([z.literal(1), z.literal(-1)]);
export type TravelDir = z.infer<typeof TravelDirSchema>;

/** A track position plus the direction along the path that the train's nose points in. */
export const TraversalSchema = z.object({
  pos: TrackPositionSchema,
  dir: TravelDirSchema,
});
export type Traversal = z.infer<typeof TraversalSchema>;

export const MOVEMENTS = ['forward', 'reverse', 'stopped'] as const;
export const MovementSchema = z.enum(MOVEMENTS);
export type Movement = z.infer<typeof MovementSchema>;

export const TrainPoseSchema = z.object({
  /** Position of the physical front end; `dir` = facing along the rail. */
  front: TraversalSchema,
  /** Position of the physical rear end; `dir` points from the rear toward the front. */
  rear: TraversalSchema,
  movement: MovementSchema,
  /** Speed magnitude in mm/s (direction comes from `movement`). */
  speedMmS: z.number().min(0),
  /** 0 = unknown, 1 = confirmed by sensors / manual placement. */
  confidence: z.number().min(0).max(1),
});
export type TrainPose = z.infer<typeof TrainPoseSchema>;

export const LOCO_ORIENTATIONS = ['forward', 'reverse'] as const;

export const ConsistUnitSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('loco'),
    /** DCC address (roster `DCC_ID`). */
    dccId: z.string().min(1),
    /** `forward` = the loco's own cab 1 points toward the consist front. */
    orientation: z.enum(LOCO_ORIENTATIONS).default('forward'),
  }),
  z.object({
    kind: z.literal('wagon'),
    wagonId: z.string().min(1),
  }),
]);
export type ConsistUnit = z.infer<typeof ConsistUnitSchema>;

/** A train as operated: ordered units from the physical front to the rear. */
export const ConsistSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  /** Ordered front → rear. `units[0]` is the front unit. */
  units: z.array(ConsistUnitSchema).min(1),
  /** Extra length per coupling between two units (mm). */
  couplingGapMm: z.number().min(0).default(6),
  /** Acceleration / braking in mm/s² used by the simulation. */
  accelerationMmS2: z.number().positive().default(120),
  brakingMmS2: z.number().positive().default(180),
});
export type Consist = z.infer<typeof ConsistSchema>;

export const ConsistInputSchema = ConsistSchema.omit({ id: true });
export type ConsistInput = z.infer<typeof ConsistInputSchema>;

export const TRAIN_STATES = ['unknown', 'stopped', 'accelerating', 'running', 'braking', 'emergency'] as const;
export const TrainStateIdSchema = z.enum(TRAIN_STATES);
export type TrainStateId = z.infer<typeof TrainStateIdSchema>;

/** Live state of one consist as tracked by the server. */
export const LiveTrainSchema = z.object({
  consistId: z.string(),
  pose: TrainPoseSchema.nullable(),
  state: TrainStateIdSchema,
  /** Pieces currently covered between rear and front. */
  occupiedPieceIds: z.array(z.string()),
  /** Blocks (by id) currently covered. */
  occupiedBlockIds: z.array(z.string()),
  /** Compass heading of the nose in degrees (0 = +x, clockwise on screen). */
  facingDeg: z.number().nullable(),
  totalLengthMm: z.number(),
  updatedAt: z.number(),
});
export type LiveTrain = z.infer<typeof LiveTrainSchema>;

export const PositionCorrectionSchema = z.object({
  consistId: z.string(),
  oldPose: TrainPoseSchema.nullable(),
  newPose: TrainPoseSchema.nullable(),
  reason: z.enum(['manual-placement', 'sensor-reconciliation', 'restart-recovery', 'removed']),
  at: z.string(),
});
export type PositionCorrection = z.infer<typeof PositionCorrectionSchema>;
