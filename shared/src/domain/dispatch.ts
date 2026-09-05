import { z } from 'zod';
import { TrackPositionSchema } from '../layout/schema.ts';

export const DISPATCH_STATES = ['planned', 'validated', 'running', 'held', 'arrived', 'rejected', 'aborted'] as const;
export const DispatchStateSchema = z.enum(DISPATCH_STATES);
export type DispatchState = z.infer<typeof DispatchStateSchema>;

export const DispatchRequestSchema = z.object({
  consistId: z.string().min(1),
  /** Station name (destinations flagged `isStation`); any free platform with that name qualifies. */
  station: z.string().min(1),
  speedStep: z.int().min(1).max(126).default(40),
  allowReverse: z.boolean().default(true),
});
export type DispatchRequest = z.infer<typeof DispatchRequestSchema>;

export const DispatchJobSchema = z.object({
  id: z.string(),
  consistId: z.string(),
  station: z.string(),
  /** Chosen platform (destination id). */
  platformId: z.string().nullable(),
  state: DispatchStateSchema,
  reason: z.string().nullable(),
  /** Why the job was rejected / stopped. */
  issues: z.array(z.string()),
  /** Non-blocking remarks, e.g. a platform shorter than the train (train is centred on it). */
  warnings: z.array(z.string()).default([]),
  speedStep: z.number(),
  movement: z.enum(['forward', 'reverse']).nullable(),
  routePieceIds: z.array(z.string()),
  turnoutStates: z.array(z.object({ pieceId: z.string(), state: z.string() })),
  stopAt: TrackPositionSchema.nullable(),
  routeLengthMm: z.number(),
  estimatedDurationMs: z.number(),
  /** Fraction of the route already covered (0…1). */
  progress: z.number(),
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type DispatchJob = z.infer<typeof DispatchJobSchema>;
