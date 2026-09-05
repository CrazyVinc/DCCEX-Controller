import { z } from 'zod';

/**
 * Layout document v3 — graph-first. Pieces are coupled through explicit `joints`;
 * piece frames are derived from the component roots and stored back for fast
 * rendering (`normalizeLayout`). Coordinates are H0 layout millimetres, y down.
 */

export const FrameSchema = z.object({
  x: z.number(),
  y: z.number(),
  /** Heading in radians, from +x toward +y. */
  theta: z.number(),
});

export const PrimitiveSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('line'), length: z.number().positive() }),
  z.object({ kind: z.literal('arc'), radius: z.number().positive(), sweep: z.number() }),
]);

export const ConnectorIdSchema = z.enum(['A', 'B', 'C', 'D']);

export const DRIVING_CONSTRAINTS = ['forward', 'reverse', 'both'] as const;
export const DrivingConstraintSchema = z.enum(DRIVING_CONSTRAINTS);

export const RAIL_TYPES = ['passenger', 'freight', 'shunting'] as const;
export const RailTypeSchema = z.enum(RAIL_TYPES);
export const RAIL_TYPE_LABEL: Record<(typeof RAIL_TYPES)[number], string> = {
  passenger: 'Passenger only',
  freight: 'Freight only',
  shunting: 'Shunting only',
};

export const PlacedPieceSchema = z.object({
  id: z.string().min(1),
  defId: z.string().min(1),
  /** World frame of connector A's origin (derived for non-root pieces, authoritative for roots). */
  frame: FrameSchema,
  level: z.int().min(0),
  /** Physical height (mm) of the piece base at connector A. */
  zMm: z.number(),
  /** Grade along the piece in % (rise / run × 100), positive = climbing from A toward the other connectors. */
  gradePercent: z.number().optional(),
  /** DCC-EX turnout / accessory id. Empty = manual. */
  automationId: z.string().optional(),
  /** Time the point motor needs to change position (ms). */
  switchTimeMs: z.int().positive().optional(),
  drivingConstraint: DrivingConstraintSchema.optional(),
  railTypes: z.array(RailTypeSchema).optional(),
  /** Solved centre line of a flex rail. */
  flexShape: z.array(PrimitiveSchema).optional(),
});

export const PortRefSchema = z.object({
  pieceId: z.string().min(1),
  connectorId: ConnectorIdSchema,
});

export const JointSchema = z.object({
  id: z.string().min(1),
  a: PortRefSchema,
  b: PortRefSchema,
  /** Accepted by the user although the two connectors do not meet exactly (loop closure). */
  forced: z.boolean().optional(),
});

/** Exact position on the track: `s` mm along `pathId` measured from that path's `from` connector. */
export const TrackPositionSchema = z.object({
  pieceId: z.string().min(1),
  pathId: z.string().min(1),
  s: z.number().min(0),
});

export const TrackBlockSchema = z.object({
  id: z.string().min(1),
  level: z.int().min(0),
  start: TrackPositionSchema,
  end: TrackPositionSchema,
  /** Piece chain from start to end (inclusive). */
  pieceIds: z.array(z.string()),
  /** DCC-EX sensor id reporting occupancy of this block. */
  sensorId: z.int().min(0).optional(),
});

export const DestinationSchema = TrackBlockSchema.extend({
  name: z.string().min(1),
  isStation: z.boolean().optional(),
});

export const SPEED_STEP_MIN = 1;
export const SPEED_STEP_MAX = 14;

export const SpeedRestrictionSchema = TrackBlockSchema.extend({
  maxSpeedStep: z.int().min(SPEED_STEP_MIN).max(SPEED_STEP_MAX),
});

export const PlacedAccessorySchema = z.object({
  id: z.string().min(1),
  defId: z.string().min(1),
  anchor: TrackPositionSchema.optional(),
  x: z.number().optional(),
  y: z.number().optional(),
  rotationDeg: z.number(),
  level: z.int().min(0),
  zMm: z.number(),
  automationId: z.string().optional(),
});

export const LayoutDocumentSchema = z.object({
  version: z.literal(3),
  name: z.string(),
  updatedAt: z.string().optional(),
  pieces: z.array(PlacedPieceSchema),
  joints: z.array(JointSchema),
  trackBlocks: z.array(TrackBlockSchema),
  destinations: z.array(DestinationSchema),
  speedRestrictions: z.array(SpeedRestrictionSchema),
  accessories: z.array(PlacedAccessorySchema),
  activeLevel: z.int().min(0),
  /** Deck height (mm) per level index; missing levels use `level × DEFAULT_LEVEL_STEP_MM`. */
  levelHeightsMm: z.record(z.string(), z.number()).optional(),
});

export type Frame = z.infer<typeof FrameSchema>;
export type Primitive = z.infer<typeof PrimitiveSchema>;
export type ConnectorId = z.infer<typeof ConnectorIdSchema>;
export type DrivingConstraint = z.infer<typeof DrivingConstraintSchema>;
export type RailType = z.infer<typeof RailTypeSchema>;
export type PlacedPiece = z.infer<typeof PlacedPieceSchema>;
export type PortRef = z.infer<typeof PortRefSchema>;
export type Joint = z.infer<typeof JointSchema>;
export type TrackPosition = z.infer<typeof TrackPositionSchema>;
export type TrackBlock = z.infer<typeof TrackBlockSchema>;
export type Destination = z.infer<typeof DestinationSchema>;
export type SpeedRestriction = z.infer<typeof SpeedRestrictionSchema>;
export type PlacedAccessory = z.infer<typeof PlacedAccessorySchema>;
export type LayoutDocument = z.infer<typeof LayoutDocumentSchema>;

/** Model mm between deck levels when `levelHeightsMm` is unset. */
export const DEFAULT_LEVEL_STEP_MM = 80;

export function emptyLayout(name = 'New layout'): LayoutDocument {
  return {
    version: 3,
    name,
    pieces: [],
    joints: [],
    trackBlocks: [],
    destinations: [],
    speedRestrictions: [],
    accessories: [],
    activeLevel: 0,
  };
}

export function getLevelHeightMm(layout: Pick<LayoutDocument, 'levelHeightsMm'>, level: number): number {
  const v = layout.levelHeightsMm?.[String(level)];
  return typeof v === 'number' && Number.isFinite(v) ? v : level * DEFAULT_LEVEL_STEP_MM;
}

export function portKey(ref: PortRef): string {
  return `${ref.pieceId}:${ref.connectorId}`;
}

export function clampSpeedStep(n: number): number {
  if (!Number.isFinite(n)) return SPEED_STEP_MAX;
  return Math.min(SPEED_STEP_MAX, Math.max(SPEED_STEP_MIN, Math.round(n)));
}
