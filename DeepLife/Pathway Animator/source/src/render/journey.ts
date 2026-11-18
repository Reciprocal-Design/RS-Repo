import { bodyTransform, organCenter } from '../core/body';
import { heroCellOf, mapExtent, middleCellId } from '../core/cellMap';
import { buildGeometry } from '../core/geometry';
import { pointInPolygon, polygonArea } from '../core/polygon';
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
//   4 Tissue → body  the camera keeps pulling back: the whole tissue shrinks
//                    into one dot of the body, on the chosen organ, as the
//                    body fades in round it
//   5 Body           the body and its dots, firing without lines between
//                    them, the tissue still alive inside its dot
//
// Each layer (tissue, body) is its own scene, drawn with its own signal and
// a camera transform, into an offscreen layer that is faded onto the frame.
// The tissue layer fades out towards its edges, so it never ends in a hard cut.
//
// On a portrait canvas (desktop, beside text) the cell and tissue are the
// landscape composition turned 90°: the tissue is laid out on the canvas
// with its sides swapped, and its camera turns it onto the frame. The body
// is laid out on the portrait canvas itself.

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export const JOURNEY_SECTIONS = ['Cell', 'Cell → tissue', 'Tissue', 'Tissue → body', 'Body'];
/** The dot that holds the tissue: its radius as a share of the body's height. */
const DOT_SIZE = 0.03;
/** The whole tissue's radius as a share of the dot's, once it is inside. */
const DOT_FILL = 0.94;
/** Share of section 4 by which the whole tissue has come inside the dot. */
const DOT_SETTLE = 0.5;

const scenes = new WeakMap<Scene, { tissue: Scene; body: Scene }>();
/** A portrait canvas: the cell and tissue are turned 90° onto it. */
export const isPortrait = (scene: Scene) => scene.canvas.height > scene.canvas.width;

/** The journey's tissue and body scenes (memoised so their geometry and schedules are cached). */
export function journeyScenes(scene: Scene) {
  let hit = scenes.get(scene);
  if (!hit) {
    // On an imported map, the middle cell becomes the centre cell: the single
    // cell's own pathways, starting the signal that spreads to the others.
    const cm = scene.cellMap;
    const { width, height } = scene.canvas;
    const canvas = isPortrait(scene) ? { ...scene.canvas, width: height, height: width } : scene.canvas;
    // The selected cell, or failing that the one nearest the middle of the map.
    const mid = cm.around ? undefined : heroCellOf(cm)?.id ?? middleCellId({ ...scene, canvas });
    const cellMap = mid ? { ...cm, heroId: mid, solo: false, centerHero: false } : cm;
    hit = {
      tissue: { ...scene, canvas, cellMap, module: { ...scene.module, kind: 'tissue' } },
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
  /** Turn the layer 90° clockwise about `origin` (the tissue on a portrait canvas). */
  turn?: boolean;
}

export interface JourneyState {
  section: number;
  tissue: Camera & { neighbours: number };
  body: Camera;
  /** The dot round the tissue, on screen (none before section 4). */
  dot: { at: Vec2; r: number; alpha: number };
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

/** Share of the frame kept clear round the centre cell in section 1 (each side). */
const HERO_MARGIN = 0.05;

/**
 * The centre cell of the journey's tissue, and the camera that shows it alone
 * at the single cell's size: centred on its bounding box, and zoomed out if
 * need be so the whole cell, receptors included, fits the frame with a margin
 * (an imported cell is rarely round, so its area alone would let a long or
 * angular cell run off the top and bottom).
 */
export function heroView(scene: Scene): { center: Vec2; zoom: number } {
  const { tissue } = journeyScenes(scene);
  const C = { x: tissue.canvas.width / 2, y: tissue.canvas.height / 2 };
  const k = Math.max(0.05, scene.cellMap.detailScale);
  const g = buildGeometry(tissue);
  const hero = g.cells.find((c) => c.hero);
  // A generated tissue's centre cell is the single cell scaled by k about the canvas centre.
  const generated = !hero || scene.cellMap.around;
  const cell = generated
    ? g.cells.reduce<(typeof g.cells)[number] | undefined>((best, c) =>
      !best || Math.hypot(c.cell.center.x - C.x, c.cell.center.y - C.y) < Math.hypot(best.cell.center.x - C.x, best.cell.center.y - C.y) ? c : best, undefined)
    : hero;
  if (!cell) return { center: C, zoom: 1 / k };
  const single = scene.cell.radius * Math.min(scene.canvas.width, scene.canvas.height);
  const want = generated ? 1 / k : Math.max(1, single / Math.max(1, Math.sqrt(Math.abs(polygonArea(cell.cell.points)) / Math.PI)));

  // The cell's extent, receptors included (a capsule sits across the membrane,
  // reaching out about half its length; a little more for its stroke).
  const out = 0.6 * scene.style.receptorSize.length * g.scale;
  const xs = cell.cell.points.map((p) => p.x), ys = cell.cell.points.map((p) => p.y);
  const x0 = Math.min(...xs) - out, x1 = Math.max(...xs) + out, y0 = Math.min(...ys) - out, y1 = Math.max(...ys) + out;
  const center = generated ? C : { x: (x0 + x1) / 2, y: (y0 + y1) / 2 };
  // The frame as the tissue sees it (sides swapped when the tissue is turned onto a portrait frame).
  const turned = isPortrait(scene);
  const fw = turned ? scene.canvas.height : scene.canvas.width, fh = turned ? scene.canvas.width : scene.canvas.height;
  const halfW = Math.max(center.x - x0, x1 - center.x), halfH = Math.max(center.y - y0, y1 - center.y);
  const fit = Math.min((fw * (0.5 - HERO_MARGIN)) / halfW, (fh * (0.5 - HERO_MARGIN)) / halfH);
  return { center, zoom: Math.min(want, fit) };
}

/**
 * How far into the tissue layer's soft edge the frame may reach, as a share of
 * the vignette's radius: the layer is fully opaque out to EDGE_FADE_START and
 * still about three-quarters opaque here, so at most the corners darken a touch.
 */
const FILL_REACH = 0.72;
const tissueViews = new WeakMap<Scene, { center: Vec2; zoom: number }>();

/**
 * The camera for the tissue section: centred on the centre cell, zoomed in
 * just enough that tissue fills the whole frame (no edge of the tissue layer,
 * and on an imported map no background beyond its cells, shows), then scaled
 * by the "Tissue zoom" setting. Never closer than the cell shot, so the
 * camera always pulls back from the cell into the tissue.
 */
export function tissueView(scene: Scene): { center: Vec2; zoom: number } {
  const hit = tissueViews.get(scene);
  if (hit) return hit;
  const { tissue } = journeyScenes(scene);
  const hero = heroView(scene);
  const g = buildGeometry(tissue);
  const center = scene.cellMap.around ? { x: tissue.canvas.width / 2, y: tissue.canvas.height / 2 } : hero.center;
  const turned = isPortrait(scene);
  const fw = turned ? scene.canvas.height : scene.canvas.width, fh = turned ? scene.canvas.width : scene.canvas.height;
  // The layer's soft edge (see drawLayer), and on a map the cells themselves.
  const e = mapExtent(tissue);
  const ex = e.x + e.w / 2, ey = e.y + e.h / 2, ea = (e.w / 2) * 1.15, eb = (e.h / 2) * 1.15;
  const map = !scene.cellMap.around;
  const radii = g.cells.map((c) => Math.sqrt(Math.abs(polygonArea(c.cell.points)) / Math.PI)).sort((a, b) => a - b);
  const gap = 0.3 * (radii[Math.floor(radii.length / 2)] ?? 0); // walls between cells may have a thin gap
  const nearCell = (p: Vec2) => g.cells.some((c) => pointInPolygon(p, c.cell.points)
    || c.cell.points.some((q) => Math.hypot(q.x - p.x, q.y - p.y) < gap));
  const covered = (z: number) => {
    const hw = fw / 2 / z, hh = fh / 2 / z;
    for (let i = 0; i <= 6; i++) {
      for (let j = 0; j <= 6; j++) {
        const p = { x: center.x + hw * (i / 3 - 1), y: center.y + hh * (j / 3 - 1) };
        if (Math.hypot((p.x - ex) / ea, (p.y - ey) / eb) > FILL_REACH) return false;
        if (map && !nearCell(p)) return false;
      }
    }
    return true;
  };
  let fill = 1;
  while (fill < hero.zoom && !covered(fill)) fill *= 1.02;
  const zoom = Math.min(hero.zoom, Math.max(1e-3, fill * Math.max(0.1, scene.module.tissueZoom ?? 1)));
  const view = { center, zoom };
  tissueViews.set(scene, view);
  return view;
}

/** The body's dot that holds the tissue, and the tissue's centre and radius as it sits inside. */
export function tissueDot(scene: Scene) {
  const { tissue } = journeyScenes(scene);
  const e = mapExtent(tissue);
  return {
    c: organCenter(scene, scene.module.organ),
    r: DOT_SIZE * bodyTransform(scene).h,
    tissueCenter: { x: e.x + e.w / 2, y: e.y + e.h / 2 },
    tissueRadius: Math.max(e.w, e.h) / 2,
  };
}

/** Cameras and fades at journey time tau (seconds from the start). Pure. */
export function journeyState(scene: Scene, tau: number): JourneyState {
  const L = sectionLength(scene);
  // C: the frame's centre.
  const C = { x: scene.canvas.width / 2, y: scene.canvas.height / 2 };
  const dot = tissueDot(scene);
  const A = dot.c;
  // Section 4 starts with the dot just larger than the frame, so the tissue is already inside it.
  const startZoom = (1.05 * Math.hypot(C.x, C.y)) / dot.r;
  const hero = heroView(scene);
  // The tissue section's camera: zoomed in so tissue fills the frame.
  const tv = tissueView(scene);
  const section = Math.max(0, Math.min(4, Math.floor(tau / L)));
  const u = clamp01((tau - section * L) / L);

  const tissue = { at: C, origin: tv.center, zoom: tv.zoom, alpha: 1, neighbours: 1, turn: isPortrait(scene) };
  const body = { at: C, origin: A, zoom: startZoom, alpha: 0 };
  const ring = { at: C, r: dot.r * startZoom, alpha: 0 };
  if (section === 0) {
    // The centre cell alone, centred, at the single cell's size.
    tissue.origin = hero.center;
    tissue.zoom = hero.zoom;
    tissue.neighbours = 0;
  } else if (section === 1) {
    const e = ease(u);
    tissue.origin = lerp(hero.center, tv.center, e);
    tissue.zoom = hero.zoom * (tv.zoom / hero.zoom) ** e; // even zoom speed on a log scale
    tissue.neighbours = smooth(0.1, 0.8, u);
  } else if (section === 3) {
    const e = ease(u);
    body.zoom = startZoom ** (1 - e);
    body.at = lerp(C, A, e);
    body.alpha = smooth(0.1, 0.6, u);
    ring.at = body.at;
    ring.r = dot.r * body.zoom;
    ring.alpha = smooth(0.05, 0.35, u);
    // The tissue pulls back inside the dot, then rides it down to its place in the body.
    const v = ease(u / DOT_SETTLE);
    const from = (tv.zoom * dot.tissueRadius) / (dot.r * startZoom);
    tissue.origin = lerp(tv.center, dot.tissueCenter, v);
    tissue.zoom = (from * (DOT_FILL / from) ** v * ring.r) / dot.tissueRadius;
    tissue.at = body.at;
  } else if (section === 4) {
    body.zoom = 1;
    body.at = A;
    body.alpha = 1;
    ring.at = A;
    ring.r = dot.r;
    ring.alpha = 1;
    tissue.origin = dot.tissueCenter;
    tissue.zoom = (DOT_FILL * dot.r) / dot.tissueRadius;
    tissue.at = A;
  }
  return { section, tissue, body, dot: ring };
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
  base.multiply(
    new DOMMatrix().translate(cam.at.x, cam.at.y).scale(cam.zoom).rotate(cam.turn ? 90 : 0).translate(-cam.origin.x, -cam.origin.y),
  );

/** Share of the tissue's half-size (centre to edge) that stays fully visible before its edge fades out. */
const EDGE_FADE_START = 0.62;

/** A circle on screen, and whether a layer keeps only what is inside it or loses it. */
type Disc = { at: Vec2; r: number; keep: boolean };

/**
 * One layer: the scene drawn through its camera onto a transparent offscreen
 * bitmap. With `edge`, the layer fades out towards that rectangle's edges
 * (an elliptical vignette, in scene coordinates, so it moves with the camera).
 * With `disc`, it is cut to that circle, or the circle is cut out of it.
 */
function drawLayer(
  role: string, ctx: Ctx, scene: Scene, t: number, m: DOMMatrix, linkAlpha = 1,
  edge?: { x: number; y: number; w: number; h: number },
  others?: { keep: string; alpha: number },
  disc?: Disc & { base: DOMMatrix },
  lines = true,
) {
  const { width, height } = ctx.canvas;
  const c = layer(role, width, height);
  const off = c.getContext('2d') as Ctx;
  off.setTransform(1, 0, 0, 1, 0, 0);
  off.clearRect(0, 0, width, height);
  off.setTransform(m);
  drawDisplayList(off, buildDisplayList(scene, t, { linkAlpha, others, lines }), { transparent: true });
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
  if (disc) {
    off.save();
    off.setTransform(disc.base);
    off.globalCompositeOperation = disc.keep ? 'destination-in' : 'destination-out';
    off.fillStyle = '#000';
    off.beginPath();
    off.arc(disc.at.x, disc.at.y, disc.r, 0, Math.PI * 2);
    off.fill();
    off.restore();
  }
  return c;
}

/**
 * How the centre cell's neighbours show while they fade in (n: 0 in the cell
 * section, 1 once the tissue is in). By default they are hidden at first. With
 * "Show neighbouring cells", their outlines show from the start, see-through
 * and optionally in greys, and grow to full opacity and colour as their
 * pathways fade in.
 */
export function neighbourFade(scene: Scene, keep: string, n: number) {
  const nb = scene.cell.neighbours;
  if (!nb?.show) return { keep, alpha: n };
  return { keep, alpha: n, outlineAlpha: nb.opacity + (1 - nb.opacity) * n, mono: nb.mono ? 1 - n : 0 };
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

  // The body first, with a hole where the dot is: the tissue shows through it.
  const dotted = st.dot.alpha > 0;
  if (st.body.alpha > 0.001) {
    const hole = { at: st.dot.at, r: st.dot.r, keep: false, base };
    const img = drawLayer('body', ctx, body, t, cameraMatrix(base, st.body), 1, undefined, undefined, hole, false);
    ctx.globalAlpha = st.body.alpha;
    ctx.drawImage(img, 0, 0);
  }
  if (st.tissue.alpha > 0.001) {
    // The centre cell alone at first: the other cells, and the links to them,
    // fade in with the neighbours.
    const hero = buildGeometry(tissue).cells.find((c) => c.hero);
    const n = st.tissue.neighbours;
    const img = drawLayer('tissue', ctx, tissue, t, cameraMatrix(base, st.tissue), n, mapExtent(tissue),
      hero && n < 1 ? neighbourFade(scene, hero.id, n) : undefined,
      dotted ? { at: st.dot.at, r: st.dot.r, keep: true, base } : undefined);
    ctx.globalAlpha = st.tissue.alpha;
    ctx.drawImage(img, 0, 0);
  }
  if (dotted) {
    // The dot's rim: a soft glow under a fine bright line, in the membrane's colours.
    const w = 0.0022 * Math.min(scene.canvas.width, scene.canvas.height);
    ctx.setTransform(base);
    ctx.beginPath();
    ctx.arc(st.dot.at.x, st.dot.at.y, st.dot.r, 0, Math.PI * 2);
    ctx.strokeStyle = scene.cell.glowColor;
    ctx.globalAlpha = 0.35 * st.dot.alpha;
    ctx.lineWidth = w * 3.5;
    ctx.stroke();
    ctx.strokeStyle = scene.cell.edgeColor;
    ctx.globalAlpha = st.dot.alpha;
    ctx.lineWidth = w;
    ctx.stroke();
  }
  ctx.restore();
}
