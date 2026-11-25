import { describe, expect, it } from 'vitest';
import { MODULES, moduleScene } from './modules';
import { parseSceneJson, serializeScene } from './sceneIO';
import { sequenceFrame, sequencePlan, setSequenceSources } from './sequence';
import { buildSchedule } from './timeline';
import { planVideo } from './video';
import type { ModuleKind, Scene } from './types';

const tabs = MODULES.map((m) => moduleScene(m.kind, 1234));
const seqWith = (seqTabs: ModuleKind[], extra: Partial<Scene['module']> = {}): Scene => {
  const s = moduleScene('sequence', 1234);
  return { ...s, module: { ...s.module, seqTabs, ...extra } };
};
const len = (kind: ModuleKind) => buildSchedule(tabs.find((t) => t.module.kind === kind)!).total;

describe('the sequence tab', () => {
  it('is the last tab, and plays tabs 1–6 by default', () => {
    expect(MODULES[MODULES.length - 1].kind).toBe('sequence');
    expect(moduleScene('sequence').module.seqTabs).toEqual(['moa', 'combination', 'toxicity', 'tissue', 'crossTissue', 'body']);
  });

  it('plays the tabs back to back, each crossfading into the next', () => {
    const s = seqWith(['moa', 'combination', 'toxicity'], { seqTransition: 1 });
    const p = sequencePlan(s, tabs);
    expect(p.segments.map((g) => g.kind)).toEqual(['moa', 'combination', 'toxicity']);
    expect(p.fade).toBe(1);
    expect(p.segments[0].start).toBe(0);
    expect(p.segments[1].start).toBeCloseTo(len('moa') - 1, 9);
    expect(p.segments[2].start).toBeCloseTo(len('moa') + len('combination') - 2, 9);
    expect(p.total).toBeCloseTo(len('moa') + len('combination') + len('toxicity') - 2, 9);
    // Each tab plays its own scene, as set up in its own tab.
    expect(p.segments[1].scene).toBe(tabs.find((t) => t.module.kind === 'combination'));
  });

  it('shows one tab, or two while they crossfade, easing the incoming one in', () => {
    setSequenceSources(tabs);
    const s = seqWith(['moa', 'combination'], { seqTransition: 1 });
    const b = sequencePlan(s).segments[1].start;
    expect(sequenceFrame(s, 0.5).map((f) => f.segment.kind)).toEqual(['moa']);
    const mid = sequenceFrame(s, b + 0.5);
    expect(mid.map((f) => f.segment.kind)).toEqual(['moa', 'combination']);
    expect(mid[0].mix).toBe(1);
    expect(mid[1].mix).toBeCloseTo(0.5, 9);
    expect(mid[1].time).toBeCloseTo(0.5, 9);
    expect(mid[0].time).toBeCloseTo(b + 0.5, 9);
    expect(sequenceFrame(s, b + 0.1)[1].mix).toBeLessThan(0.1);
    const after = sequenceFrame(s, b + 1.5);
    expect(after.map((f) => f.segment.kind)).toEqual(['combination']);
    expect(after[0].mix).toBe(1);
    // The last frame still shows the last tab.
    expect(sequenceFrame(s, sequencePlan(s).total).map((f) => f.segment.kind)).toEqual(['combination']);
  });

  it('repeats looping tabs, runs the journey once, and keeps crossfades shorter than half a tab', () => {
    const s = seqWith(['moa', 'journey'], { seqLoops: 3, seqTransition: 0 });
    const p = sequencePlan(s, tabs);
    expect(p.segments[0].length).toBeCloseTo(3 * len('moa'), 9);
    expect(p.segments[1].length).toBeCloseTo(len('journey'), 9);
    const long = sequencePlan(seqWith(['moa', 'combination'], { seqTransition: 5 }), tabs);
    expect(long.fade).toBeLessThanOrEqual(Math.min(len('moa'), len('combination')) / 2);
  });

  it('sets the timeline and the export: one run, frame by frame, the transitions included', () => {
    setSequenceSources(tabs);
    const s = seqWith(['moa', 'combination']);
    const total = sequencePlan(s).total;
    expect(buildSchedule(s).total).toBeCloseTo(total, 9);
    expect(planVideo(s, 30, 1).frames).toBe(Math.round(total * 30));
  });

  it('is saved and loaded with its tabs, order and timing', () => {
    const s = seqWith(['body', 'moa', 'journey'], { seqLoops: 2, seqTransition: 1.5 });
    const loaded = parseSceneJson(serializeScene(s));
    expect(loaded.module).toMatchObject({ kind: 'sequence', seqTabs: ['body', 'moa', 'journey'], seqLoops: 2, seqTransition: 1.5 });
    const junk = parseSceneJson(serializeScene({ ...s, module: { ...s.module, seqTabs: ['moa', 'nope', 'sequence', 'moa'] as ModuleKind[] } }));
    expect(junk.module.seqTabs).toEqual(['moa']);
  });
});
