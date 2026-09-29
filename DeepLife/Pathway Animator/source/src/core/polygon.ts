import type { Outline, Vec2 } from './types';

/** Signed area (shoelace); positive when clockwise on screen (y down). */
export function polygonArea(p: Vec2[]): number {
  let a = 0;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) a += p[j].x * p[i].y - p[i].x * p[j].y;
  return a / 2;
}

export function polygonCentroid(p: Vec2[]): Vec2 {
  const A = polygonArea(p);
  if (Math.abs(A) < 1e-12) {
    const n = p.length || 1;
    return { x: p.reduce((s, v) => s + v.x, 0) / n, y: p.reduce((s, v) => s + v.y, 0) / n };
  }
  let cx = 0, cy = 0;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const f = p[j].x * p[i].y - p[i].x * p[j].y;
    cx += (p[j].x + p[i].x) * f;
    cy += (p[j].y + p[i].y) * f;
  }
  return { x: cx / (6 * A), y: cy / (6 * A) };
}

export function pointInPolygon(q: Vec2, p: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const a = p[i], b = p[j];
    if (a.y > q.y !== b.y > q.y && q.x < ((b.x - a.x) * (q.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Points spaced evenly along the closed polygon's perimeter. */
export function resamplePolygon(p: Vec2[], n: number): Vec2[] {
  const segs = p.map((a, i) => {
    const b = p[(i + 1) % p.length];
    return { a, b, l: Math.hypot(b.x - a.x, b.y - a.y) };
  });
  const total = segs.reduce((s, g) => s + g.l, 0);
  if (!(total > 0)) return p.slice();
  const out: Vec2[] = [];
  let k = 0, acc = 0;
  for (let i = 0; i < n; i++) {
    const d = (i / n) * total;
    while (k < segs.length - 1 && acc + segs[k].l < d) acc += segs[k++].l;
    const g = segs[k], t = g.l > 0 ? (d - acc) / g.l : 0;
    out.push({ x: g.a.x + (g.b.x - g.a.x) * t, y: g.a.y + (g.b.y - g.a.y) * t });
  }
  return out;
}

/**
 * An Outline for a polygon, around `center` (default: its centroid):
 * radiusAt casts a ray from the centre to the polygon's edge. Drawn as a
 * smooth spline through evenly spaced perimeter points, which keeps straight
 * sides straight and softens corners slightly.
 */
export function polygonOutline(p: Vec2[], samples: number, center = polygonCentroid(p)): Outline {
  const points = resamplePolygon(p, samples);
  const n = p.length;
  const fallback = Math.sqrt(Math.abs(polygonArea(p)) / Math.PI);
  const radiusAt = (theta: number) => {
    const dx = Math.cos(theta), dy = Math.sin(theta);
    let best = Infinity;
    for (let i = 0; i < n; i++) {
      const a = p[i], b = p[(i + 1) % n];
      const ex = b.x - a.x, ey = b.y - a.y;
      const den = dx * ey - dy * ex;
      if (Math.abs(den) < 1e-12) continue;
      const ax = a.x - center.x, ay = a.y - center.y;
      const t = (ax * ey - ay * ex) / den; // distance along the ray
      const u = (ax * dy - ay * dx) / den; // position along the edge
      if (t > 1e-9 && u >= -1e-9 && u <= 1 + 1e-9 && t < best) best = t;
    }
    return Number.isFinite(best) ? best : fallback;
  };
  return { center, points, radiusAt };
}
