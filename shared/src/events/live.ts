import { z } from 'zod';
import { DispatchJobSchema } from '../domain/dispatch.ts';
import { LiveTrainSchema } from '../domain/train.ts';

/** Socket.IO payloads for the live map. Clients validate incoming events with these schemas. */

export const TurnoutSnapshotSchema = z.object({
  pieceId: z.string(),
  state: z.string(),
  automationId: z.string().optional(),
  states: z.array(z.object({ id: z.string(), label: z.string() })),
});
export type TurnoutSnapshot = z.infer<typeof TurnoutSnapshotSchema>;

export const SAFETY_LEVELS = ['NORMAL', 'DEGRADED', 'EMERGENCY'] as const;
export const SafetyLevelSchema = z.enum(SAFETY_LEVELS);
export type SafetyLevel = z.infer<typeof SafetyLevelSchema>;

export const SafetyStateSchema = z.object({
  level: SafetyLevelSchema,
  reasons: z.array(z.string()),
  updatedAt: z.number(),
});
export type SafetyState = z.infer<typeof SafetyStateSchema>;

export const SensorStateSchema = z.object({
  sensorId: z.int(),
  active: z.boolean(),
  updatedAt: z.number(),
});
export type SensorState = z.infer<typeof SensorStateSchema>;

export const ClaimSchema = z.object({
  consistId: z.string(),
  pieceIds: z.array(z.string()),
  turnoutIds: z.array(z.string()),
});
export type Claim = z.infer<typeof ClaimSchema>;

export const LiveSnapshotSchema = z.object({
  trains: z.array(LiveTrainSchema),
  turnouts: z.array(TurnoutSnapshotSchema),
  layoutUpdatedAt: z.string().nullable(),
  sensors: z.array(SensorStateSchema).optional(),
  claims: z.array(ClaimSchema).optional(),
  safety: SafetyStateSchema.optional(),
  simulationMode: z.boolean().optional(),
  dispatchJobs: z.array(DispatchJobSchema).optional(),
});
export type LiveSnapshot = z.infer<typeof LiveSnapshotSchema>;

export const TurnoutChangedSchema = z.object({
  pieceId: z.string(),
  state: z.string(),
  automationId: z.string().optional(),
});

export const TrainRemovedSchema = z.object({ consistId: z.string() });
export const LayoutUpdatedSchema = z.object({ updatedAt: z.string().nullable() });

/** Event name → payload schema, the single contract for client and server. */
export const LIVE_EVENTS = {
  'live:snapshot': LiveSnapshotSchema,
  'train:pose': LiveTrainSchema,
  'train:removed': TrainRemovedSchema,
  'turnout:state': TurnoutChangedSchema,
  'sensor:state': SensorStateSchema,
  'claims:updated': z.array(ClaimSchema),
  'safety:level': SafetyStateSchema,
  'layout:updated': LayoutUpdatedSchema,
  'dispatch:jobs': z.array(DispatchJobSchema),
} as const;

export type LiveEventName = keyof typeof LIVE_EVENTS;
export type LiveEventPayload<E extends LiveEventName> = z.infer<(typeof LIVE_EVENTS)[E]>;
