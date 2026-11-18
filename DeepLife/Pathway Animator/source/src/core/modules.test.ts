import { describe, expect, it } from 'vitest';
import { buildDisplayList } from '../render/displayList';
import { displayListToSvg } from '../render/svg';
import { defaultScene } from './defaults';
import { neighbourCells } from './cellMap';
import { buildGeometry } from './geometry';
import { MODULES, moduleScene, shareScene } from './modules';
import { parseSceneJson, serializeScene } from './sceneIO';
import { buildSchedule } from './timeline';
import type { ModuleKind, Scene } from './types';

/** A tab as it started before tabs 1–4 went square and zoomed out: 1920 × 1080, zoom 1, no neighbours. */
const classic = (kind: ModuleKind, seed = 7): Scene => {
  const s = moduleScene(kind, seed);
  return {
    ...s,
    canvas: { ...s.canvas, width: 1920, height: 1080 },
    cell: { ...s.cell, neighbours: { ...s.cell.neighbours, show: false } },
    module: { ...s.module, zoom: 1 },
  };
};

const lastLayer = (s: ReturnType<typeof defaultScene>) => s.pathways[0].layers.length - 1;
const oneRoute = (s: Scene): Scene => ({ ...s, module: { ...s.module, routes: 1 } });

describe('modules', () => {
  it('starts every tab from the same pathway', () => {
    const scenes = MODULES.map((m) => moduleScene(m.kind, 7));
    for (const s of scenes) expect(s.pathways[0].seed).toBe(scenes[0].pathways[0].seed);
    expect(scenes.map((s) => s.module.kind)).toEqual(['moa', 'combination', 'toxicity', 'tissue', 'crossTissue', 'body', 'journey', 'realCell']);
  });

  it('custom leaves the pathway unchanged', () => {
    const plain = defaultScene(7);
    const custom = moduleScene('custom', 7);
    expect(buildGeometry(custom).edges.length).toBe(buildGeometry(plain).edges.length);
  });

  it('MOA draws only the routes into one DEG, always on in the gradient', () => {
    const s = oneRoute(moduleScene('moa', 7));
    const g = buildGeometry(s);
    const last = lastLayer(s);
    // One route: one protein per layer, receptor to DEG, and nothing else.
    for (let l = 0; l <= last; l++) expect(g.nodes.filter((n) => n.layer === l)).toHaveLength(1);
    expect(g.edges).toHaveLength(last);
    // The same lines, in the gradient, on every frame from the first; no grey anywhere.
    const lines = (t: number) => buildDisplayList(s, t).prims.filter((p) => p.kind === 'bezier');
    const { total } = buildSchedule(s);
    for (const t of [0, total / 3, total / 2, total - 0.01]) {
      expect(lines(t).map((p) => p.id).sort()).toEqual(g.edges.map((e) => e.id).sort());
      for (const p of lines(t)) expect(p.kind === 'bezier' && p.from).not.toBe(p.kind === 'bezier' && p.to);
    }
    expect(JSON.stringify(lines(total / 2))).toBe(JSON.stringify(lines(0)));
  });

  it('MOA starts on a pathway more complex than a single route', () => {
    const s = moduleScene('moa', 7);
    expect(buildGeometry(s).edges.length).toBeGreaterThan(lastLayer(s));
  });

  it('MOA flows back and forth between the nucleus and the receptor', () => {
    const s = oneRoute(moduleScene('moa', 7));
    const g = buildGeometry(s);
    const sched = buildSchedule(s);
    const deg = g.nodes.find((n) => n.layer === lastLayer(s))!;
    const receptor = g.nodes.find((n) => n.layer === 0)!;
    const legs = [0, 1, 2, 3].map((w) => sched.edges.filter((et) => et.wave === w));
    for (const leg of legs) expect(leg).toHaveLength(lastLayer(s));
    // Each leg sets off from the end the last one reached, away from the nucleus and back in turn.
    const leaves = (w: number) => [...legs[w]].sort((a, b) => a.start - b.start)[0];
    expect([0, 1, 2, 3].map((w) => leaves(w).edge.from)).toEqual([receptor.id, deg.id, receptor.id, deg.id]);
    for (let w = 1; w < 4; w++) {
      const arrived = Math.max(...legs[w - 1].map((et) => et.start + et.duration));
      expect(leaves(w).start).toBeGreaterThan(arrived);
    }
    // Both ends pulse every time the signal arrives.
    expect(sched.pulses.get(receptor.id)!.length).toBe(3);
    expect(sched.pulses.get(deg.id)!.length).toBe(2);
    // The loop closes as the pulse gets back to the receptor, so it never stops.
    expect(sched.period).toBe(sched.total);
    expect(Math.max(...sched.edges.map((et) => et.start + et.duration))).toBeLessThan(sched.total);
    // More trips, a longer loop.
    const more = { ...s, module: { ...s.module, trips: 3 } };
    expect(buildSchedule(more).total).toBeGreaterThan(sched.total);
  });

  it('MOA with no traced DEG shows every route', () => {
    const s = moduleScene('moa', 7);
    s.module = { ...s.module, focusDeg: 0 };
    expect(buildGeometry(s).edges.length).toBe(buildGeometry(defaultScene(7)).edges.length);
  });

  it('target combination is the pathway of tab 1 and one more', () => {
    const one = buildGeometry(moduleScene('moa', 7));
    const s = moduleScene('combination', 7);
    const g = buildGeometry(s);
    expect(g.receptors.filter((r) => r.target).length).toBe(2);
    expect(g.pathways.every((p) => p.startDelay === 0)).toBe(true);
    expect(g.edges.some((e) => e.crosstalk)).toBe(false);
    // The first pathway: the same proteins in the same places, the same route lit.
    const lit = (x: typeof g, pid: string) => x.edges.filter((e) => e.pathwayId === pid).map((e) => e.id).sort();
    for (const n of one.nodes) {
      const m = g.nodeById.get(n.id)!;
      expect([m.x, m.y]).toEqual([n.x, n.y]);
    }
    expect(lit(g, 'p1')).toEqual(lit(one, 'p1'));
    // The second: its own receptor and its own route to the nucleus.
    expect(lit(g, 'p2').length).toBeGreaterThan(0);
    const sched = buildSchedule(s);
    for (const pid of ['p1', 'p2']) {
      const receptor = g.nodes.find((n) => n.pathwayId === pid && n.layer === 0)!;
      expect(sched.fire.has(receptor.id)).toBe(true);
    }
  });

  it('toxicity keeps the receptor, takes a different pathway to a different dot, and that dot pulses red', () => {
    const one = buildGeometry(moduleScene('moa', 7));
    const s = moduleScene('toxicity', 7);
    const g = buildGeometry(s);
    const toxic = g.nodes.filter((n) => n.toxic);
    expect(toxic).toHaveLength(1);
    const last = lastLayer(s);
    expect(toxic[0].layer).toBe(last);
    expect(toxic[0].region).toBe('nucleus');
    // Tab 1 traces another DEG; the receptor is where it was.
    const litDeg = one.nodes.find((n) => n.layer === last)!;
    expect(toxic[0].id).not.toBe(litDeg.id);
    const receptor = (x: typeof g) => x.receptors.find((r) => r.target)!.center;
    expect(receptor(g)).toEqual(receptor(one));
    const lit = (x: typeof g) => new Set(x.edges.map((e) => e.id));
    const a = lit(g), b = lit(one);
    expect([...a].filter((id) => !b.has(id)).length).toBeGreaterThan(0);
    // Red from the first frame to the last, pulsing, with no warning and an unchanged membrane.
    const dot = (t: number) => buildDisplayList(s, t).prims.find((p) => p.id === toxic[0].id)!;
    const radius = (t: number) => { const p = dot(t); return p.kind === 'circle' ? p.r : 0; };
    const { total } = buildSchedule(s);
    const samples = Array.from({ length: 40 }, (_, i) => radius((i / 40) * total));
    for (let i = 0; i < 40; i++) {
      const p = dot((i / 40) * total);
      expect(p.kind === 'circle' && p.fill).toBe('rgb(255,43,69)');
    }
    expect(Math.max(...samples)).toBeGreaterThan(Math.min(...samples) * 1.15);
    expect(radius(0)).toBeCloseTo(radius(total - 1e-6), 3); // the loop closes without a jump
    const plain = buildDisplayList(moduleScene('moa', 7), 0).prims.filter((p) => p.group === 'membrane');
    expect(buildDisplayList(s, total / 2).prims.filter((p) => p.group === 'membrane')).toEqual(plain);
    // Larger than the other dots, with rings radiating from it.
    const other = buildDisplayList(s, 0).prims.find((p) => p.id === g.nodes.find((n) => n.layer === 2)!.id)!;
    expect(radius(0)).toBeGreaterThan(2 * (other.kind === 'circle' ? other.r : 0));
    const ring = (t: number) => buildDisplayList(s, t).prims.find((p) => p.id === `${toxic[0].id}-ring-1`)!;
    const beat = total / Math.round(total / 1.6);
    const size = (t: number) => { const p = ring(t); return p.kind === 'ring' ? p.r : 0; };
    expect(size(beat * 0.6)).toBeGreaterThan(size(beat * 0.1));
    expect(ring(beat * 0.9).opacity!).toBeLessThan(ring(beat * 0.1).opacity!);
    // Nothing else is red.
    expect(displayListToSvg(buildDisplayList(s, total / 2)).match(/id="warning/)).toBeNull();
  });

  it('tissue puts the same cell at the centre, scaled, with neighbours round it', () => {
    const s = classic('tissue', 7);
    const single = buildGeometry(defaultScene(7));
    const g = buildGeometry(s);
    const k = s.cellMap.detailScale;
    const cx = s.canvas.width / 2, cy = s.canvas.height / 2;
    expect(g.cells.length).toBeGreaterThan(6);
    // Every node of the single cell is in the centre cell, at the same place scaled about the canvas centre.
    for (const n of single.nodes) {
      const m = g.nodeById.get(n.id)!;
      expect(m.active).toBe(n.active);
      expect(m.x).toBeCloseTo(cx + (n.x - cx) * k, 6);
      expect(m.y).toBeCloseTo(cy + (n.y - cy) * k, 6);
    }
    // The centre cell starts on its own; neighbours wait for a relay from it.
    expect(g.pathways.find((p) => p.id === 'p1')!.relayOnly).toBeFalsy();
    expect(g.pathways.filter((p) => p.id !== 'p1').every((p) => p.relayOnly)).toBe(true);
    expect(g.edges.some((e) => e.link && e.pathwayId === 'p1')).toBe(true);
    // Links run outward from the centre cell, so its signal spreads through the tissue.
    const sched = buildSchedule(s);
    const fired = new Set([...sched.fire.keys()].filter((id) => !id.startsWith('p1-')).map((id) => id.split('-')[0]));
    expect(fired.size).toBeGreaterThan(4);
    expect(g.edges.filter((e) => e.link).every((e) => !e.to.startsWith('p1-'))).toBe(true);
    // Neighbours never overlap the centre cell.
    const hero = g.cells[0];
    for (const c of g.cells.slice(1)) {
      for (const q of c.cell.points) {
        const th = Math.atan2(q.y - cy, q.x - cx);
        expect(Math.hypot(q.x - cx, q.y - cy)).toBeGreaterThan(hero.cell.radiusAt(th));
      }
    }
  });

  it('tissue follows the centre cell when the seed changes', () => {
    const a = moduleScene('tissue', 7);
    const b = { ...a, seed: 8 };
    expect(buildGeometry(b).cells[0].cell.points[0]).not.toEqual(buildGeometry(a).cells[0].cell.points[0]);
    const json = parseSceneJson(serializeScene(a));
    expect(json.cellMap.around).toBe(true);
    expect(buildGeometry(json).cells.length).toBe(buildGeometry(a).cells.length);
  });

  it('shares the look and pathway but keeps each tab its module', () => {
    const from = moduleScene('moa', 7);
    from.seed = 99;
    from.style = { ...from.style, edgeWidth: 2 };
    const to = shareScene(from, moduleScene('combination', 7));
    expect(to.seed).toBe(99);
    expect(to.style.edgeWidth).toBe(2);
    expect(to.module.kind).toBe('combination');
    expect(to.pathwayCount).toBe(2);
    expect(to.pathways).toHaveLength(2);
    expect(to.pathways.every((p) => p.startDelay === 0)).toBe(true);
  });

  it('saves and loads module settings', () => {
    const s = moduleScene('toxicity', 7);
    s.module = { ...s.module, trips: 3, toxicColor: '#ff0000' };
    expect(parseSceneJson(serializeScene(s)).module).toEqual(s.module);
    // Older scenes load as the plain animator.
    const old = JSON.parse(serializeScene(defaultScene(7)));
    delete old.module;
    expect(parseSceneJson(JSON.stringify(old)).module.kind).toBe('custom');
  });
});

describe('zoom (tabs 1–4)', () => {
  const ZOOMED: ModuleKind[] = ['moa', 'combination', 'toxicity', 'tissue'];
  const zoomed = (s: Scene, zoom: number): Scene => ({ ...s, module: { ...s.module, zoom } });

  it('tabs 1–4 start square and zoomed out, the single-cell tabs with their neighbours showing', () => {
    for (const kind of ZOOMED) {
      const s = moduleScene(kind, 7);
      expect(s.canvas.width).toBe(s.canvas.height);
      expect(s.module.zoom).toBeLessThan(1);
      expect(s.cell.neighbours.show).toBe(kind !== 'tissue');
    }
    for (const kind of ['crossTissue', 'body', 'journey', 'realCell'] as ModuleKind[]) {
      const s = moduleScene(kind, 7);
      expect([s.canvas.width, s.canvas.height]).toEqual([1920, 1080]);
      expect(s.module.zoom).toBe(1);
    }
  });

  it('scales the single cell, its network and its sizes together about the canvas centre', () => {
    for (const kind of ['moa', 'combination', 'toxicity'] as ModuleKind[]) {
      const base = zoomed(moduleScene(kind, 7), 1);
      const a = buildGeometry(base);
      const b = buildGeometry(zoomed(base, 0.5));
      const cx = base.canvas.width / 2, cy = base.canvas.height / 2;
      expect(b.scale).toBeCloseTo(a.scale * 0.5, 9);
      for (const n of a.nodes) {
        const m = b.nodeById.get(n.id)!;
        expect(m.x).toBeCloseTo(cx + (n.x - cx) * 0.5, 6);
        expect(m.y).toBeCloseTo(cy + (n.y - cy) * 0.5, 6);
      }
    }
  });

  it('shows more of the cells round the cell as it zooms out', () => {
    const s = moduleScene('moa', 7);
    const count = (zoom: number) => neighbourCells(zoomed(s, zoom)).length;
    expect(count(0.4)).toBeGreaterThan(count(0.7));
    expect(count(0.7)).toBeGreaterThan(count(1));
    // Neighbours never overlap the zoomed cell.
    const z = zoomed(s, 0.4);
    const cell = buildGeometry(z).cells[0].cell;
    for (const n of neighbourCells(z)) {
      const th = Math.atan2(n.cell.center.y - cell.center.y, n.cell.center.x - cell.center.x);
      expect(Math.hypot(n.cell.center.x - cell.center.x, n.cell.center.y - cell.center.y)).toBeGreaterThan(cell.radiusAt(th));
    }
  });

  it('zooms the tissue round its centre cell, with more cells as it zooms out', () => {
    const base = zoomed(moduleScene('tissue', 7), 1);
    const a = buildGeometry(base);
    const b = buildGeometry(zoomed(base, 0.6));
    const cx = base.canvas.width / 2, cy = base.canvas.height / 2;
    for (const n of a.nodes.filter((x) => x.id.startsWith('p'))) {
      const m = b.nodeById.get(n.id)!;
      expect(m.x).toBeCloseTo(cx + (n.x - cx) * 0.6, 6);
      expect(m.y).toBeCloseTo(cy + (n.y - cy) * 0.6, 6);
    }
    expect(b.cells.length).toBeGreaterThan(a.cells.length);
  });

  it('leaves the other tabs alone', () => {
    for (const kind of ['custom', 'crossTissue', 'journey', 'realCell'] as ModuleKind[]) {
      const s = moduleScene(kind, 7);
      expect(buildGeometry(zoomed(s, 0.5)).nodes.map((n) => [n.x, n.y])).toEqual(buildGeometry(s).nodes.map((n) => [n.x, n.y]));
    }
  });

  it('is saved in the scene JSON; files saved before it load at zoom 1', () => {
    const s = zoomed(moduleScene('moa', 7), 0.45);
    expect(parseSceneJson(serializeScene(s)).module.zoom).toBe(0.45);
    const old = JSON.parse(serializeScene(s));
    delete old.module.zoom;
    expect(parseSceneJson(JSON.stringify(old)).module.zoom).toBe(1);
  });
});
