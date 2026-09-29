import { connectCellLinks, connectCrosstalk, connectPathway, type LinkCell } from './connect';
import { decorativeReceptors, layoutPathway, pathwayGaps, REFERENCE_SHORT_SIDE, type CellFrame, type PathwayLayout } from './layout';
import { pointInPolygon, polygonArea, polygonCentroid, polygonOutline } from './polygon';
import { hash, rngFor } from './rng';
import type { CellGeom, CellMap, EdgeGeom, MapCell, NodeGeom, Outline, Pathway, ReceptorGeom, Scene, SceneGeom, Vec2 } from './types';

/** A nucleus for a cell drawn without one: the membrane shape, shrunk about its centre. */
const NUCLEUS_RATIO = 0.42;

export const mapActive = (scene: Scene) => scene.cellMap.enabled && scene.cellMap.cells.length > 0;

/** Map units → canvas pixels: the map's viewBox fitted inside the canvas, centred. */
export function mapTransform(scene: Scene) {
  const { width: W, height: H } = scene.canvas;
  const vb = scene.cellMap.viewBox;
  const k = Math.min(W / vb.width, H / vb.height);
  const ox = (W - vb.width * k) / 2 - vb.x * k, oy = (H - vb.height * k) / 2 - vb.y * k;
  return { k, map: (x: number, y: number): Vec2 => ({ x: x * k + ox, y: y * k + oy }) };
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
export function buildMapGeometry(scene: Scene): SceneGeom | null {
  const cm = scene.cellMap;
  const { map } = mapTransform(scene);
  const scale = (Math.min(scene.canvas.width, scene.canvas.height) / REFERENCE_SHORT_SIDE) * Math.max(0.05, cm.detailScale);
  const count = Math.max(1, scene.pathwayCount);

  const cells: CellGeom[] = [];
  const receptors: ReceptorGeom[] = [];
  const nodes: NodeGeom[] = [];
  const edges: EdgeGeom[] = [];
  const pathways: SceneGeom['pathways'] = [];
  const warnings = new Set<string>();
  const linkCells: LinkCell[] = [];

  for (const mc of cm.cells) {
    const mem = unflat(mc.membrane, map);
    if (mem.length < 3) continue;
    const c = polygonCentroid(mem);
    const nucPts = mc.nucleus && mc.nucleus.length >= 6
      ? unflat(mc.nucleus, map)
      : mem.map((p) => ({ x: c.x + (p.x - c.x) * NUCLEUS_RATIO, y: c.y + (p.y - c.y) * NUCLEUS_RATIO }));
    const cell = polygonOutline(mem, 96);
    const nucleus = polygonOutline(nucPts, 64);
    const R = Math.sqrt(Math.abs(polygonArea(mem)) / Math.PI);
    const frame: CellFrame = { scale, center: cell.center, R, cell, nucleus };
    cells.push({ id: mc.id, cell, nucleus, enabled: mc.enabled });

    // Per-cell variation: its own scene seed (spacing, decorative receptors)
    // and orientation, and its own seed for every shared pathway. Oriented
    // cells turn their pathways toward the widest cytoplasm.
    const cs: Scene = { ...scene, seed: hash(scene.seed, 'cell', mc.seed) };
    const spin = rngFor(scene.seed, 'cell-rotation', mc.seed)();
    cs.rotation = cm.orient
      ? roomiestRotation(cs, cell, nucleus, polygonOutline(mem, 4, nucleus.center), count) + (spin - 0.5) * 2 * ORIENT_JITTER
      : spin * 360 - 180;
    receptors.push(...decorativeReceptors(frame, cs).map((r) => ({ ...r, id: `${mc.id}-${r.id}` })));

    const layouts: PathwayLayout[] = [];
    if (mc.enabled) {
      const offset = cellOffset(scene, mc);
      const ps: Pathway[] = scene.pathways.slice(0, count).map((p) => ({
        ...p,
        id: `${mc.id}-${p.id}`,
        seed: hash(p.seed, 'cell', mc.seed),
        startDelay: p.startDelay + offset,
      }));
      ps.forEach((p, i) => {
        const l = layoutPathway(frame, cs, p, i);
        layouts.push(l);
        receptors.push(l.receptor);
        nodes.push(...l.nodes);
        l.warnings.forEach((w) => warnings.add(w));
        edges.push(...connectPathway(cs, p, l));
        pathways.push({ id: p.id, startDelay: p.startDelay });
      });
      edges.push(...connectCrosstalk(cs, layouts, ps, R));
    }
    linkCells.push({ id: mc.id, seed: mc.seed, R, points: cell.points, layouts });
  }
  edges.push(...connectCellLinks(scene, linkCells));

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

/** The map cell at a canvas point, if any. */
export function mapCellAt(scene: Scene, p: Vec2): MapCell | undefined {
  if (!mapActive(scene)) return undefined;
  const { map } = mapTransform(scene);
  return scene.cellMap.cells.find((c) => pointInPolygon(p, unflat(c.membrane, map)));
}

/** Detail size that suits a map: about the square root of its cells' size relative to the single cell. */
export function suggestedDetailScale(scene: Scene, cm: Pick<CellMap, 'viewBox' | 'cells'>): number {
  const s = { ...scene, cellMap: { ...scene.cellMap, ...cm } };
  const { map } = mapTransform(s);
  const radii = cm.cells.map((c) => Math.sqrt(Math.abs(polygonArea(unflat(c.membrane, map))) / Math.PI));
  if (!radii.length) return 0.6;
  const mean = radii.reduce((a, b) => a + b, 0) / radii.length;
  const single = scene.cell.radius * Math.min(scene.canvas.width, scene.canvas.height);
  return +Math.max(0.25, Math.min(1, Math.sqrt(mean / single))).toFixed(2);
}
