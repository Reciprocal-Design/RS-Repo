import { makeOutline } from './outline';
import { hash, range, rngFor, signed } from './rng';
import type { MapCell, Outline, Scene, Vec2 } from './types';

// A tissue built around the single cell: the same cell (outline, nucleus and
// pathways) at the centre, scaled by the map's cell size, with neighbouring
// cells packed round it out to the canvas edges. Generated from the scene, so
// it follows the centre cell when the seed, shape or canvas changes.

export interface TissueCell {
  mc: MapCell;
  cell: Outline;
  nucleus: Outline;
  /** Nominal radius (px). */
  R: number;
  /** The membrane as drawn or imported, for orienting pathways. */
  polygon: Vec2[];
}

const MAX_CELLS = 40;
const CANDIDATES = 1500;

const flat = (pts: Vec2[]) => pts.flatMap((p) => [Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10]);

const cache = new WeakMap<Scene, TissueCell[]>();

/**
 * Every cell of the tissue, the centre cell first (`hero`). Neighbours are
 * placed greedily outward from the centre, each a little smaller than the
 * centre cell, never overlapping, and only where some of it is on the canvas.
 * Pathways on/off and per-cell seeds are kept from the stored cells by id.
 */
export function tissueCells(scene: Scene): TissueCell[] {
  const hit = cache.get(scene);
  if (hit) return hit;

  // The tissue fills the canvas, or the part of it the map is given (`frame`).
  const f = scene.cellMap.frame ?? { x: 0, y: 0, w: scene.canvas.width, h: scene.canvas.height };
  const X = f.x, Y = f.y, W = f.w, H = f.h;
  const S = Math.min(scene.canvas.width, scene.canvas.height);
  const center = { x: X + W / 2, y: Y + H / 2 };
  const R = scene.cell.radius * S * Math.max(0.05, scene.cellMap.detailScale);
  const stored = new Map(scene.cellMap.cells.map((c) => [c.id, c]));

  const out: TissueCell[] = [];
  const add = (c: Vec2, r: number, membraneSeed: number, nucleusSeed: number, offset: Vec2, hero: boolean) => {
    const cell = makeOutline(c, r, scene.cell.wobble, membraneSeed);
    const nc = { x: c.x + offset.x * r, y: c.y + offset.y * r };
    const nucleus = makeOutline(nc, r * scene.nucleus.radiusRatio, scene.nucleus.wobble, nucleusSeed);
    const id = `c${out.length + 1}`;
    const prev = stored.get(id);
    out.push({
      mc: {
        id,
        membrane: flat(cell.points),
        nucleus: flat(nucleus.points),
        enabled: prev?.enabled ?? true,
        seed: prev?.seed ?? hash(scene.seed, 'tissue-cell', out.length),
        ...(hero ? { hero: true } : {}),
      },
      cell,
      nucleus,
      R: r,
      polygon: cell.points,
    });
  };

  // The centre cell: exactly the single cell's outlines, scaled about the canvas centre.
  add(center, R, hash(scene.seed, 'membrane'), hash(scene.seed, 'nucleus'), scene.nucleus.offset, true);

  // Neighbours. Outlines bulge up to 14% × wobble past their radius, so keep
  // that clear, plus a thin gap.
  const bulge = 1 + 0.14 * Math.max(0, scene.cell.wobble);
  const gap = 0.05 * R;
  const placed = [{ c: center, r: R * bulge }];
  const rng = rngFor(scene.seed, 'tissue');
  const cands: { c: Vec2; r: number; d: number }[] = [];
  for (let i = 0; i < CANDIDATES; i++) {
    const c = { x: X + range(rng, -R, W + R), y: Y + range(rng, -R, H + R) };
    cands.push({ c, r: R * range(rng, 0.68, 0.9), d: Math.hypot(c.x - center.x, c.y - center.y) });
  }
  cands.sort((a, b) => a.d - b.d);
  for (const q of cands) {
    if (out.length >= MAX_CELLS) break;
    const rr = q.r * bulge;
    // Some of the cell must be on the canvas; all of it, when the tissue has its own part of the canvas.
    if (q.c.x + rr < X || q.c.x - rr > X + W || q.c.y + rr < Y || q.c.y - rr > Y + H) continue;
    if (scene.cellMap.frame && (q.c.x - rr < X || q.c.x + rr > X + W || q.c.y - rr < Y || q.c.y + rr > Y + H)) continue;
    if (!placed.every((p) => Math.hypot(p.c.x - q.c.x, p.c.y - q.c.y) >= p.r + rr + gap)) continue;
    placed.push({ c: q.c, r: rr });
    const i = out.length;
    const o = rngFor(scene.seed, 'tissue-nucleus', i);
    add(q.c, q.r, hash(scene.seed, 'tissue-membrane', i), hash(scene.seed, 'tissue-nucleus', i), { x: signed(o, 0.08), y: signed(o, 0.08) }, false);
  }

  cache.set(scene, out);
  return out;
}
