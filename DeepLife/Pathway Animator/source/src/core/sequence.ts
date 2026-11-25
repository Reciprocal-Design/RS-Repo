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
  /** Sequence time this tab starts at (it fades in over the transition before that from the previous one). */
  start: number;
  /** Seconds it plays, its fade out included. */
  length: number;
  /** Seconds before its own animation starts: the crossfade in, then a build-out or zoom-out. */
  lead: number;
  /** The combination: its added pathway builds out over BUILD seconds after the crossfade in. */
  build?: boolean;
  /** A tissue after a single cell: it starts on that cell, framed as the previous tab showed it, and zooms out. */
  zoomFrom?: Scene;
}

export interface SequencePlan {
  segments: SequenceSegment[];
  /** Crossfade length actually used (shortened for very short tabs). */
  fade: number;
  total: number;
}

/** Views that run once, start to end, whatever their loop setting (and play in the sequence as they are). */
export const RUNS_ONCE: ModuleKind[] = ['journey', 'realCell', 'sequence'];

/** Seconds the combination's added pathway takes to build out, and a tissue to zoom out from the cell before it. */
export const BUILD = 2.5;
export const ZOOM_OUT = 2.5;

/** The tabs that show one cell on its own, which a following tissue zooms out of. */
const SINGLE: ModuleKind[] = ['moa', 'combination', 'toxicity'];
/** Tissue views that start on their selected cell. */
const TISSUES: ModuleKind[] = ['tissue', 'crossTissue'];

const variants = new WeakMap<Scene, Scene>();

/**
 * A tab as the sequence plays it (the tab itself is unchanged): its signal
 * runs once, one pulse from the receptor to the DEGs, and holds. On top of
 * that (module.seqPart, core/modules.ts and core/timeline.ts) the
 * combination's added pathway is laid out sparser and builds out, and
 * toxicity keeps tab 1's pathway with the rest of the network dimmed round
 * the route to the toxic DEG. The journey and real-cell views play as they are.
 */
export function sequenceScene(scene: Scene): Scene {
  if (RUNS_ONCE.includes(scene.module.kind)) return scene;
  const hit = variants.get(scene);
  if (hit) return hit;
  const kind = scene.module.kind;
  const v: Scene = {
    ...scene,
    animation: { ...scene.animation, loop: false, continuous: false },
    module: { ...scene.module, seqPart: true },
    // The added pathway, less crowded where it meets the first: fewer proteins in its deeper rows, and
    // fewer branches and merges between its layers.
    ...(kind === 'combination'
      ? { pathways: scene.pathways.map((p, i) => (i === 0 ? p : {
        ...p,
        branching: Math.min(p.branching, 0.15),
        convergence: Math.min(p.convergence, 0.15),
        layers: p.layers.map((l, li) => {
          const deep = li >= p.layers.length - 3 ? Math.max(1, l.nodeCount - 1) : l.nodeCount;
          return li > 0 ? { ...l, nodeCount: deep, activeCount: Math.min(l.activeCount, deep) } : l;
        }),
      })) }
      : {}),
  };
  variants.set(scene, v);
  return v;
}

const plans = new WeakMap<Scene, { from: readonly Scene[]; plan: SequencePlan }>();

/**
 * When each tab plays: back to back, each running its signal once (the
 * journey and real-cell views their whole run), the next starting
 * `seqTransition` seconds before the previous one ends so the two crossfade.
 * The combination first builds out its added pathway, and a tissue after a
 * single cell first zooms out from it, before their signal starts.
 */
export function sequencePlan(scene: Scene, tabs: readonly Scene[] = sources): SequencePlan {
  const hit = plans.get(scene);
  if (hit && hit.from === tabs) return hit.plan;
  const m = scene.module;
  const picked = m.seqTabs
    .map((kind) => tabs.find((s) => s.module.kind === kind))
    .filter((s): s is Scene => !!s && s.module.kind !== 'sequence')
    .map(sequenceScene);
  const runs = picked.map((s) => Math.max(0.1, buildSchedule(s).total));
  // A crossfade never takes more than half of the shortest run.
  const fade = picked.length > 1 ? Math.max(0, Math.min(m.seqTransition, ...runs.map((l) => l / 2))) : 0;
  const segments: SequenceSegment[] = [];
  let at = 0;
  picked.forEach((s, i) => {
    const kind = s.module.kind;
    const prev = picked[i - 1];
    const build = kind === 'combination';
    const zoomFrom = prev && TISSUES.includes(kind) && SINGLE.includes(prev.module.kind) ? prev : undefined;
    const lead = i > 0 && (build || zoomFrom) ? fade + (build ? BUILD : ZOOM_OUT) : build ? BUILD : 0;
    const length = lead + runs[i];
    segments.push({
      kind, label: moduleInfo(kind).label, scene: s, start: at, length, lead,
      ...(build ? { build } : {}), ...(zoomFrom ? { zoomFrom } : {}),
    });
    at += length - fade;
  });
  const total = segments.length ? at + fade : 1;
  const plan = { segments, fade, total };
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
    const into = i === 0 ? 0 : fade; // the crossfade in comes first
    const item: SequenceFrameItem = {
      segment: seg,
      time: Math.max(0, u - seg.lead),
      mix: i === 0 || fade <= 0 ? 1 : smooth((tt - seg.start) / fade),
    };
    if (seg.build) item.built = Math.max(0, Math.min(1, (u - into) / BUILD));
    if (seg.zoomFrom) item.zoomIn = 1 - smooth((u - into) / ZOOM_OUT);
    out.push(item);
  });
  return out;
}
