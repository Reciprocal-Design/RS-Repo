import { sequenceFrame } from '../core/sequence';
import type { Scene } from '../core/types';
import type { CanvasDrawOptions } from './canvas';
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
  frame.forEach(({ segment, time, mix }, i) => {
    const m = base.multiply(fit(scene, segment.scene));
    // On a background, the incoming tab simply fades in over the outgoing one;
    // on a transparent one, the outgoing one fades out as well.
    const next = frame[i + 1]?.mix ?? 0;
    const alpha = mix * (opts.transparent ? 1 - next : 1);
    if (frame.length === 1 && alpha >= 1) {
      ctx.save();
      ctx.setTransform(m);
      render(ctx, segment.scene, time, opts);
      ctx.restore();
      return;
    }
    const c = layer(`seq${i}`, width, height);
    const off = c.getContext('2d') as Ctx;
    off.setTransform(1, 0, 0, 1, 0, 0);
    off.clearRect(0, 0, width, height);
    off.setTransform(m);
    render(off, segment.scene, time, opts);
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
