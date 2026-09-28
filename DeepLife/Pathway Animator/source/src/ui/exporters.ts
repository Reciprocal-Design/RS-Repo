import { exportFileName, parseSceneJson, serializeScene } from '../core/sceneIO';
import type { Scene } from '../core/types';
import { buildDisplayList } from '../render/displayList';
import { render } from '../render/render';
import { displayListToSvg } from '../render/svg';

// Chrome's canvas limits: 16384px per side and about 268M pixels in total.
const MAX_SIDE = 16384;
const MAX_AREA = 268_000_000;

export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Output size for a PNG export: a multiple of the canvas, or a custom width (height keeps the aspect). */
export function pngSize(scene: Scene, mode: { scale: number } | { width: number }) {
  const { width: W, height: H } = scene.canvas;
  const k = 'scale' in mode ? mode.scale : mode.width / W;
  return { width: Math.round(W * k), height: Math.round(H * k), k };
}

export function pngSizeError(width: number, height: number): string | null {
  if (width > MAX_SIDE || height > MAX_SIDE) return `Too large: the browser allows at most ${MAX_SIDE}px per side.`;
  if (width * height > MAX_AREA) return 'Too large: over the browser’s canvas size limit.';
  return null;
}

/** Renders the frame at time t offscreen at the chosen resolution (vector-sharp at any size). */
export async function exportPng(scene: Scene, t: number, mode: { scale: number } | { width: number }, transparent: boolean) {
  const { width, height, k } = pngSize(scene, mode);
  const err = pngSizeError(width, height);
  if (err) throw new Error(err);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(k, 0, 0, k, 0, 0);
  render(ctx, scene, t, { transparent });
  const blob = await new Promise<Blob>((res, rej) =>
    canvas.toBlob((b) => (b ? res(b) : rej(new Error('PNG encoding failed.'))), 'image/png'),
  );
  downloadBlob(blob, exportFileName(scene, width, height, 'png'));
}

export function sceneToSvg(scene: Scene, t: number, includeSignal: boolean, transparent: boolean): string {
  return displayListToSvg(buildDisplayList(scene, t, { signal: includeSignal }), { transparent });
}

export function exportSvg(scene: Scene, t: number, includeSignal: boolean, transparent: boolean) {
  const svg = sceneToSvg(scene, t, includeSignal, transparent);
  const { width, height } = scene.canvas;
  downloadBlob(new Blob([svg], { type: 'image/svg+xml' }), exportFileName(scene, width, height, 'svg'));
}

export function saveSceneJson(scene: Scene) {
  const { width, height } = scene.canvas;
  downloadBlob(new Blob([serializeScene(scene)], { type: 'application/json' }), exportFileName(scene, width, height, 'json'));
}

export async function readSceneFile(file: File): Promise<Scene> {
  return parseSceneJson(await file.text());
}
