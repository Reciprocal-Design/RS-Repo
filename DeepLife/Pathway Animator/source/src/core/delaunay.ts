import type { Vec2 } from './types';

/**
 * Delaunay triangulation (Bowyer–Watson). Plenty for the few hundred points
 * of the body's wireframe; returns triangles as index triples into `pts`.
 */
export function delaunay(pts: Vec2[]): [number, number, number][] {
  const n = pts.length;
  if (n < 3) return [];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  const d = Math.max(maxX - minX, maxY - minY) * 20;
  const mx = (minX + maxX) / 2, my = (minY + maxY) / 2;
  // A super-triangle round everything, removed at the end.
  const all = [...pts, { x: mx - d, y: my - d }, { x: mx + d, y: my - d }, { x: mx, y: my + d }];

  interface Tri { a: number; b: number; c: number; x: number; y: number; r2: number }
  const make = (a: number, b: number, c: number): Tri => {
    const A = all[a], B = all[b], C = all[c];
    const D = 2 * (A.x * (B.y - C.y) + B.x * (C.y - A.y) + C.x * (A.y - B.y)) || 1e-12;
    const a2 = A.x * A.x + A.y * A.y, b2 = B.x * B.x + B.y * B.y, c2 = C.x * C.x + C.y * C.y;
    const x = (a2 * (B.y - C.y) + b2 * (C.y - A.y) + c2 * (A.y - B.y)) / D;
    const y = (a2 * (C.x - B.x) + b2 * (A.x - C.x) + c2 * (B.x - A.x)) / D;
    return { a, b, c, x, y, r2: (A.x - x) ** 2 + (A.y - y) ** 2 };
  };

  let tris: Tri[] = [make(n, n + 1, n + 2)];
  for (let i = 0; i < n; i++) {
    const p = all[i];
    const bad: Tri[] = [], keep: Tri[] = [];
    for (const t of tris) ((p.x - t.x) ** 2 + (p.y - t.y) ** 2 < t.r2 ? bad : keep).push(t);
    // The hole's boundary: edges of bad triangles not shared by another bad one.
    const count = new Map<string, [number, number]>();
    const seen = new Map<string, number>();
    for (const t of bad) {
      for (const [u, v] of [[t.a, t.b], [t.b, t.c], [t.c, t.a]] as [number, number][]) {
        const k = u < v ? `${u},${v}` : `${v},${u}`;
        seen.set(k, (seen.get(k) ?? 0) + 1);
        count.set(k, [u, v]);
      }
    }
    for (const [k, [u, v]] of count) if (seen.get(k) === 1) keep.push(make(u, v, i));
    tris = keep;
  }
  return tris.filter((t) => t.a < n && t.b < n && t.c < n).map((t) => [t.a, t.b, t.c]);
}
