import { sequencePlan } from './sequence';
import { reverseEdge } from './connect';
import { buildGeometry } from './geometry';
import type { EdgeGeom, Scene } from './types';

/** Seconds lit edges take to fade back to base before the loop restarts. */
export const FADE_OUT = 0.8;
/** Seconds a node pulse lasts. */
export const PULSE = 0.5;
/** Safety cap on relay waves per cycle. */
const MAX_WAVES = 400;
/** Hops between two runs of the same pathway (relays arriving sooner only pulse the receptor). */
const RELAY_GAP = 1.5;
/** Hops a traced signal rests at each end of its route before turning back. */
const TURN_REST = 0.4;

export interface EdgeTiming {
  edge: EdgeGeom;
  start: number; // when the comet leaves the source node
  duration: number; // seconds to travel the edge
  wave: number; // 0: the pathways' own signal; 1, 2…: relays from neighbouring cells
}

export interface Schedule {
  /** When each node first fires. */
  fire: Map<string, number>;
  /** Every signal arrival per node, sorted. */
  arrivals: Map<string, number[]>;
  /** When each pathway is running: one interval per wave that passes through it. */
  runs: Map<string, { start: number; end: number }[]>;
  /** Node pulses: full when a node fires, weaker for later arrivals. */
  pulses: Map<string, { t: number; strength: number }[]>;
  edges: EdgeTiming[];
  /** Time the last comet (and its trail) finishes. */
  signalEnd: number;
  /** Full cycle length: signal, hold, and (when looping) the fade back to base. */
  total: number;
  /** Seconds a lit edge stays lit after its comet passes (shortened when continuous motion needs it). */
  litHold: number;
  /**
   * Continuous mode: every event repeats with this period (= total), so the
   * end of the signal runs on into the start of the next loop. 0 otherwise.
   */
  period: number;
}

const cache = new WeakMap<Scene, Schedule>();

/**
 * When everything happens, derived purely from the scene.
 *
 * Wave 0 is the pathways' own signal: it starts at each receptor at its
 * pathway's start delay, and a node fires on its first arrival from any edge
 * (crosstalk included), so this is a shortest-path search over edge durations.
 *
 * On a cell map, links carry the signal into a neighbour's relay receptor.
 * Each arrival there starts a new wave that runs that cell's pathway again
 * from the receptor, unless another run of that pathway started within a
 * hop and a half of it, and at most `relayHops` cells down a chain, so relays
 * always come to an end.
 */
export function buildSchedule(scene: Scene): Schedule {
  if (scene.module.kind === 'sequence') {
    // The sequence plays other tabs (core/sequence.ts); its length follows theirs, so it is never cached here.
    const total = sequencePlan(scene).total;
    return { fire: new Map(), arrivals: new Map(), runs: new Map(), pulses: new Map(), edges: [], signalEnd: total, total, litHold: 0, period: 0 };
  }
  const hit = cache.get(scene);
  if (hit) return hit;
  if (scene.module.kind === 'journey' || scene.module.kind === 'realCell') {
    // The journey and the real-cell view run their own timelines
    // (render/journey.ts, render/realCell.ts): five equal sections.
    const total = 5 * Math.max(0.5, scene.module.sectionLength);
    const empty: Schedule = { fire: new Map(), arrivals: new Map(), runs: new Map(), pulses: new Map(), edges: [], signalEnd: total, total, litHold: 0, period: 0 };
    cache.set(scene, empty);
    return empty;
  }

  const g = buildGeometry(scene);
  const a = scene.animation;
  const hop = Math.max(0.05, a.layerDuration);
  const durationOf = (e: EdgeGeom) => {
    const to = g.nodeById.get(e.to)!;
    return (to.region === 'nucleus' ? hop * Math.max(0.1, a.nucleusSpeedFactor) : hop) * (e.hops ?? 1);
  };

  const outgoing = new Map<string, EdgeGeom[]>();
  const linksFrom = new Map<string, EdgeGeom[]>();
  for (const e of g.edges) {
    const m = e.link ? linksFrom : outgoing;
    const list = m.get(e.from) ?? [];
    list.push(e);
    m.set(e.from, list);
  }

  // Grey idle mode: crosstalk from another pathway of the same cell ends where
  // it arrives (the node pulses) instead of running that pathway on, so only
  // the pathway that was triggered lights up.
  const crosstalkEnds = scene.style.greyIdle;
  const carries = (e: EdgeGeom) => !(crosstalkEnds && e.crosstalk);

  // One wave: first-arrival times from the sources, along in-cell edges.
  // Small graphs (a few thousand nodes at most): pick-the-earliest is plenty.
  const runWave = (sources: [string, number][]) => {
    const fired = new Map<string, number>();
    const pending = new Map<string, number>(sources);
    while (pending.size) {
      let id = '';
      let t = Infinity;
      for (const [k, v] of pending) if (v < t || (v === t && k < id)) (id = k), (t = v);
      pending.delete(id);
      fired.set(id, t);
      for (const e of outgoing.get(id) ?? []) {
        if (fired.has(e.to) || !carries(e)) continue;
        const at = t + durationOf(e);
        if (at < (pending.get(e.to) ?? Infinity)) pending.set(e.to, at);
      }
    }
    return fired;
  };

  const fire = new Map<string, number>();
  const arrivals = new Map<string, number[]>();
  const pulses = new Map<string, { t: number; strength: number }[]>();
  const edges: EdgeTiming[] = [];
  const push = <T>(m: Map<string, T[]>, k: string, v: T) => {
    const list = m.get(k);
    if (list) list.push(v);
    else m.set(k, [v]);
  };
  interface Trigger { node: string; t: number; hops: number }
  const triggers: Trigger[] = [];

  const record = (fired: Map<string, number>, wave: number, hops: number) => {
    const first = new Map<string, number>();
    for (const [id, t] of fired) {
      fire.set(id, Math.min(fire.get(id) ?? Infinity, t));
      push(pulses, id, { t, strength: 1 });
      first.set(id, t);
    }
    for (const [id, t] of fired) {
      for (const e of outgoing.get(id) ?? []) {
        const duration = durationOf(e);
        edges.push({ edge: e, start: t, duration, wave });
        const at = t + duration;
        push(arrivals, e.to, at);
        // Later arrivals at a node already fired in this wave pulse more
        // softly, as do crosstalk arrivals that end there.
        const soft = !carries(e) || at > (first.get(e.to) ?? Infinity) + 1e-9;
        if (soft) push(pulses, e.to, { t: at, strength: 0.45 });
      }
      for (const e of linksFrom.get(id) ?? []) {
        const duration = durationOf(e);
        edges.push({ edge: e, start: t, duration, wave });
        push(arrivals, e.to, t + duration);
        triggers.push({ node: e.to, t: t + duration, hops: hops + 1 });
      }
    }
  };

  // Wave 0: every pathway's own start.
  const receptorOf = new Map<string, string>();
  for (const n of g.nodes) if (n.layer === 0 && !receptorOf.has(n.pathwayId)) receptorOf.set(n.pathwayId, n.id);
  const starts: [string, number][] = [];
  for (const p of g.pathways) {
    const r = p.start ?? receptorOf.get(p.id);
    if (r && !p.relayOnly) starts.push([r, Math.max(0, p.startDelay)]);
  }
  const wave0 = runWave(starts);
  record(wave0, 0, 0);

  // A traced route: the pulse has run from the receptor to the nucleus. It now
  // runs back and forth along the same route, each pass a mirror of the last,
  // and the loop closes as it gets back to the receptor.
  const traced = edges.filter((et) => et.edge.traced);
  let tracedLoop = 0;
  if (traced.length) {
    const reach = Math.max(...traced.map((et) => et.start + et.duration));
    const leg = reach + TURN_REST * hop;
    // One direction only: the pulse runs from the receptor to the DEGs, and the loop starts it again.
    const passes = 0;
    if (a.loop || a.continuous) tracedLoop = (passes + 1) * leg;
    const backwards = new Map(traced.map((et) => [et.edge.id, reverseEdge(et.edge)]));
    for (let pass = 1; pass <= passes; pass++) {
      for (const et of traced) {
        const inwards = pass % 2 === 0;
        const edge = inwards ? et.edge : backwards.get(et.edge.id)!;
        const start = pass * leg + (inwards ? et.start : reach - et.start - et.duration);
        edges.push({ edge, start, duration: et.duration, wave: pass });
        push(arrivals, edge.to, start + et.duration);
        push(pulses, edge.to, { t: start + et.duration, strength: 1 });
      }
    }
  }

  // Relay waves, in time order. A pathway can run again once the last run
  // has moved on by a hop and a half, so relays chase each other down it
  // rather than starting on top of one another.
  const busy = new Map<string, number[]>(); // pathway → wave start times
  for (const p of g.pathways) busy.set(p.id, p.relayOnly ? [] : [Math.max(0, p.startDelay)]);
  const gap = RELAY_GAP * hop;
  const maxHops = Math.max(0, Math.round(scene.cellMap.relayHops ?? 0));
  let waves = 0;
  while (triggers.length && waves < MAX_WAVES) {
    let k = 0;
    for (let i = 1; i < triggers.length; i++) if (triggers[i].t < triggers[k].t) k = i;
    const { node, t, hops } = triggers.splice(k, 1)[0];
    const pid = g.nodeById.get(node)!.pathwayId;
    const starts = busy.get(pid) ?? [];
    const free = starts.every((s) => Math.abs(t - s) >= gap);
    if (hops > maxHops || !free) {
      push(pulses, node, { t, strength: 0.45 });
      continue;
    }
    starts.push(t);
    busy.set(pid, starts);
    record(runWave([[node, t]]), ++waves, hops);
  }

  let signalEnd = 0;
  const trail = Math.max(0, a.trailLength);
  for (const et of edges) {
    const arrive = et.start + et.duration;
    signalEnd = Math.max(signalEnd, arrive + trail * et.duration, arrive + PULSE);
  }
  for (const list of arrivals.values()) list.sort((x, y) => x - y);

  // Pathway runs: the span of each wave's comets within each pathway.
  const byRun = new Map<string, { pid: string; start: number; end: number }>();
  for (const et of edges) {
    const pid = et.edge.pathwayId, key = `${pid}|${et.wave}`;
    const r = byRun.get(key);
    const end = et.start + et.duration;
    if (r) (r.start = Math.min(r.start, et.start)), (r.end = Math.max(r.end, end));
    else byRun.set(key, { pid, start: et.start, end });
  }
  const runs = new Map<string, { start: number; end: number }[]>();
  for (const r of byRun.values()) push(runs, r.pid, { start: r.start, end: r.end });

  const litHold = a.continuous ? continuousHold(edges, trail, Math.max(0, a.holdAtEnd)) : Math.max(0, a.holdAtEnd);
  const total = tracedLoop ? tracedLoop : a.continuous
    ? continuousPeriod(edges, trail, litHold, a.density ?? 0)
    : signalEnd + Math.max(0, a.holdAtEnd) + (a.loop ? FADE_OUT : 0);
  const schedule: Schedule = { fire, arrivals, runs, pulses, edges, signalEnd, total, litHold, period: tracedLoop || a.continuous ? total : 0 };
  cache.set(scene, schedule);
  return schedule;
}

/** Does playback wrap round? Continuous motion always loops. */
export const loops = (scene: Scene) => scene.animation.loop || scene.animation.continuous;

/** Seconds since an event at `at`, wrapped onto the period in continuous mode. */
export const since = (tau: number, at: number, period: number) =>
  period > 0 ? ((((tau - at) % period) + period) % period) : tau - at;

/**
 * Continuous mode's lit hold: no longer than fits inside the signal's own span.
 * A longer hold would stretch the loop past the signal, leaving a stretch with
 * no comet running (a fast signal on a short pathway).
 */
export function continuousHold(edges: EdgeTiming[], trail: number, hold: number): number {
  if (!edges.length) return hold;
  const span = Math.max(...edges.map((e) => e.start + e.duration)) - Math.min(...edges.map((e) => e.start));
  const edge = Math.max(...edges.map((e) => e.duration * (1 + trail)));
  return Math.max(0, Math.min(hold, span - edge - FADE_OUT - 0.05));
}

/**
 * Continuous mode's loop length. Every event repeats with the period, so a
 * comet running at time t also runs at t + period: the loop is seamless, and
 * the question is only how long to make it. It is the longest period (up to
 * the signal's whole span) for which, once everything is wrapped onto it,
 * some comet head is always travelling. Density folds more of the signal over
 * itself for busier motion. It never drops below what one edge needs (its
 * travel, trail, and its lit hold and fade), so nothing overlaps itself.
 */
export function continuousPeriod(edges: EdgeTiming[], trail: number, litHold: number, density: number): number {
  if (!edges.length) return 1;
  // Activity = a comet head travelling along an edge.
  const iv = edges.map((e) => [e.start, e.start + e.duration] as const);
  const t0 = Math.min(...iv.map((x) => x[0]));
  const span = Math.max(...iv.map((x) => x[1])) - t0;
  const floor = Math.max(...edges.map((e) => e.duration * (1 + trail) + litHold + FADE_OUT)) + 0.05;
  const covered = (T: number) => {
    const parts: [number, number][] = [];
    for (const [a, b] of iv) {
      if (b - a >= T) return true;
      const s = (((a - t0) % T) + T) % T, e = s + (b - a);
      if (e <= T) parts.push([s, e]);
      else parts.push([s, T], [0, e - T]);
    }
    parts.sort((x, y) => x[0] - y[0]);
    let reach = 0;
    for (const [a, b] of parts) {
      if (a > reach + 1e-6) return false;
      reach = Math.max(reach, b);
    }
    return reach >= T - 1e-6;
  };
  const step = Math.max(0.02, span / 400);
  let best = 0;
  for (let T = Math.max(span, floor); T >= floor; T -= step) {
    if (covered(T)) {
      best = T;
      break;
    }
  }
  if (!best) return Math.max(span, floor); // no gap-free loop: keep the whole signal
  const dense = Math.max(floor, best * (1 - 0.6 * Math.max(0, Math.min(1, density))));
  return covered(dense) ? dense : best;
}

/** Map playback time onto one cycle: wraps when looping, otherwise clamps. */
export function cycleTime(scene: Scene, t: number): number {
  const { total } = buildSchedule(scene);
  if (total <= 0) return 0;
  if (loops(scene)) return ((t % total) + total) % total;
  return Math.min(Math.max(t, 0), total);
}

export const ease = (x: number, mode: 'linear' | 'easeInOut') =>
  mode === 'easeInOut' ? (x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2) : x;

/** 0 → 1 → 0 bump for a pulse that started `dt` seconds ago. */
export const pulseEnvelope = (dt: number) => (dt < 0 || dt > PULSE ? 0 : Math.sin((Math.PI * dt) / PULSE) ** 2);
