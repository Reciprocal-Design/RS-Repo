import { bezierHead, bezierPoint, tAtDistance } from '../core/bezier';
import { makeRamp, parseColor, rgbaString, type RGBA } from '../core/color';
import { buildGeometry } from '../core/geometry';
import { closedSplineSegments } from '../core/outline';
import { buildSchedule, cycleTime, ease, FADE_OUT, pulseEnvelope } from '../core/timeline';
import type { Bezier, OutlineLook, Scene, Vec2 } from '../core/types';

// A flat list of draw primitives, consumed by both the Canvas and SVG backends.

export type Group =
  | 'membrane'
  | 'nucleus'
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
  );

export interface DisplayList {
  width: number;
  height: number;
  background: string;
  prims: Prim[];
}

const TRAIL_SEGMENTS = 12;
const GLOW_LAYERS = 26;

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
): Prim[] {
  const key = JSON.stringify([group, look.outlineStyle, look.glowWidth, look.glowColor, look.edgeColor, look.color, look.strokeWidth, s]);
  let byKey = outlineCache.get(points);
  if (!byKey) outlineCache.set(points, (byKey = new Map()));
  let prims = byKey.get(key);
  if (!prims) byKey.set(key, (prims = buildOutlinePrims(group, points, look, s)));
  return prims;
}

function buildOutlinePrims(
  group: 'membrane' | 'nucleus',
  points: Vec2[],
  look: OutlineLook & { color: string; strokeWidth: number },
  s: number,
): Prim[] {
  const start = points[0];
  const segments = closedSplineSegments(points);
  const edgeW = Math.max(0.25, look.strokeWidth) * s;
  if (look.outlineStyle !== 'glow') {
    return [{ kind: 'closedSpline', id: `${group}-outline`, group, start, segments, stroke: look.color, width: edgeW }];
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
      kind: 'closedSpline', id: `${group}-glow-${i + 1}`, group, start, segments, clip: group,
      stroke: rgbaString(ramp(t ** 1.1)), width: 2 * d, opacity: 0.085,
    });
  }
  // A bright band right at the rim: lavender into the edge colour.
  const rim: [number, number, number][] = [[3.2, 0.72, 0.3], [2.1, 0.88, 0.45], [1.3, 1, 0.75]];
  rim.forEach(([w, c, a], i) => {
    out.push({
      kind: 'closedSpline', id: `${group}-rim-${i + 1}`, group, start, segments, clip: group,
      stroke: rgbaString(ramp(c)), width: 2 * w * edgeW, opacity: a,
    });
  });
  out.push({ kind: 'closedSpline', id: `${group}-outline`, group, start, segments, stroke: look.edgeColor, width: edgeW });
  return out;
}
const mixWhite = ([r, g, b]: RGBA, k: number): RGBA => [r + (255 - r) * k, g + (255 - g) * k, b + (255 - b) * k, 1];
const withAlpha = ([r, g, b]: RGBA, a: number) => rgbaString([r, g, b, a]);

/**
 * Everything drawn at time `t` (seconds). Pure: the same scene and t always
 * give the same list. Draw order: outlines → receptors → edges and lit edges →
 * comets and pulse flashes → halos → nodes.
 */
export function buildDisplayList(scene: Scene, t = 0, opts: { signal?: boolean } = {}): DisplayList {
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
  // Lit edges fade back to base over the last FADE_OUT seconds of a looping cycle.
  const fade = an.loop ? Math.max(0, Math.min(1, (schedule.total - tau) / FADE_OUT)) : 1;

  if (scene.cell.visible) prims.push(...outlinePrims('membrane', g.cell.points, scene.cell, s));
  if (scene.nucleus.visible) prims.push(...outlinePrims('nucleus', g.nucleus.points, scene.nucleus, s));

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

  for (const e of g.edges) {
    prims.push({
      kind: 'bezier', id: e.id, group: e.crosstalk ? 'crosstalk' : 'edges', p: e.bezier,
      width: st.edgeWidth * s, from: color(e.depthFrom), to: color(e.depthTo), opacity: e.opacity,
    });
  }

  if (signal) {
    const trail = Math.max(0, an.trailLength);
    const cometW = Math.max(0.5, an.cometSize) * s;
    // Progress along each edge: raw (linear in time, runs on past 1 while the
    // trail catches up) and eased (position of the head along the curve).
    const along = schedule.edges.map((et) => ({ et, q: (tau - et.start) / et.duration }));

    // Lit edges: the part a comet has passed stays brighter until the loop resets.
    for (const { et, q } of along) {
      if (q <= 0 || fade <= 0) continue;
      const e = et.edge;
      const frac = ease(Math.min(1, q), an.easing);
      const tt = tAtDistance(e.lut, frac * e.length);
      const part = bezierHead(e.bezier, tt);
      prims.push({
        kind: 'bezier', id: `${e.id}-lit`, group: e.crosstalk ? 'crosstalk' : 'edges', p: part,
        width: st.edgeWidth * 1.25 * s, from: color(e.depthFrom),
        to: color(e.depthFrom + (e.depthTo - e.depthFrom) * frac),
        opacity: Math.max(0, Math.min(1, an.litEdgeOpacity)) * fade,
      });
    }

    // Comets: a trail fading to transparent behind a bright head with a soft glow.
    for (const { et, q } of along) {
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
            kind: 'trail', id: `${e.id}-trail-glow`, group: 'signal', blend: 'lighter', points: pts,
            tail: withAlpha(cTail, 0), head: withAlpha(cHead, 0.22 * an.glow), width: cometW * (2.5 + 4 * an.glow),
          });
        }
        prims.push({
          kind: 'trail', id: `${e.id}-trail`, group: 'signal', blend: 'lighter', points: pts,
          tail: withAlpha(cTail, 0), head: withAlpha(cHead, 0.85), width: cometW * 0.5,
        });
        prims.push({
          kind: 'trail', id: `${e.id}-trail-core`, group: 'signal', blend: 'lighter', points: front,
          tail: withAlpha(cMid, 0), head: withAlpha(cHead, 1), width: cometW,
        });
      }
      if (q < 1) {
        const c = bezierPoint(e.bezier, tAtDistance(e.lut, head * e.length));
        const rgb = ramp(e.depthFrom + (e.depthTo - e.depthFrom) * head);
        if (an.glow > 0) {
          prims.push({
            kind: 'glow', id: `${e.id}-head-glow`, group: 'signal', blend: 'lighter', c,
            r: cometW * (3 + 7 * an.glow), color: withAlpha(rgb, 0.55 * an.glow),
          });
        }
        prims.push({ kind: 'circle', id: `${e.id}-head`, group: 'signal', blend: 'lighter', c, r: cometW * 0.9, fill: rgbaString(mixWhite(rgb, 0.7)) });
      }
    }
  }

  // Node pulses: a node pulses when it fires (full size) and again, smaller,
  // for each later arrival from a convergent or crosstalk edge.
  const pulse = new Map<string, number>();
  if (signal) {
    for (const n of g.nodes) {
      if (!n.active) continue;
      const fired = schedule.fire.get(n.id);
      if (fired === undefined || tau < fired) continue;
      const times = n.layer === 0 ? [fired] : (schedule.arrivals.get(n.id) ?? []);
      let e = 0;
      times.forEach((at, i) => (e = Math.max(e, (i === 0 ? 1 : 0.45) * pulseEnvelope(tau - at))));
      if (e > 0) pulse.set(n.id, e);
    }
    for (const [id, e] of pulse) {
      const n = g.nodeById.get(id)!;
      prims.push({
        kind: 'glow', id: `${id}-flash`, group: 'signal', blend: 'lighter', c: n,
        r: st.haloRadius * s * (1.4 + 1.6 * e), color: withAlpha(ramp(n.depth), 0.7 * e),
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
    prims.push({ kind: 'circle', id: `${n.id}-halo`, group: 'nodes-active', c: n, r: st.haloRadius * s * grow(n.id), fill: halo });
  }
  for (const n of active) {
    if (n.layer === 0) {
      if (st.receptorStyle === 'capsule') continue;
      const rec = g.receptors.find((r) => r.pathwayId === n.pathwayId)!;
      prims.push({
        kind: 'diamond', id: `${n.id}-diamond`, group: 'nodes-active', c: n,
        r: st.activeNodeRadius * 1.6 * s * grow(n.id), angle: rec.angle, fill: '#ffffff',
      });
    } else {
      prims.push({ kind: 'circle', id: n.id, group: 'nodes-active', c: n, r: st.activeNodeRadius * s * grow(n.id), fill: '#ffffff' });
    }
  }
  for (const n of g.nodes) {
    if (n.active) continue;
    const r = st.inactiveNodeRadius * s;
    const w = Math.max(0.75, 1 * s);
    prims.push({ kind: 'ring', id: `${n.id}-outer`, group: 'nodes-inactive', c: n, r, stroke: st.inactiveNodeColor, width: w });
    prims.push({ kind: 'ring', id: `${n.id}-inner`, group: 'nodes-inactive', c: n, r: r * 0.5, stroke: st.inactiveNodeColor, width: w });
  }

  return { width: scene.canvas.width, height: scene.canvas.height, background: scene.canvas.background, prims };
}
