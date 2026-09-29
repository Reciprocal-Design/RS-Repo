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

  it('links always end at a relay receptor on the neighbour’s wall, which feeds its pathway', () => {
    const s = mapScene();
    s.cellMap.links = { enabled: true, amount: 2 };
    const g = buildGeometry(s);
    const links = g.edges.filter((e) => e.link);
    expect(links.length).toBeGreaterThan(20);
    const cellOf = (id: string) => id.split('-')[0];
    for (const e of links) {
      const r = g.nodeById.get(e.to)!;
      expect(r.layer).toBe(0);
      expect(r.id).toMatch(/-R\d+$/);
      // A capsule is drawn for it, on the target cell's membrane.
      const rec = g.receptors.find((x) => x.nodeId === r.id)!;
      const c = g.cells.find((x) => x.id === cellOf(r.pathwayId))!;
      const d = Math.hypot(rec.center.x - c.cell.center.x, rec.center.y - c.cell.center.y);
      expect(Math.abs(d - c.cell.radiusAt(Math.atan2(rec.center.y - c.cell.center.y, rec.center.x - c.cell.center.x)))).toBeLessThan(1);
      // It feeds first-layer nodes of its own cell.
      const out = g.edges.filter((x) => x.from === r.id);
      expect(out.length).toBeGreaterThan(0);
      for (const x of out) expect(g.nodeById.get(x.to)!.layer).toBe(1);
      expect(out.every((x) => cellOf(x.to) === cellOf(r.id))).toBe(true);
    }
    const fewer = { ...s, cellMap: { ...s.cellMap, links: { enabled: true, amount: 0.5 } } };
    expect(buildGeometry(fewer).edges.filter((e) => e.link).length).toBeLessThan(links.length / 2);
  });

  it('a relay runs the neighbour’s pathway again, down a limited chain', () => {
    const s = mapScene();
    s.cellMap.links = { enabled: true, amount: 2 };
    s.cellMap.relayHops = 3;
    const g = buildGeometry(s);
    const sch = buildSchedule(s);
    const relayed = sch.edges.filter((t) => t.wave > 0 && !t.edge.link);
    expect(relayed.length).toBeGreaterThan(20);
    // A relay wave starts at a relay receptor and reaches deep layers of that cell.
    for (let w = 1; w <= 5; w++) {
      const es = sch.edges.filter((t) => t.wave === w);
      if (!es.length) continue;
      const start = Math.min(...es.map((t) => t.start));
      const src = es.find((t) => t.start === start)!.edge.from;
      expect(g.nodeById.get(src)!.id).toMatch(/-R\d+$/);
      expect(Math.max(...es.map((t) => g.nodeById.get(t.edge.to)!.layer))).toBeGreaterThan(2);
    }
    // The relay receptor pulses fully when it fires.
    const firstRelay = sch.edges.find((t) => t.wave > 0)!;
    expect(sch.pulses.get(firstRelay.edge.from)!.some((p) => p.strength === 1)).toBe(true);
    // No relays with a chain of 0; more waves with a longer chain; always finite.
    const none = { ...s, cellMap: { ...s.cellMap, relayHops: 0 } };
    expect(buildSchedule(none).edges.some((t) => t.wave > 0)).toBe(false);
    const long = { ...s, cellMap: { ...s.cellMap, relayHops: 6 } };
    const waves = (x: Scene) => new Set(buildSchedule(x).edges.map((t) => t.wave)).size;
    expect(waves(long)).toBeGreaterThanOrEqual(waves(s));
    expect(Number.isFinite(buildSchedule(long).total)).toBe(true);
    // Frames with relays still have unique ids.
    const svg = displayListToSvg(buildDisplayList(s, sch.signalEnd * 0.6, { signal: true }));
    const ids = [...svg.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('cell variation varies node and layer counts from cell to cell, within the rules', () => {
    const counts = (v: number) => {
      const s = mapScene();
      s.cellMap.variation = v;
      const g = buildGeometry(s);
      return g.cells.map((c) => {
        const ns = g.nodes.filter((n) => n.pathwayId === `${c.id}-p1` && !/-R\d+$/.test(n.id)); // relay receptors aside
        const layers = Math.max(...ns.map((n) => n.layer)) + 1;
        return `${layers}:${ns.length}`;
      });
    };
    expect(new Set(counts(0)).size).toBe(1);
    const varied = counts(1);
    expect(new Set(varied).size).toBeGreaterThan(5);
    expect(new Set(varied.map((c) => c.split(':')[0])).size).toBeGreaterThan(1);
    for (const c of varied) {
      const layers = Number(c.split(':')[0]);
      expect(layers).toBeGreaterThanOrEqual(3);
      expect(layers).toBeLessThanOrEqual(8);
    }
  });

  it('staggers cells: receptors start at different times', () => {
    const s = mapScene();
    s.cellMap.stagger = 4;
    const starts = buildGeometry(s).pathways.map((p) => p.startDelay);
    expect(Math.max(...starts) - Math.min(...starts)).toBeGreaterThan(1);
    expect(Math.max(...starts)).toBeLessThanOrEqual(4);
  });

  it('points each pathway into its cell’s widest cytoplasm', () => {
    // Nuclei pushed toward one side (a different side per cell): the receptor
    // should sit on the opposite, roomy side.
    const cells: string[] = [];
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2, cx = 120 + (i % 4) * 240, cy = 120 + Math.floor(i / 4) * 240;
      const dx = Math.cos(a), dy = Math.sin(a);
      const hex = Array.from({ length: 6 }, (_, k) => `${cx + 100 * Math.cos((Math.PI / 3) * k)},${cy + 100 * Math.sin((Math.PI / 3) * k)}`);
      cells.push(`<polygon points="${hex.join(' ')}"/><circle cx="${cx + 45 * dx}" cy="${cy + 45 * dy}" r="38"/>`);
    }
    const s = defaultScene(3);
    const m = cellMapFromSvg(parseXml(`<svg viewBox="0 0 980 500">${cells.join('')}</svg>`), 3);
    s.cellMap = { ...s.cellMap, enabled: true, viewBox: m.viewBox, cells: m.cells, links: { enabled: false, amount: 0 } };
    const side = (sc: Scene) => {
      const g = buildGeometry(sc);
      return g.cells.map((c) => {
        const r = g.nodes.find((n) => n.pathwayId.startsWith(`${c.id}-`) && n.layer === 0)!;
        // Cosine between the receptor's and the nucleus's directions from the cell centre.
        const ux = r.x - c.cell.center.x, uy = r.y - c.cell.center.y;
        const nx = c.nucleus.center.x - c.cell.center.x, ny = c.nucleus.center.y - c.cell.center.y;
        return (ux * nx + uy * ny) / (Math.hypot(ux, uy) * Math.hypot(nx, ny));
      });
    };
    for (const cos of side(s)) expect(cos).toBeLessThan(-0.8);
    // Off: a random turn per cell, so some receptors face the nucleus side.
    const random = { ...s, cellMap: { ...s.cellMap, orient: false } };
    expect(side(random).some((cos) => cos > -0.5)).toBe(true);
  });

  it('continuous motion on a map: several pathways are always active', () => {
    const s = mapScene();
    s.animation = { ...s.animation, continuous: true };
    const sch = buildSchedule(s);
    let fewest = Infinity;
    for (let t = 0.013; t < sch.total; t += 0.1) {
      const active = new Set(
        sch.edges.filter((e) => {
          const x = (((t - e.start) % sch.total) + sch.total) % sch.total;
          return x > 0 && x < e.duration;
        }).map((e) => e.edge.pathwayId),
      );
      fewest = Math.min(fewest, active.size);
    }
    expect(fewest).toBeGreaterThanOrEqual(2);
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
