import { realVideoInfo } from '../core/realVideo';
import { cycleTime } from '../core/timeline';
import type { Scene } from '../core/types';
import { drawDisplayList, type CanvasDrawOptions } from './canvas';
import { buildDisplayList } from './displayList';

// Virtual → real cell, in five sections of equal length:
//
//   1 Virtual cell           the selected cell, as in the other views
//   2 Virtual → real         the real cell video fades in under the network
//                            as the virtual cell's outlines fade out
//   3 Discovery              on the real cell, new edges grow in and new
//                            nodes pop up (inactive ones becoming active)
//   4 Real → virtual         the video fades out, the outlines come back
//   5 Virtual cell, updated  with the new nodes and edges
//
// The network keeps animating throughout; it is its own scene
// (`realCellNet`), with its own signal loop.

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export const REAL_CELL_SECTIONS = ['Virtual cell', 'Virtual → real cell', 'Discovery', 'Real → virtual cell', 'Virtual cell, updated'];

const nets = new WeakMap<Scene, Scene>();
/** The network the view draws (memoised so its geometry and schedule are cached). */
export function realCellNet(scene: Scene): Scene {
  let hit = nets.get(scene);
  if (!hit) {
    hit = { ...scene, module: { ...scene.module, kind: 'realCellNet' } };
    nets.set(scene, hit);
  }
  return hit;
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
/** Smootherstep: starts and ends at rest. */
const ease = (x: number) => {
  const t = clamp01(x);
  return t * t * t * (t * (6 * t - 15) + 10);
};
const sectionLength = (scene: Scene) => Math.max(0.5, scene.module.sectionLength);

export interface RealCellState {
  section: number;
  /** How much the real cell video shows (0–1). */
  video: number;
  /** How far discovery has got (0–1). */
  discovered: number;
}

/** Fades and discovery at time tau (seconds from the start). Pure. */
export function realCellState(scene: Scene, tau: number): RealCellState {
  const L = sectionLength(scene);
  const section = Math.max(0, Math.min(4, Math.floor(tau / L)));
  const u = clamp01((tau - section * L) / L);
  switch (section) {
    case 0: return { section, video: 0, discovered: 0 };
    case 1: return { section, video: ease(u), discovered: 0 };
    case 2: return { section, video: 1, discovered: ease(u) };
    case 3: return { section, video: 1 - ease(u), discovered: 1 };
    default: return { section, video: 0, discovered: 1 };
  }
}

/**
 * Seconds into the real cell video at view time tau: it starts as it fades in
 * (section 2) and loops if it is shorter than the time it is on screen.
 */
export function videoTimeAt(scene: Scene, tau: number, duration: number): number {
  const x = Math.max(0, tau - sectionLength(scene));
  return duration > 0 ? x % duration : 0;
}

/**
 * Bring the video to the frame needed at time t, and wait for it: exports
 * call this before drawing each frame, so every frame shows the right one.
 */
export async function seekRealVideo(scene: Scene, t: number): Promise<void> {
  const info = realVideoInfo(scene.module.realVideo);
  if (!info) return;
  const want = videoTimeAt(scene, cycleTime(scene, t), info.duration);
  const v = info.video;
  if (!v.paused) v.pause();
  if (Math.abs(v.currentTime - want) < 1e-3 && v.readyState >= 2) return;
  await new Promise<void>((res) => {
    const done = () => {
      v.removeEventListener('seeked', done);
      res();
    };
    v.addEventListener('seeked', done);
    v.currentTime = want;
    setTimeout(done, 3000);
  });
}

/** The video, covering the canvas, then sized and moved by the view's settings. */
function videoRect(scene: Scene, w: number, h: number) {
  const { width: W, height: H } = scene.canvas;
  const m = scene.module;
  const k = Math.max(W / w, H / h) * Math.max(0.05, m.videoScale);
  const vw = w * k, vh = h * k;
  return { x: (W - vw) / 2 + m.videoX * W, y: (H - vh) / 2 + m.videoY * H, w: vw, h: vh };
}

export function drawRealCell(ctx: Ctx, scene: Scene, t: number, opts: CanvasDrawOptions = {}): void {
  const st = realCellState(scene, cycleTime(scene, t));
  const net = realCellNet(scene);
  const { width: W, height: H } = scene.canvas;
  ctx.save();
  if (opts.transparent) ctx.clearRect(0, 0, W, H);
  else {
    ctx.fillStyle = scene.canvas.background;
    ctx.fillRect(0, 0, W, H);
  }
  const info = realVideoInfo(scene.module.realVideo);
  if (info && st.video > 0.001) {
    const r = videoRect(scene, info.width, info.height);
    ctx.globalAlpha = st.video;
    ctx.drawImage(info.video, r.x, r.y, r.w, r.h);
    // Darken it a little, so the network reads over it.
    const dim = 1 - Math.max(0, Math.min(1, scene.module.videoBrightness));
    if (dim > 0) {
      ctx.globalAlpha = st.video * dim;
      ctx.fillStyle = '#000';
      ctx.fillRect(r.x, r.y, r.w, r.h);
    }
    ctx.globalAlpha = 1;
  }
  ctx.restore();
  // The network over it, the virtual cell's outlines giving way to the video.
  drawDisplayList(ctx, buildDisplayList(net, t, { discovered: st.discovered, outlineAlpha: info ? 1 - st.video : 1 }), { overlay: true });
}
