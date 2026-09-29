import { polygonArea, polygonCentroid, pointInPolygon } from './polygon';
import type { MapCell, Vec2 } from './types';

// Import a cell map from SVG: every closed shape is collected (paths, polygons,
// rects, circles, ellipses, with their transforms applied), then shapes are
// paired by containment: a membrane is a top-level closed shape and its
// nucleus is the largest shape inside it. A frame or background shape that
// holds several cells is ignored.

/** The little of the DOM the importer reads, so it can be tested without a browser. */
export interface SvgNode {
  localName: string;
  getAttribute(name: string): string | null;
  children: ArrayLike<SvgNode>;
}

type Matrix = [number, number, number, number, number, number]; // a b c d e f
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];
const mul = (m: Matrix, n: Matrix): Matrix => [
  m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
];
const apply = (m: Matrix, p: Vec2): Vec2 => ({ x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] });

const NUMBER = /[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g;
const numbers = (s: string | null) => (s ?? '').match(NUMBER)?.map(Number) ?? [];

export function parseTransform(s: string | null): Matrix {
  let m = IDENTITY;
  for (const [, fn, args] of (s ?? '').matchAll(/(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g)) {
    const a = numbers(args);
    let t: Matrix = IDENTITY;
    if (fn === 'matrix' && a.length === 6) t = a as Matrix;
    else if (fn === 'translate') t = [1, 0, 0, 1, a[0] ?? 0, a[1] ?? 0];
    else if (fn === 'scale') t = [a[0] ?? 1, 0, 0, a[1] ?? a[0] ?? 1, 0, 0];
    else if (fn === 'rotate') {
      const r = ((a[0] ?? 0) * Math.PI) / 180, c = Math.cos(r), sn = Math.sin(r);
      const [cx, cy] = [a[1] ?? 0, a[2] ?? 0];
      t = mul(mul([1, 0, 0, 1, cx, cy], [c, sn, -sn, c, 0, 0]), [1, 0, 0, 1, -cx, -cy]);
    } else if (fn === 'skewX') t = [1, 0, Math.tan(((a[0] ?? 0) * Math.PI) / 180), 1, 0, 0];
    else if (fn === 'skewY') t = [1, Math.tan(((a[0] ?? 0) * Math.PI) / 180), 0, 1, 0, 0];
    m = mul(m, t);
  }
  return m;
}

const CURVE_STEPS = 10;

/** SVG elliptical arc (endpoint form) sampled as points after `p0`, per the SVG spec's conversion. */
function arcPoints(p0: Vec2, rx: number, ry: number, rotDeg: number, large: boolean, sweep: boolean, p1: Vec2): Vec2[] {
  rx = Math.abs(rx);
  ry = Math.abs(ry);
  if (!rx || !ry) return [p1];
  const phi = (rotDeg * Math.PI) / 180, cos = Math.cos(phi), sin = Math.sin(phi);
  const dx = (p0.x - p1.x) / 2, dy = (p0.y - p1.y) / 2;
  const x1 = cos * dx + sin * dy, y1 = -sin * dx + cos * dy;
  const lambda = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry);
  if (lambda > 1) {
    rx *= Math.sqrt(lambda);
    ry *= Math.sqrt(lambda);
  }
  const num = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1;
  const den = rx * rx * y1 * y1 + ry * ry * x1 * x1;
  const k = (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0, num / den));
  const cx1 = (k * rx * y1) / ry, cy1 = (-k * ry * x1) / rx;
  const cx = cos * cx1 - sin * cy1 + (p0.x + p1.x) / 2, cy = sin * cx1 + cos * cy1 + (p0.y + p1.y) / 2;
  const ang = (ux: number, uy: number, vx: number, vy: number) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  const th1 = ang(1, 0, (x1 - cx1) / rx, (y1 - cy1) / ry);
  let dth = ang((x1 - cx1) / rx, (y1 - cy1) / ry, (-x1 - cx1) / rx, (-y1 - cy1) / ry);
  if (!sweep && dth > 0) dth -= 2 * Math.PI;
  if (sweep && dth < 0) dth += 2 * Math.PI;
  const steps = Math.max(4, Math.ceil((Math.abs(dth) / (2 * Math.PI)) * 32));
  const out: Vec2[] = [];
  for (let i = 1; i <= steps; i++) {
    const t = th1 + (dth * i) / steps;
    const ex = rx * Math.cos(t), ey = ry * Math.sin(t);
    out.push({ x: cos * ex - sin * ey + cx, y: sin * ex + cos * ey + cy });
  }
  out[out.length - 1] = p1;
  return out;
}

export interface Subpath {
  points: Vec2[];
  closed: boolean;
}

/** Flatten SVG path data into polylines, one per subpath. */
export function parsePathData(d: string): Subpath[] {
  const out: Subpath[] = [];
  let i = 0;
  const skip = () => {
    while (i < d.length && /[\s,]/.test(d[i])) i++;
  };
  const num = (): number => {
    skip();
    NUMBER.lastIndex = i;
    const m = NUMBER.exec(d);
    if (!m || m.index !== i) throw new Error('bad path number');
    i += m[0].length;
    return Number(m[0]);
  };
  const flag = (): boolean => {
    skip();
    const c = d[i++];
    if (c !== '0' && c !== '1') throw new Error('bad arc flag');
    return c === '1';
  };
  let cur: Vec2 = { x: 0, y: 0 }, start: Vec2 = cur;
  let pts: Vec2[] = [];
  let lastCtrl: Vec2 | null = null, lastCmd = '';
  const flush = (closed: boolean) => {
    if (pts.length > 1) out.push({ points: pts, closed });
    pts = [];
  };
  const cubic = (c1: Vec2, c2: Vec2, e: Vec2) => {
    const p0 = cur;
    for (let s = 1; s <= CURVE_STEPS; s++) {
      const t = s / CURVE_STEPS, u = 1 - t;
      pts.push({
        x: u * u * u * p0.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * e.x,
        y: u * u * u * p0.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * e.y,
      });
    }
    cur = e;
  };
  const quad = (c: Vec2, e: Vec2) => {
    const p0 = cur;
    for (let s = 1; s <= CURVE_STEPS; s++) {
      const t = s / CURVE_STEPS, u = 1 - t;
      pts.push({ x: u * u * p0.x + 2 * u * t * c.x + t * t * e.x, y: u * u * p0.y + 2 * u * t * c.y + t * t * e.y });
    }
    cur = e;
  };

  try {
    while (true) {
      skip();
      if (i >= d.length) break;
      let cmd = d[i];
      if (/[a-zA-Z]/.test(cmd)) i++;
      else if (lastCmd) cmd = lastCmd === 'M' ? 'L' : lastCmd === 'm' ? 'l' : lastCmd; // implicit repeat
      else break;
      const rel = cmd === cmd.toLowerCase();
      const P = (x: number, y: number): Vec2 => (rel ? { x: cur.x + x, y: cur.y + y } : { x, y });
      const C = cmd.toUpperCase();
      let ctrl: Vec2 | null = null;
      switch (C) {
        case 'M': {
          flush(false);
          cur = P(num(), num());
          start = cur;
          pts = [cur];
          break;
        }
        case 'L': cur = P(num(), num()); pts.push(cur); break;
        case 'H': cur = { x: rel ? cur.x + num() : num(), y: cur.y }; pts.push(cur); break;
        case 'V': cur = { x: cur.x, y: rel ? cur.y + num() : num() }; pts.push(cur); break;
        case 'C': {
          const c1 = P(num(), num()), c2 = P(num(), num()), e = P(num(), num());
          cubic(c1, c2, e);
          ctrl = c2;
          break;
        }
        case 'S': {
          const c1 = lastCtrl && /[CcSs]/.test(lastCmd) ? { x: 2 * cur.x - lastCtrl.x, y: 2 * cur.y - lastCtrl.y } : cur;
          const c2 = P(num(), num()), e = P(num(), num());
          cubic(c1, c2, e);
          ctrl = c2;
          break;
        }
        case 'Q': {
          const c = P(num(), num()), e = P(num(), num());
          quad(c, e);
          ctrl = c;
          break;
        }
        case 'T': {
          const c: Vec2 = lastCtrl && /[QqTt]/.test(lastCmd) ? { x: 2 * cur.x - lastCtrl.x, y: 2 * cur.y - lastCtrl.y } : cur;
          quad(c, P(num(), num()));
          ctrl = c;
          break;
        }
        case 'A': {
          const rx = num(), ry = num(), rot = num(), large = flag(), sweep = flag();
          const e = P(num(), num());
          pts.push(...arcPoints(cur, rx, ry, rot, large, sweep, e));
          cur = e;
          break;
        }
        case 'Z': {
          flush(true);
          cur = start;
          pts = [cur];
          break;
        }
        default:
          throw new Error(`unknown path command ${cmd}`);
      }
      lastCtrl = ctrl;
      // Numbers after a command repeat it (after M, as L); none may follow Z.
      lastCmd = C === 'Z' ? '' : cmd;
    }
  } catch {
    // Keep what parsed cleanly before the error, as browsers do.
  }
  flush(false);
  return out;
}

const SKIP = new Set(['defs', 'clippath', 'mask', 'symbol', 'marker', 'pattern', 'lineargradient', 'radialgradient', 'style', 'title', 'desc', 'metadata', 'text', 'image', 'use']);
const len = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y);

function hidden(n: SvgNode): boolean {
  const style = (n.getAttribute('style') ?? '').replace(/\s/g, '');
  return n.getAttribute('display') === 'none' || n.getAttribute('visibility') === 'hidden' || /display:none|visibility:hidden/.test(style);
}

function ellipsePoints(cx: number, cy: number, rx: number, ry: number): Vec2[] {
  return Array.from({ length: 48 }, (_, i) => {
    const t = (i / 48) * Math.PI * 2;
    return { x: cx + rx * Math.cos(t), y: cy + ry * Math.sin(t) };
  });
}

/** Every closed shape under `node`, as polygons in root user units. */
export function collectShapes(node: SvgNode, m: Matrix = IDENTITY): Vec2[][] {
  const out: Vec2[][] = [];
  const attr = (n: SvgNode, k: string) => Number(numbers(n.getAttribute(k))[0] ?? 0);
  for (const child of Array.from(node.children)) {
    const tag = child.localName.toLowerCase();
    if (SKIP.has(tag) || hidden(child)) continue;
    const cm = mul(m, parseTransform(child.getAttribute('transform')));
    let polys: Vec2[][] = [];
    switch (tag) {
      case 'g': case 'a': case 'switch': case 'svg':
        out.push(...collectShapes(child, cm));
        continue;
      case 'path':
        for (const sp of parsePathData(child.getAttribute('d') ?? '')) {
          const p = sp.points;
          // An open subpath that ends where it started is closed in practice.
          const closed = sp.closed || (p.length > 2 && len(p[0], p[p.length - 1]) < 1e-6 * (1 + Math.abs(p[0].x) + Math.abs(p[0].y)) + 0.01);
          if (closed) polys.push(p);
        }
        break;
      case 'polygon': case 'polyline': {
        const a = numbers(child.getAttribute('points'));
        const p: Vec2[] = [];
        for (let k = 0; k + 1 < a.length; k += 2) p.push({ x: a[k], y: a[k + 1] });
        if (tag === 'polygon' || (p.length > 2 && len(p[0], p[p.length - 1]) < 0.01)) polys.push(p);
        break;
      }
      case 'rect': {
        const x = attr(child, 'x'), y = attr(child, 'y'), w = attr(child, 'width'), h = attr(child, 'height');
        if (w > 0 && h > 0) polys.push([{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }]);
        break;
      }
      case 'circle': {
        const r = attr(child, 'r');
        if (r > 0) polys.push(ellipsePoints(attr(child, 'cx'), attr(child, 'cy'), r, r));
        break;
      }
      case 'ellipse': {
        const rx = attr(child, 'rx'), ry = attr(child, 'ry');
        if (rx > 0 && ry > 0) polys.push(ellipsePoints(attr(child, 'cx'), attr(child, 'cy'), rx, ry));
        break;
      }
      default:
        continue;
    }
    for (const p of polys) {
      // Drop a repeated closing point; keep shapes with a real area.
      const q = p.map((v) => apply(cm, v));
      if (q.length > 3 && len(q[0], q[q.length - 1]) < 1e-9) q.pop();
      if (q.length >= 3 && Math.abs(polygonArea(q)) > 1e-9) out.push(q);
    }
  }
  return out;
}

interface Shape {
  pts: Vec2[];
  area: number;
  c: Vec2;
}

/** Is shape `a` inside shape `b`? Its centre and most of its outline must be. */
function inside(a: Shape, b: Shape): boolean {
  if (a.area >= b.area || !pointInPolygon(a.c, b.pts)) return false;
  const step = Math.max(1, Math.floor(a.pts.length / 12));
  let n = 0, k = 0;
  for (let i = 0; i < a.pts.length; i += step, n++) if (pointInPolygon(a.pts[i], b.pts)) k++;
  return k >= 0.8 * n;
}

export interface ClassifiedCell {
  membrane: Vec2[];
  nucleus: Vec2[] | null;
}

/**
 * Pair shapes into cells. Duplicates (e.g. a fill and a stroke copy of the
 * same outline) are merged; a shape holding several cells (a frame or
 * background) is treated as a container, not a cell.
 */
export function classifyCells(polys: Vec2[][]): ClassifiedCell[] {
  const shapes: Shape[] = [];
  for (const pts of polys) {
    const s = { pts, area: Math.abs(polygonArea(pts)), c: polygonCentroid(pts) };
    const dup = shapes.some((o) => Math.abs(o.area - s.area) < 0.01 * s.area && len(o.c, s.c) < 0.01 * Math.sqrt(s.area));
    if (!dup) shapes.push(s);
  }
  shapes.sort((a, b) => b.area - a.area);
  // Immediate parent: the smallest shape that contains it.
  const parent = shapes.map((s, i) => {
    for (let j = i - 1; j >= 0; j--) if (inside(s, shapes[j])) return j;
    return -1;
  });
  const children = shapes.map((_, i) => parent.map((p, k) => (p === i ? k : -1)).filter((k) => k >= 0));
  const container = (i: number) =>
    children[i].filter((k) => children[k].length > 0).length >= 2 || children[i].length >= 4;
  const top = (i: number) => !container(i) && (parent[i] < 0 || container(parent[i]));
  const candidates = shapes.map((_, i) => i).filter(top);
  if (!candidates.length) return [];
  // Ignore stray small top-level marks.
  const areas = candidates.map((i) => shapes[i].area).sort((a, b) => a - b);
  const median = areas[Math.floor(areas.length / 2)];
  return candidates
    .filter((i) => shapes[i].area >= 0.15 * median)
    .map((i) => {
      const nuc = children[i].find((k) => shapes[k].area <= 0.9 * shapes[i].area);
      return { membrane: shapes[i].pts, nucleus: nuc === undefined ? null : shapes[nuc].pts };
    });
}

export const MAX_MAP_CELLS = 60;

export interface ImportedMap {
  viewBox: { x: number; y: number; width: number; height: number };
  cells: MapCell[];
  warnings: string[];
}

const flat = (pts: Vec2[]) => pts.flatMap((p) => [+p.x.toFixed(2), +p.y.toFixed(2)]);

/** Build a cell map from a parsed SVG root. */
export function cellMapFromSvg(root: SvgNode, seed = 1): ImportedMap {
  if (root.localName.toLowerCase() !== 'svg') throw new Error('This file is not an SVG.');
  const cells = classifyCells(collectShapes(root));
  if (!cells.length) {
    throw new Error('No closed cell shapes found. Draw each membrane and nucleus as a closed path, polygon, circle or ellipse.');
  }
  const warnings: string[] = [];
  // Reading order: top to bottom, then left to right.
  cells.sort((a, b) => {
    const ca = polygonCentroid(a.membrane), cb = polygonCentroid(b.membrane);
    return ca.y - cb.y || ca.x - cb.x;
  });
  if (cells.length > MAX_MAP_CELLS) {
    warnings.push(`Found ${cells.length} cells; using the first ${MAX_MAP_CELLS}.`);
    cells.length = MAX_MAP_CELLS;
  }
  const missing = cells.filter((c) => !c.nucleus).length;
  if (missing) warnings.push(`${missing} cell${missing > 1 ? 's have' : ' has'} no nucleus; one was added.`);

  let vb = numbers(root.getAttribute('viewBox'));
  if (vb.length !== 4 || vb[2] <= 0 || vb[3] <= 0) {
    const w = numbers(root.getAttribute('width'))[0], h = numbers(root.getAttribute('height'))[0];
    if (w > 0 && h > 0) vb = [0, 0, w, h];
    else {
      const all = cells.flatMap((c) => c.membrane);
      const xs = all.map((p) => p.x), ys = all.map((p) => p.y);
      vb = [Math.min(...xs), Math.min(...ys), Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)];
    }
  }
  return {
    viewBox: { x: vb[0], y: vb[1], width: vb[2], height: vb[3] },
    cells: cells.map((c, i) => ({
      id: `c${i + 1}`,
      membrane: flat(c.membrane),
      nucleus: c.nucleus ? flat(c.nucleus) : null,
      enabled: true,
      seed: (seed * 7919 + i * 104729) >>> 0,
    })),
    warnings,
  };
}

/** Parse SVG text in the browser. */
export function importCellMapSvg(text: string, seed = 1): ImportedMap {
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('This SVG could not be read.');
  return cellMapFromSvg(doc.documentElement as unknown as SvgNode, seed);
}
