import type { Bezier, Vec2 } from './types';

export const LUT_SAMPLES = 64;

export function bezierPoint([p0, p1, p2, p3]: Bezier, t: number): Vec2 {
  const u = 1 - t;
  const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
  return { x: a * p0.x + b * p1.x + c * p2.x + d * p3.x, y: a * p0.y + b * p1.y + c * p2.y + d * p3.y };
}

/** Cumulative arc length at t = i / LUT_SAMPLES. */
export function arcLengthLut(bz: Bezier): Float32Array {
  const lut = new Float32Array(LUT_SAMPLES + 1);
  let prev = bz[0];
  for (let i = 1; i <= LUT_SAMPLES; i++) {
    const p = bezierPoint(bz, i / LUT_SAMPLES);
    lut[i] = lut[i - 1] + Math.hypot(p.x - prev.x, p.y - prev.y);
    prev = p;
  }
  return lut;
}

/** Parameter t at which the curve has travelled `dist` along its length. */
export function tAtDistance(lut: Float32Array, dist: number): number {
  const total = lut[lut.length - 1];
  if (dist <= 0) return 0;
  if (dist >= total) return 1;
  let lo = 0, hi = lut.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (lut[mid] < dist) lo = mid;
    else hi = mid;
  }
  const f = (dist - lut[lo]) / (lut[hi] - lut[lo] || 1);
  return (lo + f) / (lut.length - 1);
}
