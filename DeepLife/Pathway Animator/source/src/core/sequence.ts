import { moduleInfo } from './modules';
import { buildSchedule } from './timeline';
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
  /** The tab's scene as the sequence plays it (sequenceScene). */
  scene: Scene;
  /** Sequence time its section starts at (it fades in over the first `fade` seconds of it). */
  start: number;
  /** Seconds of its section. */
  section: number;
  /** Seconds it shows: its section, and the crossfade into the next one. */
  length: number;
  /** Seconds before its own animation starts: a build-out or zoom-out. */
  lead: number;
  /** Seconds it needs: the lead, then until its pulse reaches the end of the pathway. */
  needs: number;
  /** The combination: its added pathway builds out over the first BUILD seconds. */
  build?: boolean;
  /** A tissue after a single cell: it starts on that cell, framed as the previous tab showed it, and zooms out. */
  zoomFrom?: Scene;
}

export interface SequencePlan {
  segments: SequenceSegment[];
  /** Crossfade length actually used (at most half the shortest section). */
  fade: number;
  /** Seconds per section when every tab gets the same (seqEqual); else the longest tab's. */
  section: number;
  total: number;
}

/** Views that run once, start to end, whatever their loop setting (and play in the sequence as they are). */
export const RUNS_ONCE: ModuleKind[] = ['journey', 'realCell', 'sequence'];

/** Seconds the combination's added pathway takes to build out, and a tissue to zoom out from the cell before it. */
export const BUILD = 2;
export const ZOOM_OUT = 2;

/** The tabs that show one cell on its own, which a following tissue zooms out of. */
const SINGLE: ModuleKind[] = ['moa', 'combination', 'toxicity'];
/** Tissue views that start on their selected cell. */
const TISSUES: ModuleKind[] = ['tissue', 'crossTissue'];

const variants = new WeakMap<Scene, Scene>();

/**
 * A tab as the sequence plays it (the tab itself is unchanged): its signal
 * runs once, one pulse from the receptor to the DEGs, and holds; the
 * combination's added pathway builds out (module.seqPart, core/modules.ts).
 * The journey and real-cell views play as they are.
 */
export function sequenceScene(scene: Scene): Scene {
  if (RUNS_ONCE.includes(scene.module.kind)) return scene;
  const hit = variants.get(scene);
  if (hit) return hit;
  const v: Scene = {
    ...scene,
    animation: { ...scene.animation, loop: false, continuous: false },
    module: { ...scene.module, seqPart: true },
  };
  variants.set(scene, v);
  return v;
}

const plans = new WeakMap<Scene, { from: readonly Scene[]; plan: SequencePlan }>();

/** Seconds until a scene's pulse has reached the end of its last line (the whole run for the journey and real-cell views). */
function arrival(scene: Scene): number {
  const sc = buildSchedule(scene);
  if (RUNS_ONCE.includes(scene.module.kind) || !sc.edges.length) return sc.total;
  return Math.max(...sc.edges.map((et) => et.start + et.duration));
}

/**
 * When each tab plays: one after another, each moving on as soon as its
 * pulse reaches the end of the pathway (or, with `seqEqual`, in sections of
 * equal length: `seqSection`, or fitted to the tab that needs longest,
 * rounded up to half a second). The next tab fades in over the start of its
 * section, on top of the last moments of the one before. The combination
 * first builds out its added pathway, and a tissue after a single cell first
 * zooms out from it, before their signal starts.
 */
export function sequencePlan(scene: Scene, tabs: readonly Scene[] = sources): SequencePlan {
  const hit = plans.get(scene);
  if (hit && hit.from === tabs) return hit.plan;
  const m = scene.module;
  const picked = m.seqTabs
    .map((kind) => tabs.find((s) => s.module.kind === kind))
    .filter((s): s is Scene => !!s && s.module.kind !== 'sequence')
    .map(sequenceScene);
  const parts = picked.map((s, i) => {
    const kind = s.module.kind;
    const prev = picked[i - 1];
    const build = kind === 'combination';
    const zoomFrom = prev && TISSUES.includes(kind) && SINGLE.includes(prev.module.kind) ? prev : undefined;
    const lead = build ? BUILD : zoomFrom ? ZOOM_OUT : 0;
    return { s, kind, build, zoomFrom, lead, needs: lead + Math.max(0.1, arrival(s)) };
  });
  const fit = Math.ceil(2 * Math.max(1, ...parts.map((p) => p.needs))) / 2;
  const equal = m.seqSection > 0 ? Math.max(1, m.seqSection) : fit;
  const sections = parts.map((p) => (m.seqEqual ? equal : p.needs));
  const fade = parts.length > 1 ? Math.max(0, Math.min(m.seqTransition, ...sections.map((x) => x / 2))) : 0;
  let at = 0;
  const segments: SequenceSegment[] = parts.map((p, i) => {
    const seg: SequenceSegment = {
      kind: p.kind, label: moduleInfo(p.kind).label, scene: p.s,
      start: at, section: sections[i], length: sections[i] + (i < parts.length - 1 ? fade : 0), lead: p.lead, needs: p.needs,
      ...(p.build ? { build: true } : {}), ...(p.zoomFrom ? { zoomFrom: p.zoomFrom } : {}),
    };
    at += sections[i];
    return seg;
  });
  const plan = { segments, fade, section: m.seqEqual ? equal : Math.max(1, ...sections), total: Math.max(1, at) };
  plans.set(scene, { from: tabs, plan });
  return plan;
}

export interface SequenceFrameItem {
  segment: SequenceSegment;
  /** The tab's own animation time. */
  time: number;
  /** How far it has faded in (0–1, eased). */
  mix: number;
  /** The combination: how far its added pathway has built out (0–1). */
  built?: number;
  /** A tissue zooming out from the cell before it: 1 still framed as that cell, 0 its own view (eased). */
  zoomIn?: number;
}

const smooth = (x: number) => {
  const t = Math.max(0, Math.min(1, x));
  return t * t * (3 - 2 * t);
};

/**
 * The tabs showing at sequence time t (one, or two while crossfading), each
 * with its own time and how far it has faded in, built out or zoomed out.
 */
export function sequenceFrame(scene: Scene, t: number): SequenceFrameItem[] {
  const { segments, fade, total } = sequencePlan(scene);
  const tt = Math.max(0, Math.min(t, total));
  const out: SequenceFrameItem[] = [];
  segments.forEach((seg, i) => {
    const end = seg.start + seg.length;
    const last = i === segments.length - 1;
    if (tt < seg.start || (tt >= end && !last)) return;
    const u = Math.min(tt - seg.start, seg.length);
    const item: SequenceFrameItem = {
      segment: seg,
      time: Math.max(0, u - seg.lead),
      mix: i === 0 || fade <= 0 ? 1 : smooth((tt - seg.start) / fade),
    };
    if (seg.build) item.built = Math.max(0, Math.min(1, u / BUILD));
    if (seg.zoomFrom) item.zoomIn = 1 - smooth(u / ZOOM_OUT);
    out.push(item);
  });
  return out;
}
