import { describe, expect, it } from 'vitest';
import { defaultScene } from './defaults';
import { buildGeometry } from './geometry';
import { addLayer, canRemoveLayer, regionOptions, removeLayer, setCounts, setRegion } from './layers';
import type { NodeGeom, Scene } from './types';

const clone = (s: Scene): Scene => structuredClone(s);
const positions = (s: Scene, keep: (n: NodeGeom) => boolean = () => true) =>
  buildGeometry(s).nodes.filter(keep).map((n) => [n.id, +n.x.toFixed(6), +n.y.toFixed(6)]);

function withLayers(s: Scene, fn: (l: Scene['pathways'][0]['layers']) => Scene['pathways'][0]['layers']): Scene {
  const c = clone(s);
  c.pathways[0].layers = fn(c.pathways[0].layers);
  return c;
}

describe('determinism', () => {
  it('same scene JSON → identical geometry', () => {
    const a = defaultScene(42);
    const b = JSON.parse(JSON.stringify(a));
    const ga = buildGeometry(a), gb = buildGeometry(b);
    expect(positions(a)).toEqual(positions(b));
    expect(ga.edges.map((e) => [e.id, e.opacity])).toEqual(gb.edges.map((e) => [e.id, e.opacity]));
  });
});

describe('stability', () => {
  const base = defaultScene(7);

  it('hiding membrane or nucleus never moves anything', () => {
    const s = clone(base);
    s.cell.visible = false;
    s.nucleus.visible = false;
    s.cell.showDecorativeReceptors = false;
    expect(positions(s)).toEqual(positions(base));
  });

  it("editing one layer's node count does not move other layers", () => {
    for (const n of [1, 3, 9, 10]) {
      const s = withLayers(base, (l) => setCounts(l, 2, n, Math.min(n, 3)));
      const other = (x: NodeGeom) => x.layer !== 2;
      expect(positions(s, other)).toEqual(positions(base, other));
    }
  });

  it('changing active count does not move any node', () => {
    const s = withLayers(base, (l) => setCounts(l, 3, l[3].nodeCount, 5));
    expect(positions(s)).toEqual(positions(base));
  });

  it('style changes (receptor size, line thickness, colours) do not move nodes', () => {
    const s = clone(base);
    s.style.receptorSize = { length: 80, width: 30 };
    s.style.edgeWidth = 3;
    s.style.gradientStops = ['#fff', '#000', '#f00', '#0f0'];
    s.style.edgeCurvature = 0.1;
    const notReceptor = (n: NodeGeom) => n.layer > 0;
    expect(positions(s, notReceptor)).toEqual(positions(base, notReceptor));
  });
});

describe('connections', () => {
  for (const seed of [1, 2, 3, 99, 1234, 55555]) {
    it(`obeys the pathway rules (seed ${seed})`, () => {
      const s = defaultScene(seed);
      s.pathways[0].branching = (seed % 10) / 10;
      const g = buildGeometry(s);
      const L = s.pathways[0].layers.length;
      const out = new Map<string, number>(), inc = new Map<string, number>();
      for (const e of g.edges) {
        out.set(e.from, (out.get(e.from) ?? 0) + 1);
        inc.set(e.to, (inc.get(e.to) ?? 0) + 1);
        const a = g.nodeById.get(e.from)!, b = g.nodeById.get(e.to)!;
        expect(a.active && b.active).toBe(true);
        expect(b.layer - a.layer).toBe(1);
        for (const p of e.bezier) expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
      }
      for (const n of g.nodes) {
        if (!n.active) {
          expect(out.get(n.id) ?? 0).toBe(0);
          continue;
        }
        if (n.layer > 0) expect(inc.get(n.id) ?? 0).toBeGreaterThan(0);
        if (n.layer < L - 1) expect(out.get(n.id) ?? 0).toBeGreaterThan(0);
        if (n.layer > 0) expect(out.get(n.id) ?? 0).toBeLessThanOrEqual(4);
      }
    });
  }

  it('keeps nodes in their regions', () => {
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const g = buildGeometry(defaultScene(seed));
      for (const n of g.nodes) {
        if (n.layer === 0) continue;
        const dn = Math.hypot(n.x - g.nucleus.center.x, n.y - g.nucleus.center.y);
        const rn = g.nucleus.radiusAt(Math.atan2(n.y - g.nucleus.center.y, n.x - g.nucleus.center.x));
        if (n.region === 'nucleus') expect(dn).toBeLessThan(rn);
        else {
          expect(dn).toBeGreaterThan(rn);
          const dc = Math.hypot(n.x - g.cell.center.x, n.y - g.cell.center.y);
          expect(dc).toBeLessThan(g.cell.radiusAt(Math.atan2(n.y - g.cell.center.y, n.x - g.cell.center.x)));
        }
      }
    }
  });
});

describe('layer rules', () => {
  const layers = defaultScene().pathways[0].layers;

  it('only the boundary layers can switch region', () => {
    expect(regionOptions(layers, 1)).toEqual(['cytoplasm']);
    expect(regionOptions(layers, 2)).toEqual(['cytoplasm', 'nucleus']);
    expect(regionOptions(layers, 3)).toEqual(['cytoplasm', 'nucleus']);
    expect(regionOptions(layers, 4)).toEqual(['nucleus']);
    expect(setRegion(layers, 1, 'nucleus')).toBe(layers);
  });

  it('adds layers at the end of their region, up to 8', () => {
    const a = addLayer(layers, 'cytoplasm');
    expect(a.map((l) => l.region)).toEqual(['membrane', 'cytoplasm', 'cytoplasm', 'cytoplasm', 'nucleus', 'nucleus']);
    let b = layers;
    for (let i = 0; i < 10; i++) b = addLayer(b, 'nucleus');
    expect(b.length).toBe(8);
  });

  it('keeps at least 3 layers and one of each region', () => {
    const three = removeLayer(removeLayer(layers, 4), 2);
    expect(three.map((l) => l.region)).toEqual(['membrane', 'cytoplasm', 'nucleus']);
    expect(canRemoveLayer(three, 1)).toBe(false);
    expect(canRemoveLayer(three, 2)).toBe(false);
    expect(canRemoveLayer(layers, 0)).toBe(false);
  });

  it('clamps counts', () => {
    const c = setCounts(layers, 1, 20, 30);
    expect(c[1]).toMatchObject({ nodeCount: 10, activeCount: 10 });
    expect(setCounts(layers, 0, 5, 5)).toBe(layers);
  });
});
