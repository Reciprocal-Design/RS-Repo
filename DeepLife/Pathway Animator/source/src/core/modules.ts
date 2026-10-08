import { makeEdge } from './connect';
import { defaultCellMap, defaultModule, defaultScene, makePathway } from './defaults';
import { hash, rngFor } from './rng';
import type { CellMap, EdgeGeom, ModuleKind, NodeGeom, ReceptorGeom, Scene, SceneGeom } from './types';

/** A tissue built round the single cell: the same cell at the centre, neighbours relaying its signal on. */
export function tissueMap(): CellMap {
  return { ...defaultCellMap(), enabled: true, around: true, name: 'tissue', detailScale: 0.5, startShare: 0 };
}

// The client's modules: six views of the same pathway, one per tab. Each is a
// preset scene plus a pure transform of its geometry (applyModule), so the
// schedule, renderer and exporters need to know very little about them.

export interface ModuleInfo {
  kind: ModuleKind;
  label: string;
  blurb: string;
}

export const MODULES: ModuleInfo[] = [
  { kind: 'targetId', label: 'Target ID', blurb: 'The drug target (receptor) and the DEGs it changes, joined directly.' },
  {
    kind: 'moa',
    label: 'MOA elucidation',
    blurb: 'How the receptor reaches a DEG: the route and the proteins along it, with the rest of the network dimmed.',
  },
  {
    kind: 'combination',
    label: 'Target combination',
    blurb: 'Several receptors targeted at once, acting together on several DEGs. Each pathway is one target.',
  },
  { kind: 'toxicity', label: 'Target toxicity', blurb: 'When the signal reaches a toxic DEG, the cell turns red.' },
  {
    kind: 'tissue',
    label: 'Tissue-level target ID',
    blurb: 'Indication extension: the same cell at the centre of a tissue, its signal passing on into neighbouring cells.',
  },
  { kind: 'custom', label: 'Module 6', blurb: 'Not defined yet. Works as the standard animator for now.' },
];

export const moduleInfo = (kind: ModuleKind) => MODULES.find((m) => m.kind === kind) ?? MODULES[MODULES.length - 1];

/**
 * A module's starting scene. Every module starts from the same seed, so the
 * tabs show the same pathway; each then adjusts what it needs.
 */
export function moduleScene(kind: ModuleKind, seed = 1234): Scene {
  const s = defaultScene(seed);
  s.module = defaultModule(kind);
  s.name = moduleInfo(kind).label.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  if (kind === 'combination') {
    // Three targets, hit together.
    s.pathwayCount = 3;
    s.pathways = [0, 1, 2].map((i) => ({ ...makePathway(seed, i, s.pathways[0].layers), startDelay: 0 }));
  }
  if (kind === 'toxicity') s.animation = { ...s.animation, holdAtEnd: 2.5 };
  if (kind === 'tissue') s.cellMap = tissueMap();
  return s;
}

/**
 * Copy the shared look and pathway of `from` onto another tab's scene. The
 * tab keeps what makes its module: its module settings, cell map, pathway
 * count and start delays, and name.
 */
export function shareScene(from: Scene, to: Scene): Scene {
  return {
    ...from,
    name: to.name,
    module: to.module,
    cellMap: to.cellMap,
    pathwayCount: to.pathwayCount,
    pathways: from.pathways.map((p, i) => ({ ...p, startDelay: to.pathways[i]?.startDelay ?? p.startDelay })),
  };
}

/** Active DEGs (last-layer nodes) of each pathway, left to right across the row. */
function degsByPathway(nodes: NodeGeom[]): Map<string, NodeGeom[]> {
  const last = new Map<string, number>();
  for (const n of nodes) last.set(n.pathwayId, Math.max(last.get(n.pathwayId) ?? 0, n.layer));
  const out = new Map<string, NodeGeom[]>();
  for (const n of nodes) {
    if (!n.active || n.layer === 0 || n.layer !== last.get(n.pathwayId)) continue;
    const list = out.get(n.pathwayId) ?? [];
    list.push(n);
    out.set(n.pathwayId, list);
  }
  for (const list of out.values()) list.sort((a, b) => a.lateral - b.lateral);
  return out;
}

/** How many active DEGs the first pathway has (the range of the MOA focus and toxic DEG controls). */
export function degCount(scene: Scene): number {
  const layers = scene.pathways[0]?.layers ?? [];
  return Math.max(1, layers[layers.length - 1]?.activeCount ?? 1);
}

/**
 * The module's view of a scene's geometry. Pure: new node, edge and receptor
 * objects where anything changes, the input untouched.
 *
 * - Receptor → DEG only: every layer between is hidden, and each receptor is
 *   joined straight to its pathway's active DEGs.
 * - MOA focus: one to three routes into one DEG (receptor → one protein per
 *   layer → DEG) stay lit; the rest of the network is dimmed and carries no signal.
 * - Toxicity: a seeded choice of each pathway's DEGs is marked toxic.
 * - Drug targets: each pathway's own receptor is marked.
 */
export function applyModule(scene: Scene, g: SceneGeom): SceneGeom {
  const m = scene.module;
  const kind = m.kind;
  const direct = m.directOnly && (kind === 'targetId' || kind === 'combination');
  const focus = kind === 'moa' && m.focusDeg > 0;
  const toxic = kind === 'toxicity' && m.toxicDegs > 0;
  const mark = m.markTargets && (kind === 'targetId' || kind === 'combination' || kind === 'toxicity');
  if (!direct && !focus && !toxic && !mark) return g;

  let nodes = g.nodes;
  let edges = g.edges;
  const degs = degsByPathway(nodes);

  if (direct) {
    const keep = new Set<string>();
    const last = new Map<string, number>();
    for (const n of nodes) last.set(n.pathwayId, Math.max(last.get(n.pathwayId) ?? 0, n.layer));
    for (const n of nodes) if (n.layer === 0 || n.layer === last.get(n.pathwayId)) keep.add(n.id);
    nodes = nodes.filter((n) => keep.has(n.id));
    const out: EdgeGeom[] = [];
    for (const r of nodes) {
      if (r.layer !== 0 || !r.active) continue;
      const hops = Math.max(1, 0.6 * (last.get(r.pathwayId) ?? 1));
      for (const d of degs.get(r.pathwayId) ?? []) {
        out.push({ ...makeEdge(scene, r, d, false, rngFor(hash(scene.seed, 'direct'), r.id, d.id)), hops });
      }
    }
    edges = out;
  }

  if (focus) {
    const into = new Map<string, EdgeGeom[]>();
    for (const e of edges) {
      if (e.crosstalk || e.link) continue;
      const list = into.get(e.to) ?? [];
      list.push(e);
      into.set(e.to, list);
    }
    // Walk back from the focused DEG of each pathway to its receptor, one
    // incoming edge at a time. Later routes prefer proteins not yet used, so
    // they show other ways the signal can arrive.
    const route = new Set<string>();
    const routeEdges = new Set<string>();
    const routes = Math.max(1, Math.min(3, Math.round(m.routes)));
    for (const [pid, list] of degs) {
      const target = list[Math.min(m.focusDeg, list.length) - 1];
      const rng = rngFor(scene.seed, 'route', pid, m.focusDeg);
      for (let r = 0; r < routes; r++) {
        let id = target.id;
        route.add(id);
        for (let guard = 0; guard < 16; guard++) {
          const ins = into.get(id) ?? [];
          if (!ins.length) break;
          const fresh = ins.filter((e) => !route.has(e.from));
          const pool = r > 0 && fresh.length ? fresh : ins;
          const e = pool[Math.floor(rng() * pool.length)];
          routeEdges.add(e.id);
          route.add(e.from);
          id = e.from;
        }
      }
    }
    nodes = nodes.map((n) => (route.has(n.id) || !n.active ? n : { ...n, dim: true }));
    edges = edges.map((e) => (routeEdges.has(e.id) ? e : { ...e, dim: true }));
  }

  if (toxic) {
    const chosen = new Set<string>();
    for (const [pid, list] of degs) {
      const rng = rngFor(scene.seed, 'toxic', pid);
      const order = list.map((n) => ({ n, k: rng() })).sort((a, b) => a.k - b.k);
      order.slice(0, Math.min(Math.round(m.toxicDegs), list.length)).forEach(({ n }) => chosen.add(n.id));
    }
    nodes = nodes.map((n) => (chosen.has(n.id) ? { ...n, toxic: true } : n));
  }

  let receptors = g.receptors;
  if (mark) {
    // A pathway's own receptor, not a relay receptor or a decorative one.
    const own = (r: ReceptorGeom) => r.pathwayId !== null && r.id === `receptor-${r.pathwayId}`;
    receptors = receptors.map((r) => (own(r) ? { ...r, target: true } : r));
  }

  return { ...g, nodes, edges, receptors, nodeById: new Map(nodes.map((n) => [n.id, n])) };
}
