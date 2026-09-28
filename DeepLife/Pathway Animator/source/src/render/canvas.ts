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
  for (const p of list.prims) drawPrim(ctx, p);
  ctx.restore();
}

function drawPrim(ctx: Ctx, p: Prim): void {
  ctx.globalAlpha = p.opacity ?? 1;
  switch (p.kind) {
    case 'closedSpline': {
      ctx.beginPath();
      ctx.moveTo(p.start.x, p.start.y);
      for (const [c1, c2, e] of p.segments) ctx.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, e.x, e.y);
      ctx.closePath();
      ctx.strokeStyle = p.stroke;
      ctx.lineWidth = p.width;
      ctx.stroke();
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
