import { describe, expect, it } from 'vitest';
import { buildDisplayList } from '../render/displayList';
import { displayListToSvg } from '../render/svg';
import { defaultScene } from './defaults';
import { neighbourCells } from './cellMap';
import { buildGeometry } from './geometry';
import { linkTraced, MODULES, moduleScene, shareScene, tissueMap, TRACED } from './modules';
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

  it('starts every pathway at 4 cytoplasm, 4 cytoplasm, 3 nucleus and 3 DEG, all active', () => {
    for (const m of MODULES) {
      const layers = moduleScene(m.kind, 1234).pathways[0].layers;
      expect(layers.map((l) => [l.region, l.nodeCount, l.activeCount])).toEqual([
        ['membrane', 1, 1], ['cytoplasm', 4, 4], ['cytoplasm', 4, 4], ['nucleus', 3, 3], ['nucleus', 3, 3],
      ]);
    }
  });

  it('tabs 1–3 draw every active protein of the settings, always on in the gradient', () => {
    for (const kind of TRACED) {
      const s = moduleScene(kind, 1234);
      const g = buildGeometry(s);
      expect([0, 1, 2, 3, 4].map((l) => g.nodes.filter((n) => n.pathwayId === 'p1' && n.layer === l && n.active).length)).toEqual([1, 4, 4, 3, 3]);
      const lines = (t: number) => buildDisplayList(s, t).prims.filter((p) => p.kind === 'bezier');
      const { total } = buildSchedule(s);
      expect(lines(0).map((p) => p.id).sort()).toEqual(g.edges.map((e) => e.id).sort());
      expect(JSON.stringify(lines(total / 2))).toBe(JSON.stringify(lines(0)));
    }
  });

  it('MOA flows back and forth between the nucleus and the receptor', () => {
    const s = moduleScene('moa', 7);
    const g = buildGeometry(s);
    const sched = buildSchedule(s);
    const receptor = g.nodes.find((n) => n.layer === 0)!;
    const deg = g.nodes.find((n) => n.layer === lastLayer(s))!;
    const legs = [0, 1, 2, 3].map((w) => sched.edges.filter((et) => et.wave === w));
    for (const leg of legs) expect(leg).toHaveLength(g.edges.length);
    const first = (w: number) => [...legs[w]].sort((a, b) => a.start - b.start)[0];
    expect(g.nodeById.get(first(0).edge.from)!.layer).toBe(0);
    expect(g.nodeById.get(first(1).edge.from)!.layer).toBe(lastLayer(s));
    expect(g.nodeById.get(first(2).edge.from)!.layer).toBe(0);
    expect(g.nodeById.get(first(3).edge.from)!.layer).toBe(lastLayer(s));
    for (let w = 1; w < 4; w++) expect(first(w).start).toBeGreaterThan(Math.max(...legs[w - 1].map((et) => et.start + et.duration)));
    expect(sched.pulses.get(deg.id)!.length).toBeGreaterThan(1);
    expect(sched.pulses.get(receptor.id)!.length).toBeGreaterThan(1);
    // The loop closes as the pulse gets back to the receptor, so it never stops.
    expect(sched.period).toBe(sched.total);
    expect(Math.max(...sched.edges.map((et) => et.start + et.duration))).toBeLessThan(sched.total);
    // More trips, a longer loop.
    const more = { ...s, module: { ...s.module, trips: 3 } };
    expect(buildSchedule(more).total).toBeGreaterThan(sched.total);
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

  it('tabs 1–3 share one pulse size and line thickness', () => {
    for (const kind of TRACED) {
      const s = moduleScene(kind, 1234);
      expect(s.animation.cometSize).toBe(6.5);
      expect(s.style.edgeWidth).toBe(3.55);
    }
    expect(moduleScene('tissue', 1234).style.edgeWidth).toBe(defaultScene(1234).style.edgeWidth);
  });

  it('keeps the pathway of tab 1 in tab 2 whatever is changed in tab 1', () => {
    const shape = (s: Scene) => {
      const g = buildGeometry(s);
      return JSON.stringify(g.edges.filter((e) => e.pathwayId === 'p1').map((e) => [e.id, e.bezier]));
    };
    const tab1 = moduleScene('moa', 1234);
    const tab2 = moduleScene('combination', 1234);
    expect(shape(tab2)).toBe(shape(tab1));
    // Regenerated, re-routed and restyled in tab 1.
    const edited: Scene = {
      ...tab1, seed: 555,
      pathways: [{ ...tab1.pathways[0], seed: 987 }],
      style: { ...tab1.style, edgeWidth: 2 },
      module: { ...tab1.module, trips: 3 },
    };
    const linked = linkTraced(edited, tab2);
    expect(shape(linked)).toBe(shape(edited));
    expect(shape(linked)).not.toBe(shape(tab2));
    expect(linked.style.edgeWidth).toBe(2);
    // Tab 2 keeps its second pathway, and edits there come back to tab 1.
    expect(linked.pathwayCount).toBe(2);
    expect(linked.pathways).toHaveLength(2);
    expect(buildGeometry(linked).edges.some((e) => e.pathwayId === 'p2')).toBe(true);
    expect(shape(linkTraced(linked, edited))).toBe(shape(linked));
    expect(linkTraced(edited, moduleScene('toxicity', 1234)).module.toxicColor).toBe(moduleScene('toxicity', 1234).module.toxicColor);
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
    // The receptor is where it was; the wiring is its own.
    const receptor = (x: typeof g) => x.receptors.find((r) => r.target)!.center;
    expect(receptor(g)).toEqual(receptor(one));
    const wiring = (x: typeof g) => JSON.stringify(x.edges.map((e) => e.bezier));
    expect(wiring(g)).not.toBe(wiring(one));
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
    const other = buildDisplayList(s, 0).prims.find((p) => p.id === g.nodes.find((n) => n.layer === 2 && !n.toxic)!.id)!;
    expect(radius(0)).toBeGreaterThan(2 * (other.kind === 'circle' ? other.r : 0));
    const ring = (t: number) => buildDisplayList(s, t).prims.find((p) => p.id === `${toxic[0].id}-ring-1`)!;
    const beat = total / Math.round(total / 1.6);
    const size = (t: number) => { const p = ring(t); return p.kind === 'ring' ? p.r : 0; };
    expect(size(beat * 0.6)).toBeGreaterThan(size(beat * 0.1));
    expect(ring(beat * 0.9).opacity!).toBeLessThan(ring(beat * 0.1).opacity!);
    // Nothing else is red.
    expect(displayListToSvg(buildDisplayList(s, total / 2)).match(/id="warning/)).toBeNull();
  });

  it('a generated tissue puts the same cell at the centre, scaled, with neighbours round it', () => {
    const s: Scene = { ...classic('tissue', 7), cellMap: tissueMap() };
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

  it('a generated tissue follows the centre cell when the seed changes', () => {
    const a: Scene = { ...moduleScene('tissue', 7), cellMap: tissueMap() };
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

describe('zoom (tabs 1–3)', () => {
  const ZOOMED: ModuleKind[] = ['moa', 'combination', 'toxicity'];
  const zoomed = (s: Scene, zoom: number): Scene => ({ ...s, module: { ...s.module, zoom } });

  it('tabs 1–3 start square and zoomed out, with their neighbours showing', () => {
    for (const kind of ZOOMED) {
      const s = moduleScene(kind, 7);
      expect(s.canvas.width).toBe(s.canvas.height);
      expect(s.module.zoom).toBeLessThan(1);
      expect(s.cell.neighbours.show).toBe(true);
    }
    for (const kind of ['tissue', 'crossTissue', 'body', 'journey', 'realCell'] as ModuleKind[]) {
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
