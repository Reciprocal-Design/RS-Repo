import { makeRamp, parseColor, rgbaString } from '../core/color';
import { buildGeometry } from '../core/geometry';
import { closedSplineSegments } from '../core/outline';
import type { Bezier, Scene, Vec2 } from '../core/types';

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
}

export type Prim = Base &
  (
    | { kind: 'closedSpline'; start: Vec2; segments: [Vec2, Vec2, Vec2][]; stroke: string; width: number }
    | { kind: 'bezier'; p: Bezier; width: number; from: string; to: string }
    | { kind: 'circle'; c: Vec2; r: number; fill: string }
    | { kind: 'ring'; c: Vec2; r: number; stroke: string; width: number }
    | { kind: 'capsule'; c: Vec2; angle: number; length: number; width: number; stroke: string; strokeWidth: number }
    | { kind: 'diamond'; c: Vec2; r: number; angle: number; fill?: string; stroke?: string; strokeWidth?: number }
  );

export interface DisplayList {
  width: number;
  height: number;
  background: string;
  prims: Prim[];
}

/**
 * Draw order: outlines → receptors → edges → (comets) → halos → nodes.
 * `t` is accepted now so the signature stays stable once animation lands.
 */
export function buildDisplayList(scene: Scene, _t = 0): DisplayList {
  const g = buildGeometry(scene);
  const s = g.scale;
  const st = scene.style;
  const ramp = makeRamp(st.gradientStops);
  const color = (d: number) => rgbaString(ramp(d));
  const prims: Prim[] = [];

  if (scene.cell.visible) {
    prims.push({
      kind: 'closedSpline', id: 'membrane', group: 'membrane',
      start: g.cell.points[0], segments: closedSplineSegments(g.cell.points),
      stroke: scene.cell.color, width: scene.cell.strokeWidth * s,
    });
  }
  if (scene.nucleus.visible) {
    prims.push({
      kind: 'closedSpline', id: 'nucleus', group: 'nucleus',
      start: g.nucleus.points[0], segments: closedSplineSegments(g.nucleus.points),
      stroke: scene.nucleus.color, width: scene.nucleus.strokeWidth * s,
    });
  }

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

  // Halos first so edges and dots from neighbouring nodes are never hidden by them.
  const active = g.nodes.filter((n) => n.active);
  const halo = rgbaString(parseColor(st.haloColor));
  for (const n of active) {
    const isReceptor = n.layer === 0;
    if (isReceptor && st.receptorStyle === 'capsule') continue;
    prims.push({ kind: 'circle', id: `${n.id}-halo`, group: 'nodes-active', c: n, r: st.haloRadius * s, fill: halo });
  }
  for (const n of active) {
    if (n.layer === 0) {
      if (st.receptorStyle === 'capsule') continue;
      const rec = g.receptors.find((r) => r.pathwayId === n.pathwayId)!;
      prims.push({
        kind: 'diamond', id: `${n.id}-diamond`, group: 'nodes-active', c: n,
        r: st.activeNodeRadius * 1.6 * s, angle: rec.angle, fill: '#ffffff',
      });
    } else {
      prims.push({ kind: 'circle', id: n.id, group: 'nodes-active', c: n, r: st.activeNodeRadius * s, fill: '#ffffff' });
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
