import { exportFileName } from '../core/sceneIO';
import type { Scene } from '../core/types';
import { planVideo, videoSize, videoSizeError } from '../core/video';
import { render } from '../render/render';
import { downloadBlob } from './exporters';

export type VideoQuality = 'medium' | 'high' | 'veryHigh';
export type VideoFormat = 'mp4' | 'webm';

export interface VideoOptions {
  scale: number; // of the canvas size
  fps: number;
  loops: number;
  quality: VideoQuality;
  format: VideoFormat;
}

/** Does this browser have the video encoder at all (WebCodecs)? */
export const videoSupported = () => typeof window !== 'undefined' && 'VideoEncoder' in window;

const FORMATS = {
  mp4: { codec: 'avc', ext: 'mp4', mime: 'video/mp4', label: 'MP4 (H.264)' },
  webm: { codec: 'vp9', ext: 'webm', mime: 'video/webm', label: 'WebM (VP9)' },
} as const;

/**
 * Render the animation frame by frame (not a screen recording, so every frame
 * is exact and smooth however heavy the scene) and encode it with the
 * browser's own encoder: H.264 in MP4, or VP9 in WebM. When the browser has no
 * H.264 encoder (some Firefox and Linux builds), MP4 falls back to WebM. The
 * muxer is loaded only when needed. Resolves with the format actually saved.
 */
export async function exportVideo(
  scene: Scene,
  opts: VideoOptions,
  onProgress: (done: number, total: number) => void,
  signal: AbortSignal,
): Promise<VideoFormat> {
  if (!videoSupported()) {
    throw new Error('This browser cannot encode video. Use a recent Chrome, Edge, Safari (17+) or Firefox (130+).');
  }
  const { width, height, kx, ky } = videoSize(scene, opts.scale);
  const sizeErr = videoSizeError(width, height);
  if (sizeErr) throw new Error(sizeErr);
  const plan = planVideo(scene, opts.fps, opts.loops);

  const mb = await import('mediabunny');
  const quality = { medium: mb.QUALITY_MEDIUM, high: mb.QUALITY_HIGH, veryHigh: mb.QUALITY_VERY_HIGH }[opts.quality];
  const can = (f: VideoFormat) => mb.canEncodeVideo(FORMATS[f].codec, { width, height, quality, frameRate: opts.fps });
  const order: VideoFormat[] = opts.format === 'mp4' ? ['mp4', 'webm'] : ['webm'];
  let format: VideoFormat | null = null;
  for (const f of order) {
    if (await can(f)) {
      format = f;
      break;
    }
  }
  if (!format) {
    throw new Error(`This browser cannot encode ${width} × ${height} at ${opts.fps} fps as ${FORMATS[opts.format].label}. Try a smaller size or frame rate.`);
  }
  const fmt = FORMATS[format];

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  const output = new mb.Output({
    format: format === 'mp4' ? new mb.Mp4OutputFormat({ fastStart: 'in-memory' }) : new mb.WebMOutputFormat(),
    target: new mb.BufferTarget(),
  });
  const source = new mb.CanvasSource(canvas, { codec: fmt.codec, bitrate: quality, keyFrameInterval: 2 });
  output.addVideoTrack(source, { frameRate: opts.fps });
  await output.start();

  try {
    for (let i = 0; i < plan.frames; i++) {
      if (signal.aborted) throw new DOMException('Export cancelled.', 'AbortError');
      ctx.setTransform(kx, 0, 0, ky, 0, 0);
      render(ctx, scene, plan.timeAt(i));
      await source.add(i / opts.fps, 1 / opts.fps);
      onProgress(i + 1, plan.frames);
      // Let the page repaint the progress bar now and then.
      if (i % 4 === 3) await new Promise((r) => setTimeout(r, 0));
    }
    await output.finalize();
  } catch (e) {
    await output.cancel().catch(() => {});
    throw e;
  }
  const buffer = output.target.buffer;
  if (!buffer) throw new Error('Video encoding produced no data.');
  downloadBlob(new Blob([buffer], { type: fmt.mime }), exportFileName(scene, width, height, fmt.ext));
  return format;
}
