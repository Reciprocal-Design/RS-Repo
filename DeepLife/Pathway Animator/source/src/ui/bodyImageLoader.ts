import { bodyImageInfo, figureMask, fitFigure, registerBodyImage } from '../core/bodyImage';

/** Analysis resolution: masks are made at most this wide. */
const MASK_WIDTH = 480;
/** Soft edge round the cut-out figure, and fade where it meets the image's own edges (shares of the image size). */
const EDGE_SOFTNESS = 0.003;
const BORDER_FADE = 0.05;

const pending = new Map<string, Promise<void>>();

export function readImageFile(file: File): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.onerror = () => rej(new Error('This image could not be read.'));
    r.readAsDataURL(file);
  });
}

/**
 * Decode a body image, find the figure in it, cut the figure out of its
 * background (soft edges; faded where the image crops it), and register it
 * for geometry and rendering. Once per image.
 */
export function loadBodyImage(src: string): Promise<void> {
  if (!src || bodyImageInfo(src)) return Promise.resolve();
  let p = pending.get(src);
  if (!p) {
    p = analyse(src).finally(() => pending.delete(src));
    pending.set(src, p);
  }
  return p;
}

async function analyse(src: string) {
  // Wait on the load event: decode() can stall while the page is in the background.
  const img = new Image();
  await new Promise<void>((res, rej) => {
    img.onload = () => res();
    img.onerror = () => rej(new Error('This image could not be opened.'));
    img.src = src;
    if (img.complete && img.naturalWidth) res();
  });
  const W = img.naturalWidth, H = img.naturalHeight;
  if (!W || !H) throw new Error('This image is empty.');

  // The figure, at mask resolution.
  const k = Math.min(1, MASK_WIDTH / W);
  const mw = Math.max(1, Math.round(W * k)), mh = Math.max(1, Math.round(H * k));
  const small = Object.assign(document.createElement('canvas'), { width: mw, height: mh });
  const sctx = small.getContext('2d', { willReadFrequently: true })!;
  sctx.drawImage(img, 0, 0, mw, mh);
  const mask = figureMask(sctx.getImageData(0, 0, mw, mh).data, mw, mh);
  const fit = fitFigure(mask, mw, mh);
  if (!mask.some((v) => v)) throw new Error('No figure found: use an image of a figure on a plain background.');

  // The mask as an alpha channel, softened.
  const alpha = sctx.createImageData(mw, mh);
  for (let i = 0; i < mw * mh; i++) {
    alpha.data[4 * i] = alpha.data[4 * i + 1] = alpha.data[4 * i + 2] = 255;
    alpha.data[4 * i + 3] = mask[i] ? 255 : 0;
  }
  sctx.putImageData(alpha, 0, 0);

  const out = Object.assign(document.createElement('canvas'), { width: W, height: H });
  const ctx = out.getContext('2d')!;
  ctx.drawImage(img, 0, 0);
  ctx.globalCompositeOperation = 'destination-in';
  ctx.filter = `blur(${Math.max(1, EDGE_SOFTNESS * Math.max(W, H))}px)`;
  ctx.drawImage(small, 0, 0, W, H);
  ctx.filter = 'none';
  // Fade the figure out where the image crops it, so no hard edge shows.
  const fade = (x0: number, y0: number, x1: number, y1: number) => {
    const g = ctx.createLinearGradient(x0, y0, x1, y1);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(BORDER_FADE, 'rgba(0,0,0,1)');
    g.addColorStop(1, 'rgba(0,0,0,1)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  };
  fade(0, 0, 0, H);
  fade(0, H, 0, 0);
  fade(0, 0, W, 0);
  fade(W, 0, 0, 0);
  ctx.globalCompositeOperation = 'source-over';

  registerBodyImage(src, {
    width: W,
    height: H,
    mask,
    mw,
    mh,
    fit: { cx: fit.cx / k, top: fit.top / k, shoulders: fit.shoulders / k },
    bitmap: out,
    cutoutUrl: out.toDataURL('image/png'),
  });
}
