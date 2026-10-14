import { describe, expect, it } from 'vitest';
import { buildDisplayList } from '../render/displayList';
import { displayListToSvg } from '../render/svg';
import { defaultScene } from './defaults';
import { buildGeometry } from './geometry';
import { MODULES, moduleScene, shareScene } from './modules';
import { parseSceneJson, serializeScene } from './sceneIO';
import { buildSchedule } from './timeline';

const lastLayer = (s: ReturnType<typeof defaultScene>) => s.pathways[0].layers.length - 1;

describe('modules', () => {
  it('starts every tab from the same pathway', () => {
    const scenes = MODULES.map((m) => moduleScene(m.kind, 7));
    for (const s of scenes) expect(s.pathways[0].seed).toBe(scenes[0].pathways[0].seed);
    expect(scenes.map((s) => s.module.kind)).toEqual(['targetId', 'moa', 'combination', 'toxicity', 'tissue', 'crossTissue', 'body', 'journey', 'realCell']);
  });

  it('custom leaves the pathway unchanged', () => {
    const plain = defaultScene(7);
    const custom = moduleScene('custom', 7);
    expect(buildGeometry(custom).edges.length).toBe(buildGeometry(plain).edges.length);
  });

  it('target ID joins the receptor straight to its active DEGs', () => {
    const s = moduleScene('targetId', 7);
    const g = buildGeometry(s);
    const last = lastLayer(s);
    expect(g.nodes.every((n) => n.layer === 0 || n.layer === last)).toBe(true);
    const degs = g.nodes.filter((n) => n.layer === last && n.active);
    expect(g.edges.length).toBe(degs.length);
    for (const e of g.edges) {
      expect(g.nodeById.get(e.from)!.layer).toBe(0);
      expect(g.nodeById.get(e.to)!.layer).toBe(last);
      expect(e.hops).toBeGreaterThan(1);
    }
    const sched = buildSchedule(s);
    for (const d of degs) expect(sched.fire.has(d.id)).toBe(true);
    expect(g.receptors.filter((r) => r.target).length).toBe(1);
  });

  it('target ID can show the full pathway', () => {
    const s = moduleScene('targetId', 7);
    s.module = { ...s.module, directOnly: false };
    expect(buildGeometry(s).edges.length).toBe(buildGeometry(defaultScene(7)).edges.length);
  });

  it('MOA traces the route into one DEG and dims the rest', () => {
    const s = moduleScene('moa', 7);
    const g = buildGeometry(s);
    const last = lastLayer(s);
    const degs = g.nodes.filter((n) => n.layer === last && n.active).sort((a, b) => a.lateral - b.lateral);
    expect(degs[0].dim).toBeFalsy();
    for (const d of degs.slice(1)) expect(d.dim).toBe(true);
    expect(g.nodes.some((n) => n.dim)).toBe(true);
    // Only the route carries the signal.
    const sched = buildSchedule(s);
    for (const n of g.nodes) if (n.dim) expect(sched.fire.has(n.id)).toBe(false);
    expect(sched.fire.has(degs[0].id)).toBe(true);
    expect(sched.edges.every((et) => !et.edge.dim)).toBe(true);
    // One route: one protein per layer, receptor to DEG.
    const lit = g.nodes.filter((n) => n.active && !n.dim && n.pathwayId === 'p1');
    for (let l = 0; l <= last; l++) expect(lit.filter((n) => n.layer === l).length).toBe(1);
    expect(g.edges.filter((e) => !e.dim).length).toBe(last);
  });

  it('MOA runs backwards from the DEG, uncovering the route as it goes', () => {
    const s = moduleScene('moa', 7);
    const g = buildGeometry(s);
    const last = lastLayer(s);
    const deg = g.nodes.filter((n) => n.layer === last && n.active).sort((a, b) => a.lateral - b.lateral)[0];
    const receptor = g.nodes.find((n) => n.layer === 0)!;
    const sched = buildSchedule(s);
    // The signal starts at the DEG and reaches the receptor last.
    expect(sched.fire.get(deg.id)).toBe(0);
    const route = g.nodes.filter((n) => n.active && !n.dim);
    expect(Math.max(...route.map((n) => sched.fire.get(n.id)!))).toBe(sched.fire.get(receptor.id));
    for (const e of g.edges.filter((x) => !x.dim)) {
      expect(g.nodeById.get(e.from)!.layer).toBe(g.nodeById.get(e.to)!.layer + 1);
      expect(e.reveal).toBe(true);
    }
    // The DEG is there from the start; the rest of the route is not.
    expect(deg.reveal).toBeFalsy();
    expect(route.filter((n) => n.reveal).length).toBe(last);
    const ids = (t: number) => new Set(buildDisplayList(s, t).prims.map((p) => p.id));
    const mid = route.find((n) => n.layer === 2)!;
    const edge = g.edges.find((e) => e.to === mid.id && !e.dim)!;
    const start = ids(0.01);
    expect(start.has(deg.id)).toBe(true);
    expect(start.has(mid.id)).toBe(false);
    expect(start.has(`${receptor.id}-diamond`)).toBe(false);
    expect(start.has(edge.id)).toBe(false); // no resting edge on the route
    const t = sched.fire.get(mid.id)! + 0.6;
    const later = ids(t);
    expect(later.has(mid.id)).toBe(true);
    expect(later.has(`${edge.id}-lit`)).toBe(true);
    // It pops: larger than its resting size just after it appears.
    const r = (time: number) => {
      const p = buildDisplayList(s, time).prims.find((q) => q.id === mid.id)!;
      return p.kind === 'circle' ? p.r : 0;
    };
    expect(r(sched.fire.get(mid.id)! + 0.2)).toBeGreaterThan(r(sched.fire.get(mid.id)! + 2));
    // A still export without the signal shows the whole route.
    expect(new Set(buildDisplayList(s, 0, { signal: false }).prims.map((p) => p.id)).has(mid.id)).toBe(true);
  });

  it('MOA can trace more than one route', () => {
    const s = moduleScene('moa', 7);
    s.module = { ...s.module, routes: 3 };
    const g = buildGeometry(s);
    expect(g.edges.filter((e) => !e.dim).length).toBeGreaterThan(lastLayer(s));
  });

  it('MOA with no traced DEG shows every route', () => {
    const s = moduleScene('moa', 7);
    s.module = { ...s.module, focusDeg: 0 };
    expect(buildGeometry(s).nodes.some((n) => n.dim)).toBe(false);
  });

  it('target combination marks every pathway receptor and starts them together', () => {
    const s = moduleScene('combination', 7);
    const g = buildGeometry(s);
    // The whole of each pathway is shown, the proteins between receptor and DEGs included.
    expect(s.module.directOnly).toBe(false);
    for (const pid of ['p1', 'p2', 'p3']) {
      expect(g.nodes.some((n) => n.pathwayId === pid && n.layer > 0 && n.layer < lastLayer(s))).toBe(true);
    }
    expect(g.receptors.filter((r) => r.target).length).toBe(3);
    expect(g.pathways.every((p) => p.startDelay === 0)).toBe(true);
  });

  it('toxicity turns the cell red once a toxic DEG fires', () => {
    const s = moduleScene('toxicity', 7);
    s.module = { ...s.module, toxicDegs: 2 };
    const g = buildGeometry(s);
    expect(g.nodes.filter((n) => n.toxic).length).toBe(2);
    const sched = buildSchedule(s);
    const fired = Math.min(...g.nodes.filter((n) => n.toxic).map((n) => sched.fire.get(n.id)!));
    const tint = (t: number) => buildDisplayList(s, t).underlays!.find((u) => u.id === 'membrane-toxic')!.opacity;
    expect(tint(0)).toBe(0);
    expect(tint(fired + 1.5)).toBe(1);
    // The membrane is drawn only as the two cross-faded underlays.
    expect(buildDisplayList(s, 0).prims.some((p) => p.group === 'membrane')).toBe(false);
    const svg = displayListToSvg(buildDisplayList(s, fired + 1.5));
    expect(svg).toContain('<g id="membrane-toxic">');
    expect(svg).not.toContain('<g id="membrane-own"');
  });

  it('tissue puts the same cell at the centre, scaled, with neighbours round it', () => {
    const s = moduleScene('tissue', 7);
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

  it('target combination interconnects the targets', () => {
    const s = moduleScene('combination', 7);
    const g = buildGeometry(s);
    const cross = g.edges.filter((e) => e.crosstalk);
    expect(cross.length).toBeGreaterThan(0);
    for (const e of cross) expect(g.nodeById.get(e.to)!.pathwayId).not.toBe(g.nodeById.get(e.from)!.pathwayId);
    const off = { ...s, crosstalk: { enabled: false, amount: 0.5 } };
    expect(buildGeometry(off).edges.some((e) => e.crosstalk)).toBe(false);
  });

  it('toxicity shows a large warning in the middle of the cell once it turns', () => {
    const s = moduleScene('toxicity', 7);
    const g = buildGeometry(s);
    const sched = buildSchedule(s);
    const fired = Math.min(...g.nodes.filter((n) => n.toxic).map((n) => sched.fire.get(n.id)!));
    expect(buildDisplayList(s, 0).prims.some((p) => p.kind === 'warning')).toBe(false);
    const w = buildDisplayList(s, fired + 1.5).prims.find((p) => p.kind === 'warning')!;
    expect(w).toBeTruthy();
    // In the middle of the cell, a fifth of the canvas's short side tall; the size setting scales it.
    if (w.kind !== 'warning') throw new Error('not a warning');
    expect(w.c).toEqual(g.cells[0].cell.center);
    expect(w.size).toBeCloseTo(0.2 * 1080, 0);
    const big = { ...s, module: { ...s.module, warningSize: 2 } };
    const w2 = buildDisplayList(big, fired + 1.5).prims.find((p) => p.kind === 'warning')!;
    expect(w2.kind === 'warning' && w2.size).toBeCloseTo(0.4 * 1080, 0);
    expect(displayListToSvg(buildDisplayList(s, fired + 1.5))).toContain('id="warning"');
    const off = { ...s, module: { ...s.module, warning: false } };
    expect(buildDisplayList(off, fired + 1.5).prims.some((p) => p.kind === 'warning')).toBe(false);
  });

  it('shares the look and pathway but keeps each tab its module', () => {
    const from = moduleScene('moa', 7);
    from.seed = 99;
    from.style = { ...from.style, edgeWidth: 2 };
    const to = shareScene(from, moduleScene('combination', 7));
    expect(to.seed).toBe(99);
    expect(to.style.edgeWidth).toBe(2);
    expect(to.module.kind).toBe('combination');
    expect(to.pathwayCount).toBe(3);
    expect(to.pathways.slice(0, 3).every((p) => p.startDelay === 0)).toBe(true);
  });

  it('saves and loads module settings', () => {
    const s = moduleScene('toxicity', 7);
    s.module = { ...s.module, toxicDegs: 3, toxicColor: '#ff0000' };
    expect(parseSceneJson(serializeScene(s)).module).toEqual(s.module);
    // Older scenes load as the plain animator.
    const old = JSON.parse(serializeScene(defaultScene(7)));
    delete old.module;
    expect(parseSceneJson(JSON.stringify(old)).module.kind).toBe('custom');
  });
});
