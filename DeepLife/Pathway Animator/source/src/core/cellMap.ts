import { connectCellLinks, connectCrosstalk, connectPathway, type LinkCell } from './connect';
import { decorativeReceptors, layoutPathway, pathwayGaps, REFERENCE_SHORT_SIDE, type CellFrame, type PathwayLayout } from './layout';
import { varyLayers } from './layers';
import { pointInPolygon, polygonArea, polygonCentroid, polygonOutline } from './polygon';
import { hash, rngFor } from './rng';
import { tissueCells, type TissueCell } from './tissue';
import type { CellGeom, CellMap, EdgeGeom, MapCell, NodeGeom, Outline, Pathway, ReceptorGeom, Scene, SceneGeom, Vec2 } from './types';

/** A nucleus for a cell drawn without one: the membrane shape, shrunk about its centre. */
const NUCLEUS_RATIO = 0.42;

export const mapActive = (scene: Scene) => scene.cellMap.enabled && (scene.cellMap.around || scene.cellMap.cells.length > 0);

/** The selected cell of an imported map, if it has one. */
export const heroCellOf = (cm: CellMap): MapCell | undefined =>
  cm.around || !cm.heroId ? undefined : cm.cells.find((c) => c.id === cm.heroId);

/** Is the map showing only its selected cell, as the single cell? */
export const soloActive = (scene: Scene) => mapActive(scene) && scene.cellMap.solo && !!heroCellOf(scene.cellMap);

/**
 * The map's cells: as imported (only the selected one, in a solo view), or
 * the tissue generated round the single cell.
 */
export function mapCells(scene: Scene): MapCell[] {
  const cm = scene.cellMap;
  if (cm.around) return tissueCells(scene).map((t) => t.mc);
  const hero = cm.solo ? heroCellOf(cm) : undefined;
  return hero ? [hero] : cm.cells;
}

/** A cell's radius in map units: that of the circle with its area. */
function cellRadius(c: MapCell): number {
  let a = 0;
  const m = c.membrane, n = m.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) a += m[2 * j] * m[2 * i + 1] - m[2 * i] * m[2 * j + 1];
  return Math.sqrt(Math.abs(a / 2) / Math.PI);
}
const radii = new WeakMap<MapCell[], number>();
function meanRadius(cm: CellMap): number {
  let hit = radii.get(cm.cells);
  if (hit === undefined) {
    hit = cm.cells.reduce((s, c) => s + cellRadius(c), 0) / Math.max(1, cm.cells.length);
    radii.set(cm.cells, hit);
  }
  return hit;
}

const boxes = new WeakMap<MapCell[], CellMap['viewBox']>();
/** The area the map's cells cover, padded by 4% (map units). */
function cellsBox(cm: CellMap): CellMap['viewBox'] {
  let hit = boxes.get(cm.cells);
  if (!hit) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const c of cm.cells) {
      for (let i = 0; i + 1 < c.membrane.length; i += 2) {
        x0 = Math.min(x0, c.membrane[i]);
        x1 = Math.max(x1, c.membrane[i]);
        y0 = Math.min(y0, c.membrane[i + 1]);
        y1 = Math.max(y1, c.membrane[i + 1]);
      }
    }
    if (!(x1 > x0 && y1 > y0)) return cm.viewBox;
    const pad = 0.04 * Math.max(x1 - x0, y1 - y0);
    hit = { x: x0 - pad, y: y0 - pad, width: x1 - x0 + 2 * pad, height: y1 - y0 + 2 * pad };
    boxes.set(cm.cells, hit);
  }
  return hit;
}

/**
 * Map units → canvas pixels. The map's viewBox is fitted inside the canvas
 * (or the map's own part of it, `frame`), centred; with `centerHero` the
 * selected cell is put in the middle instead. A solo view fits the selected
 * cell alone, at the single cell's size. A tissue is in canvas pixels.
 */
export function mapTransform(scene: Scene) {
  const cm = scene.cellMap;
  if (cm.around) return { k: 1, zoom: 1, map: (x: number, y: number): Vec2 => ({ x, y }) };
  const f = cm.frame ?? { x: 0, y: 0, w: scene.canvas.width, h: scene.canvas.height };
  // Given its own part of the canvas, the map is fitted by what its cells
  // cover (a little padded), not by the SVG's whole page.
  const vb = cm.frame ? cellsBox(cm) : cm.viewBox;
  const hero = heroCellOf(cm);
  let k = Math.min(f.w / vb.width, f.h / vb.height);
  // The map point that sits at the middle of the frame.
  let mx = vb.x + vb.width / 2, my = vb.y + vb.height / 2;
  if (hero && (cm.solo || cm.centerHero)) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i + 1 < hero.membrane.length; i += 2) {
      x0 = Math.min(x0, hero.membrane[i]);
      x1 = Math.max(x1, hero.membrane[i]);
      y0 = Math.min(y0, hero.membrane[i + 1]);
      y1 = Math.max(y1, hero.membrane[i + 1]);
    }
    mx = (x0 + x1) / 2;
    my = (y0 + y1) / 2;
    // Solo: the cell spans what the single cell does (twice its radius).
    if (cm.solo) k = (2 * scene.cell.radius * Math.min(f.w, f.h)) / Math.max(1e-6, x1 - x0, y1 - y0);
  }
  // Zoomed in on the selected cell: it, and `rings` cells beyond it, span the canvas's short side.
  let zoom = 1;
  if (hero && cm.centerHero && !cm.solo && cm.rings > 0) {
    const kz = Math.min(f.w, f.h) / 2 / (cellRadius(hero) + cm.rings * 2 * meanRadius(cm));
    if (kz > k) (zoom = kz / k), (k = kz);
  }
  const ox = f.x + f.w / 2 - mx * k, oy = f.y + f.h / 2 - my * k;
  return { k, zoom, map: (x: number, y: number): Vec2 => ({ x: x * k + ox, y: y * k + oy }) };
}

const unflat = (a: number[], map: (x: number, y: number) => Vec2) => {
  const out: Vec2[] = [];
  for (let i = 0; i + 1 < a.length; i += 2) out.push(map(a[i], a[i + 1]));
  return out;
};

/** Degrees an oriented cell may turn away from its roomiest direction, so similar cells still differ. */
const ORIENT_JITTER = 8;

/**
 * The cell rotation (degrees) that puts its pathways where there is most room:
 * each pathway runs from its receptor on the membrane to the nucleus, so the
 * room it has is the cytoplasm between them. Room is averaged over a spread
 * of directions around each pathway (a pathway fans out), and summed over the
 * pathways, which keep their spacing (pathwayGaps) as the cell turns.
 */
export function roomiestRotation(cs: Scene, cell: Outline, nucleus: Outline, membraneFromNucleus: Outline, count: number): number {
  const N = nucleus.center;
  const room = (phi: number) => {
    // The receptor sits on the membrane at angle phi from the cell centre.
    const px = cell.center.x + Math.cos(phi) * cell.radiusAt(phi);
    const py = cell.center.y + Math.sin(phi) * cell.radiusAt(phi);
    const th = Math.atan2(py - N.y, px - N.x);
    // Cytoplasm depth from there to the nucleus, and across the pathway's fan.
    let sum = 0;
    for (const d of [-0.5, -0.25, 0, 0.25, 0.5]) sum += Math.max(0, membraneFromNucleus.radiusAt(th + d) - nucleus.radiusAt(th + d));
    return sum;
  };
  const gaps = pathwayGaps({ ...cs, pathwayCount: count });
  let best = 0, bestScore = -Infinity;
  for (let r = -180; r < 180; r += 3) {
    let a = ((r - 90) * Math.PI) / 180, score = 0;
    for (let i = 0; i < count; i++) {
      score += room(a);
      a += gaps[i % gaps.length];
    }
    if (score > bestScore) (bestScore = score), (best = r);
  }
  return best;
}

/** Seconds a cell's pathways start after the scene begins (random, within the stagger). */
export const cellOffset = (scene: Scene, cell: MapCell) =>
  Math.max(0, scene.cellMap.stagger) * rngFor(scene.seed, 'cell-offset', cell.seed)();

/**
 * Each cell of the map is laid out like the single cell, with its own frame
 * (membrane, nucleus, size) and its own seed, so the shared pathway settings
 * give every cell a different network. Sizes are scaled by the map's detail
 * size, since map cells are much smaller than the single cell.
 */
/** Imported cells as outlines: polygons smoothed, a nucleus made where a cell has none. */
function importedCells(scene: Scene): TissueCell[] {
  const { map } = mapTransform(scene);
  const heroId = heroCellOf(scene.cellMap)?.id;
  const out: TissueCell[] = [];
  for (const cell of mapCells(scene)) {
    // The selected cell is the centre cell (and is never switched off).
    const mc = cell.id === heroId ? { ...cell, hero: true, enabled: true } : cell;
    const mem = unflat(mc.membrane, map);
    if (mem.length < 3) continue;
    const c = polygonCentroid(mem);
    const nucPts = mc.nucleus && mc.nucleus.length >= 6
      ? unflat(mc.nucleus, map)
      : mem.map((p) => ({ x: c.x + (p.x - c.x) * NUCLEUS_RATIO, y: c.y + (p.y - c.y) * NUCLEUS_RATIO }));
    out.push({
      mc,
      cell: polygonOutline(mem, 96),
      nucleus: polygonOutline(nucPts, 64),
      R: Math.sqrt(Math.abs(polygonArea(mem)) / Math.PI),
      polygon: mem,
    });
  }
  return out;
}

export interface MapBuildOptions {
  /** Prefix for every id (a second tissue beside the first). */
  prefix?: string;
  /** No pathway starts on its own: the tissue waits for a signal from outside. */
  noStart?: boolean;
  /** Membrane glow colour for every cell, when not the scene's. */
  glow?: string;
  /** Links run away from this point (when the tissue has no centre cell). */
  linkOrigin?: Vec2;
  /** Collects the cells as laid out, for linking tissues to each other. */
  collect?: LinkCell[];
}

/**
 * In a tissue, the centre cell (`hero`) is the single cell itself: the
 * scene's own seed and pathways, unvaried, starting on its own like the
 * single cell does, so it matches the other views. In a generated tissue it
 * takes the scene's rotation exactly; a selected cell of an imported map is
 * first turned toward its widest cytoplasm (its shape is its own), then by
 * the scene's rotation.
 */
export function buildMapGeometry(scene: Scene, opts: MapBuildOptions = {}): SceneGeom | null {
  const cm = scene.cellMap;
  const pre = opts.prefix ?? '';
  // A solo view is the single cell: full-size detail. Zoomed in on the
  // selected cell, detail grows with the cells (up to full size).
  const detail = soloActive(scene) ? 1 : Math.min(1, Math.max(0.05, cm.detailScale) * mapTransform(scene).zoom);
  const scale = (Math.min(scene.canvas.width, scene.canvas.height) / REFERENCE_SHORT_SIDE) * detail;
  const count = Math.max(1, scene.pathwayCount);

  const cells: CellGeom[] = [];
  const receptors: ReceptorGeom[] = [];
  const nodes: NodeGeom[] = [];
  const edges: EdgeGeom[] = [];
  const pathways: SceneGeom['pathways'] = [];
  const warnings = new Set<string>();
  const linkCells: LinkCell[] = [];

  const prepared = cm.around ? tissueCells(scene) : importedCells(scene);
  for (const { mc: mc0, cell, nucleus, R, polygon } of prepared) {
    const mc = pre ? { ...mc0, id: `${pre}${mc0.id}` } : mc0;
    const frame: CellFrame = { scale, center: cell.center, R, cell, nucleus };
    const hero = !!mc.hero;
    cells.push({ id: mc.id, cell, nucleus, enabled: mc.enabled, ...(hero ? { hero } : {}), ...(opts.glow ? { glow: opts.glow } : {}) });

    // Per-cell variation: its own scene seed (spacing, decorative receptors)
    // and orientation, and its own seed for every shared pathway. Oriented
    // cells turn their pathways toward the widest cytoplasm.
    let cs: Scene = hero ? scene : { ...scene, seed: hash(scene.seed, 'cell', mc.seed) };
    if (!hero) {
      const spin = rngFor(scene.seed, 'cell-rotation', mc.seed)();
      cs.rotation = cm.orient
        ? roomiestRotation(cs, cell, nucleus, polygonOutline(polygon, 4, nucleus.center), count) + (spin - 0.5) * 2 * ORIENT_JITTER
        : spin * 360 - 180;
    } else if (!cm.around && cm.orient) {
      cs = { ...scene, rotation: roomiestRotation(scene, cell, nucleus, polygonOutline(polygon, 4, nucleus.center), count) + scene.rotation };
    }
    receptors.push(...decorativeReceptors(frame, cs).map((r) => ({ ...r, id: `${mc.id}-${r.id}` })));

    const layouts: PathwayLayout[] = [];
    if (mc.enabled) {
      const offset = hero ? 0 : cellOffset(scene, mc);
      const ps: Pathway[] = scene.pathways.slice(0, count).map((p) =>
        hero
          ? (pre ? { ...p, id: `${pre}${p.id}` } : p)
          : {
            ...p,
            id: `${mc.id}-${p.id}`,
            seed: hash(p.seed, 'cell', mc.seed),
            startDelay: p.startDelay + offset,
            // Each cell's own node and layer counts, drifting from the shared ones.
            layers: varyLayers(p.layers, cm.variation, rngFor(scene.seed, 'cell-layers', mc.seed, p.id)),
          });
      ps.forEach((p, i) => {
        const l = layoutPathway(frame, cs, p, i);
        layouts.push(l);
        receptors.push(l.receptor);
        nodes.push(...l.nodes);
        l.warnings.forEach((w) => warnings.add(w));
        edges.push(...connectPathway(cs, p, l));
        const own = !opts.noStart && (hero || rngFor(scene.seed, 'cell-start', mc0.seed, p.id)() < cm.startShare);
        pathways.push({ id: p.id, startDelay: p.startDelay, relayOnly: !own });
      });
      edges.push(...connectCrosstalk(cs, layouts, ps, R));
    }
    linkCells.push({ id: mc.id, seed: mc.seed, R, points: cell.points, layouts, frame, scene: cs });
  }
  // At least one pathway starts on its own, or nothing would ever happen.
  if (!opts.noStart && pathways.length && pathways.every((p) => p.relayOnly)) pathways[0].relayOnly = false;
  // A tissue's cells sit a little apart, so neighbours may link across a wider
  // gap. Where there is a centre cell, links run outward from it, so its signal spreads.
  const heroCell = cells.find((c) => c.hero);
  const origin = heroCell && !opts.noStart ? heroCell.cell.center : opts.linkOrigin;
  const links = connectCellLinks(scene, linkCells, {
    ...(cm.around ? { reach: 0.6 } : {}),
    ...(origin ? { origin } : {}),
  });
  opts.collect?.push(...linkCells);
  edges.push(...links.edges);
  nodes.push(...links.nodes);
  // Relay receptors take the place of any decorative receptor they would overlap.
  const clear = 1.6 * scene.style.receptorSize.length * scale;
  const keep = (r: ReceptorGeom) =>
    r.pathwayId !== null || links.receptors.every((q) => Math.hypot(q.center.x - r.center.x, q.center.y - r.center.y) >= clear);
  receptors.splice(0, receptors.length, ...receptors.filter(keep), ...links.receptors);

  const first = cells[0];
  if (!first) return null;
  return {
    scale,
    cell: first.cell,
    nucleus: first.nucleus,
    cells,
    pathways,
    receptors,
    nodes,
    nodeById: new Map(nodes.map((n) => [n.id, n])),
    edges,
    warnings: [...warnings],
  };
}

/** The cell of an imported map nearest the middle of the map (its centroid nearest the map's centre). */
export function middleCellId(scene: Scene): string | undefined {
  const cm = scene.cellMap;
  if (!cm.cells.length) return undefined;
  const { map } = mapTransform(scene);
  const vb = cm.viewBox;
  const mid = map(vb.x + vb.width / 2, vb.y + vb.height / 2);
  let best: string | undefined, bd = Infinity;
  for (const c of cm.cells) {
    const p = polygonCentroid(unflat(c.membrane, map));
    const d = Math.hypot(p.x - mid.x, p.y - mid.y);
    if (d < bd) (bd = d), (best = c.id);
  }
  return best;
}

/** The map's own extent on the canvas: the fitted viewBox, or the whole canvas for a tissue. */
export function mapExtent(scene: Scene) {
  const { width: W, height: H } = scene.canvas;
  if (scene.cellMap.around) return { x: 0, y: 0, w: W, h: H };
  const { map } = mapTransform(scene);
  const vb = scene.cellMap.viewBox;
  const a = map(vb.x, vb.y), b = map(vb.x + vb.width, vb.y + vb.height);
  // Centred on the selected cell, the map may run off one side: the extent
  // (used to soften the tissue's edge) stays centred on the canvas, wide
  // enough to reach the map's far side.
  if (scene.cellMap.centerHero && heroCellOf(scene.cellMap)) {
    const hw = Math.max(W / 2 - a.x, b.x - W / 2), hh = Math.max(H / 2 - a.y, b.y - H / 2);
    return { x: W / 2 - hw, y: H / 2 - hh, w: 2 * hw, h: 2 * hh };
  }
  return { x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y };
}

/** The map cell at a canvas point, if any. */
export function mapCellAt(scene: Scene, p: Vec2): MapCell | undefined {
  if (!mapActive(scene)) return undefined;
  const { map } = mapTransform(scene);
  return mapCells(scene).find((c) => pointInPolygon(p, unflat(c.membrane, map)));
}

/** Detail size that suits a map: about the square root of its cells' size relative to the single cell. */
export function suggestedDetailScale(scene: Scene, cm: Pick<CellMap, 'viewBox' | 'cells'> & Pick<Partial<CellMap>, 'frame'>): number {
  const s = { ...scene, cellMap: { ...scene.cellMap, ...cm } };
  const { map } = mapTransform(s);
  const radii = cm.cells.map((c) => Math.sqrt(Math.abs(polygonArea(unflat(c.membrane, map))) / Math.PI));
  if (!radii.length) return 0.6;
  const mean = radii.reduce((a, b) => a + b, 0) / radii.length;
  const single = scene.cell.radius * Math.min(scene.canvas.width, scene.canvas.height);
  return +Math.max(0.25, Math.min(1, Math.sqrt(mean / single))).toFixed(2);
}
