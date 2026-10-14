import type { Scene, SceneGeom } from './types';

// The real-cell view's network: the pathway as it is, plus what the real
// cell reveals. Each layer gains a few of its inactive nodes (the ones the
// layout would make active next), joined to the network by the edges the
// pathway would give them. Nothing that was there moves or changes: the new
// nodes and edges are only added, each with the point in the discovery
// (0–1) at which it appears.

/**
 * `build` makes a scene's plain geometry. The discovered nodes appear in
 * order, layer by layer, across each row; each is reached by its incoming
 * edges growing in, then pops up, then its outgoing edges grow out of it.
 */
export function buildDiscoveryGeometry(scene: Scene, build: (s: Scene) => SceneGeom): SceneGeom {
  const plain: Scene = { ...scene, module: { ...scene.module, kind: 'custom' } };
  const before = build(plain);
  const extra = Math.max(0, Math.round(scene.module.newNodes));
  if (!extra) return before;
  const more: Scene = {
    ...plain,
    pathways: plain.pathways.map((p) => ({
      ...p,
      layers: p.layers.map((l, i) => (i === 0 ? l : { ...l, activeCount: Math.min(l.nodeCount, l.activeCount + extra) })),
    })),
  };
  const after = build(more);

  const wasActive = new Set(before.nodes.filter((n) => n.active).map((n) => n.id));
  const fresh = after.nodes.filter((n) => n.active && !wasActive.has(n.id) && before.nodeById.has(n.id));
  if (!fresh.length) return before;
  fresh.sort((a, b) => a.pathwayId.localeCompare(b.pathwayId) || a.layer - b.layer || a.lateral - b.lateral);

  // Timing, as shares of the discovery: each new node has a window of w; the
  // windows are spread so the last one (and its outgoing edges) end at 1.
  const n = fresh.length;
  const w = Math.min(0.3, 1 / n);
  const spread = Math.max(0, 1 - 1.6 * w);
  const base = new Map(fresh.map((f, i) => [f.id, n > 1 ? (i / (n - 1)) * spread : 0]));
  const span = 0.5 * w;

  const nodes = before.nodes.map((x) => (base.has(x.id) ? { ...x, active: true, discoverAt: base.get(x.id)! + span } : x));
  const had = new Set(before.edges.map((e) => e.id));
  const added = after.edges
    .filter((e) => !had.has(e.id) && !e.link && (base.has(e.from) || base.has(e.to)) && before.nodeById.has(e.from) && before.nodeById.has(e.to))
    .map((e) => ({
      ...e,
      // Into a new node: grows just before it pops up. Out of one: grows once it has.
      discoverAt: Math.max(base.has(e.to) ? base.get(e.to)! : -Infinity, base.has(e.from) ? base.get(e.from)! + 2 * span : -Infinity),
    }));
  return { ...before, nodes, nodeById: new Map(nodes.map((x) => [x.id, x])), edges: [...before.edges, ...added], discoverSpan: span };
}
