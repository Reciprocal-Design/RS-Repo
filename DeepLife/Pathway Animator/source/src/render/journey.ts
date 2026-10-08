import { organCenter } from '../core/body';
import { mapExtent, middleCellId } from '../core/cellMap';
import { buildGeometry } from '../core/geometry';
import { polygonArea } from '../core/polygon';
import { cycleTime } from '../core/timeline';
import type { Scene, Vec2 } from '../core/types';
import { drawDisplayList, type CanvasDrawOptions } from './canvas';
import { buildDisplayList } from './displayList';

// The scroll sequence: cell → tissue → body, in five sections of equal length.
//
//   1 Cell           the tissue's centre cell (on an imported SVG map, the
//                    cell nearest the map's middle), isolated and zoomed in to
//                    the single cell's size; neighbours hidden
//   2 Cell → tissue  the camera pulls back and the neighbours fade in
//   3 Tissue         the tissue round the cell
//   4 Tissue → body  the camera keeps pulling back: the tissue shrinks into
//                    the chosen organ and fades, as the body fades in round it
//   5 Body           the body, organs and their firing lines
//
// Each layer (tissue, body) is its own scene, drawn with its own signal and
// a camera transform, into an offscreen layer that is faded onto the frame.
// The tissue layer fades out towards its edges, so it never ends in a hard cut.

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export const JOURNEY_SECTIONS = ['Cell', 'Cell → tissue', 'Tissue', 'Tissue → body', 'Body'];
/** How far into its organ the body starts, at the beginning of section 4. */
const BODY_ZOOM = 8;

const scenes = new WeakMap<Scene, { tissue: Scene; body: Scene }>();
/** The journey's tissue and body scenes (memoised so their geometry and schedules are cached). */
export function journeyScenes(scene: Scene) {
  let hit = scenes.get(scene);
  if (!hit) {
    // On an imported map, the middle cell becomes the centre cell: the single
    // cell's own pathways, starting the signal that spreads to the others.
    const cm = scene.cellMap;
    const mid = cm.around ? undefined : middleCellId(scene);
    const cellMap = mid ? { ...cm, cells: cm.cells.map((c) => (c.id === mid ? { ...c, hero: true, enabled: true } : c)) } : cm;
    hit = {
      tissue: { ...scene, cellMap, module: { ...scene.module, kind: 'tissue' } },
      body: { ...scene, module: { ...scene.module, kind: 'body' } },
    };
    scenes.set(scene, hit);
  }
  return hit;
}

export const sectionLength = (scene: Scene) => Math.max(0.5, scene.module.sectionLength);

interface Camera {
  /** Screen point the layer's origin is drawn at. */
  at: Vec2;
  /** Layer point that sits at `at`. */
  origin: Vec2;
  zoom: number;
  alpha: number;
}

export interface JourneyState {
  section: number;
  tissue: Camera & { neighbours: number };
  body: Camera;
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const smooth = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
/** Smootherstep: starts and ends at rest, so a camera move eases in and out. */
const ease = (x: number) => {
  const t = clamp01(x);
  return t * t * t * (t * (6 * t - 15) + 10);
};
const lerp = (a: Vec2, b: Vec2, t: number): Vec2 => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

/** The centre cell of the journey's tissue, and the camera that shows it alone at the single cell's size. */
export function heroView(scene: Scene): { center: Vec2; zoom: number } {
  const { tissue } = journeyScenes(scene);
  const C = { x: scene.canvas.width / 2, y: scene.canvas.height / 2 };
  const k = Math.max(0.05, scene.cellMap.detailScale);
  const hero = buildGeometry(tissue).cells.find((c) => c.hero);
  // A generated tissue's centre cell is the single cell scaled by k about the canvas centre.
  if (!hero || scene.cellMap.around) return { center: C, zoom: 1 / k };
  const R = Math.sqrt(Math.abs(polygonArea(hero.cell.points)) / Math.PI);
  const single = scene.cell.radius * Math.min(scene.canvas.width, scene.canvas.height);
  return { center: hero.cell.center, zoom: Math.max(1, single / Math.max(1, R)) };
}

/** Cameras and fades at journey time tau (seconds from the start). Pure. */
export function journeyState(scene: Scene, tau: number): JourneyState {
  const L = sectionLength(scene);
  const C = { x: scene.canvas.width / 2, y: scene.canvas.height / 2 };
  const A = organCenter(scene, scene.module.organ);
  const hero = heroView(scene);
  const section = Math.max(0, Math.min(4, Math.floor(tau / L)));
  const u = clamp01((tau - section * L) / L);

  const tissue = { at: C, origin: C, zoom: 1, alpha: 1, neighbours: 1 };
  const body = { at: C, origin: A, zoom: BODY_ZOOM, alpha: 0 };
  if (section === 0) {
    // The centre cell alone, centred, at the single cell's size.
    tissue.origin = hero.center;
    tissue.zoom = hero.zoom;
    tissue.neighbours = 0;
  } else if (section === 1) {
    const e = ease(u);
    tissue.origin = lerp(hero.center, C, e);
    tissue.zoom = hero.zoom ** (1 - e); // even zoom speed on a log scale
    tissue.neighbours = smooth(0.1, 0.8, u);
  } else if (section === 3) {
    const e = ease(u);
    body.zoom = BODY_ZOOM ** (1 - e);
    body.at = lerp(C, A, e);
    body.alpha = smooth(0.1, 0.6, u);
    tissue.zoom = body.zoom / BODY_ZOOM;
    tissue.at = body.at;
    tissue.alpha = 1 - smooth(0.15, 0.6, u);
  } else if (section === 4) {
    body.zoom = 1;
    body.at = A;
    body.alpha = 1;
    // Faded out, but where section 4 left it.
    tissue.zoom = 1 / BODY_ZOOM;
    tissue.at = A;
    tissue.alpha = 0;
  }
  return { section, tissue, body };
}

/** Reused offscreen layers, one per role, at the output's device size. */
const layers = new Map<string, OffscreenCanvas | HTMLCanvasElement>();
function layer(role: string, width: number, height: number) {
  let c = layers.get(role);
  if (!c || c.width !== width || c.height !== height) {
    c = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(width, height) : Object.assign(document.createElement('canvas'), { width, height });
    layers.set(role, c);
  }
  return c;
}

const cameraMatrix = (base: DOMMatrix, cam: Camera) =>
  base.multiply(new DOMMatrix().translate(cam.at.x, cam.at.y).scale(cam.zoom).translate(-cam.origin.x, -cam.origin.y));

/** Share of the tissue's half-size (centre to edge) that stays fully visible before its edge fades out. */
const EDGE_FADE_START = 0.62;

/**
 * One layer: the scene drawn through its camera onto a transparent offscreen
 * bitmap. With `edge`, the layer fades out towards that rectangle's edges
 * (an elliptical vignette, in scene coordinates, so it moves with the camera).
 */
function drawLayer(
  role: string, ctx: Ctx, scene: Scene, t: number, m: DOMMatrix, linkAlpha = 1,
  edge?: { x: number; y: number; w: number; h: number },
  others?: { keep: string; alpha: number },
) {
  const { width, height } = ctx.canvas;
  const c = layer(role, width, height);
  const off = c.getContext('2d') as Ctx;
  off.setTransform(1, 0, 0, 1, 0, 0);
  off.clearRect(0, 0, width, height);
  off.setTransform(m);
  drawDisplayList(off, buildDisplayList(scene, t, { linkAlpha, others }), { transparent: true });
  if (edge) {
    off.save();
    off.setTransform(m.translate(edge.x + edge.w / 2, edge.y + edge.h / 2).scale((edge.w / 2) * 1.15, (edge.h / 2) * 1.15));
    const g = off.createRadialGradient(0, 0, 0, 0, 0, 1);
    g.addColorStop(0, 'rgba(0,0,0,1)');
    g.addColorStop(EDGE_FADE_START, 'rgba(0,0,0,1)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    off.globalCompositeOperation = 'destination-in';
    off.fillStyle = g;
    off.fillRect(-4, -4, 8, 8);
    off.restore();
  }
  return c;
}

export function drawJourney(ctx: Ctx, scene: Scene, t: number, opts: CanvasDrawOptions = {}): void {
  const tau = cycleTime(scene, t);
  const st = journeyState(scene, tau);
  const { tissue, body } = journeyScenes(scene);
  const base = ctx.getTransform();

  ctx.save();
  if (opts.transparent) {
    ctx.clearRect(0, 0, scene.canvas.width, scene.canvas.height);
  } else {
    ctx.fillStyle = scene.canvas.background;
    ctx.fillRect(0, 0, scene.canvas.width, scene.canvas.height);
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);

  if (st.tissue.alpha > 0.001) {
    // The centre cell alone at first: the other cells, and the links to them,
    // fade in with the neighbours.
    const hero = buildGeometry(tissue).cells.find((c) => c.hero);
    const n = st.tissue.neighbours;
    const img = drawLayer('tissue', ctx, tissue, t, cameraMatrix(base, st.tissue), n, mapExtent(tissue),
      hero && n < 1 ? { keep: hero.id, alpha: n } : undefined);
    ctx.globalAlpha = st.tissue.alpha;
    ctx.drawImage(img, 0, 0);
  }
  if (st.body.alpha > 0.001) {
    const img = drawLayer('body', ctx, body, t, cameraMatrix(base, st.body));
    ctx.globalAlpha = st.body.alpha;
    ctx.drawImage(img, 0, 0);
  }
  ctx.restore();
}
