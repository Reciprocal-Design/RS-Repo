// A body image (a rendered figure on a plain background) used in place of the
// drawn body. The image is analysed once, from its pixels: which pixels are
// the figure (a mask, for placing particles and the network) and where its
// head and shoulders are (to fit the network to it). The browser decodes the
// image and registers the result here; geometry and rendering read it back
// by the image's data URL, and draw without it until it is ready.

export interface BodyImageFit {
  /** Image pixels: the figure's centre line, the top of the head, and the shoulder line. */
  cx: number;
  top: number;
  shoulders: number;
}

export interface BodyImageInfo {
  width: number;
  height: number;
  /** The figure, at mask resolution (mw × mh), 1 = figure. */
  mask: Uint8Array;
  mw: number;
  mh: number;
  fit: BodyImageFit;
  /** The figure cut out of its background, with soft edges, ready to draw (and as a PNG data URL, for SVG). */
  bitmap?: CanvasImageSource;
  cutoutUrl?: string;
}

const registry = new Map<string, BodyImageInfo>();
const listeners = new Set<() => void>();

export const bodyImageInfo = (src: string) => (src ? registry.get(src) : undefined);
export function registerBodyImage(src: string, info: BodyImageInfo) {
  registry.set(src, info);
  listeners.forEach((f) => f());
}
export function onBodyImage(f: () => void) {
  listeners.add(f);
  return () => listeners.delete(f);
}

/**
 * The figure in an RGBA image whose background is one plain colour: pixels
 * that differ from the corner colour, plus everything they enclose (a
 * figure's dark core can be close to the background). Background is what a
 * flood fill reaches from the image's edge without crossing the figure.
 */
export function figureMask(rgba: Uint8ClampedArray | Uint8Array, w: number, h: number, threshold = 12): Uint8Array {
  const at = (x: number, y: number) => 4 * (y * w + x);
  const corners = [at(0, 0), at(w - 1, 0), at(0, h - 1), at(w - 1, h - 1)];
  const bg = [0, 1, 2].map((c) => corners.map((i) => rgba[i + c]).sort((a, b) => a - b)[1]);
  const differs = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const d = Math.hypot(rgba[4 * i] - bg[0], rgba[4 * i + 1] - bg[1], rgba[4 * i + 2] - bg[2]);
    differs[i] = d > threshold ? 1 : 0;
  }
  const outside = new Uint8Array(w * h);
  const stack: number[] = [];
  const seed = (i: number) => {
    if (!differs[i] && !outside[i]) {
      outside[i] = 1;
      stack.push(i);
    }
  };
  for (let x = 0; x < w; x++) seed(x), seed((h - 1) * w + x);
  for (let y = 0; y < h; y++) seed(y * w), seed(y * w + w - 1);
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % w, y = (i - x) / w;
    if (x > 0) seed(i - 1);
    if (x < w - 1) seed(i + 1);
    if (y > 0) seed(i - w);
    if (y < h - 1) seed(i + w);
  }
  const mask = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) mask[i] = outside[i] ? 0 : 1;
  return mask;
}

/**
 * Head and shoulders from the mask: the top is the first row of the figure;
 * the head's width is taken just below it, and the shoulder line is the first
 * row at least 1.9 times as wide (in the upper part of the figure). The
 * centre line is the middle of the figure at the shoulders. In mask pixels.
 */
export function fitFigure(mask: Uint8Array, w: number, h: number): BodyImageFit {
  const rows: { min: number; max: number; n: number }[] = [];
  for (let y = 0; y < h; y++) {
    let min = w, max = -1, n = 0;
    for (let x = 0; x < w; x++) {
      if (!mask[y * w + x]) continue;
      n++;
      if (x < min) min = x;
      if (x > max) max = x;
    }
    rows.push({ min, max, n });
  }
  const top = Math.max(0, rows.findIndex((r) => r.n > w * 0.01));
  const bottom = rows.length - 1 - [...rows].reverse().findIndex((r) => r.n > w * 0.01);
  const span = Math.max(1, bottom - top);
  const widths = rows.map((r) => (r.n ? r.max - r.min : 0));
  const head = widths.slice(top + Math.round(span * 0.04), top + Math.round(span * 0.1) + 1).sort((a, b) => a - b);
  const headW = head[Math.floor(head.length / 2)] || widths[top] || 1;
  let shoulders = top + Math.round(span * 0.25);
  for (let y = top + Math.round(span * 0.08); y < top + span * 0.6; y++) {
    if (widths[y] >= 1.9 * headW) {
      shoulders = y;
      break;
    }
  }
  const r = rows[shoulders];
  return { cx: r.n ? (r.min + r.max) / 2 : w / 2, top, shoulders };
}
