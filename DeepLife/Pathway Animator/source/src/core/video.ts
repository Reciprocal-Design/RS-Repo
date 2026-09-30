import { buildSchedule, loops } from './timeline';
import type { Scene } from './types';

// Video export timing, kept pure so it can be tested without a browser.

export const VIDEO_FPS = [24, 25, 30, 50, 60] as const;
/** H.264 encoders commonly top out at 4096 px wide (level 5.1/5.2). */
export const VIDEO_MAX_SIDE = 4096;

export interface VideoPlan {
  frames: number;
  fps: number;
  /** Seconds of animation the video covers (whole loops when the scene loops). */
  span: number;
  /** Animation time of frame i. */
  timeAt: (i: number) => number;
}

/**
 * Which animation times to render. A looping scene exports whole loops, and
 * frame times are spread exactly across them (i × span / frames), so the last
 * frame flows straight into the first and the video itself loops seamlessly,
 * even when a loop is not a whole number of frames long (the timing is
 * stretched by well under a frame). A non-looping scene exports one run.
 */
export function planVideo(scene: Scene, fps: number, loopCount = 1): VideoPlan {
  const total = buildSchedule(scene).total;
  const span = Math.max(1 / fps, total * (loops(scene) ? Math.max(1, Math.round(loopCount)) : 1));
  const frames = Math.max(1, Math.round(span * fps));
  return { frames, fps, span, timeAt: (i) => (i * span) / frames };
}

/** Output size: the canvas scaled by k, rounded to even pixels (required by H.264). */
export function videoSize(scene: Scene, k: number) {
  const even = (v: number) => Math.max(2, 2 * Math.round(v / 2));
  const width = even(scene.canvas.width * k), height = even(scene.canvas.height * k);
  return { width, height, kx: width / scene.canvas.width, ky: height / scene.canvas.height };
}

export function videoSizeError(width: number, height: number): string | null {
  if (width > VIDEO_MAX_SIDE || height > VIDEO_MAX_SIDE) return `Too large for MP4: at most ${VIDEO_MAX_SIDE}px per side.`;
  return null;
}
