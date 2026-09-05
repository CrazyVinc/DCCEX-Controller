/**
 * Speed model: converts between DCC speed steps (0…126), Märklin-style speed steps
 * (1…14, used for speed restrictions) and model speed in mm/s, based on the roster
 * calibration of each locomotive (`Distance` mm in `Duration` s at `Step`).
 */

export interface SpeedCalibration {
  Distance?: number | null;
  Duration?: number | null;
  Step?: number | null;
  /** Maximum DCC step allowed for this loco (roster limit). */
  limit?: number;
}

export const DCC_MAX_STEP = 126;
export const MARKLIN_MAX_STEP = 14;
/** Fallback: mm/s per DCC step when no calibration is available (≈158 scale km/h at step 126). */
export const DEFAULT_MM_S_PER_STEP = 4;

/** mm/s per DCC speed step, linear through the calibration point. */
export function mmPerSecondPerStep(cal: SpeedCalibration | undefined): number {
  if (!cal || !cal.Distance || !cal.Duration || !cal.Step || cal.Duration <= 0 || cal.Step <= 0) return DEFAULT_MM_S_PER_STEP;
  return cal.Distance / cal.Duration / cal.Step;
}

export function speedForStep(cal: SpeedCalibration | undefined, dccStep: number): number {
  return Math.max(0, Math.min(DCC_MAX_STEP, dccStep)) * mmPerSecondPerStep(cal);
}

export function stepForSpeed(cal: SpeedCalibration | undefined, speedMmS: number): number {
  const perStep = mmPerSecondPerStep(cal);
  return Math.max(0, Math.min(DCC_MAX_STEP, Math.round(speedMmS / perStep)));
}

/** Märklin 1…14 speed step → DCC 0…126 step. */
export function marklinStepToDcc(step: number): number {
  return Math.round((Math.max(0, Math.min(MARKLIN_MAX_STEP, step)) * DCC_MAX_STEP) / MARKLIN_MAX_STEP);
}

/** Maximum model speed allowed by a Märklin-style speed restriction for this loco. */
export function speedLimitForRestriction(cal: SpeedCalibration | undefined, maxSpeedStep: number): number {
  return speedForStep(cal, marklinStepToDcc(maxSpeedStep));
}

/** Prototype km/h at 1:87 for display. */
export function toScaleKmh(speedMmS: number): number {
  return (speedMmS * 87 * 3.6) / 1000;
}

/** Distance needed to brake from `v` to a stop with constant deceleration `a` (mm). */
export function brakingDistance(v: number, a: number): number {
  return a > 0 ? (v * v) / (2 * a) : Infinity;
}

/** Time to travel `distance` starting at `v` with constant acceleration `a` capped at `vMax` (s). */
export function travelTime(distance: number, v: number, a: number, vMax: number): number {
  if (distance <= 0) return 0;
  const vCap = Math.max(vMax, 1e-6);
  if (v >= vCap) return distance / vCap;
  const accelDist = (vCap * vCap - v * v) / (2 * a);
  if (accelDist >= distance) {
    const vEnd = Math.sqrt(v * v + 2 * a * distance);
    return (vEnd - v) / a;
  }
  return (vCap - v) / a + (distance - accelDist) / vCap;
}
