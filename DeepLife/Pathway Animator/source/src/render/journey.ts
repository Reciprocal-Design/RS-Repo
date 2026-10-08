import { organCenter } from '../core/body';
import { buildGeometry } from '../core/geometry';
import { closedSplineSegments } from '../core/outline';
import { cycleTime } from '../core/timeline';
import type { Scene, Vec2 } from '../core/types';
import { drawDisplayList, type CanvasDrawOptions } from './canvas';
import { buildDisplayList } from './displayList';

// The scroll sequence: cell → tissue → body, in five sections of equal length.
//
//   1 Cell           the tissue's centre cell, zoomed in until it is exactly
//                    the single cell of the other tabs; neighbours hidden
//   2 Cell → tissue  the camera pulls back and the neighbours fade in
//   3 Tissue         the tissue round the cell
//   4 Tissue → body  the camera keeps pulling back: the tissue shrinks into
//                    the chosen organ and fades, as the body fades in round it
//   5 Body           the body, organs and their firing lines
//
// Each layer (tissue, body) is its own scene, drawn with its own signal and
// a camera transform, into an offscreen layer that is faded onto the frame.

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export const JOURNEY_SECTIONS = ['Cell', 'Cell → tissue', 'Tissue', 'Tissue → body', 'Body'];
/** How far into its organ the body starts, at the beginning of section 4. */
const BODY_ZOOM = 8;

const scenes = new WeakMap<Scene, { tissue: Scene; body: Scene }>();
/** The journey's tissue and body scenes (memoised so their geometry and schedules are cached). */
export function journeyScenes(scene: Scene) {
  let hit = scenes.get(scene);
  if (!hit) {
    hit = {
      tissue: { ...scene, module: { ...scene.module, kind: 'tissue' } },
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

/** Cameras and fades at journey time tau (seconds from the start). Pure. */
export function journeyState(scene: Scene, tau: number): JourneyState {
  const L = sectionLength(scene);
  const C = { x: scene.canvas.width / 2, y: scene.canvas.height / 2 };
  const A = organCenter(scene, scene.module.organ);
  const k = Math.max(0.05, scene.cellMap.detailScale);
  const section = Math.max(0, Math.min(4, Math.floor(tau / L)));
  const u = clamp01((tau - section * L) / L);

  const tissue = { at: C, origin: C, zoom: 1, alpha: 1, neighbours: 1 };
  const body = { at: C, origin: A, zoom: BODY_ZOOM, alpha: 0 };
  if (section === 0) {
    // At zoom 1/k the centre cell is exactly the single cell.
    tissue.zoom = 1 / k;
    tissue.neighbours = 0;
  } else if (section === 1) {
    tissue.zoom = (1 / k) ** (1 - ease(u)); // even zoom speed on a log scale
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

/** One layer: the scene drawn through its camera onto a transparent offscreen bitmap. */
function drawLayer(role: string, ctx: Ctx, scene: Scene, t: number, m: DOMMatrix, linkAlpha = 1) {
  const { width, height } = ctx.canvas;
  const c = layer(role, width, height);
  const off = c.getContext('2d') as Ctx;
  off.setTransform(1, 0, 0, 1, 0, 0);
  off.clearRect(0, 0, width, height);
  off.setTransform(m);
  drawDisplayList(off, buildDisplayList(scene, t, { linkAlpha }), { transparent: true });
  return c;
}

/** The region of the centre cell (a little past its membrane, so receptors stay whole), in device pixels. */
function heroPath(scene: Scene, m: DOMMatrix): Path2D {
  const hero = buildGeometry(scene).cells[0].cell;
  const c = hero.center;
  const radii = hero.points.map((p) => Math.hypot(p.x - c.x, p.y - c.y));
  const pad = 0.05 * (radii.reduce((a, b) => a + b, 0) / radii.length);
  const pts = hero.points.map((p, i) => {
    const k = 1 + pad / (radii[i] || 1);
    const q = m.transformPoint(new DOMPoint(c.x + (p.x - c.x) * k, c.y + (p.y - c.y) * k));
    return { x: q.x, y: q.y };
  });
  const path = new Path2D();
  path.moveTo(pts[0].x, pts[0].y);
  for (const [a, b, e] of closedSplineSegments(pts)) path.bezierCurveTo(a.x, a.y, b.x, b.y, e.x, e.y);
  path.closePath();
  return path;
}

export function drawJourney(ctx: Ctx, scene: Scene, t: number, opts: CanvasDrawOptions = {}): void {
  const tau = cycleTime(scene, t);
  const st = journeyState(scene, tau);
  const { tissue, body } = journeyScenes(scene);
  const base = ctx.getTransform();
  const { width, height } = ctx.canvas;

  ctx.save();
  if (opts.transparent) {
    ctx.clearRect(0, 0, scene.canvas.width, scene.canvas.height);
  } else {
    ctx.fillStyle = scene.canvas.background;
    ctx.fillRect(0, 0, scene.canvas.width, scene.canvas.height);
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);

  if (st.tissue.alpha > 0.001) {
    const m = cameraMatrix(base, st.tissue);
    // Links to the neighbours appear with them.
    const img = drawLayer('tissue', ctx, tissue, t, m, st.tissue.neighbours);
    if (st.tissue.neighbours >= 0.999) {
      ctx.globalAlpha = st.tissue.alpha;
      ctx.drawImage(img, 0, 0);
    } else {
      // The centre cell at full strength; everything round it fading in.
      const hero = heroPath(tissue, m);
      ctx.save();
      ctx.clip(hero);
      ctx.globalAlpha = st.tissue.alpha;
      ctx.drawImage(img, 0, 0);
      ctx.restore();
      if (st.tissue.neighbours > 0.001) {
        const outside = new Path2D();
        outside.rect(0, 0, width, height);
        outside.addPath(hero);
        ctx.save();
        ctx.clip(outside, 'evenodd');
        ctx.globalAlpha = st.tissue.alpha * st.tissue.neighbours;
        ctx.drawImage(img, 0, 0);
        ctx.restore();
      }
    }
  }
  if (st.body.alpha > 0.001) {
    const img = drawLayer('body', ctx, body, t, cameraMatrix(base, st.body));
    ctx.globalAlpha = st.body.alpha;
    ctx.drawImage(img, 0, 0);
  }
  ctx.restore();
}
