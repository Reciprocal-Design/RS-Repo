import { describe, expect, it } from 'vitest';
import { buildDisplayList } from '../render/displayList';
import { bodyImageRect } from './body';
import { figureMask, fitFigure, registerBodyImage } from './bodyImage';
import { buildGeometry } from './geometry';
import { moduleScene } from './modules';

/** A navy image with a figure: a round head, wider shoulders and torso, bright rim, dark core. */
function figure(w = 100, h = 160) {
  const px = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = 4 * (y * w + x);
      const head = Math.hypot(x - 50, y - 20) <= 10;
      const torso = x >= 30 && x <= 70 && y >= 35;
      const core = torso && x > 40 && x < 60 && y > 50;
      const [r, g, b] = core ? [18, 1, 18] : head || torso ? [180, 140, 240] : [1, 3, 32];
      px.set([r, g, b, 255], i);
    }
  }
  return { px, w, h };
}

describe('body image', () => {
  it('finds the figure, dark core included, and its head and shoulders', () => {
    const { px, w, h } = figure();
    const mask = figureMask(px, w, h);
    expect(mask[20 * w + 50]).toBe(1); // head
    expect(mask[100 * w + 50]).toBe(1); // dark core, near the background colour
    expect(mask[5 * w + 5]).toBe(0); // background
    const fit = fitFigure(mask, w, h);
    expect(fit.top).toBeGreaterThanOrEqual(10);
    expect(fit.top).toBeLessThanOrEqual(12);
    expect(fit.shoulders).toBe(35);
    expect(fit.cx).toBeCloseTo(50, 0);
  });

  it('places the network and particles on the figure', () => {
    const { px, w, h } = figure();
    const mask = figureMask(px, w, h);
    const src = 'data:image/png;base64,test-figure';
    registerBodyImage(src, { width: w, height: h, mask, mw: w, mh: h, fit: fitFigure(mask, w, h) });
    const base = moduleScene('body', 7);
    const s = { ...base, module: { ...base.module, bodyImage: src } };
    const r = bodyImageRect(s)!;
    const g = buildGeometry(s);
    expect(g.image).toEqual({ src, x: r.x, y: r.y, w: r.w, h: r.h });
    const on = (p: { x: number; y: number }) => {
      const ix = Math.floor(((p.x - r.x) / r.w) * w), iy = Math.floor(((p.y - r.y) / r.h) * h);
      return mask[iy * w + ix] === 1;
    };
    expect(g.nodes.length).toBeGreaterThan(20);
    expect(g.nodes.every(on)).toBe(true);
    expect(g.particles!.every(on)).toBe(true);
    // Every connection joins two kept nodes, and the drawn body gives way to the image.
    for (const e of g.edges) expect(g.nodeById.has(e.from) && g.nodeById.has(e.to)).toBe(true);
    const prims = buildDisplayList(s, 1).prims;
    expect(prims.some((p) => p.kind === 'image')).toBe(true);
    expect(prims.some((p) => p.id === 'body-body-fill')).toBe(false);
  });
});
