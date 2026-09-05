import { compose, type Frame } from './frame.ts';
import { primitiveEnd, primitiveLength, primitivePoseAt, type Primitive } from './primitives.ts';

export interface SamplePoint {
  x: number;
  y: number;
  theta: number;
  /** Arc length from the start of the chain. */
  s: number;
}

/**
 * Sample a primitive chain into poses for rendering. Lines produce their two end
 * points; arcs are subdivided so the chord error stays below `toleranceMm`.
 * The exact geometry is never approximated for measurements, only for drawing.
 */
export function samplePath(prims: readonly Primitive[], start: Frame, toleranceMm = 0.15): SamplePoint[] {
  const out: SamplePoint[] = [];
  let frame = start;
  let sOffset = 0;
  for (let i = 0; i < prims.length; i++) {
    const p = prims[i]!;
    const len = primitiveLength(p);
    let n = 1;
    if (p.kind === 'arc') {
      const maxStep = 2 * Math.acos(Math.max(-1, 1 - toleranceMm / p.radius));
      n = Math.max(2, Math.ceil(Math.abs(p.sweep) / maxStep));
    }
    for (let k = i === 0 ? 0 : 1; k <= n; k++) {
      const s = (len * k) / n;
      const pose = compose(frame, primitivePoseAt(p, s));
      out.push({ x: pose.x, y: pose.y, theta: pose.theta, s: sOffset + s });
    }
    frame = compose(frame, primitiveEnd(p));
    sOffset += len;
  }
  return out;
}

/** Axis-aligned bounds of sampled points. */
export function boundsOf(points: readonly { x: number; y: number }[]): { minX: number; minY: number; maxX: number; maxY: number } | null {
  if (!points.length) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}
