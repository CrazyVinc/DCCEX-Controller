import { compose, distance, headingVector, normalizeAngle, type Frame } from './frame.ts';
import { pathEnd, pathLength, pathMinRadius, type Primitive } from './primitives.ts';

export interface FlexSolution {
  primitives: Primitive[];
  lengthMm: number;
  minRadiusMm: number;
  /** Residual error of the solution at the end pose (should be ~0). */
  endErrorMm: number;
}

const EPS = 1e-9;

function cross(ax: number, ay: number, bx: number, by: number): number {
  return ax * by - ay * bx;
}

/**
 * Circular arc (or line) that starts at the origin heading +x and passes through
 * `p` (local coordinates). The end heading is 2× the angle between +x and the chord.
 */
function arcThrough(p: { x: number; y: number }): Primitive | null {
  const chord = Math.hypot(p.x, p.y);
  if (chord < EPS) return null;
  const half = Math.atan2(p.y, p.x); // angle from tangent to chord
  if (Math.abs(half) < 1e-9) {
    return p.x > 0 ? { kind: 'line', length: chord } : null;
  }
  const sweep = 2 * half;
  const radius = chord / (2 * Math.sin(Math.abs(half)));
  return { kind: 'arc', radius, sweep };
}

/**
 * Biarc fitting: the shortest G1-continuous pair of circular arcs from `start` to
 * `end` (positions + headings, world frame). Used to bend flex rail so that a loop
 * closes exactly. Returns `null` when the poses cannot be connected (e.g. the end
 * lies behind the start with an opposite heading and zero offset).
 */
export function solveBiarc(start: Frame, end: Frame): FlexSolution | null {
  // Work in the start frame: P0 = 0, T0 = +x.
  const c = Math.cos(start.theta);
  const s = Math.sin(start.theta);
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const v = { x: dx * c + dy * s, y: -dx * s + dy * c };
  const t1 = headingVector(normalizeAngle(end.theta - start.theta));
  const t0 = { x: 1, y: 0 };

  const vv = v.x * v.x + v.y * v.y;
  if (vv < EPS) return null;
  const t0t1 = t0.x * t1.x + t0.y * t1.y;
  const vt = v.x * (t0.x + t1.x) + v.y * (t0.y + t1.y);
  const denom = 2 * (1 - t0t1);

  let d: number;
  if (Math.abs(denom) < 1e-9) {
    // Parallel tangents.
    const vt1 = v.x * t1.x + v.y * t1.y;
    if (Math.abs(v.y) < 1e-9 && vt1 > 0) {
      // Collinear and ahead: a plain straight.
      const prims: Primitive[] = [{ kind: 'line', length: Math.sqrt(vv) }];
      return { primitives: prims, lengthMm: Math.sqrt(vv), minRadiusMm: Infinity, endErrorMm: 0 };
    }
    if (Math.abs(vt1) < 1e-9) return null;
    d = vv / (4 * vt1);
  } else {
    const disc = vt * vt + denom * vv;
    d = (-vt + Math.sqrt(disc)) / denom;
  }
  if (!Number.isFinite(d) || d <= 0) return null;

  // Junction point and the two arcs.
  const pm = { x: (0 + d * t0.x + v.x - d * t1.x) / 2, y: (0 + d * t0.y + v.y - d * t1.y) / 2 };
  const first = arcThrough(pm);
  if (!first) return null;
  const midFrame = pathEnd([first]);
  // Second arc: from pm (heading midFrame.theta) to v. Express v in the mid frame.
  const mc = Math.cos(midFrame.theta);
  const ms = Math.sin(midFrame.theta);
  const rx = v.x - midFrame.x;
  const ry = v.y - midFrame.y;
  const local = { x: rx * mc + ry * ms, y: -rx * ms + ry * mc };
  const second = arcThrough(local);
  if (!second) return null;

  const primitives = [first, second];
  const reached = compose(start, pathEnd(primitives));
  const endErrorMm = distance(reached, end) + Math.abs(normalizeAngle(reached.theta - end.theta)) * 100;
  return { primitives, lengthMm: pathLength(primitives), minRadiusMm: pathMinRadius(primitives), endErrorMm };
}

/** Sign of the turning direction of a biarc leg; kept for callers that want to inspect the shape. */
export function biarcTurn(p: Primitive): -1 | 0 | 1 {
  if (p.kind === 'line') return 0;
  return p.sweep < 0 ? -1 : 1;
}

export { cross as crossProduct };
