import { moduleInfo } from './modules';
import { buildSchedule, loops } from './timeline';
import type { ModuleKind, Scene } from './types';

// The sequence tab plays other tabs one after another, each crossfading into
// the next, so one continuous export (a PNG sequence) runs from tab to tab.
// It draws the tabs' own scenes as they are in the app: the store keeps this
// list of them up to date (setSequenceSources).

let sources: readonly Scene[] = [];

/** The scenes of every tab, for the sequence to play (called whenever the tabs change). */
export function setSequenceSources(tabs: readonly Scene[]) {
  sources = tabs;
}

export interface SequenceSegment {
  kind: ModuleKind;
  label: string;
  scene: Scene;
  /** Sequence time this tab starts at (it fades in over the transition before that from the previous one). */
  start: number;
  /** Seconds it plays, its fade out included. */
  length: number;
}

export interface SequencePlan {
  segments: SequenceSegment[];
  /** Crossfade length actually used (shortened for very short tabs). */
  fade: number;
  total: number;
}

/** Views that run once, start to end, whatever their loop setting. */
export const RUNS_ONCE: ModuleKind[] = ['journey', 'realCell', 'sequence'];

const plans = new WeakMap<Scene, { from: readonly Scene[]; plan: SequencePlan }>();

/**
 * When each tab plays: back to back, each `seqLoops` loops long (one run for
 * the journey and real-cell views), the next starting `seqTransition` seconds
 * before the previous one ends so the two crossfade.
 */
export function sequencePlan(scene: Scene, tabs: readonly Scene[] = sources): SequencePlan {
  const hit = plans.get(scene);
  if (hit && hit.from === tabs) return hit.plan;
  const m = scene.module;
  const picked = m.seqTabs
    .map((kind) => tabs.find((s) => s.module.kind === kind))
    .filter((s): s is Scene => !!s && s.module.kind !== 'sequence');
  const lengths = picked.map((s) => {
    const total = Math.max(0.1, buildSchedule(s).total);
    return RUNS_ONCE.includes(s.module.kind) || !loops(s) ? total : total * Math.max(1, m.seqLoops);
  });
  // A crossfade never takes more than half of the shortest tab.
  const fade = picked.length > 1 ? Math.max(0, Math.min(m.seqTransition, ...lengths.map((l) => l / 2))) : 0;
  const segments: SequenceSegment[] = [];
  let at = 0;
  picked.forEach((s, i) => {
    segments.push({ kind: s.module.kind, label: moduleInfo(s.module.kind).label, scene: s, start: at, length: lengths[i] });
    at += lengths[i] - fade;
  });
  const total = segments.length ? at + fade : 1;
  const plan = { segments, fade, total };
  plans.set(scene, { from: tabs, plan });
  return plan;
}

/**
 * The tabs showing at sequence time t (one, or two while crossfading), each
 * with its own time and how far it has faded in (0–1, eased).
 */
export function sequenceFrame(scene: Scene, t: number): { segment: SequenceSegment; time: number; mix: number }[] {
  const { segments, fade, total } = sequencePlan(scene);
  const tt = Math.max(0, Math.min(t, total));
  const out: { segment: SequenceSegment; time: number; mix: number }[] = [];
  segments.forEach((seg, i) => {
    const end = seg.start + seg.length;
    const last = i === segments.length - 1;
    if (tt < seg.start || (tt >= end && !last)) return;
    const x = i === 0 || fade <= 0 ? 1 : Math.min(1, (tt - seg.start) / fade);
    out.push({ segment: seg, time: Math.min(tt - seg.start, seg.length), mix: x * x * (3 - 2 * x) });
  });
  return out;
}
