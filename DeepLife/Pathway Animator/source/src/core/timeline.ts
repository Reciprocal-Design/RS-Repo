import { buildGeometry } from './geometry';
import type { EdgeGeom, Scene } from './types';

/** Seconds lit edges take to fade back to base before the loop restarts. */
export const FADE_OUT = 0.8;
/** Seconds a node pulse lasts. */
export const PULSE = 0.5;

export interface EdgeTiming {
  edge: EdgeGeom;
  start: number; // when the comet leaves the source node
  duration: number; // seconds to travel the edge
}

export interface Schedule {
  /** When each node fires (first arrival; the receptor fires at its start delay). */
  fire: Map<string, number>;
  /** Every signal arrival per node, sorted; the first one fires it. */
  arrivals: Map<string, number[]>;
  edges: EdgeTiming[];
  /** Time the last comet (and its trail) finishes. */
  signalEnd: number;
  /** Full cycle length: signal, hold, and (when looping) the fade back to base. */
  total: number;
}

const cache = new WeakMap<Scene, Schedule>();

/**
 * When everything happens, derived purely from the scene. Signals start at each
 * receptor at its pathway's start delay; a node fires on the first arrival from
 * any edge (including crosstalk) and never fires again, so this is a shortest-
 * path search over the edge durations.
 */
export function buildSchedule(scene: Scene): Schedule {
  const hit = cache.get(scene);
  if (hit) return hit;

  const g = buildGeometry(scene);
  const a = scene.animation;
  const hop = Math.max(0.05, a.layerDuration);
  const durationOf = (e: EdgeGeom) => {
    const to = g.nodeById.get(e.to)!;
    return to.region === 'nucleus' ? hop * Math.max(0.1, a.nucleusSpeedFactor) : hop;
  };

  const outgoing = new Map<string, EdgeGeom[]>();
  for (const e of g.edges) {
    const list = outgoing.get(e.from) ?? [];
    list.push(e);
    outgoing.set(e.from, list);
  }

  const fire = new Map<string, number>();
  const arrivals = new Map<string, number[]>();
  // Small graphs (a few hundred nodes; a cell map a few thousand): a
  // pick-the-earliest loop over the pending set is plenty.
  const pending = new Map<string, number>();
  const receptorOf = new Map(g.nodes.filter((n) => n.layer === 0).map((n) => [n.pathwayId, n.id]));
  for (const p of g.pathways) {
    const receptor = receptorOf.get(p.id);
    if (receptor) pending.set(receptor, Math.max(0, p.startDelay));
  }
  while (pending.size) {
    let id = '';
    let t = Infinity;
    for (const [k, v] of pending) if (v < t || (v === t && k < id)) (id = k), (t = v);
    pending.delete(id);
    fire.set(id, t);
    for (const e of outgoing.get(id) ?? []) {
      if (fire.has(e.to)) continue;
      const at = t + durationOf(e);
      if (at < (pending.get(e.to) ?? Infinity)) pending.set(e.to, at);
    }
  }

  const edges: EdgeTiming[] = [];
  let signalEnd = 0;
  const trail = Math.max(0, a.trailLength);
  for (const e of g.edges) {
    const start = fire.get(e.from);
    if (start === undefined) continue;
    const duration = durationOf(e);
    edges.push({ edge: e, start, duration });
    const arrive = start + duration;
    const list = arrivals.get(e.to) ?? [];
    list.push(arrive);
    arrivals.set(e.to, list);
    signalEnd = Math.max(signalEnd, arrive + trail * duration, arrive + PULSE);
  }
  for (const list of arrivals.values()) list.sort((x, y) => x - y);

  const total = signalEnd + Math.max(0, a.holdAtEnd) + (a.loop ? FADE_OUT : 0);
  const schedule: Schedule = { fire, arrivals, edges, signalEnd, total };
  cache.set(scene, schedule);
  return schedule;
}

/** Map playback time onto one cycle: wraps when looping, otherwise clamps. */
export function cycleTime(scene: Scene, t: number): number {
  const { total } = buildSchedule(scene);
  if (total <= 0) return 0;
  if (scene.animation.loop) return ((t % total) + total) % total;
  return Math.min(Math.max(t, 0), total);
}

export const ease = (x: number, mode: 'linear' | 'easeInOut') =>
  mode === 'easeInOut' ? (x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2) : x;

/** 0 → 1 → 0 bump for a pulse that started `dt` seconds ago. */
export const pulseEnvelope = (dt: number) => (dt < 0 || dt > PULSE ? 0 : Math.sin((Math.PI * dt) / PULSE) ** 2);
