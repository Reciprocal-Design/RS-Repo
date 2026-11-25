import { buildGeometry } from '../core/geometry';
import { polygonArea, polygonCentroid } from '../core/polygon';
import { sequenceFrame, type SequenceFrameItem } from '../core/sequence';
import type { Scene, Vec2 } from '../core/types';
import { drawDisplayList, type CanvasDrawOptions } from './canvas';
import { buildDisplayList } from './displayList';
import { prepareFrame, render } from './render';

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

const layers = new Map<string, OffscreenCanvas | HTMLCanvasElement>();
function layer(role: string, width: number, height: number) {
  let c = layers.get(role);
  if (!c || c.width !== width || c.height !== height) {
    c = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(width, height) : Object.assign(document.createElement('canvas'), { width, height });
    layers.set(role, c);
  }
  return c;
}

/** A tab's canvas fitted inside the sequence's, centred (the margins show the sequence's background). */
function fit(scene: Scene, src: Scene) {
  const { width: W, height: H } = scene.canvas;
  const { width: w, height: h } = src.canvas;
  const k = Math.min(W / w, H / h);
  return new DOMMatrix().translate((W - w * k) / 2, (H - h * k) / 2).scale(k);
}

/** The cell a view centres on (its selected cell, or its only one): middle and size. */
function heroOf(scene: Scene): { c: Vec2; r: number } | null {
  const cells = buildGeometry(scene).cells;
  const cell = cells.find((c) => c.hero) ?? cells.find((c) => c.id === scene.cellMap.heroId) ?? (cells.length === 1 ? cells[0] : undefined);
  if (!cell) return null;
  return { c: polygonCentroid(cell.cell.points), r: Math.sqrt(Math.abs(polygonArea(cell.cell.points)) / Math.PI) };
}

/**
 * Where a tab is drawn on the sequence's canvas: fitted, and for a tissue
 * zooming out of the cell before it, a camera that starts with its selected
 * cell exactly where (and as large as) that tab showed it, then eases back
 * to the tissue's own view.
 */
function placement(scene: Scene, item: SequenceFrameItem): DOMMatrix {
  const src = item.segment.scene;
  const m = fit(scene, src);
  const from = item.segment.zoomFrom;
  if (!from || !item.zoomIn) return m;
  const a = heroOf(from), b = heroOf(src);
  if (!a || !b) return m;
  const mFrom = fit(scene, from);
  const at = m.inverse().transformPoint(mFrom.transformPoint(new DOMPoint(a.c.x, a.c.y)));
  const k0 = (mFrom.a * a.r) / (m.a * b.r);
  const z = item.zoomIn;
  const k = k0 ** z; // even zoom speed on a log scale
  const x = b.c.x + (at.x - b.c.x) * z, y = b.c.y + (at.y - b.c.y) * z;
  return m.translate(x, y).scale(k).translate(-b.c.x, -b.c.y);
}

/** One tab, as the sequence plays it (the combination built out as far as it has got). */
function drawItem(ctx: Ctx, item: SequenceFrameItem, opts: CanvasDrawOptions) {
  const src = item.segment.scene;
  if (item.built !== undefined && item.built < 1) drawDisplayList(ctx, buildDisplayList(src, item.time, { discovered: item.built }), opts);
  else render(ctx, src, item.time, opts);
}

/**
 * The sequence at time t: the tab playing, or while two crossfade, the
 * outgoing one with the incoming one faded in over it. Each tab is drawn
 * exactly as its own tab would draw it, at its own time.
 */
export function drawSequence(ctx: Ctx, scene: Scene, t: number, opts: CanvasDrawOptions = {}): void {
  const base = ctx.getTransform();
  const frame = sequenceFrame(scene, t);
  ctx.save();
  if (opts.transparent) ctx.clearRect(0, 0, scene.canvas.width, scene.canvas.height);
  else {
    ctx.fillStyle = scene.canvas.background;
    ctx.fillRect(0, 0, scene.canvas.width, scene.canvas.height);
  }
  ctx.restore();
  const { width, height } = ctx.canvas;
  frame.forEach((item, i) => {
    const { mix } = item;
    const m = base.multiply(placement(scene, item));
    // On a background, the incoming tab simply fades in over the outgoing one;
    // on a transparent one, the outgoing one fades out as well.
    const next = frame[i + 1]?.mix ?? 0;
    const alpha = mix * (opts.transparent ? 1 - next : 1);
    if (frame.length === 1 && alpha >= 1) {
      ctx.save();
      ctx.setTransform(m);
      drawItem(ctx, item, opts);
      ctx.restore();
      return;
    }
    const c = layer(`seq${i}`, width, height);
    const off = c.getContext('2d') as Ctx;
    off.setTransform(1, 0, 0, 1, 0, 0);
    off.clearRect(0, 0, width, height);
    off.setTransform(m);
    drawItem(off, item, opts);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = alpha;
    ctx.drawImage(c, 0, 0);
    ctx.restore();
  });
}

/** Get the tabs showing at time t ready to draw exactly (a real cell video's frame). */
export async function prepareSequenceFrame(scene: Scene, t: number): Promise<void> {
  for (const { segment, time } of sequenceFrame(scene, t)) await prepareFrame(segment.scene, time);
}
