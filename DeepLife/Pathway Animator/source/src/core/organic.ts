import { delaunay } from './delaunay';
import { range, rngFor, signed } from './rng';
import type { CellMap, MapCell, Vec2 } from './types';

// A generated tissue that looks grown rather than placed: irregular cells
// packed wall to wall, in a clump with an uneven edge. Points are scattered
// evenly, each cell is the region nearest its point (a Voronoi cell, from the
// Delaunay triangulation), corners are rounded and a thin gap is left between
// neighbours. Returned in the same form as an imported SVG map.

export const ORGANIC_NAME = 'generated tissue';

/** Share of each cell's size left as the gap to its neighbours. */
const GAP = 0.02;

const circumcentre = (a: Vec2, b: Vec2, c: Vec2): Vec2 => {
  const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y)) || 1e-12;
  const a2 = a.x * a.x + a.y * a.y, b2 = b.x * b.x + b.y * b.y, c2 = c.x * c.x + c.y * c.y;
  return {
    x: (a2 * (b.y - c.y) + b2 * (c.y - a.y) + c2 * (a.y - b.y)) / d,
    y: (a2 * (c.x - b.x) + b2 * (a.x - c.x) + c2 * (b.x - a.x)) / d,
  };
};

/** Corner cutting: each pass replaces every corner with two points a quarter of the way along its sides. */
function rounded(p: Vec2[], passes: number): Vec2[] {
  let out = p;
  for (let k = 0; k < passes; k++) {
    const next: Vec2[] = [];
    for (let i = 0; i < out.length; i++) {
      const a = out[i], b = out[(i + 1) % out.length];
      next.push({ x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25 }, { x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75 });
    }
    out = next;
  }
  return out;
}

const centroidOf = (p: Vec2[]): Vec2 => {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const f = p[j].x * p[i].y - p[i].x * p[j].y;
    a += f;
    cx += (p[j].x + p[i].x) * f;
    cy += (p[j].y + p[i].y) * f;
  }
  return Math.abs(a) < 1e-9 ? p[0] : { x: cx / (3 * a), y: cy / (3 * a) };
};

const cache = new Map<string, Pick<CellMap, 'name' | 'viewBox' | 'cells'>>();

/**
 * About `wanted` cells in a clump `aspect` (width ÷ height) in proportion.
 * The same seed always gives the same tissue.
 */
export function organicTissue(seed: number, wanted = 22, aspect = 0.85): Pick<CellMap, 'name' | 'viewBox' | 'cells'> {
  const key = `${seed}|${wanted}|${aspect}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const H = 1000, W = H * aspect;
  const rng = rngFor(seed, 'organic-tissue');
  // The clump: an ellipse with a wavering edge.
  const ph = [rng() * 6.28, rng() * 6.28, rng() * 6.28];
  const edge = (th: number) => 1 + 0.1 * Math.sin(2 * th + ph[0]) + 0.07 * Math.sin(3 * th + ph[1]) + 0.04 * Math.sin(5 * th + ph[2]);
  const a = 0.43 * W, b = 0.43 * H;
  const inClump = (p: Vec2) => {
    const x = (p.x - W / 2) / a, y = (p.y - H / 2) / b;
    return Math.hypot(x, y) < edge(Math.atan2(y, x));
  };

  // Evenly scattered points, each with its own size, over the clump and a
  // margin round it: the points outside only shape the cells at the edge.
  const d = Math.sqrt((Math.PI * a * b) / Math.max(4, wanted)) * 0.97;
  const pts: { p: Vec2; r: number }[] = [];
  for (let tries = 0; tries < 9000; tries++) {
    const p = { x: range(rng, -2 * d, W + 2 * d), y: range(rng, -2 * d, H + 2 * d) };
    const r = (d / 2) * range(rng, 0.82, 1.2);
    if (pts.every((q) => Math.hypot(q.p.x - p.x, q.p.y - p.y) >= q.r + r)) pts.push({ p, r });
  }
  const sites = pts.map((q) => q.p);
  const around = new Map<number, Vec2[]>();
  for (const [i, j, k] of delaunay(sites)) {
    const c = circumcentre(sites[i], sites[j], sites[k]);
    for (const v of [i, j, k]) around.set(v, [...(around.get(v) ?? []), c]);
  }

  const shapes: { c: Vec2; membrane: Vec2[]; nucleus: Vec2[] }[] = [];
  sites.forEach((s, i) => {
    if (!inClump(s)) return;
    const corners = around.get(i) ?? [];
    // A cell reaching far from its point was not closed in by neighbours: leave it out.
    if (corners.length < 3 || corners.some((c) => Math.hypot(c.x - s.x, c.y - s.y) > 2.2 * d)) return;
    corners.sort((p, q) => Math.atan2(p.y - s.y, p.x - s.x) - Math.atan2(q.y - s.y, q.x - s.x));
    const c = centroidOf(corners);
    const membrane = rounded(corners, 2).map((p) => ({ x: c.x + (p.x - c.x) * (1 - GAP), y: c.y + (p.y - c.y) * (1 - GAP) }));
    // A nucleus that fits: a slightly uneven ellipse well inside the nearest wall, a little off centre.
    const inradius = Math.min(...membrane.map((p) => Math.hypot(p.x - c.x, p.y - c.y)));
    const n = { x: c.x + signed(rng, 0.12) * inradius, y: c.y + signed(rng, 0.12) * inradius };
    const rx = inradius * range(rng, 0.46, 0.56), ry = inradius * range(rng, 0.46, 0.56), tilt = rng() * 6.28;
    const nucleus: Vec2[] = [];
    for (let t = 0; t < 20; t++) {
      const th = (t / 20) * Math.PI * 2;
      const x = Math.cos(th) * rx, y = Math.sin(th) * ry;
      nucleus.push({ x: n.x + x * Math.cos(tilt) - y * Math.sin(tilt), y: n.y + x * Math.sin(tilt) + y * Math.cos(tilt) });
    }
    shapes.push({ c, membrane, nucleus });
  });

  // Reading order, like an imported map.
  shapes.sort((p, q) => Math.round(p.c.y / d) - Math.round(q.c.y / d) || p.c.x - q.c.x);
  const flat = (p: Vec2[]) => p.flatMap((v) => [Math.round(v.x * 10) / 10, Math.round(v.y * 10) / 10]);
  const cells: MapCell[] = shapes.map((s, i) => ({
    id: `c${i + 1}`,
    membrane: flat(s.membrane),
    nucleus: flat(s.nucleus),
    enabled: true,
    seed: (seed * 7919 + i * 104729) >>> 0,
  }));
  const out = { name: ORGANIC_NAME, viewBox: { x: 0, y: 0, width: W, height: H }, cells };
  cache.set(key, out);
  if (cache.size > 16) cache.delete(cache.keys().next().value!);
  return out;
}
