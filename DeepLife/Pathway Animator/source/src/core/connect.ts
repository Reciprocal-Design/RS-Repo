import { arcLengthLut } from './bezier';
import { receptorAt, type CellFrame, type PathwayLayout } from './layout';
import { hash, range, rngFor, signed, type Rng } from './rng';
import type { Bezier, EdgeGeom, NodeGeom, Pathway, ReceptorGeom, Scene, Vec2 } from './types';

const MAX_FAN_OUT = 4;

/**
 * Cubic Bézier from centre to centre. Control points leave and enter each
 * node along its local flow direction (toward the nucleus centre), which gives
 * the smooth S-curves of the style reference whatever the pathway's angle.
 */
export function edgeCurve(a: NodeGeom, b: NodeGeom, curvature: number): Bezier {
  const chord = Math.hypot(b.x - a.x, b.y - a.y);
  // curvature 0 still bends gently; 1 is a full S-curve.
  const k = (0.2 + 0.8 * curvature) * 0.5 * Math.max(a.rho - b.rho, 0.3 * chord);
  return [
    { x: a.x, y: a.y },
    { x: a.x + a.flow.x * k, y: a.y + a.flow.y * k },
    { x: b.x - b.flow.x * k, y: b.y - b.flow.y * k },
    { x: b.x, y: b.y },
  ];
}

export function makeEdge(scene: Scene, a: NodeGeom, b: NodeGeom, crosstalk: boolean, rng: Rng): EdgeGeom {
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

/** Edges within one pathway: adjacent layers only, active nodes only. */
export function connectPathway(scene: Scene, pathway: Pathway, layout: PathwayLayout): EdgeGeom[] {
  const edges: EdgeGeom[] = [];

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

    const latP = parents.map((p) => p.lateral);
    const latC = children.map((c) => c.lateral);
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

/** Crosstalk only joins nodes of neighbouring pathways closer than this (× cell radius). */
export const CROSSTALK_REACH = 0.55;

/**
 * Crosstalk: a few edges from layer k of one pathway to layer k+1 of its
 * neighbour around the cell. Any layer may take part, but only where the two
 * pathways run close together: pairs farther apart than CROSSTALK_REACH are
 * never linked, so widely spaced neighbours get none. Nearer pairs are
 * favoured gently, and a layer that already carries a link is less likely to
 * get another, so links spread along the pathways instead of piling up at the
 * deepest layers.
 */
export function connectCrosstalk(scene: Scene, layouts: PathwayLayout[], pathways: Pathway[], R: number): EdgeGeom[] {
  const n = layouts.length;
  if (!scene.crosstalk.enabled || n < 2) return [];
  const reach = CROSSTALK_REACH * R;
  const falloff = 0.3 * R;
  const edges: EdgeGeom[] = [];
  const pairCount = n === 2 ? 1 : n;
  for (let a = 0; a < pairCount; a++) {
    const b = (a + 1) % n;
    const pa = pathways[a], pb = pathways[b];
    const rng = rngFor(hash(pa.seed, pb.seed), 'crosstalk', a);
    const count = Math.round(scene.crosstalk.amount * 3 + rng() * 0.99);
    if (!count) continue;

    // Close candidate pairs, either direction, across every layer k → k+1.
    // Source layer k ≥ 1 (never the receptor).
    const pairs: { a: NodeGeom; b: NodeGeom; d: number; k: number }[] = [];
    for (const [src, dst] of [[layouts[a], layouts[b]], [layouts[b], layouts[a]]]) {
      const maxK = Math.min(src.layers.length - 1, dst.layers.length - 2);
      for (let k = 1; k <= maxK; k++) {
        for (const x of src.layers[k]) {
          if (!x.active) continue;
          for (const y of dst.layers[k + 1]) {
            if (!y.active) continue;
            const d = Math.hypot(x.x - y.x, x.y - y.y);
            if (d <= reach) pairs.push({ a: x, b: y, d, k });
          }
        }
      }
    }
    if (!pairs.length) continue;

    const layerUse = new Map<number, number>();
    const nodeUse = new Set<string>();
    const free = (q: (typeof pairs)[number]) => !nodeUse.has(q.a.id) && !nodeUse.has(q.b.id);
    const layersK = [...new Set(pairs.map((q) => q.k))];
    const er = rngFor(hash(pa.seed, pb.seed), 'crosstalk-edges', a);
    for (let e = 0; e < count; e++) {
      // First the layer, by how close the pathways come there (not by how many
      // candidate pairs it has, which would always favour the deep layers)…
      const layerW = layersK.map((k) => {
        const ds = pairs.filter((q) => q.k === k && free(q)).map((q) => q.d);
        return ds.length ? (1 - Math.min(...ds) / reach + 0.05) * 0.3 ** (layerUse.get(k) ?? 0) : 0;
      });
      const li = weightedPick(er, layerW, 1)[0];
      if (li === undefined) break;
      const k = layersK[li];
      // …then a pair within it, favouring the nearest.
      const inLayer = pairs.filter((q) => q.k === k && free(q));
      const pick = weightedPick(er, inLayer.map((q) => Math.exp(-((q.d / falloff) ** 2))), 1)[0];
      if (pick === undefined) break;
      const q = inLayer[pick];
      nodeUse.add(q.a.id);
      nodeUse.add(q.b.id);
      layerUse.set(k, (layerUse.get(k) ?? 0) + 1);
      edges.push(makeEdge(scene, q.a, q.b, true, er));
    }
  }
  return edges;
}

export interface LinkCell {
  id: string;
  seed: number;
  R: number;
  /** Outline sample points, for finding neighbours. */
  points: Vec2[];
  layouts: PathwayLayout[];
  frame: CellFrame;
  /** The cell's own scene (its seed and turn), for placing receptors. */
  scene: Scene;
}

/** Do two cells touch? Their outlines come within a small gap (× the smaller radius) of each other. */
function touching(a: LinkCell, b: LinkCell, reach: number): boolean {
  const gap = reach * Math.min(a.R, b.R);
  const box = (c: LinkCell) => {
    const xs = c.points.map((p) => p.x), ys = c.points.map((p) => p.y);
    return [Math.min(...xs) - gap, Math.min(...ys) - gap, Math.max(...xs) + gap, Math.max(...ys) + gap];
  };
  const [ax0, ay0, ax1, ay1] = box(a), [bx0, by0, bx1, by1] = box(b);
  if (ax1 < bx0 || bx1 < ax0 || ay1 < by0 || by1 < ay0) return false;
  const g2 = gap * gap;
  for (const p of a.points) for (const q of b.points) if ((p.x - q.x) ** 2 + (p.y - q.y) ** 2 < g2) return true;
  return false;
}

export interface CellLinks {
  edges: EdgeGeom[];
  /** Relay receptor nodes (layer 0 of the pathway they feed). */
  nodes: NodeGeom[];
  receptors: ReceptorGeom[];
}

/**
 * Cell-to-cell links. Each pair of touching cells gets `amount` links on
 * average (0–8). A link runs from an active cytoplasm node of one cell to a
 * relay receptor on the other cell's membrane, on the wall facing it, and that
 * receptor feeds the nearest first-layer nodes of the neighbour's pathway, so
 * the signal enters through a receptor and runs the pathway again from there.
 * Links arriving close together on the same wall share a receptor.
 */
export function connectCellLinks(
  scene: Scene,
  cells: LinkCell[],
  /** `reach`: how far apart touching cells may be (× the smaller radius); `origin`: links run away from this point. */
  { reach = 0.15, origin }: { reach?: number; origin?: Vec2 } = {},
): CellLinks {
  const out: CellLinks = { edges: [], nodes: [], receptors: [] };
  const { enabled, amount } = scene.cellMap.links;
  if (!enabled || amount <= 0) return out;
  const usedSources = new Set<string>();
  const relays = new Map<string, { node: NodeGeom; rec: ReceptorGeom }[]>(); // per cell
  for (let i = 0; i < cells.length; i++) {
    for (let j = i + 1; j < cells.length; j++) {
      const A = cells[i], B = cells[j];
      if (!A.layouts.length || !B.layouts.length || !touching(A, B, reach)) continue;
      const rng = rngFor(scene.seed, 'cell-link', A.seed, B.seed);
      const count = Math.floor(amount) + (rng() < amount - Math.floor(amount) ? 1 : 0);
      for (let k = 0; k < count; k++) {
        const coin = rng();
        const nearer = (c: LinkCell) => (origin ? Math.hypot(c.frame.center.x - origin.x, c.frame.center.y - origin.y) : 0);
        const [src, dst] = origin ? (nearer(A) <= nearer(B) ? [A, B] : [B, A]) : coin < 0.5 ? [A, B] : [B, A];
        // Sources near the shared wall, each used by one link while fresh ones
        // last (with many links per neighbour a node may send more than one).
        const all = src.layouts.flatMap((l) => l.nodes.filter((n) => n.active && n.layer > 0 && n.region === 'cytoplasm'));
        const fresh = all.filter((n) => !usedSources.has(n.id));
        const from = fresh.length ? fresh : all;
        const near = (a: NodeGeom) => {
          let best = dst.points[0], bd = Infinity;
          for (const q of dst.points) {
            const d = Math.hypot(q.x - a.x, q.y - a.y);
            if (d < bd) (bd = d), (best = q);
          }
          return { q: best, d: bd };
        };
        const cands = from.map((a) => ({ a, ...near(a) })).filter((c) => c.d < 1.2 * src.R);
        if (!cands.length) continue;
        const dMin = Math.min(...cands.map((c) => c.d));
        const pick = weightedPick(rng, cands.map((c) => Math.exp(-3 * (c.d / dMin - 1))), 1)[0];
        if (pick === undefined) continue;
        const { a, q } = cands[pick];
        usedSources.add(a.id);
        const relay = relayAt(scene, dst, q, relays, out);
        // A reused source may land on a receptor it already feeds: one link is enough.
        if (relay && !out.edges.some((e) => e.link && e.from === a.id && e.to === relay.id)) {
          out.edges.push(makeLinkEdge(scene, a, relay, rng));
        }
      }
    }
  }
  return out;
}

/** The relay receptor on `cell`'s membrane at (or near) point q, made on first use. */
function relayAt(
  scene: Scene, cell: LinkCell, q: Vec2,
  relays: Map<string, { node: NodeGeom; rec: ReceptorGeom }[]>, out: CellLinks,
): NodeGeom | null {
  const f = cell.frame;
  const list = relays.get(cell.id) ?? [];
  relays.set(cell.id, list);
  const minSep = 2.2 * scene.style.receptorSize.length * f.scale;
  const hit = list.find((r) => Math.hypot(r.rec.center.x - q.x, r.rec.center.y - q.y) < minSep);
  if (hit) return hit.node;

  const phi = Math.atan2(q.y - f.cell.center.y, q.x - f.cell.center.x);
  const idx = list.length + 1;
  // Feed the pathway whose first layer lies nearest the wall.
  const firsts = cell.layouts.map((l) => ({ l, nodes: (l.layers[1] ?? []).filter((n) => n.active) })).filter((x) => x.nodes.length);
  if (!firsts.length) return null;
  const rec0 = receptorAt(f, cell.scene, phi, '', null);
  const dist = (n: NodeGeom) => Math.hypot(n.x - rec0.inner.x, n.y - rec0.inner.y);
  // Among pathways reasonably near this wall, feed the one with fewest relay
  // receptors so far, so relays reach every pathway of the cell, not just
  // the one nearest the wall.
  const reach = firsts.map((x) => ({ ...x, d: Math.min(...x.nodes.map(dist)) })).sort((x, y) => x.d - y.d);
  const fed = (pid: string) => list.filter((r) => r.node.pathwayId === pid).length;
  const near = reach.filter((x) => x.d <= 1.6 * reach[0].d);
  near.sort((x, y) => fed(x.l.receptor.pathwayId!) - fed(y.l.receptor.pathwayId!) || x.d - y.d);
  const { l, nodes } = near[0];
  const pathwayId = l.receptor.pathwayId!;
  const id = `${pathwayId}-R${idx}`;
  const rec: ReceptorGeom = { ...rec0, id: `receptor-${id}`, pathwayId, nodeId: id };
  const N = f.nucleus.center;
  const node: NodeGeom = {
    id, pathwayId, layer: 0, depth: 0, x: rec.inner.x, y: rec.inner.y, active: true, region: 'membrane',
    flow: { x: Math.cos(rec.angle), y: Math.sin(rec.angle) },
    rho: Math.hypot(rec.inner.x - N.x, rec.inner.y - N.y), lateral: 0,
  };
  list.push({ node, rec });
  out.nodes.push(node);
  out.receptors.push(rec);
  // Into the pathway: like its own receptor, a relay receptor feeds every
  // active first-layer node, so a relay runs the whole pathway again (and can
  // pass on from any of its cytoplasm nodes).
  for (const c of nodes) out.edges.push(makeEdge(scene, node, c, false, rngFor(hash(scene.seed, id), c.id)));
  return node;
}

/** A link leaves its node heading for the target and enters the receptor along its inward flow. */
function makeLinkEdge(scene: Scene, a: NodeGeom, b: NodeGeom, rng: Rng): EdgeGeom {
  const d = Math.hypot(b.x - a.x, b.y - a.y);
  const k = d / 3;
  const ux = (b.x - a.x) / (d || 1), uy = (b.y - a.y) / (d || 1);
  const bend = signed(rng, 0.25) * d;
  const bezier: Bezier = [
    { x: a.x, y: a.y },
    { x: a.x + ux * k - uy * bend, y: a.y + uy * k + ux * bend },
    { x: b.x - b.flow.x * k, y: b.y - b.flow.y * k },
    { x: b.x, y: b.y },
  ];
  const lut = arcLengthLut(bezier);
  const { min, max } = scene.style.edgeOpacity;
  return {
    id: `link-${a.id}-to-${b.id}`,
    from: a.id,
    to: b.id,
    pathwayId: a.pathwayId,
    crosstalk: true,
    bezier,
    length: lut[lut.length - 1],
    lut,
    opacity: range(rng, Math.min(min, max), Math.max(min, max)),
    depthFrom: a.depth,
    depthTo: 0,
    link: true,
  };
}
