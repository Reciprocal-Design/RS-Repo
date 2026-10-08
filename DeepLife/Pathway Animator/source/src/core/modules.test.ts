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
    expect(scenes.map((s) => s.module.kind)).toEqual(['targetId', 'moa', 'combination', 'toxicity', 'tissue', 'custom']);
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
