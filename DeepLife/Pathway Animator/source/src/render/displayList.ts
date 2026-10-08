import { bezierHead, bezierPoint, tAtDistance } from '../core/bezier';
import { makeRamp, parseColor, rgbaString, type RGBA } from '../core/color';
import { buildGeometry } from '../core/geometry';
import { closedSplineSegments } from '../core/outline';
import { buildSchedule, cycleTime, ease, FADE_OUT, pulseEnvelope, since } from '../core/timeline';
import type { Bezier, OutlineLook, Scene, SceneGeom, Vec2 } from '../core/types';

// A flat list of draw primitives, consumed by both the Canvas and SVG backends.

export type Group =
  | 'membrane'
  | 'nucleus'
  | 'mesh'
  | 'particles'
  | 'receptors'
  | 'edges'
  | 'crosstalk'
  | 'signal'
  | 'nodes-active'
  | 'nodes-inactive';

interface Base {
  id: string;
  group: Group;
  opacity?: number;
  /** Additive blending, so overlapping comets bloom on the dark background. */
  blend?: 'lighter';
}

export type Prim = Base &
  (
    /** A closed curve; with `clip`, the stroke is clipped to the inside of the curve (key names the clip shape). */
    | { kind: 'closedSpline'; start: Vec2; segments: [Vec2, Vec2, Vec2][]; stroke: string; width: number; clip?: string }
    | { kind: 'bezier'; p: Bezier; width: number; from: string; to: string }
    | { kind: 'circle'; c: Vec2; r: number; fill: string }
    | { kind: 'ring'; c: Vec2; r: number; stroke: string; width: number }
    | { kind: 'capsule'; c: Vec2; angle: number; length: number; width: number; stroke: string; strokeWidth: number }
    | { kind: 'diamond'; c: Vec2; r: number; angle: number; fill?: string; stroke?: string; strokeWidth?: number }
    /** A comet trail: a polyline along the curve, stroked with a gradient from its tail colour to its head colour. */
    | { kind: 'trail'; points: Vec2[]; tail: string; head: string; width: number }
    /** A soft radial glow: `color` at the centre fading to transparent at r. */
    | { kind: 'glow'; c: Vec2; r: number; color: string }
    /** A warning badge: a rounded triangle `size` tall, centred on c, with an exclamation mark. */
    | { kind: 'warning'; c: Vec2; size: number; fill: string; mark: string }
    /** Many small dots, batched by colour: each bucket's pts are x, y, r triples. */
    | { kind: 'dots'; buckets: { color: string; pts: Float32Array }[] }
    /** Straight line segments in one stroke: pts are x1, y1, x2, y2 quadruples. */
    | { kind: 'segments'; pts: Float32Array; stroke: string; width: number }
  );

export interface DisplayList {
  width: number;
  height: number;
  background: string;
  prims: Prim[];
  /**
   * The first `staticCount` prims (outlines, receptors, base edges) are the
   * same at every time of a scene; `staticKey` is shared by every frame of the
   * same scene, so a backend may render them once and reuse the result.
   */
  staticCount: number;
  staticKey: object;
  /** Distinguishes static layers of the same scene drawn differently (links faded). */
  staticTag?: string;
  /**
   * Layers drawn between the background and the static layer, each faded by
   * its opacity. Each layer's prims are the same array in every frame, so a
   * backend may render one once and reuse it (target toxicity cross-fades the
   * membrane from its own colour to red this way).
   */
  underlays?: { id: string; prims: Prim[]; opacity: number }[];
}

const TRAIL_SEGMENTS = 12;
/** Seconds a pathway takes to light up from grey (grey idle mode). */
const RISE = 0.3;
const GLOW_LAYERS = 26;
/** Seconds the cell takes to turn red once a toxic DEG fires. */
const TINT_RISE = 0.8;

/**
 * An outline as a plain line, or as a glowing rim: a stack of strokes clipped
 * to the inside of the curve, each thinner and brighter than the last, so light
 * fades from a bright edge into the dark interior. Vector in both backends.
 */
const outlineCache = new WeakMap<Vec2[], Map<string, Prim[]>>();

/**
 * Outline prims are memoised per outline (geometry is cached per scene) and
 * look, so every frame gets the same prim objects and the canvas backend can
 * reuse its rendered rim bitmap across frames.
 */
function outlinePrims(
  group: 'membrane' | 'nucleus',
  points: Vec2[],
  look: OutlineLook & { color: string; strokeWidth: number },
  s: number,
  prefix = '',
): Prim[] {
  const key = JSON.stringify([group, look.outlineStyle, look.glowWidth, look.glowColor, look.edgeColor, look.color, look.strokeWidth, s, prefix]);
  let byKey = outlineCache.get(points);
  if (!byKey) outlineCache.set(points, (byKey = new Map()));
  let prims = byKey.get(key);
  if (!prims) byKey.set(key, (prims = buildOutlinePrims(group, points, look, s, prefix)));
  return prims;
}

/** `prefix` keeps ids (and SVG clip paths) unique per cell of a map. */
function buildOutlinePrims(
  group: 'membrane' | 'nucleus',
  points: Vec2[],
  look: OutlineLook & { color: string; strokeWidth: number },
  s: number,
  prefix: string,
): Prim[] {
  const start = points[0];
  const segments = closedSplineSegments(points);
  const edgeW = Math.max(0.25, look.strokeWidth) * s;
  const id = `${prefix}${group}`;
  if (look.outlineStyle !== 'glow') {
    return [{ kind: 'closedSpline', id: `${id}-outline`, group, start, segments, stroke: look.color, width: edgeW }];
  }
  const glow = parseColor(look.glowColor), edge = parseColor(look.edgeColor);
  // Deep glow → glow → a lavender blend → the bright rim, interpolated in OKLab.
  const deep = rgbaString([glow[0] * 0.45, glow[1] * 0.45, glow[2] * 0.55, 1]);
  const mid = rgbaString([(glow[0] + edge[0]) / 2, (glow[1] * 0.6 + edge[1] * 0.4), (glow[2] + edge[2]) / 2, 1]);
  const ramp = makeRamp([deep, look.glowColor, mid, look.edgeColor]);
  const depth = Math.max(0, look.glowWidth) * s;
  const out: Prim[] = [];
  // Many thin, equally faint layers: where they overlap (near the rim) the
  // light builds up smoothly, with no visible steps.
  for (let i = 0; i < GLOW_LAYERS; i++) {
    const t = i / (GLOW_LAYERS - 1); // 0 = widest, faintest; 1 = at the rim
    const d = depth * (1 - t) ** 1.6 + edgeW * (1 + 2 * t);
    out.push({
      kind: 'closedSpline', id: `${id}-glow-${i + 1}`, group, start, segments, clip: id,
      stroke: rgbaString(ramp(t ** 1.1)), width: 2 * d, opacity: 0.085,
    });
  }
  // A bright band right at the rim: lavender into the edge colour.
  const rim: [number, number, number][] = [[3.2, 0.72, 0.3], [2.1, 0.88, 0.45], [1.3, 1, 0.75]];
  rim.forEach(([w, c, a], i) => {
    out.push({
      kind: 'closedSpline', id: `${id}-rim-${i + 1}`, group, start, segments, clip: id,
      stroke: rgbaString(ramp(c)), width: 2 * w * edgeW, opacity: a,
    });
  });
  out.push({ kind: 'closedSpline', id: `${id}-outline`, group, start, segments, stroke: look.edgeColor, width: edgeW });
  return out;
}
const mixWhite = ([r, g, b]: RGBA, k: number): RGBA => [r + (255 - r) * k, g + (255 - g) * k, b + (255 - b) * k, 1];

/** The membrane in the toxicity colour: its glow turns that colour, its rim a pale tint of it. */
function toxicLook(scene: Scene): Scene['cell'] {
  const c = parseColor(scene.module.toxicColor);
  const a = parseColor(scene.cell.color)[3];
  return {
    ...scene.cell,
    glowColor: rgbaString([c[0], c[1], c[2], 1]),
    edgeColor: rgbaString(mixWhite(c, 0.78)),
    color: rgbaString([c[0], c[1], c[2], Math.max(a, 0.6)]),
  };
}

/** The resting particle field, bucketed by tone (one array per geometry, stable across frames). */
const particleCache = new WeakMap<SceneGeom, Map<string, { color: string; pts: Float32Array }[]>>();
function particleBuckets(g: SceneGeom, ramp: (t: number) => RGBA, tones: number, k: number) {
  const key = JSON.stringify([ramp(0), ramp(0.5), ramp(1), tones, k]);
  let byKey = particleCache.get(g);
  if (!byKey) particleCache.set(g, (byKey = new Map()));
  let out = byKey.get(key);
  if (!out) {
    const lists = Array.from({ length: tones }, () => [] as number[]);
    for (const p of g.particles ?? []) lists[Math.min(tones - 1, Math.floor(p.tone * tones))].push(p.x, p.y, p.r * g.scale * k);
    out = lists
      .map((pts, i) => ({ color: rgbaString(ramp((i + 0.5) / tones)), pts: new Float32Array(pts) }))
      .filter((b) => b.pts.length);
    byKey.set(key, out);
  }
  return out;
}

/** Every cell's membrane in one look, as one array per geometry and look (stable across frames). */
const membraneCache = new WeakMap<SceneGeom, Map<string, Prim[]>>();
function membranes(g: SceneGeom, look: Scene['cell'], prefix: string): Prim[] {
  const key = JSON.stringify([look, prefix]);
  let byKey = membraneCache.get(g);
  if (!byKey) membraneCache.set(g, (byKey = new Map()));
  let prims = byKey.get(key);
  if (!prims) {
    prims = g.cells.flatMap((c) => outlinePrims('membrane', c.cell.points, look, g.scale, `${prefix}${c.id ? `${c.id}-` : ''}`));
    byKey.set(key, prims);
  }
  return prims;
}
const withAlpha = ([r, g, b]: RGBA, a: number) => rgbaString([r, g, b, a]);

/**
 * Everything drawn at time `t` (seconds). Pure: the same scene and t always
 * give the same list. Draw order: outlines → receptors → edges and lit edges →
 * comets and pulse flashes → halos → nodes.
 */
/**
 * `linkAlpha` fades the links between cells and their signals (the journey
 * shows the centre cell alone before its neighbours appear).
 */
export function buildDisplayList(scene: Scene, t = 0, opts: { signal?: boolean; linkAlpha?: number } = {}): DisplayList {
  const g = buildGeometry(scene);
  const s = g.scale;
  const st = scene.style;
  const an = scene.animation;
  const ramp = makeRamp(st.gradientStops);
  const color = (d: number) => rgbaString(ramp(d));
  const prims: Prim[] = [];
  const signal = opts.signal ?? true;
  const schedule = buildSchedule(scene);
  const tau = cycleTime(scene, t);
  const period = schedule.period;
  // Lit edges fade back to base over the last FADE_OUT seconds of a looping
  // cycle. In continuous mode each edge fades on its own instead: it stays lit
  // for the hold time after its comet passes, then fades.
  const fade = period ? 1 : an.loop ? Math.max(0, Math.min(1, (schedule.total - tau) / FADE_OUT)) : 1;
  const litHold = Math.max(0, an.holdAtEnd);

  // Target toxicity: the cell turns red once a toxic DEG fires, and back
  // again as the loop closes (or, in continuous mode, before it fires again).
  const toxicity = scene.module.kind === 'toxicity';
  let tint = 0;
  if (toxicity && signal) {
    let t0 = Infinity;
    for (const n of g.nodes) if (n.toxic) t0 = Math.min(t0, schedule.fire.get(n.id) ?? Infinity);
    if (Number.isFinite(t0)) {
      const x = since(tau, t0, period);
      tint = period
        ? Math.min(x / TINT_RISE, (period - x) / FADE_OUT)
        : Math.min(1, x / TINT_RISE) * fade;
      tint = Math.max(0, Math.min(1, tint));
    }
  }
  // In toxicity mode the membranes are cross-faded underlays instead of static prims.
  const underlays: DisplayList['underlays'] = [];
  if (toxicity && scene.cell.visible) {
    underlays.push({ id: 'membrane-own', prims: membranes(g, scene.cell, ''), opacity: 1 - tint });
    underlays.push({ id: 'membrane-toxic', prims: membranes(g, toxicLook(scene), 'toxic-'), opacity: tint });
  }

  // Every cell's outlines (one cell, or each cell of a map), before anything else,
  // so the canvas backend can cache them all as one static bitmap.
  const os = g.outlineScale ?? s;
  for (const c of g.cells) {
    const prefix = c.id ? `${c.id}-` : '';
    if (scene.cell.visible && !toxicity) prims.push(...outlinePrims('membrane', c.cell.points, scene.cell, os, prefix));
    if (scene.nucleus.visible && !c.noNucleus) prims.push(...outlinePrims('nucleus', c.nucleus.points, scene.nucleus, os, prefix));
  }
  // Organs (body view), in the nucleus style.
  if (scene.nucleus.visible) {
    g.organs?.forEach((o, i) => prims.push(...outlinePrims('nucleus', o.points, scene.nucleus, os, `organ${i + 1}-`)));
  }
  // Body view: wireframe, anatomy lines and the resting particle field.
  const TONES = 10;
  const toneOf = (t: number) => Math.min(TONES - 1, Math.floor(t * TONES));
  if (g.mesh?.length) {
    prims.push({ kind: 'segments', id: 'body-mesh', group: 'mesh', pts: g.mesh, stroke: scene.cell.edgeColor, width: 0.7 * os, opacity: 0.2 });
  }
  if (scene.cell.visible) {
    g.anatomy?.forEach((b, i) => prims.push({
      kind: 'bezier', id: `body-anatomy-${i + 1}`, group: 'membrane', p: b, width: Math.max(0.25, scene.cell.strokeWidth) * os,
      from: scene.cell.edgeColor, to: scene.cell.edgeColor, opacity: 0.7,
    }));
  }
  if (g.particles?.length) prims.push({ kind: 'dots', id: 'body-particles', group: 'particles', buckets: particleBuckets(g, ramp, TONES, 1), opacity: 0.4 });

  // Receptors: capsules across the membrane, stroked in the membrane colour.
  // They stay visible when the membrane line is hidden.
  const capsule = st.receptorStyle !== 'diamond';
  const len = st.receptorSize.length * s, wid = st.receptorSize.width * s;
  for (const r of g.receptors) {
    const decorative = r.pathwayId === null;
    if (decorative && !scene.cell.showDecorativeReceptors) continue;
    if (capsule) {
      prims.push({
        kind: 'capsule', id: r.id, group: 'receptors', c: r.center, angle: r.angle,
        length: len, width: wid, stroke: scene.cell.color, strokeWidth: scene.cell.strokeWidth * s,
        opacity: decorative ? 0.75 : 1,
      });
    } else if (decorative) {
      prims.push({
        kind: 'diamond', id: r.id, group: 'receptors', c: r.inner, r: st.haloRadius * 0.7 * s, angle: r.angle,
        stroke: st.inactiveNodeColor, strokeWidth: 1 * s,
      });
    }
  }

  // Drug targets: a ring round each targeted receptor.
  for (const r of g.receptors) {
    if (!r.target) continue;
    prims.push({
      kind: 'ring', id: `${r.id}-target`, group: 'receptors', c: r.center, r: Math.max(len, wid) * 0.72,
      stroke: scene.module.targetColor, width: Math.max(0.75, 1.5 * s), opacity: 0.9,
    });
  }

  // Grey idle mode: the network rests in grey, and a pathway lights up in
  // colour while a signal runs through it, then fades back.
  const grey = st.greyIdle;
  const idle = Math.max(0, Math.min(1, st.idleOpacity));
  const greyRgb = parseColor(st.inactiveNodeColor);
  const greyCss = rgbaString([greyRgb[0], greyRgb[1], greyRgb[2], 1]);
  // MOA focus: the network off the traced route rests faint and grey.
  const dimA = Math.max(0, Math.min(1, scene.module.dimOpacity));

  for (const e of g.edges) {
    prims.push({
      kind: 'bezier', id: e.id, group: e.crosstalk ? 'crosstalk' : 'edges', p: e.bezier, width: st.edgeWidth * s,
      ...(e.dim
        ? { from: greyCss, to: greyCss, opacity: e.opacity * dimA }
        : grey
          ? { from: greyCss, to: greyCss, opacity: e.opacity * idle }
          : { from: color(e.depthFrom), to: color(e.depthTo), opacity: e.opacity }),
    });
  }

  const staticCount = prims.length;

  // How lit each pathway is now (grey idle mode): on while a wave runs
  // through it and for the hold after, then fading back to grey.
  const act = new Map<string, number>();
  if (grey && signal) {
    const env = (x: number, len: number) =>
      x < 0 ? 0 : x < len + litHold ? Math.min(1, x / RISE) : Math.max(0, 1 - (x - len - litHold) / FADE_OUT);
    for (const [pid, runs] of schedule.runs) {
      let a = 0;
      for (const r of runs) {
        const len = r.end - r.start;
        if (period) {
          // A run may outlast the period: count each repeat still fading.
          for (let x = since(tau, r.start, period); x < len + litHold + FADE_OUT; x += period) a = Math.max(a, env(x, len));
        } else {
          a = Math.max(a, env(tau - r.start, len) * fade);
        }
      }
      if (a > 0.005) act.set(pid, a); // below that it is invisible: skip drawing it
    }
    for (const e of g.edges) {
      const a = act.get(e.pathwayId) ?? 0;
      if (a <= 0 || e.dim) continue;
      prims.push({
        kind: 'bezier', id: `${e.id}-on`, group: e.crosstalk ? 'crosstalk' : 'edges', p: e.bezier,
        width: st.edgeWidth * s, from: color(e.depthFrom), to: color(e.depthTo), opacity: e.opacity * a,
      });
    }
  }
  // Grey idle mode: node brightness follows its pathway (1 when not greying).
  const on = (n: { pathwayId: string }) => (grey ? (act.get(n.pathwayId) ?? 0) : 1);
  const nodeFill = (a: number) => (a >= 1 ? '#ffffff' : rgbaString(mixWhite(greyRgb, a)));

  if (signal) {
    const trail = Math.max(0, an.trailLength);
    const cometW = Math.max(0.5, an.cometSize) * s;
    // Progress along each edge: raw (linear in time, runs on past 1 while the
    // trail catches up) and eased (position of the head along the curve).
    const along = schedule.edges.map((et) => {
      const x = since(tau, et.start, period);
      // Continuous or grey idle: how lit the edge still is, x seconds after its
      // comet left (otherwise lit edges stay lit until the loop's closing fade).
      const lit = period || grey ? Math.max(0, Math.min(1, (et.duration + litHold + FADE_OUT - x) / FADE_OUT)) : 1;
      return { et, q: x / et.duration, lit, id: et.wave ? `${et.edge.id}-w${et.wave}` : et.edge.id };
    });

    // Lit edges: the part a comet has passed stays brighter until the loop resets.
    for (const { et, q, lit, id } of along) {
      if (q <= 0 || fade * lit <= 0) continue;
      const e = et.edge;
      const frac = ease(Math.min(1, q), an.easing);
      const tt = tAtDistance(e.lut, frac * e.length);
      const part = bezierHead(e.bezier, tt);
      prims.push({
        kind: 'bezier', id: `${id}-lit`, group: e.crosstalk ? 'crosstalk' : 'edges', p: part,
        width: st.edgeWidth * 1.25 * s, from: color(e.depthFrom),
        to: color(e.depthFrom + (e.depthTo - e.depthFrom) * frac),
        opacity: Math.max(0, Math.min(1, an.litEdgeOpacity)) * fade * lit,
      });
    }

    // Comets: a trail fading to transparent behind a bright head with a soft glow.
    for (const { et, q, id } of along) {
      if (q <= 0 || q - trail >= 1) continue;
      const e = et.edge;
      const head = ease(Math.min(1, q), an.easing);
      const tail = ease(Math.max(0, Math.min(1, q - trail)), an.easing);
      if (head - tail > 1e-4) {
        // Sample the trail along the curve, then stroke it in a few gradient
        // passes (glow, body, bright front half) so it tapers and fades to
        // transparent at the tail. A handful of strokes per comet keeps 60fps.
        const pts: Vec2[] = [];
        for (let i = 0; i <= TRAIL_SEGMENTS; i++) {
          const f = tail + ((head - tail) * i) / TRAIL_SEGMENTS;
          pts.push(bezierPoint(e.bezier, tAtDistance(e.lut, f * e.length)));
        }
        const at = (f: number) => ramp(e.depthFrom + (e.depthTo - e.depthFrom) * f);
        const cHead = at(head), cTail = at(tail), cMid = at((head + tail) / 2);
        const front = pts.slice(TRAIL_SEGMENTS / 2);
        if (an.glow > 0) {
          prims.push({
            kind: 'trail', id: `${id}-trail-glow`, group: 'signal', blend: 'lighter', points: pts,
            tail: withAlpha(cTail, 0), head: withAlpha(cHead, 0.22 * an.glow), width: cometW * (2.5 + 4 * an.glow),
          });
        }
        prims.push({
          kind: 'trail', id: `${id}-trail`, group: 'signal', blend: 'lighter', points: pts,
          tail: withAlpha(cTail, 0), head: withAlpha(cHead, 0.85), width: cometW * 0.5,
        });
        prims.push({
          kind: 'trail', id: `${id}-trail-core`, group: 'signal', blend: 'lighter', points: front,
          tail: withAlpha(cMid, 0), head: withAlpha(cHead, 1), width: cometW,
        });
      }
      if (q < 1) {
        const c = bezierPoint(e.bezier, tAtDistance(e.lut, head * e.length));
        const rgb = ramp(e.depthFrom + (e.depthTo - e.depthFrom) * head);
        if (an.glow > 0) {
          prims.push({
            kind: 'glow', id: `${id}-head-glow`, group: 'signal', blend: 'lighter', c,
            r: cometW * (3 + 7 * an.glow), color: withAlpha(rgb, 0.55 * an.glow),
          });
        }
        prims.push({ kind: 'circle', id: `${id}-head`, group: 'signal', blend: 'lighter', c, r: cometW * 0.9, fill: rgbaString(mixWhite(rgb, 0.7)) });
      }
    }
  }

  // Body view: particles light up as the signal reaches the node nearest
  // them, in a wave travelling out from it, then dim back to rest.
  if (signal && g.particles?.length) {
    const LEVELS = 4;
    const lit: { color: number; level: number; x: number; y: number; r: number }[] = [];
    for (const p of g.particles) {
      const f = schedule.fire.get(p.node);
      if (f === undefined) continue;
      const x = since(tau, f + p.delay, period);
      if (x < 0) continue;
      const e = (x < 0.15 ? x / 0.15 : Math.exp(-(x - 0.15) / 1.1)) * (period ? 1 : fade);
      if (e < 0.06) continue;
      lit.push({ color: toneOf(p.tone), level: Math.min(LEVELS - 1, Math.floor(e * LEVELS)), x: p.x, y: p.y, r: p.r });
    }
    for (let lv = 0; lv < LEVELS; lv++) {
      const byTone = new Map<number, number[]>();
      for (const q of lit) {
        if (q.level !== lv) continue;
        const list = byTone.get(q.color) ?? [];
        list.push(q.x, q.y, q.r * s * 1.5);
        byTone.set(q.color, list);
      }
      if (!byTone.size) continue;
      prims.push({
        kind: 'dots', id: `body-particles-lit-${lv + 1}`, group: 'signal', blend: 'lighter', opacity: (lv + 1) / LEVELS,
        buckets: [...byTone].map(([t, pts]) => ({ color: rgbaString(mixWhite(ramp((t + 0.5) / TONES), 0.35)), pts: new Float32Array(pts) })),
      });
    }
  }

  // Node pulses: a node pulses when it fires (full size) and again, smaller,
  // for each later arrival from a convergent or crosstalk edge; on a cell map,
  // each relay that runs the pathway again fires it again.
  const pulse = new Map<string, number>();
  const toxicRgb = parseColor(scene.module.toxicColor);
  const toxicFill = rgbaString([toxicRgb[0], toxicRgb[1], toxicRgb[2], 1]);
  if (signal) {
    for (const n of g.nodes) {
      if (!n.active) continue;
      let e = 0;
      for (const p of schedule.pulses.get(n.id) ?? []) e = Math.max(e, p.strength * pulseEnvelope(since(tau, p.t, period)));
      if (e > 0) pulse.set(n.id, e);
    }
    for (const [id, e] of pulse) {
      const n = g.nodeById.get(id)!;
      prims.push({
        kind: 'glow', id: `${id}-flash`, group: 'signal', blend: 'lighter', c: n,
        r: st.haloRadius * s * (n.toxic ? 2 : 1) * (1.4 + 1.6 * e), color: withAlpha(n.toxic ? toxicRgb : ramp(n.depth), 0.7 * e),
      });
    }
  }
  const grow = (id: string) => 1 + (Math.max(1, an.nodePulseScale) - 1) * (pulse.get(id) ?? 0);

  // Halos first so edges and dots from neighbouring nodes are never hidden by them.
  const active = g.nodes.filter((n) => n.active);
  const halo = rgbaString(parseColor(st.haloColor));
  for (const n of active) {
    const isReceptor = n.layer === 0;
    if (isReceptor && st.receptorStyle === 'capsule') continue;
    if (n.dim) continue;
    const a = on(n);
    if (a <= 0) continue;
    prims.push({
      kind: 'circle', id: `${n.id}-halo`, group: 'nodes-active', c: n, r: st.haloRadius * s * grow(n.id), fill: halo,
      ...(a < 1 ? { opacity: a } : {}),
    });
  }
  for (const n of active) {
    if (n.layer === 0) {
      if (st.receptorStyle === 'capsule') continue;
      const rec = g.receptors.find((r) => r.nodeId === n.id) ?? g.receptors.find((r) => r.pathwayId === n.pathwayId)!;
      const a = on(n);
      prims.push({
        kind: 'diamond', id: `${n.id}-diamond`, group: 'nodes-active', c: n,
        r: st.activeNodeRadius * 1.6 * s * grow(n.id), angle: rec.angle, fill: nodeFill(a),
        ...(a < 1 ? { opacity: idle + (1 - idle) * a } : {}),
      });
    } else if (n.dim) {
      prims.push({ kind: 'circle', id: n.id, group: 'nodes-active', c: n, r: st.activeNodeRadius * s, fill: greyCss, opacity: dimA });
    } else {
      const a = on(n);
      prims.push({
        kind: 'circle', id: n.id, group: 'nodes-active', c: n, r: st.activeNodeRadius * s * grow(n.id) * (n.toxic ? 1.25 : 1),
        fill: n.toxic ? toxicFill : nodeFill(a),
        ...(a < 1 ? { opacity: idle + (1 - idle) * a } : {}),
      });
    }
  }
  for (const n of g.nodes) {
    if (n.active) continue;
    const r = st.inactiveNodeRadius * s;
    const w = Math.max(0.75, 1 * s);
    prims.push({ kind: 'ring', id: `${n.id}-outer`, group: 'nodes-inactive', c: n, r, stroke: st.inactiveNodeColor, width: w });
    prims.push({ kind: 'ring', id: `${n.id}-inner`, group: 'nodes-inactive', c: n, r: r * 0.5, stroke: st.inactiveNodeColor, width: w });
  }

  // Target toxicity: a warning badge on the membrane, popping in as the cell turns.
  if (toxicity && scene.module.warning && tint > 0) {
    const cell = g.cells[0].cell;
    const th = ((scene.module.warningAngle - 90) * Math.PI) / 180;
    const c = { x: cell.center.x + Math.cos(th) * cell.radiusAt(th), y: cell.center.y + Math.sin(th) * cell.radiusAt(th) };
    const pop = 0.7 + 0.3 * Math.min(1, tint * 1.4);
    const size = 46 * s * pop;
    prims.push({ kind: 'glow', id: 'warning-glow', group: 'signal', blend: 'lighter', c, r: size * 1.6, color: withAlpha(toxicRgb, 0.55), opacity: tint });
    prims.push({ kind: 'warning', id: 'warning', group: 'signal', c, size, fill: toxicFill, mark: '#FFFFFF', opacity: tint });
  }

  let out = prims;
  let staticOut = staticCount;
  const linkAlpha = Math.max(0, Math.min(1, opts.linkAlpha ?? 1));
  if (linkAlpha < 1) {
    // Link edges and everything drawn along them have ids starting `link-`.
    out = [];
    prims.forEach((p, i) => {
      if (!p.id.startsWith('link-')) out.push(p);
      else if (linkAlpha > 0) out.push({ ...p, opacity: (p.opacity ?? 1) * linkAlpha });
      else if (i < staticCount) staticOut--;
      if (i === staticCount - 1) staticOut = out.length;
    });
  }

  return {
    width: scene.canvas.width,
    height: scene.canvas.height,
    background: scene.canvas.background,
    prims: out,
    staticCount: staticOut,
    staticKey: g,
    ...(linkAlpha < 1 ? { staticTag: `links-${linkAlpha.toFixed(3)}` } : {}),
    ...(underlays.length ? { underlays } : {}),
  };
}
