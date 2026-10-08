import { hexString, parseColor } from '../core/color';
import type { DisplayList, Group, Prim } from './displayList';

// SVG backend: the same display list as the canvas, written as clean, editable
// vector for Illustrator. Named groups, one gradient per edge, colours as hex
// plus opacity (Illustrator ignores rgba()), nothing rasterised.

const GROUP_ORDER: Group[] = [
  'membrane',
  'nucleus',
  'mesh',
  'particles',
  'receptors',
  'edges',
  'crosstalk',
  'signal',
  'nodes-active',
  'nodes-inactive',
];

const n = (v: number) => {
  const r = Math.round(v * 100) / 100;
  return Object.is(r, -0) ? '0' : String(r);
};
const safeId = (id: string) => id.replace(/[^A-Za-z0-9_-]/g, '_');

/** Split any CSS colour into an SVG-friendly hex colour and opacity. */
function paint(color: string): { hex: string; alpha: number } {
  const c = parseColor(color);
  return { hex: hexString(c), alpha: c[3] };
}
const opacityAttr = (name: string, a: number) => (a < 0.999 ? ` ${name}="${+a.toFixed(3)}"` : '');
const fillAttrs = (color: string) => {
  const p = paint(color);
  return `fill="${p.hex}"${opacityAttr('fill-opacity', p.alpha)}`;
};
const strokeAttrs = (color: string) => {
  const p = paint(color);
  return `stroke="${p.hex}"${opacityAttr('stroke-opacity', p.alpha)}`;
};
const stop = (offset: number, color: string) => {
  const p = paint(color);
  return `<stop offset="${offset}" stop-color="${p.hex}"${opacityAttr('stop-opacity', p.alpha)}/>`;
};

export interface SvgOptions {
  transparent?: boolean;
}

export function displayListToSvg(list: DisplayList, opts: SvgOptions = {}): string {
  const defs: string[] = [];
  const clips = new Set<string>();
  const groups = new Map<Group, string[]>(GROUP_ORDER.map((g) => [g, []]));

  // Underlays (a membrane cross-fading to another colour) come first in their group, each as one faded group.
  for (const u of list.underlays ?? []) {
    if (u.opacity <= 0.001) continue;
    const els = u.prims.map((p) => primToSvg(p, defs, clips)).filter((el): el is string => !!el);
    if (!els.length) continue;
    groups.get(u.prims[0].group)!.push(`<g id="${safeId(u.id)}"${opacityAttr('opacity', u.opacity)}>\n${els.join('\n')}\n</g>`);
  }
  for (const p of list.prims) {
    const el = primToSvg(p, defs, clips);
    if (el) groups.get(p.group)!.push(el);
  }

  const out: string[] = [];
  out.push('<?xml version="1.0" encoding="UTF-8"?>');
  out.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${list.width}" height="${list.height}" viewBox="0 0 ${list.width} ${list.height}">`,
  );
  if (defs.length) out.push(`<defs>\n${defs.join('\n')}\n</defs>`);
  if (!opts.transparent) {
    out.push(`<rect id="background" x="0" y="0" width="${list.width}" height="${list.height}" ${fillAttrs(list.background)}/>`);
  }
  for (const g of GROUP_ORDER) {
    const items = groups.get(g)!;
    if (!items.length) continue;
    out.push(`<g id="${g}">\n${items.join('\n')}\n</g>`);
  }
  out.push('</svg>');
  return out.join('\n');
}

function primToSvg(p: Prim, defs: string[], clips: Set<string>): string | null {
  const id = safeId(p.id);
  const op = p.opacity ?? 1;
  if (op <= 0) return null;
  const opacity = opacityAttr('opacity', op);
  const blend = p.blend === 'lighter' ? ' style="mix-blend-mode:screen"' : '';

  switch (p.kind) {
    case 'closedSpline': {
      let d = `M${n(p.start.x)},${n(p.start.y)}`;
      for (const [a, b, e] of p.segments) d += ` C${n(a.x)},${n(a.y)} ${n(b.x)},${n(b.y)} ${n(e.x)},${n(e.y)}`;
      let clip = '';
      if (p.clip) {
        const cid = `clip-${safeId(p.clip)}`;
        if (!clips.has(cid)) {
          clips.add(cid);
          defs.push(`<clipPath id="${cid}"><path d="${d} Z"/></clipPath>`);
        }
        clip = ` clip-path="url(#${cid})"`;
      }
      return `<path id="${id}" d="${d} Z" fill="none" ${strokeAttrs(p.stroke)} stroke-width="${n(p.width)}"${opacity}${clip}/>`;
    }
    case 'bezier': {
      const [a, b, c, e] = p.p;
      const gid = `grad-${id}`;
      defs.push(
        `<linearGradient id="${gid}" gradientUnits="userSpaceOnUse" x1="${n(a.x)}" y1="${n(a.y)}" x2="${n(e.x)}" y2="${n(e.y)}">${stop(0, p.from)}${stop(1, p.to)}</linearGradient>`,
      );
      const d = `M${n(a.x)},${n(a.y)} C${n(b.x)},${n(b.y)} ${n(c.x)},${n(c.y)} ${n(e.x)},${n(e.y)}`;
      return `<path id="${id}" d="${d}" fill="none" stroke="url(#${gid})" stroke-width="${n(p.width)}" stroke-linecap="round"${opacity}/>`;
    }
    case 'circle':
      return `<circle id="${id}" cx="${n(p.c.x)}" cy="${n(p.c.y)}" r="${n(p.r)}" ${fillAttrs(p.fill)}${opacity}${blend}/>`;
    case 'ring':
      return `<circle id="${id}" cx="${n(p.c.x)}" cy="${n(p.c.y)}" r="${n(p.r)}" fill="none" ${strokeAttrs(p.stroke)} stroke-width="${n(p.width)}"${opacity}/>`;
    case 'capsule': {
      const deg = (p.angle * 180) / Math.PI;
      const w = Math.min(p.width, p.length);
      return `<rect id="${id}" x="${n(-p.length / 2)}" y="${n(-w / 2)}" width="${n(p.length)}" height="${n(w)}" rx="${n(w / 2)}" fill="none" ${strokeAttrs(p.stroke)} stroke-width="${n(p.strokeWidth)}" transform="translate(${n(p.c.x)} ${n(p.c.y)}) rotate(${n(deg)})"${opacity}/>`;
    }
    case 'diamond': {
      const deg = (p.angle * 180) / Math.PI;
      const pts = `${n(p.r)},0 0,${n(p.r * 0.8)} ${n(-p.r)},0 0,${n(-p.r * 0.8)}`;
      const fill = p.fill ? fillAttrs(p.fill) : 'fill="none"';
      const stroke = p.stroke ? ` ${strokeAttrs(p.stroke)} stroke-width="${n(p.strokeWidth ?? 1)}"` : '';
      return `<polygon id="${id}" points="${pts}" ${fill}${stroke} transform="translate(${n(p.c.x)} ${n(p.c.y)}) rotate(${n(deg)})"${opacity}/>`;
    }
    case 'trail': {
      const a = p.points[0], e = p.points[p.points.length - 1];
      const gid = `grad-${id}`;
      defs.push(
        `<linearGradient id="${gid}" gradientUnits="userSpaceOnUse" x1="${n(a.x)}" y1="${n(a.y)}" x2="${n(e.x)}" y2="${n(e.y)}">${stop(0, p.tail)}${stop(1, p.head)}</linearGradient>`,
      );
      const d = p.points.map((q, i) => `${i ? 'L' : 'M'}${n(q.x)},${n(q.y)}`).join(' ');
      return `<path id="${id}" d="${d}" fill="none" stroke="url(#${gid})" stroke-width="${n(p.width)}" stroke-linejoin="round"${opacity}${blend}/>`;
    }
    case 'dots': {
      const out: string[] = [];
      for (const b of p.buckets) {
        for (let i = 0; i < b.pts.length; i += 3) {
          out.push(`<circle cx="${n(b.pts[i])}" cy="${n(b.pts[i + 1])}" r="${n(b.pts[i + 2])}" ${fillAttrs(b.color)}/>`);
        }
      }
      return `<g id="${id}"${opacity}${blend}>${out.join('')}</g>`;
    }
    case 'segments': {
      let d = '';
      for (let i = 0; i < p.pts.length; i += 4) d += `M${n(p.pts[i])},${n(p.pts[i + 1])}L${n(p.pts[i + 2])},${n(p.pts[i + 3])}`;
      return `<path id="${id}" d="${d}" fill="none" ${strokeAttrs(p.stroke)} stroke-width="${n(p.width)}" stroke-linecap="round"${opacity}/>`;
    }
    case 'warning': {
      const h = p.size, w = h * 1.12, r = h * 0.12;
      const tri = `${n(0)},${n(-h / 2 + r)} ${n(w / 2 - r)},${n(h / 2 - r)} ${n(-w / 2 + r)},${n(h / 2 - r)}`;
      return `<g id="${id}" transform="translate(${n(p.c.x)} ${n(p.c.y)})"${opacity}>`
        + `<polygon points="${tri}" ${fillAttrs(p.fill)} ${strokeAttrs(p.fill)} stroke-width="${n(2 * r)}" stroke-linejoin="round"/>`
        + `<line x1="0" y1="${n(-h * 0.17)}" x2="0" y2="${n(h * 0.13)}" ${strokeAttrs(p.mark)} stroke-width="${n(h * 0.1)}" stroke-linecap="round"/>`
        + `<circle cx="0" cy="${n(h * 0.29)}" r="${n(h * 0.06)}" ${fillAttrs(p.mark)}/></g>`;
    }
    case 'glow': {
      const gid = `grad-${id}`;
      defs.push(`<radialGradient id="${gid}">${stop(0, p.color)}${stop(1, 'rgba(0,0,0,0)')}</radialGradient>`);
      return `<circle id="${id}" cx="${n(p.c.x)}" cy="${n(p.c.y)}" r="${n(p.r)}" fill="url(#${gid})"${opacity}${blend}/>`;
    }
  }
}
