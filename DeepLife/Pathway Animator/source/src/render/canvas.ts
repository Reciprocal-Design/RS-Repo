import type { DisplayList, Prim } from './displayList';

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export interface CanvasDrawOptions {
  transparent?: boolean;
}

/** Canvas 2D backend. Draws in scene coordinates; the caller sets any transform. */
export function drawDisplayList(ctx: Ctx, list: DisplayList, opts: CanvasDrawOptions = {}): void {
  ctx.save();
  if (opts.transparent) {
    ctx.clearRect(0, 0, list.width, list.height);
  } else {
    ctx.fillStyle = list.background;
    ctx.fillRect(0, 0, list.width, list.height);
  }
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const prims = list.prims;
  for (const u of list.underlays ?? []) if (u.opacity > 0) drawCachedLayer(ctx, u.prims, u.prims, u.prims.length, u.opacity);
  // The static layer (outlines with their glowing rims, receptors, base edges;
  // for a cell map, every cell's) is the same in every frame of a scene: draw
  // it once to a bitmap at device resolution and reuse it during playback.
  let i = 0;
  if (list.staticCount > 0) {
    drawCachedLayer(ctx, list.staticKey, prims, list.staticCount, 1, list.staticTag);
    i = list.staticCount;
  }
  for (; i < prims.length; i++) drawPrim(ctx, prims[i]);
  ctx.restore();
}

interface StaticCache {
  key: string;
  bitmap: HTMLCanvasElement | OffscreenCanvas;
}
const staticCache = new WeakMap<object, StaticCache>();

/** Draw the first `count` prims through a bitmap cached under `cacheKey`, faded by `opacity`. */
function drawCachedLayer(ctx: Ctx, cacheKey: object, prims: Prim[], count: number, opacity: number, tag = '') {
  const m = ctx.getTransform();
  const { width, height } = ctx.canvas;
  const key = [width, height, m.a, m.b, m.c, m.d, m.e, m.f, count, tag].join(',');
  let hit = staticCache.get(cacheKey);
  if (!hit || hit.key !== key) {
    // Reuse the bitmap when only the transform changed (a camera move), rather than allocating a new one.
    const same = hit && hit.bitmap.width === width && hit.bitmap.height === height;
    const bitmap = same
      ? hit!.bitmap
      : typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(width, height) : Object.assign(document.createElement('canvas'), { width, height });
    const off = bitmap.getContext('2d') as Ctx;
    off.setTransform(1, 0, 0, 1, 0, 0);
    off.clearRect(0, 0, width, height);
    off.setTransform(m);
    off.lineCap = 'round';
    off.lineJoin = 'round';
    for (let k = 0; k < count; k++) drawPrim(off, prims[k]);
    hit = { key, bitmap };
    staticCache.set(cacheKey, hit);
  }
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = opacity;
  ctx.globalCompositeOperation = 'source-over';
  ctx.drawImage(hit.bitmap, 0, 0);
  ctx.restore();
}

function drawPrim(ctx: Ctx, p: Prim): void {
  ctx.globalAlpha = p.opacity ?? 1;
  ctx.globalCompositeOperation = p.blend ?? 'source-over';
  switch (p.kind) {
    case 'closedSpline': {
      ctx.beginPath();
      ctx.moveTo(p.start.x, p.start.y);
      for (const [c1, c2, e] of p.segments) ctx.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, e.x, e.y);
      ctx.closePath();
      ctx.strokeStyle = p.stroke;
      ctx.lineWidth = p.width;
      if (p.clip) {
        // Keep only the inner half of the stroke: light falls inward from the rim.
        ctx.save();
        ctx.clip();
        ctx.stroke();
        ctx.restore();
      } else {
        ctx.stroke();
      }
      break;
    }
    case 'bezier': {
      const [a, b, c, d] = p.p;
      // Gradient runs along the chord from start to end point.
      const grad = ctx.createLinearGradient(a.x, a.y, d.x, d.y);
      grad.addColorStop(0, p.from);
      grad.addColorStop(1, p.to);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.bezierCurveTo(b.x, b.y, c.x, c.y, d.x, d.y);
      ctx.strokeStyle = grad;
      ctx.lineWidth = p.width;
      ctx.stroke();
      break;
    }
    case 'circle': {
      ctx.beginPath();
      ctx.arc(p.c.x, p.c.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = p.fill;
      ctx.fill();
      break;
    }
    case 'ring': {
      ctx.beginPath();
      ctx.arc(p.c.x, p.c.y, p.r, 0, Math.PI * 2);
      ctx.strokeStyle = p.stroke;
      ctx.lineWidth = p.width;
      ctx.stroke();
      break;
    }
    case 'capsule': {
      ctx.save();
      ctx.translate(p.c.x, p.c.y);
      ctx.rotate(p.angle);
      const h = p.width / 2;
      const half = Math.max(0, p.length / 2 - h);
      ctx.beginPath();
      ctx.moveTo(-half, -h);
      ctx.lineTo(half, -h);
      ctx.arc(half, 0, h, -Math.PI / 2, Math.PI / 2);
      ctx.lineTo(-half, h);
      ctx.arc(-half, 0, h, Math.PI / 2, (3 * Math.PI) / 2);
      ctx.closePath();
      ctx.strokeStyle = p.stroke;
      ctx.lineWidth = p.strokeWidth;
      ctx.stroke();
      ctx.restore();
      break;
    }
    case 'trail': {
      const a = p.points[0], b = p.points[p.points.length - 1];
      const grad = ctx.createLinearGradient(a.x, a.y, b.x, b.y);
      grad.addColorStop(0, p.tail);
      grad.addColorStop(1, p.head);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      for (let i = 1; i < p.points.length; i++) ctx.lineTo(p.points[i].x, p.points[i].y);
      ctx.strokeStyle = grad;
      ctx.lineWidth = p.width;
      ctx.stroke();
      break;
    }
    case 'glow': {
      const grad = ctx.createRadialGradient(p.c.x, p.c.y, 0, p.c.x, p.c.y, p.r);
      grad.addColorStop(0, p.color);
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.beginPath();
      ctx.arc(p.c.x, p.c.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = grad;
      ctx.fill();
      break;
    }
    case 'warning': {
      // Rounded triangle: a filled path stroked in the same colour with round joins.
      const h = p.size, w = h * 1.12;
      const r = h * 0.12;
      ctx.save();
      ctx.translate(p.c.x, p.c.y);
      ctx.beginPath();
      ctx.moveTo(0, -h / 2 + r);
      ctx.lineTo(w / 2 - r, h / 2 - r);
      ctx.lineTo(-w / 2 + r, h / 2 - r);
      ctx.closePath();
      ctx.fillStyle = p.fill;
      ctx.strokeStyle = p.fill;
      ctx.lineJoin = 'round';
      ctx.lineWidth = 2 * r;
      ctx.fill();
      ctx.stroke();
      ctx.strokeStyle = p.mark;
      ctx.fillStyle = p.mark;
      ctx.lineCap = 'round';
      ctx.lineWidth = h * 0.1;
      ctx.beginPath();
      ctx.moveTo(0, -h * 0.17);
      ctx.lineTo(0, h * 0.13);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, h * 0.29, h * 0.06, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      break;
    }
    case 'diamond': {
      ctx.save();
      ctx.translate(p.c.x, p.c.y);
      ctx.rotate(p.angle);
      ctx.beginPath();
      ctx.moveTo(p.r, 0);
      ctx.lineTo(0, p.r * 0.8);
      ctx.lineTo(-p.r, 0);
      ctx.lineTo(0, -p.r * 0.8);
      ctx.closePath();
      if (p.fill) {
        ctx.fillStyle = p.fill;
        ctx.fill();
      }
      if (p.stroke) {
        ctx.strokeStyle = p.stroke;
        ctx.lineWidth = p.strokeWidth ?? 1;
        ctx.stroke();
      }
      ctx.restore();
      break;
    }
  }
}
