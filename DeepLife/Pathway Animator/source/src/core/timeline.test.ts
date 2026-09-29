import { describe, expect, it } from 'vitest';
import { buildDisplayList } from '../render/displayList';
import { defaultScene, makePathway } from './defaults';
import { buildGeometry } from './geometry';
import { buildSchedule, cycleTime, FADE_OUT } from './timeline';
import type { Scene } from './types';

function multi(n: number, seed = 5): Scene {
  const s = defaultScene(seed);
  s.pathwayCount = n;
  s.pathways = Array.from({ length: n }, (_, i) => ({ ...makePathway(seed, i, s.pathways[0].layers), startDelay: i * 0.7 }));
  s.crosstalk = { enabled: true, amount: 0.8 };
  return s;
}

describe('signal schedule', () => {
  for (const n of [1, 3, 5]) {
    it(`nodes fire on the first arrival, from any edge (${n} pathways)`, () => {
      const s = multi(n);
      const g = buildGeometry(s);
      const sch = buildSchedule(s);
      for (const p of s.pathways.slice(0, n)) {
        const receptor = g.nodes.find((x) => x.pathwayId === p.id && x.layer === 0)!;
        expect(sch.fire.get(receptor.id)).toBe(p.startDelay); // receptors have no incoming edges
      }
      for (const node of g.nodes) {
        if (!node.active || node.layer === 0) continue;
        const incoming = sch.edges.filter((e) => e.edge.to === node.id);
        expect(incoming.length).toBeGreaterThan(0);
        const first = Math.min(...incoming.map((e) => e.start + e.duration));
        expect(sch.fire.get(node.id)).toBeCloseTo(first, 9);
        expect(sch.arrivals.get(node.id)![0]).toBeCloseTo(first, 9);
      }
      for (const e of sch.edges) expect(e.start).toBe(sch.fire.get(e.edge.from));
      // Inactive nodes never fire.
      for (const node of g.nodes) if (!node.active) expect(sch.fire.has(node.id)).toBe(false);
    });
  }

  it('nucleus hops are slower by the nucleus factor', () => {
    const s = defaultScene(3);
    s.animation.layerDuration = 1;
    s.animation.nucleusSpeedFactor = 2;
    const g = buildGeometry(s);
    for (const e of buildSchedule(s).edges) {
      expect(e.duration).toBe(g.nodeById.get(e.edge.to)!.region === 'nucleus' ? 2 : 1);
    }
  });

  it('total = signal + hold (+ fade when looping), and time wraps or clamps', () => {
    const s = defaultScene(3);
    const sch = buildSchedule(s);
    expect(sch.total).toBeCloseTo(sch.signalEnd + s.animation.holdAtEnd + FADE_OUT);
    expect(cycleTime(s, sch.total + 1.25)).toBeCloseTo(1.25);
    const once = { ...s, animation: { ...s.animation, loop: false } };
    expect(buildSchedule(once).total).toBeCloseTo(sch.signalEnd + s.animation.holdAtEnd);
    expect(cycleTime(once, 999)).toBeCloseTo(buildSchedule(once).total);
  });
});

describe('continuous motion', () => {
  const heads = (s: Scene, t: number) =>
    buildDisplayList(s, t).prims.filter((p) => p.kind === 'circle' && p.group === 'signal') as { c: { x: number; y: number } }[];

  for (const n of [1, 3]) {
    it(`always has a signal running, and the loop is seamless (${n} pathway${n > 1 ? 's' : ''})`, () => {
      const s = multi(n);
      s.animation = { ...s.animation, continuous: true, loop: false };
      const T = buildSchedule(s).total;
      expect(T).toBeGreaterThan(1);
      // A comet is always travelling (away from exact hand-over instants).
      for (let t = 0.013; t < T; t += 0.05) expect(heads(s, t).length).toBeGreaterThan(0);
      // Across the wrap nothing jumps: each comet just after it is where a comet
      // was just before, or at a node (one leaving as another arrived).
      const g = buildGeometry(s);
      const a = heads(s, T - 1e-3).map((p) => p.c), b = heads(s, T + 1e-3).map((p) => p.c);
      const near = (p: { x: number; y: number }, qs: { x: number; y: number }[]) =>
        qs.some((q) => Math.hypot(q.x - p.x, q.y - p.y) < 2);
      for (const p of b) expect(near(p, a) || near(p, g.nodes)).toBe(true);
      for (const p of a) expect(near(p, b) || near(p, g.nodes)).toBe(true);
      expect(cycleTime(s, T + 0.5)).toBeCloseTo(0.5);
    });
  }

  it('edges fade on their own instead of all staying lit; density shortens the loop', () => {
    const s = multi(3);
    s.animation = { ...s.animation, continuous: true, density: 0 };
    const sch = buildSchedule(s);
    let fewest = Infinity;
    for (let t = 0; t < sch.total; t += 0.1) {
      fewest = Math.min(fewest, buildDisplayList(s, t).prims.filter((p) => p.id.endsWith('-lit')).length);
    }
    expect(fewest).toBeLessThan(sch.edges.length);
    const dense = { ...s, animation: { ...s.animation, density: 1 } };
    expect(buildSchedule(dense).total).toBeLessThanOrEqual(sch.total);
    // Off: the usual cycle with its hold and fade.
    const off = { ...s, animation: { ...s.animation, continuous: false } };
    expect(buildSchedule(off).period).toBe(0);
  });
});

describe('frames', () => {
  it('same scene JSON + same t → identical frame', () => {
    const a = multi(4);
    const b = JSON.parse(JSON.stringify(a));
    for (const t of [0, 0.4, 1.7, 3.3, 6.1]) {
      expect(JSON.stringify(buildDisplayList(a, t))).toBe(JSON.stringify(buildDisplayList(b, t)));
    }
  });

  it('shows the full network at t = 0 and comets while the signal travels', () => {
    const s = defaultScene(9);
    const at0 = buildDisplayList(s, 0).prims;
    expect(at0.some((p) => p.group === 'signal')).toBe(false);
    expect(at0.filter((p) => p.kind === 'bezier').length).toBe(buildGeometry(s).edges.length);
    const mid = buildDisplayList(s, s.animation.layerDuration * 0.5).prims;
    expect(mid.some((p) => p.kind === 'circle' && p.group === 'signal')).toBe(true);
    // After the signal ends, everything passed is lit and no comets remain.
    const sch = buildSchedule(s);
    const held = buildDisplayList(s, sch.signalEnd + 0.01).prims;
    expect(held.some((p) => p.group === 'signal' && p.kind !== 'glow')).toBe(false);
    expect(held.filter((p) => p.id.endsWith('-lit')).length).toBe(sch.edges.length);
    // The fade brings lit edges back to base by the end of the loop.
    const end = buildDisplayList(s, sch.total - 1e-6).prims;
    expect(end.filter((p) => p.id.endsWith('-lit')).every((p) => (p.opacity ?? 1) < 0.01)).toBe(true);
  });

  it('can leave the signal layer out (structure only)', () => {
    const s = defaultScene(9);
    const prims = buildDisplayList(s, 1.2, { signal: false }).prims;
    expect(prims.some((p) => p.group === 'signal' || p.id.endsWith('-lit'))).toBe(false);
  });
});
