import { describe, expect, it } from 'vitest';
import { buildGeometry } from './geometry';
import { MODULES, moduleScene } from './modules';
import { parseSceneJson, serializeScene } from './sceneIO';
import { BUILD, sequenceFrame, sequencePlan, sequenceScene, setSequenceSources, ZOOM_OUT } from './sequence';
import { buildSchedule } from './timeline';
import { planVideo } from './video';
import type { ModuleKind, Scene } from './types';

const tabs = MODULES.map((m) => moduleScene(m.kind, 1234));
const tab = (kind: ModuleKind) => tabs.find((t) => t.module.kind === kind)!;
const seqWith = (seqTabs: ModuleKind[], extra: Partial<Scene['module']> = {}): Scene => {
  const s = moduleScene('sequence', 1234);
  return { ...s, module: { ...s.module, seqTabs, ...extra } };
};
const run = (kind: ModuleKind) => buildSchedule(sequenceScene(tab(kind))).total;

describe('the sequence tab', () => {
  it('is the last tab, and plays tabs 1–5 by default', () => {
    expect(MODULES[MODULES.length - 1].kind).toBe('sequence');
    expect(moduleScene('sequence').module.seqTabs).toEqual(['moa', 'combination', 'toxicity', 'tissue', 'crossTissue']);
  });

  it('plays each tab with one pulse from the receptor to the DEGs, leaving the tab itself alone', () => {
    const own = tab('moa');
    const v = sequenceScene(own);
    expect(own.module.seqPart).toBeUndefined();
    expect(v.module.seqPart).toBe(true);
    const ownEdges = buildSchedule(own).edges, seqEdges = buildSchedule(v).edges;
    // Every edge carries the pulse once, receptor to DEG; the tab sends it back and forth.
    expect(seqEdges.length).toBe(buildGeometry(v).edges.length);
    expect(seqEdges.every((et) => et.wave === 0)).toBe(true);
    expect(ownEdges.length).toBeGreaterThan(seqEdges.length);
    // Saved scenes never carry the flag.
    expect(parseSceneJson(serializeScene(v)).module.seqPart).toBeUndefined();
  });

  it('toxicity uses tab 1’s pathway and fades everything off the main route to the red dot', () => {
    const g = buildGeometry(sequenceScene(tab('toxicity')));
    const moa = buildGeometry(sequenceScene(tab('moa')));
    const pos = (gg: typeof g) => gg.nodes.filter((n) => n.pathwayId === 'p1').map((n) => [n.id, Math.round(n.x), Math.round(n.y)]);
    expect(pos(g)).toEqual(pos(moa));
    // The tab itself keeps its own, different pathway.
    expect(pos(buildGeometry(tab('toxicity')))).not.toEqual(pos(moa));
    const toxic = g.nodes.find((n) => n.toxic)!;
    expect(toxic.dim).toBeUndefined();
    // The route: at most two lines into each protein on it, back to the receptor; the rest fades.
    const bright = g.edges.filter((e) => e.dim === undefined);
    const into = bright.filter((e) => e.to === toxic.id);
    expect(into.length).toBeGreaterThan(0);
    expect(into.length).toBeLessThanOrEqual(2);
    for (const n of g.nodes.filter((x) => x.dim === undefined && x.layer > 0)) {
      expect(bright.filter((e) => e.to === n.id).length).toBeGreaterThan(0);
      expect(bright.filter((e) => e.to === n.id).length).toBeLessThanOrEqual(2);
    }
    expect(g.nodes.find((n) => n.layer === 0)!.dim).toBeUndefined();
    expect(g.edges.filter((e) => e.dim !== undefined).length).toBeGreaterThan(bright.length / 2);
    expect(g.nodes.some((n) => n.dim !== undefined)).toBe(true);
  });

  it('combination builds its added pathway out from the crosstalk back to its receptor, sparser than the tab', () => {
    const v = sequenceScene(tab('combination'));
    const g = buildGeometry(v);
    const added = g.nodes.filter((n) => n.pathwayId === 'p2');
    expect(added.length).toBeGreaterThan(0);
    expect(g.nodes.filter((n) => n.pathwayId === 'p1').every((n) => n.discoverAt === undefined)).toBe(true);
    // Deeper layers appear first; the receptor last.
    const byLayer = new Map(added.map((n) => [n.layer, n.discoverAt!]));
    const layers = [...byLayer.keys()].sort((a, b) => a - b);
    for (let i = 1; i < layers.length; i++) expect(byLayer.get(layers[i])!).toBeLessThan(byLayer.get(layers[i - 1])!);
    const cross = g.edges.filter((e) => e.crosstalk && e.pathwayId === 'p2');
    expect(cross.length).toBeGreaterThan(0);
    expect(cross.every((e) => e.discoverAt === 0 && e.growBack)).toBe(true);
    expect(g.receptors.find((r) => r.pathwayId === 'p2')!.discoverAt).toBe(Math.max(...added.map((n) => n.discoverAt!)));
    // Fewer lines in the added pathway than the tab's own.
    const count = (gg: typeof g) => gg.edges.filter((e) => e.pathwayId === 'p2' && !e.crosstalk).length;
    expect(count(g)).toBeLessThan(count(buildGeometry(tab('combination'))));
  });

  it('gives every tab a section of the same length, fitted to the one that needs longest', () => {
    const s = seqWith(['moa', 'combination', 'toxicity', 'tissue', 'crossTissue'], { seqTransition: 1 });
    const p = sequencePlan(s, tabs);
    const [a, b, c, d, e] = p.segments;
    expect(b.lead).toBe(BUILD);
    expect(b.needs).toBeCloseTo(BUILD + run('combination'), 9);
    expect(c.lead).toBe(0);
    expect(d.lead).toBe(ZOOM_OUT);
    expect(d.zoomFrom).toBe(c.scene);
    expect(e.lead).toBe(0);
    // Sections: equal, back to back, long enough for every tab, in half seconds.
    expect(p.section * 2).toBe(Math.round(p.section * 2));
    expect(p.section).toBeGreaterThanOrEqual(Math.max(...p.segments.map((g) => g.needs)));
    expect(p.section - Math.max(...p.segments.map((g) => g.needs))).toBeLessThan(0.5);
    p.segments.forEach((g, i) => expect(g.start).toBeCloseTo(i * p.section, 9));
    expect(a.length).toBeCloseTo(p.section + 1, 9);
    expect(e.length).toBeCloseTo(p.section, 9);
    expect(p.total).toBeCloseTo(5 * p.section, 9);
    // Tabs 4 and 5 are now as short as the others: no section longer than about a pathway and a build-out.
    expect(p.section).toBeLessThan(8);
    // A set length overrides the fit.
    expect(sequencePlan(seqWith(['moa', 'tissue'], { seqSection: 6 }), tabs).section).toBe(6);
  });

  it('shows one tab, or two while they crossfade; builds and zooms from the start of the section', () => {
    setSequenceSources(tabs);
    const s = seqWith(['toxicity', 'combination', 'tissue'], { seqTransition: 1 });
    const { segments: [, b, c], section } = sequencePlan(s);
    const mid = sequenceFrame(s, b.start + 0.5);
    expect(mid.map((f) => f.segment.kind)).toEqual(['toxicity', 'combination']);
    expect(mid[1].mix).toBeCloseTo(0.5, 9);
    expect(mid[1].built).toBeCloseTo(0.5 / BUILD, 9);
    expect(mid[1].time).toBe(0);
    const running = sequenceFrame(s, b.start + BUILD + 0.75)[0];
    expect(running.built).toBe(1);
    expect(running.time).toBeCloseTo(0.75, 9);
    // The tissue after the combination starts framed on its cell and zooms out.
    expect(sequenceFrame(s, c.start)[1].zoomIn).toBe(1);
    expect(sequenceFrame(s, c.start + ZOOM_OUT / 2)[0].zoomIn).toBeCloseTo(0.5, 9);
    expect(sequenceFrame(s, c.start + ZOOM_OUT)[0].zoomIn).toBe(0);
    // The end of a section holds the tab's last frame.
    const held = sequenceFrame(s, b.start + section - 0.01)[0];
    expect(held.time).toBeCloseTo(Math.min(section - 0.01 - BUILD, buildSchedule(b.scene).total + 99), 6);
    expect(sequenceFrame(s, sequencePlan(s).total).map((f) => f.segment.kind)).toEqual(['tissue']);
  });

  it('sets the timeline and the export: one run, frame by frame, the transitions included', () => {
    setSequenceSources(tabs);
    const s = seqWith(['moa', 'combination']);
    const total = sequencePlan(s).total;
    expect(buildSchedule(s).total).toBeCloseTo(total, 9);
    expect(planVideo(s, 30, 1).frames).toBe(Math.round(total * 30));
  });

  it('is saved and loaded with its tabs, order and timing', () => {
    const s = seqWith(['body', 'moa', 'journey'], { seqTransition: 1.5 });
    const loaded = parseSceneJson(serializeScene(s));
    expect(loaded.module).toMatchObject({ kind: 'sequence', seqTabs: ['body', 'moa', 'journey'], seqTransition: 1.5 });
    const junk = parseSceneJson(serializeScene({ ...s, module: { ...s.module, seqTabs: ['moa', 'nope', 'sequence', 'moa'] as ModuleKind[] } }));
    expect(junk.module.seqTabs).toEqual(['moa']);
  });
});
