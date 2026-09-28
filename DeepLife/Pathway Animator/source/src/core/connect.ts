import { arcLengthLut } from './bezier';
import type { PathwayLayout } from './layout';
import { hash, range, rngFor, signed, type Rng } from './rng';
import type { Bezier, EdgeGeom, NodeGeom, Pathway, Scene } from './types';

const MAX_FAN_OUT = 4;

/**
 * Cubic Bézier from centre to centre. Control points leave and enter each
 * node along its local flow direction (toward the nucleus centre), which gives
 * the smooth S-curves of the style reference whatever the pathway's angle.
 */
export function edgeCurve(a: NodeGeom, b: NodeGeom, curvature: number): Bezier {
  const chord = Math.hypot(b.x - a.x, b.y - a.y);
  const k = curvature * 0.5 * Math.max(a.rho - b.rho, 0.3 * chord);
  return [
    { x: a.x, y: a.y },
    { x: a.x + a.flow.x * k, y: a.y + a.flow.y * k },
    { x: b.x - b.flow.x * k, y: b.y - b.flow.y * k },
    { x: b.x, y: b.y },
  ];
}

function makeEdge(scene: Scene, a: NodeGeom, b: NodeGeom, crosstalk: boolean, rng: Rng): EdgeGeom {
  const bezier = edgeCurve(a, b, scene.style.edgeCurvature);
  const lut = arcLengthLut(bezier);
  const { min, max } = scene.style.edgeOpacity;
  return {
    id: `${crosstalk ? 'xt' : 'e'}-${a.id}-to-${b.id}`,
    from: a.id,
    to: b.id,
    pathwayId: a.pathwayId,
    crosstalk,
    bezier,
    length: lut[lut.length - 1],
    lut,
    opacity: range(rng, Math.min(min, max), Math.max(min, max)),
    depthFrom: a.depth,
    depthTo: b.depth,
  };
}

/** Pick up to k distinct indices, weighted, without replacement. */
function weightedPick(rng: Rng, weights: number[], k: number): number[] {
  const keyed = weights.map((w, i) => ({ i, key: w > 0 ? rng() ** (1 / w) : -1 }));
  keyed.sort((a, b) => b.key - a.key);
  return keyed.slice(0, k).filter((x) => x.key >= 0).map((x) => x.i);
}

/** Signed lateral position (arc length from the pathway axis) of a node. */
const lateral = (n: NodeGeom, axis: number) => {
  // flow points at the nucleus centre, so the node's polar angle is that of -flow.
  const d = Math.atan2(-n.flow.y, -n.flow.x) - axis;
  return Math.atan2(Math.sin(d), Math.cos(d)) * n.rho;
};

/** Edges within one pathway: adjacent layers only, active nodes only. */
export function connectPathway(scene: Scene, pathway: Pathway, layout: PathwayLayout): EdgeGeom[] {
  const edges: EdgeGeom[] = [];
  const rn = layout.nodes[0];
  const axis = Math.atan2(-rn.flow.y, -rn.flow.x);

  for (let li = 1; li < layout.layers.length; li++) {
    const parents = layout.layers[li - 1].filter((n) => n.active);
    const children = layout.layers[li].filter((n) => n.active);
    if (!parents.length || !children.length) continue;
    const rng = rngFor(pathway.seed, 'links', li, parents.length, children.length);
    const pairs = new Set<string>();
    const outCount = new Map<string, number>();
    const inCount = new Map<string, number>();
    const add = (p: NodeGeom, c: NodeGeom) => {
      const key = `${p.id}|${c.id}`;
      if (pairs.has(key)) return;
      pairs.add(key);
      outCount.set(p.id, (outCount.get(p.id) ?? 0) + 1);
      inCount.set(c.id, (inCount.get(c.id) ?? 0) + 1);
      edges.push(makeEdge(scene, p, c, false, rngFor(pathway.seed, 'edge', p.id, c.id)));
    };

    if (parents.length === 1 && li === 1) {
      // The receptor feeds every active node in layer 2.
      children.forEach((c) => add(parents[0], c));
      continue;
    }

    const latP = parents.map((p) => lateral(p, axis));
    const latC = children.map((c) => lateral(c, axis));
    const halfWidth = Math.max(...latP.map(Math.abs), ...latC.map(Math.abs), 1);
    const sigma = 0.55 * halfWidth + 0.5 * layout.spacing[li];

    const order = parents.map((_, i) => ({ i, k: rng() })).sort((a, b) => a.k - b.k);
    for (const { i } of order) {
      const p = parents[i];
      const fan = Math.max(1, Math.min(MAX_FAN_OUT, children.length, Math.round(1 + pathway.branching * 2.6 + signed(rng, 0.9))));
      const weights = children.map((c, j) => {
        const d = latP[i] - latC[j];
        const near = Math.exp(-(d * d) / (2 * sigma * sigma));
        const merge = (inCount.get(c.id) ?? 0) > 0 ? 0.35 + 1.6 * pathway.convergence : 1.5 - 0.6 * pathway.convergence;
        return near * merge + 1e-4;
      });
      weightedPick(rng, weights, fan).forEach((j) => add(p, children[j]));
    }

    // Every active child needs at least one incoming edge.
    children.forEach((c, j) => {
      if (inCount.get(c.id)) return;
      const ranked = parents
        .map((p, i) => ({ p, d: Math.abs(latP[i] - latC[j]) + ((outCount.get(p.id) ?? 0) >= MAX_FAN_OUT ? 1e9 : 0) }))
        .sort((a, b) => a.d - b.d);
      add(ranked[0].p, c);
    });
  }
  return edges;
}

/**
 * Crosstalk: a few edges from layer k of one pathway to layer k+1 of its
 * neighbour around the cell, preferring nodes on the facing sides.
 */
export function connectCrosstalk(scene: Scene, layouts: PathwayLayout[], pathways: Pathway[]): EdgeGeom[] {
  const n = layouts.length;
  if (!scene.crosstalk.enabled || n < 2) return [];
  const edges: EdgeGeom[] = [];
  const pairCount = n === 2 ? 1 : n;
  for (let a = 0; a < pairCount; a++) {
    const b = (a + 1) % n;
    const pa = pathways[a], pb = pathways[b];
    const rng = rngFor(hash(pa.seed, pb.seed), 'crosstalk', a);
    const count = Math.round(scene.crosstalk.amount * 3 + rng() * 0.99);
    const used = new Set<string>();
    for (let e = 0; e < count; e++) {
      const er = rngFor(hash(pa.seed, pb.seed), 'crosstalk-edge', e);
      const forward = er() < 0.5;
      const [src, dst] = forward ? [layouts[a], layouts[b]] : [layouts[b], layouts[a]];
      const maxK = Math.min(src.layers.length, dst.layers.length) - 1;
      if (maxK < 1) continue;
      const k = 1 + Math.floor(er() * maxK); // source layer k ≥ 1, target layer k+1 ≤ last
      if (k + 1 > dst.layers.length - 1) continue;
      const from = src.layers[k].filter((x) => x.active);
      const to = dst.layers[k + 1].filter((x) => x.active);
      if (!from.length || !to.length) continue;
      const toward = (x: NodeGeom, other: PathwayLayout) =>
        Math.hypot(x.x - other.receptor.inner.x, x.y - other.receptor.inner.y);
      const f = weightedPick(er, from.map((x) => 1 / (1 + toward(x, dst) / 100) ** 3), 1)[0];
      const t = weightedPick(er, to.map((x) => 1 / (1 + toward(x, src) / 100) ** 3), 1)[0];
      if (f === undefined || t === undefined) continue;
      const key = `${from[f].id}|${to[t].id}`;
      if (used.has(key)) continue;
      used.add(key);
      edges.push(makeEdge(scene, from[f], to[t], true, er));
    }
  }
  return edges;
}
