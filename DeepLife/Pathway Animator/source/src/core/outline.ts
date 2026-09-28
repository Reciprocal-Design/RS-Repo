import { createNoise2D } from 'simplex-noise';
import { rngFor } from './rng';
import type { Outline, Vec2 } from './types';

export const OUTLINE_SAMPLES = 48;

/**
 * A smooth, slightly irregular closed outline: r(θ) = R · (1 + wobble · noise(θ)).
 * Noise is sampled on a circle in noise space so the shape closes seamlessly.
 */
export function makeOutline(center: Vec2, R: number, wobble: number, seed: number): Outline {
  const noise = createNoise2D(rngFor(seed, 'outline'));
  // Low-frequency octaves; wobble 1 ≈ ±14% radius.
  const octaves = [
    { f: 0.9, a: 1 },
    { f: 1.8, a: 0.4 },
    { f: 3.1, a: 0.14 },
  ];
  const amp = 0.14 * wobble;
  const radiusAt = (theta: number) => {
    let n = 0;
    for (const o of octaves) n += o.a * noise(Math.cos(theta) * o.f + 11.3, Math.sin(theta) * o.f - 4.7);
    return R * (1 + (amp * n) / 1.54);
  };
  const points: Vec2[] = [];
  for (let i = 0; i < OUTLINE_SAMPLES; i++) {
    const th = (i / OUTLINE_SAMPLES) * Math.PI * 2;
    const r = radiusAt(th);
    points.push({ x: center.x + Math.cos(th) * r, y: center.y + Math.sin(th) * r });
  }
  return { center, points, radiusAt };
}

/** Closed Catmull-Rom spline through the points, as cubic Bézier segments. */
export function closedSplineSegments(points: Vec2[]): [Vec2, Vec2, Vec2][] {
  const n = points.length;
  const segs: [Vec2, Vec2, Vec2][] = [];
  for (let i = 0; i < n; i++) {
    const p0 = points[(i - 1 + n) % n], p1 = points[i], p2 = points[(i + 1) % n], p3 = points[(i + 2) % n];
    segs.push([
      { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 },
      { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 },
      p2,
    ]);
  }
  return segs;
}

/** Outward unit normal of the outline at angle θ (from the curve's tangent). */
export function outlineNormal(o: Outline, theta: number): Vec2 {
  const h = 1e-3;
  const p = (t: number) => ({ x: Math.cos(t) * o.radiusAt(t), y: Math.sin(t) * o.radiusAt(t) });
  const a = p(theta - h), b = p(theta + h);
  const tx = b.x - a.x, ty = b.y - a.y;
  const len = Math.hypot(tx, ty) || 1;
  // Angles increase clockwise on screen (y down), so the outward normal is (ty, -tx).
  return { x: ty / len, y: -tx / len };
}
