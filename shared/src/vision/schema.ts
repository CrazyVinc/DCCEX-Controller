import { z } from 'zod';

/**
 * Structured output requested from the vision model. Coordinates are fractions of the
 * image width/height (0…1), angles in degrees (0 = pointing right, clockwise positive
 * on the image), lengths as fractions of the image width.
 */
export const VISION_ELEMENT_TYPES = ['straight', 'curve', 'turnout-left', 'turnout-right', 'crossing'] as const;

export const VisionElementSchema = z.object({
  type: z.enum(VISION_ELEMENT_TYPES),
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  angleDeg: z.number(),
  /** Approximate visible length as a fraction of the image width. */
  lengthRel: z.number().min(0).max(2).default(0.1),
  /** For curves: approximate sweep in degrees (positive = turning clockwise on the image). */
  sweepDeg: z.number().optional(),
  confidence: z.number().min(0).max(1).default(0.5),
});
export type VisionElement = z.infer<typeof VisionElementSchema>;

export const VisionResultSchema = z.object({
  elements: z.array(VisionElementSchema),
  /** Free-text notes from the model (never used for control). */
  notes: z.string().optional(),
});
export type VisionResult = z.infer<typeof VisionResultSchema>;

export const PhotoImportResponseSchema = z.object({
  model: z.string(),
  result: VisionResultSchema,
  durationMs: z.number(),
});
export type PhotoImportResponse = z.infer<typeof PhotoImportResponseSchema>;

/** The exact instruction sent to the model; kept next to the schema so both stay aligned. */
export const VISION_PROMPT = `You are analysing a top-down photo of a model railway (H0 scale) track plan.
Detect every visible track piece and answer with ONLY a JSON object, no prose, no markdown:
{"elements":[{"type":"straight|curve|turnout-left|turnout-right|crossing","x":0.0-1.0,"y":0.0-1.0,"angleDeg":number,"lengthRel":0.0-1.0,"sweepDeg":number,"confidence":0.0-1.0}],"notes":"optional"}
- x,y: centre of the piece as fractions of image width/height (origin top-left).
- angleDeg: direction of the track at the piece centre, 0 = pointing right, 90 = pointing down.
- lengthRel: visible length of the piece as a fraction of the image width.
- sweepDeg: only for curves, the arc angle (positive when the curve turns clockwise on the image).
- confidence: how sure you are about the type and position.
List straights, curves, turnouts (left/right by the side the branch leaves toward, seen along angleDeg) and crossings.`;
