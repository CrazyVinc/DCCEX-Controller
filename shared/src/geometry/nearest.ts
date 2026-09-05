import { compose, toLocalPoint, type Frame, type Vec2 } from './frame.ts';
import { primitiveEnd, primitiveLength, type Primitive } from './primitives.ts';

export interface NearestOnPath {
  /** Arc length along the chain of the closest point. */
  s: number;
  distance: number;
}

/** Exact closest point on a chain of primitives (world frame `start`) to `point`. */
export function nearestOnPath(prims: readonly Primitive[], start: Frame, point: Vec2): NearestOnPath {
  let best: NearestOnPath = { s: 0, distance: Infinity };
  let frame = start;
  let sOffset = 0;
  for (const p of prims) {
    const local = toLocalPoint(frame, point);
    const len = primitiveLength(p);
    let s: number;
    let d: number;
    if (p.kind === 'line') {
      s = Math.min(Math.max(local.x, 0), p.length);
      d = Math.hypot(local.x - s, local.y);
    } else {
      const sgn = p.sweep < 0 ? -1 : 1;
      // Mirror left turns so the centre is always at (0, R).
      const px = local.x;
      const py = sgn * local.y;
      const vx = px;
      const vy = py - p.radius;
      const a = Math.atan2(vy, vx); // angle from centre; arc starts at -π/2 and runs toward +angles
      let u = a + Math.PI / 2;
      if (u < -Math.PI) u += 2 * Math.PI;
      if (u > Math.PI) u -= 2 * Math.PI;
      const sweepAbs = Math.abs(p.sweep);
      if (u >= 0 && u <= sweepAbs) {
        s = u * p.radius;
        d = Math.abs(Math.hypot(vx, vy) - p.radius);
      } else {
        // Closest end point.
        const endLocal = primitiveEnd(p);
        const dStart = Math.hypot(px, py);
        const dEnd = Math.hypot(local.x - endLocal.x, local.y - endLocal.y);
        if (dStart <= dEnd) {
          s = 0;
          d = dStart;
        } else {
          s = len;
          d = dEnd;
        }
      }
    }
    if (d < best.distance) {
      best = { s: sOffset + s, distance: d };
    }
    frame = compose(frame, primitiveEnd(p));
    sOffset += len;
  }
  return best;
}
