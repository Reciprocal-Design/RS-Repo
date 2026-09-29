import { describe, expect, it } from 'vitest';
import { mapCellAt } from './cellMap';
import { defaultScene } from './defaults';
import { buildGeometry } from './geometry';
import { polygonArea } from './polygon';
import { normalizeScene, serializeScene } from './sceneIO';
import { cellMapFromSvg, classifyCells, parsePathData, parseTransform, type SvgNode } from './svgImport';
import { buildSchedule } from './timeline';
import { buildDisplayList } from '../render/displayList';
import { displayListToSvg } from '../render/svg';
import type { Scene } from './types';

/** Just enough XML for the test maps: elements, attributes, self-closing tags. */
function parseXml(text: string): SvgNode {
  const root: SvgNode & { children: SvgNode[] } = { localName: '#root', getAttribute: () => null, children: [] };
  const stack = [root];
  for (const [, close, name, attrs, self] of text.matchAll(/<(\/?)([\w:-]+)([^>]*?)(\/?)>/g)) {
    if (close) {
      stack.pop();
      continue;
    }
    const map = new Map([...attrs.matchAll(/([\w:-]+)="([^"]*)"/g)].map(([, k, v]) => [k, v]));
    const node = { localName: name.replace(/^.*:/, ''), getAttribute: (k: string) => map.get(k) ?? null, children: [] as SvgNode[] };
    stack[stack.length - 1].children.push(node);
    if (!self) stack.push(node);
  }
  return root.children[0];
}

/** A Voronoi-like test map: a 5 × 4 grid of touching hexagons, each with a nucleus. */
function hexMap(): string {
  const r = 50, w = Math.sqrt(3) * r;
  const shapes: string[] = [];
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 5; col++) {
      const cx = 60 + col * w + (row % 2) * (w / 2), cy = 60 + row * 1.5 * r;
      const pts = Array.from({ length: 6 }, (_, k) => {
        const a = (Math.PI / 3) * k + Math.PI / 6;
        return `${(cx + r * Math.cos(a)).toFixed(3)},${(cy + r * Math.sin(a)).toFixed(3)}`;
      });
      const i = row * 5 + col;
      // Mix the ways cells are drawn: polygon + ellipse, path + circle, path with arcs.
      if (i % 3 === 0) {
        shapes.push(`<polygon points="${pts.join(' ')}" fill="none" stroke="#fff"/>`);
        shapes.push(`<ellipse cx="${cx + 4}" cy="${cy - 3}" rx="20" ry="16"/>`);
      } else if (i % 3 === 1) {
        shapes.push(`<path d="M${pts.join(' L')} Z"/>`);
        shapes.push(`<circle cx="${cx}" cy="${cy}" r="18"/>`);
      } else {
        shapes.push(`<path d="M${pts.join('L')}z"/>`);
        shapes.push(`<path d="M${cx - 18},${cy} a18 18 0 1 0 36 0 a18 18 0 1 0 -36 0z"/>`);
      }
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 500">
  <rect x="0" y="0" width="900" height="500" fill="#000"/>
  <defs><clipPath id="x"><rect x="0" y="0" width="10" height="10"/></clipPath></defs>
  <g transform="translate(10 5)">${shapes.join('\n')}</g>
</svg>`;
}

function mapScene(seed = 7): Scene {
  const s = defaultScene(seed);
  const imported = cellMapFromSvg(parseXml(hexMap()), seed);
  s.cellMap = { ...s.cellMap, enabled: true, name: 'hex.svg', viewBox: imported.viewBox, cells: imported.cells, detailScale: 0.55 };
  s.pathwayCount = 1;
  return s;
}

describe('SVG path parsing', () => {
  it('reads absolute and relative commands, implicit repeats and Z', () => {
    const [sp] = parsePathData('m10 10 h20 v20 l-20 0 z');
    expect(sp.closed).toBe(true);
    expect(Math.abs(polygonArea(sp.points))).toBeCloseTo(400, 6);
    const [a, b] = parsePathData('M0,0 10,0 10,10 0,10Z M20 20 L30 20 30 30 Z');
    expect(a.points.length).toBe(4);
    expect(b.points[1]).toEqual({ x: 30, y: 20 });
  });

  it('flattens arcs (including packed flags) and curves', () => {
    // A sampled circle is a 32-gon: within 1% of the true area.
    const area = (d: string) => Math.abs(polygonArea(parsePathData(d)[0].points));
    expect(area('M0,0a5,5 0 1,0 10,0a5 5 0 1 0 -10 0z') / (Math.PI * 25)).toBeCloseTo(1, 1);
    expect(area('M0 0a5 5 0 1010 0a5 5 0 10-10 0z') / (Math.PI * 25)).toBeCloseTo(1, 1);
    const [curve] = parsePathData('M0 0 C0 10 10 10 10 0 S20 -10 20 0 Q25 5 30 0 T40 0 Z');
    expect(curve.points.length).toBeGreaterThan(30);
  });

  it('composes transforms', () => {
    const m = parseTransform('translate(10 20) scale(2)');
    expect(m).toEqual([2, 0, 0, 2, 10, 20]);
    const r = parseTransform('rotate(90 5 5)');
    expect(r[4]).toBeCloseTo(10, 9);
    expect(r[5]).toBeCloseTo(0, 9);
  });
});

describe('cell map import', () => {
  it('pairs membranes and nuclei, ignoring the background and defs', () => {
    const m = cellMapFromSvg(parseXml(hexMap()));
    expect(m.cells.length).toBe(20);
    expect(m.cells.every((c) => c.nucleus && c.nucleus.length >= 6)).toBe(true);
    expect(m.viewBox).toEqual({ x: 0, y: 0, width: 900, height: 500 });
    // The group transform was applied: the first cell sits right of x = 10.
    expect(Math.min(...m.cells[0].membrane.filter((_, i) => i % 2 === 0))).toBeGreaterThan(10);
  });

  it('merges duplicate outlines and adds a missing nucleus', () => {
    const sq = (x: number, s: number) => [{ x, y: 0 }, { x: x + s, y: 0 }, { x: x + s, y: s }, { x, y: s }];
    const cells = classifyCells([sq(0, 100), sq(0, 100), sq(30, 40), sq(200, 100)]);
    expect(cells.length).toBe(2);
    expect(cells.filter((c) => c.nucleus).length).toBe(1);
  });

  it('rejects an SVG with no closed shapes', () => {
    expect(() => cellMapFromSvg(parseXml('<svg><line x1="0" y1="0" x2="5" y2="5"/></svg>'))).toThrow(/No closed cell shapes/);
  });
});

describe('pathways on a cell map', () => {
  it('lays pathways out inside each enabled cell only', () => {
    const s = mapScene();
    s.cellMap.cells[3].enabled = false;
    const g = buildGeometry(s);
    expect(g.cells.length).toBe(20);
    const cellOf = new Map(g.cells.map((c) => [c.id, c]));
    for (const n of g.nodes) {
      const id = n.pathwayId.split('-')[0];
      const c = cellOf.get(id)!;
      const d = Math.hypot(n.x - c.cell.center.x, n.y - c.cell.center.y);
      expect(d).toBeLessThan(c.cell.radiusAt(Math.atan2(n.y - c.cell.center.y, n.x - c.cell.center.x)) + 1e-6);
      if (n.layer > 0) {
        const dn = Math.hypot(n.x - c.nucleus.center.x, n.y - c.nucleus.center.y);
        const rn = c.nucleus.radiusAt(Math.atan2(n.y - c.nucleus.center.y, n.x - c.nucleus.center.x));
        expect(n.region === 'nucleus' ? dn < rn : dn > rn).toBe(true);
      }
    }
    expect(g.nodes.some((n) => n.pathwayId.startsWith('c4-'))).toBe(false);
    expect(g.pathways.length).toBe(19);
    for (const e of g.edges) expect(Number.isFinite(e.length) && e.length > 0).toBe(true);
  });

  it('cells vary: the same settings give different networks', () => {
    const g = buildGeometry(mapScene());
    const shape = (c: string) => g.edges.filter((e) => e.pathwayId.startsWith(`${c}-`) && !e.id.startsWith('link-')).length;
    const counts = new Set(g.cells.map((c) => shape(c.id)));
    expect(counts.size).toBeGreaterThan(2);
  });

  it('links only touching cells, into a receptor, and the signal spreads through them', () => {
    const s = mapScene();
    s.cellMap.links = { enabled: true, amount: 1 };
    const g = buildGeometry(s);
    const links = g.edges.filter((e) => e.id.startsWith('link-'));
    expect(links.length).toBeGreaterThan(5);
    for (const e of links) {
      const a = g.nodeById.get(e.from)!, b = g.nodeById.get(e.to)!;
      expect(a.pathwayId.split('-')[0]).not.toBe(b.pathwayId.split('-')[0]);
      expect(b.layer).toBe(0);
      expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeLessThan(200);
    }
    const sch = buildSchedule(s);
    for (const e of links) expect(sch.edges.some((t) => t.edge === e)).toBe(true);
    s.cellMap.links.enabled = false;
    const off = { ...s, cellMap: { ...s.cellMap, links: { enabled: false, amount: 1 } } };
    expect(buildGeometry(off).edges.some((e) => e.id.startsWith('link-'))).toBe(false);
  });

  it('staggers cells: receptors start at different times', () => {
    const s = mapScene();
    s.cellMap.stagger = 4;
    const starts = buildGeometry(s).pathways.map((p) => p.startDelay);
    expect(Math.max(...starts) - Math.min(...starts)).toBeGreaterThan(1);
    expect(Math.max(...starts)).toBeLessThanOrEqual(4);
  });

  it('finds the clicked cell', () => {
    const s = mapScene();
    const g = buildGeometry(s);
    const c = g.cells[5];
    expect(mapCellAt(s, c.cell.center)?.id).toBe(c.id);
    expect(mapCellAt(s, { x: 1, y: 1 })).toBeUndefined();
  });

  it('exports SVG with a clip path per cell, and round-trips through scene JSON', () => {
    const s = mapScene();
    const svg = displayListToSvg(buildDisplayList(s, 0, { signal: false }));
    const ids = [...svg.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]);
    expect(new Set(ids).size).toBe(ids.length);
    expect((svg.match(/<clipPath /g) ?? []).length).toBe(20);
    const back = normalizeScene(JSON.parse(serializeScene(s)));
    expect(back.cellMap).toEqual(s.cellMap);
    expect(buildGeometry(back).nodes.length).toBe(buildGeometry(s).nodes.length);
  });

  it('turning the map off restores the single cell exactly', () => {
    const plain = defaultScene(7);
    const s = mapScene();
    s.cellMap.enabled = false;
    const pos = (x: Scene) => buildGeometry(x).nodes.map((n) => [n.id, n.x, n.y]);
    expect(pos({ ...s, pathwayCount: plain.pathwayCount })).toEqual(pos(plain));
  });
});
