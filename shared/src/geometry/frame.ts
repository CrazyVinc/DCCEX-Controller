/**
 * Rigid 2D frames (pose = position + heading) in layout millimetres.
 *
 * World convention (plan view, same as the screen): +x right, +y down.
 * `theta` is the heading in radians measured from +x toward +y, so a positive
 * rotation appears clockwise on screen. A "left" turn (as seen by a train
 * driving along the track) therefore has a *negative* sweep.
 */
export interface Frame {
  x: number;
  y: number;
  theta: number;
}

export interface Vec2 {
  x: number;
  y: number;
}

export const IDENTITY_FRAME: Frame = { x: 0, y: 0, theta: 0 };

export const TAU = Math.PI * 2;

/** Normalise an angle into (-π, π]. */
export function normalizeAngle(theta: number): number {
  let t = theta % TAU;
  if (t <= -Math.PI) t += TAU;
  if (t > Math.PI) t -= TAU;
  return t;
}

export function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

export function radToDeg(rad: number): number {
  return (rad * 180) / Math.PI;
}

/** `a ∘ b`: express `b` (given in `a`'s coordinates) in `a`'s parent coordinates. */
export function compose(a: Frame, b: Frame): Frame {
  const c = Math.cos(a.theta);
  const s = Math.sin(a.theta);
  return {
    x: a.x + b.x * c - b.y * s,
    y: a.y + b.x * s + b.y * c,
    theta: normalizeAngle(a.theta + b.theta),
  };
}

/** Inverse transform so that `compose(a, invert(a))` is the identity. */
export function invert(a: Frame): Frame {
  const c = Math.cos(a.theta);
  const s = Math.sin(a.theta);
  return {
    x: -(a.x * c + a.y * s),
    y: a.x * s - a.y * c,
    theta: normalizeAngle(-a.theta),
  };
}

/** Transform a point from `f`'s local coordinates to its parent coordinates. */
export function applyToPoint(f: Frame, p: Vec2): Vec2 {
  const c = Math.cos(f.theta);
  const s = Math.sin(f.theta);
  return { x: f.x + p.x * c - p.y * s, y: f.y + p.x * s + p.y * c };
}

/** Transform a point from parent coordinates into `f`'s local coordinates. */
export function toLocalPoint(f: Frame, p: Vec2): Vec2 {
  const c = Math.cos(f.theta);
  const s = Math.sin(f.theta);
  const dx = p.x - f.x;
  const dy = p.y - f.y;
  return { x: dx * c + dy * s, y: -dx * s + dy * c };
}

/** Same position, heading turned by 180°. */
export function flipHeading(f: Frame): Frame {
  return { x: f.x, y: f.y, theta: normalizeAngle(f.theta + Math.PI) };
}

export function translateFrame(f: Frame, dx: number, dy: number): Frame {
  return { x: f.x + dx, y: f.y + dy, theta: f.theta };
}

/** Rotate a frame about an arbitrary pivot point by `dTheta`. */
export function rotateFrameAbout(f: Frame, pivot: Vec2, dTheta: number): Frame {
  const c = Math.cos(dTheta);
  const s = Math.sin(dTheta);
  const dx = f.x - pivot.x;
  const dy = f.y - pivot.y;
  return {
    x: pivot.x + dx * c - dy * s,
    y: pivot.y + dx * s + dy * c,
    theta: normalizeAngle(f.theta + dTheta),
  };
}

export function headingVector(theta: number): Vec2 {
  return { x: Math.cos(theta), y: Math.sin(theta) };
}

export function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Absolute smallest angular difference between two headings, in radians. */
export function headingDifference(a: number, b: number): number {
  return Math.abs(normalizeAngle(a - b));
}

export function framesAlmostEqual(a: Frame, b: Frame, posTol = 1e-6, angTol = 1e-9): boolean {
  return distance(a, b) <= posTol && headingDifference(a.theta, b.theta) <= angTol;
}
