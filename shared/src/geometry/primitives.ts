import { compose, normalizeAngle, type Frame } from './frame.ts';

/**
 * Exact track centre-line primitives, each expressed in its own local frame:
 * the primitive starts at the origin heading along +x.
 *
 * - `line`: straight of `length` mm.
 * - `arc`: circular arc of `radius` mm turning by the signed `sweep` (radians).
 *   Positive sweep turns toward +y (right-hand turn on a y-down screen), negative
 *   sweep turns left. The centre lies at (0, sign(sweep) · radius).
 */
export type Primitive =
  | { kind: 'line'; length: number }
  | { kind: 'arc'; radius: number; sweep: number };

export function line(length: number): Primitive {
  return { kind: 'line', length };
}

export function arc(radius: number, sweep: number): Primitive {
  return { kind: 'arc', radius, sweep };
}

export function primitiveLength(p: Primitive): number {
  return p.kind === 'line' ? p.length : Math.abs(p.sweep) * p.radius;
}

/** Pose at arc length `s` (clamped to the primitive) in the primitive's local frame. */
export function primitivePoseAt(p: Primitive, s: number): Frame {
  if (p.kind === 'line') {
    return { x: Math.min(Math.max(s, 0), p.length), y: 0, theta: 0 };
  }
  const len = Math.abs(p.sweep) * p.radius;
  const u = Math.min(Math.max(s, 0), len) / p.radius;
  const sgn = p.sweep < 0 ? -1 : 1;
  return {
    x: p.radius * Math.sin(u),
    y: sgn * p.radius * (1 - Math.cos(u)),
    theta: normalizeAngle(sgn * u),
  };
}

export function primitiveEnd(p: Primitive): Frame {
  return primitivePoseAt(p, primitiveLength(p));
}

/** Signed curvature (1/mm); 0 for lines, sign follows the sweep. */
export function primitiveCurvature(p: Primitive): number {
  if (p.kind === 'line') return 0;
  return (p.sweep < 0 ? -1 : 1) / p.radius;
}

/** Total centre-line length of a chain of primitives. */
export function pathLength(prims: readonly Primitive[]): number {
  let total = 0;
  for (const p of prims) total += primitiveLength(p);
  return total;
}

/**
 * Pose at arc length `s` along a chain of primitives, in the chain's local frame
 * (start at origin heading +x). `s` is clamped to [0, length].
 */
export function pathPoseAt(prims: readonly Primitive[], s: number): Frame {
  let frame: Frame = { x: 0, y: 0, theta: 0 };
  let remaining = Math.max(0, s);
  for (let i = 0; i < prims.length; i++) {
    const p = prims[i]!;
    const len = primitiveLength(p);
    if (remaining <= len || i === prims.length - 1) {
      return compose(frame, primitivePoseAt(p, Math.min(remaining, len)));
    }
    frame = compose(frame, primitiveEnd(p));
    remaining -= len;
  }
  return frame;
}

export function pathEnd(prims: readonly Primitive[]): Frame {
  return pathPoseAt(prims, pathLength(prims));
}

/** The same centre line traversed in the opposite direction (order reversed, sweeps negated). */
export function reversePrimitives(prims: readonly Primitive[]): Primitive[] {
  const out: Primitive[] = [];
  for (let i = prims.length - 1; i >= 0; i--) {
    const p = prims[i]!;
    out.push(p.kind === 'line' ? { kind: 'line', length: p.length } : { kind: 'arc', radius: p.radius, sweep: -p.sweep });
  }
  return out;
}

/**
 * Sub-chain covering arc lengths [s0, s1] of `prims` (both clamped, s0 ≤ s1). The result
 * is expressed in its own local frame; place it with `pathPoseAt(prims, s0)`.
 */
export function slicePath(prims: readonly Primitive[], s0: number, s1: number): Primitive[] {
  const total = pathLength(prims);
  const a = Math.min(Math.max(0, Math.min(s0, s1)), total);
  const b = Math.min(Math.max(0, Math.max(s0, s1)), total);
  const out: Primitive[] = [];
  let offset = 0;
  for (const p of prims) {
    const len = primitiveLength(p);
    const from = Math.max(a, offset);
    const to = Math.min(b, offset + len);
    if (to - from > 1e-9) {
      const part = to - from;
      out.push(p.kind === 'line' ? { kind: 'line', length: part } : { kind: 'arc', radius: p.radius, sweep: (p.sweep < 0 ? -1 : 1) * (part / p.radius) });
    }
    offset += len;
    if (offset >= b) break;
  }
  return out;
}

/** Smallest radius in the chain (Infinity when it only contains lines). */
export function pathMinRadius(prims: readonly Primitive[]): number {
  let min = Infinity;
  for (const p of prims) {
    if (p.kind === 'arc') min = Math.min(min, p.radius);
  }
  return min;
}
