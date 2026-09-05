import type { Graphics } from 'pixi.js';
import { compose, type Frame } from '@shared/geometry/frame.ts';
import { primitiveEnd, type Primitive } from '@shared/geometry/primitives.ts';

/**
 * Trace a chain of primitives into a Pixi path, laterally offset by `offset` mm
 * (positive = toward +y side of the direction of travel). Lines become parallel
 * lines, arcs stay exact concentric arcs — no polyline approximation.
 */
export function tracePath(g: Graphics, prims: readonly Primitive[], start: Frame, offset = 0): void {
  let frame = start;
  let first = true;
  for (const p of prims) {
    const nx = -Math.sin(frame.theta);
    const ny = Math.cos(frame.theta);
    if (p.kind === 'line') {
      const x0 = frame.x + offset * nx;
      const y0 = frame.y + offset * ny;
      const x1 = x0 + p.length * Math.cos(frame.theta);
      const y1 = y0 + p.length * Math.sin(frame.theta);
      if (first) g.moveTo(x0, y0);
      else g.lineTo(x0, y0);
      g.lineTo(x1, y1);
    } else {
      const sgn = p.sweep < 0 ? -1 : 1;
      const cx = frame.x + sgn * p.radius * nx;
      const cy = frame.y + sgn * p.radius * ny;
      const r = p.radius - sgn * offset;
      const a0 = Math.atan2(frame.y - cy, frame.x - cx);
      const a1 = a0 + p.sweep;
      const sx = cx + r * Math.cos(a0);
      const sy = cy + r * Math.sin(a0);
      if (first) g.moveTo(sx, sy);
      else g.lineTo(sx, sy);
      if (r > 1e-6) g.arc(cx, cy, r, a0, a1, p.sweep < 0);
      else g.lineTo(cx, cy);
    }
    first = false;
    frame = compose(frame, primitiveEnd(p));
  }
}

export interface TrackStyle {
  bedWidth: number;
  bedColor: number;
  railColor: number;
  railWidth: number;
  gauge: number;
}

/** Plan-view styling per track family (H0 gauge 16.5 mm). */
export function trackStyleFor(system: string): TrackStyle {
  switch (system) {
    case 'K':
      return { bedWidth: 26, bedColor: 0x3f3a33, railColor: 0xc8b48a, railWidth: 1.6, gauge: 16.5 };
    case 'M':
      return { bedWidth: 36, bedColor: 0x5b5f66, railColor: 0xd4d4d4, railWidth: 1.8, gauge: 16.5 };
    case 'C':
    default:
      return { bedWidth: 40, bedColor: 0x6b5b45, railColor: 0xd6dde3, railWidth: 1.6, gauge: 16.5 };
  }
}

export interface DrawTrackOptions {
  alpha?: number;
  highlight?: number | null;
  ghost?: boolean;
}

/** Draw one path (bed + two rails) in world coordinates. */
export function drawTrackPath(g: Graphics, prims: readonly Primitive[], start: Frame, style: TrackStyle, opts: DrawTrackOptions = {}): void {
  const alpha = opts.alpha ?? 1;
  if (opts.highlight != null) {
    tracePath(g, prims, start, 0);
    g.stroke({ width: style.bedWidth + 10, color: opts.highlight, alpha: 0.9 * alpha, cap: 'butt', join: 'round' });
  }
  tracePath(g, prims, start, 0);
  g.stroke({ width: style.bedWidth, color: opts.ghost ? 0x38bdf8 : style.bedColor, alpha: (opts.ghost ? 0.35 : 1) * alpha, cap: 'butt', join: 'round' });
  for (const side of [-1, 1]) {
    tracePath(g, prims, start, (side * style.gauge) / 2);
    g.stroke({ width: style.railWidth, color: opts.ghost ? 0xe0f2fe : style.railColor, alpha, cap: 'butt', join: 'round' });
  }
}
