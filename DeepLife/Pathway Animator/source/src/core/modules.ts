import { arcLengthLut } from './bezier';
import { middleCellId, suggestedDetailScale } from './cellMap';
import { makeEdge } from './connect';
import { defaultCellMap, defaultModule, defaultScene, makePathway } from './defaults';
import { organicTissue } from './organic';
import { hash, rngFor } from './rng';
import type { Bezier, CellMap, EdgeGeom, ModuleKind, NodeGeom, ReceptorGeom, Scene, SceneGeom } from './types';

/** A tissue built round the single cell: the same cell at the centre, neighbours relaying its signal on. */
export function tissueMap(): CellMap {
  return { ...defaultCellMap(), enabled: true, around: true, name: 'tissue', detailScale: 0.5, startShare: 0, relayHops: 4 };
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
    blurb: 'Working back from a DEG to the receptor: the signal uncovers the route as it goes, each protein popping up as it is reached. The rest of the network stays dimmed.',
  },
  {
    kind: 'combination',
    label: 'Target combination',
    blurb: 'Several receptors targeted at once, unevenly spaced round the cell, their pathways interconnected on the way to the DEGs. Each pathway is one target.',
  },
  { kind: 'toxicity', label: 'Target toxicity', blurb: 'When the signal reaches a toxic DEG, the cell turns red.' },
  {
    kind: 'tissue',
    label: 'Tissue-level target ID',
    blurb: 'Indication extension: the same cell at the centre of a tissue, its signal passing on into neighbouring cells.',
  },
  {
    kind: 'crossTissue',
    label: 'Cross-tissue communication',
    blurb: 'Two tissues side by side, the second in its own colour, with connections between them: the signal starts in the selected cell, spreads through its tissue and crosses into the other.',
  },
  {
    kind: 'body',
    label: 'Body',
    blurb: 'Organ-level connectivity: the body drawn like a cell, its organs like nuclei, with the same firing lines between them.',
  },
  {
    kind: 'journey',
    label: 'Cell → tissue → body',
    blurb: 'The scroll sequence: the cell zooms out into the tissue, which fades into the body. Five sections of equal length; export it as a PNG sequence.',
  },
];

export const moduleInfo = (kind: ModuleKind): ModuleInfo =>
  MODULES.find((m) => m.kind === kind) ?? { kind, label: 'Pathway', blurb: 'The standard animator.' };

/** The views that show one cell on its own (and, with an uploaded map, only its selected cell). */
export const SINGLE_CELL: ModuleKind[] = ['targetId', 'moa', 'combination', 'toxicity'];


/** An uploaded tissue map, as the views share it. */
export type TissueUpload = Pick<CellMap, 'name' | 'viewBox' | 'cells'>;

/**
 * Put an uploaded tissue map, and the cell selected in it, into a view:
 * the single-cell views show only that cell (as the single cell); the
 * tissue view shows the whole map with that cell in the middle; the
 * cross-tissue view and the journey use the whole map. In all of them the
 * selected cell runs the scene's own pathways and starts the signal, and
 * the other cells wait for it to reach them.
 */
export function withTissueMap(scene: Scene, map: TissueUpload, heroId: string): Scene {
  const kind = scene.module.kind;
  const base: CellMap = { ...defaultCellMap(), enabled: true, name: map.name, viewBox: map.viewBox, cells: map.cells, heroId };
  if (SINGLE_CELL.includes(kind)) return { ...scene, cellMap: { ...base, solo: true, detailScale: 1 } };
  const fit = (s: Scene) => suggestedDetailScale(s, map);
  // The tissue view is zoomed in on the selected cell, two cells showing beyond it.
  if (kind === 'tissue') return { ...scene, cellMap: { ...base, centerHero: true, rings: 2, startShare: 0, relayHops: 4, detailScale: fit(scene) } };
  if (kind === 'journey') return { ...scene, cellMap: { ...base, startShare: 0, relayHops: 4, detailScale: fit(scene) } };
  if (kind === 'crossTissue') {
    // Each tissue has (a little under) half the canvas, fitted by its cells.
    const { width: W, height: H } = scene.canvas;
    const framed = { ...base, frame: { x: 0, y: 0, w: 0.46 * W, h: H } };
    return { ...scene, cellMap: { ...base, startShare: 0, relayHops: 8, detailScale: suggestedDetailScale(scene, framed) } };
  }
  return scene;
}

/** Select another cell of the uploaded map. */
export function withHero(scene: Scene, heroId: string): Scene {
  const cm = scene.cellMap;
  if (cm.around || !cm.cells.some((c) => c.id === heroId)) return scene;
  return { ...scene, cellMap: { ...cm, heroId } };
}

/** Back to each view's own cell or generated tissue. */
export function withoutTissueMap(scene: Scene): Scene {
  const kind = scene.module.kind;
  if (SINGLE_CELL.includes(kind)) return { ...scene, cellMap: defaultCellMap() };
  if (kind === 'tissue') return { ...scene, cellMap: tissueMap() };
  if (kind === 'journey') return { ...scene, cellMap: { ...tissueMap(), detailScale: 0.4 } };
  if (kind === 'crossTissue') return withOrganicTissue(scene, scene.seed);
  return scene;
}

/**
 * The cross-tissue view's own tissue, when no map is uploaded: a generated
 * one, its cells packed wall to wall, with its middle cell selected.
 */
export function withOrganicTissue(scene: Scene, seed: number): Scene {
  const map = organicTissue(seed);
  const probe = { ...scene, cellMap: { ...defaultCellMap(), viewBox: map.viewBox, cells: map.cells } };
  return withTissueMap(scene, map, middleCellId(probe) ?? map.cells[0]?.id ?? '');
}

/**
 * A module's starting scene. Every module starts from the same seed, so the
 * tabs show the same pathway; each then adjusts what it needs.
 */
export function moduleScene(kind: ModuleKind, seed = 1234): Scene {
  const s = defaultScene(seed);
  s.module = defaultModule(kind);
  s.name = moduleInfo(kind).label.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  if (kind === 'combination') {
    // Three targets, hit together, spaced unevenly and interconnected.
    s.pathwayCount = 3;
    s.pathways = [0, 1, 2].map((i) => ({ ...makePathway(seed, i, s.pathways[0].layers), startDelay: 0 }));
    s.spacingVariation = 1.7;
    s.rotation = 24;
    s.crosstalk = { enabled: true, amount: 0.5 };
  }
  if (kind === 'toxicity') s.animation = { ...s.animation, holdAtEnd: 2.5 };
  if (kind === 'tissue') s.cellMap = tissueMap();
  if (kind === 'crossTissue') return withOrganicTissue(s, seed);
  if (kind === 'journey') {
    // The tissue the cell zooms out into; motion that never stops, for a scroll sequence.
    s.cellMap = { ...tissueMap(), detailScale: 0.4 };
    s.animation = { ...s.animation, continuous: true };
  }
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
  let pathways = g.pathways;
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
      // Interconnection (crosstalk on): a receptor also reaches a few of the
      // other pathways' DEGs, the nearest most often.
      if (scene.crosstalk.enabled && scene.crosstalk.amount > 0) {
        const rng = rngFor(hash(scene.seed, 'direct-cross'), r.id);
        const others = [...degs].filter(([pid]) => pid !== r.pathwayId).flatMap(([, list]) => list);
        const count = Math.min(others.length, Math.floor(scene.crosstalk.amount * 3 + rng()));
        const near = others
          .map((d) => ({ d, key: rng() ** (Math.hypot(d.x - r.x, d.y - r.y) / 100) }))
          .sort((a, b) => b.key - a.key);
        for (const { d } of near.slice(0, count)) {
          out.push({ ...makeEdge(scene, r, d, true, rngFor(hash(scene.seed, 'direct-cross'), r.id, d.id)), hops });
        }
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
    const startOf = new Map<string, string>(); // pathway → the DEG the trace starts from
    const routes = Math.max(1, Math.min(3, Math.round(m.routes)));
    for (const [pid, list] of degs) {
      const target = list[Math.min(m.focusDeg, list.length) - 1];
      startOf.set(pid, target.id);
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
    // Elucidation runs backwards: the signal starts at the DEG and travels
    // the route in reverse to the receptor. The route is not there to begin
    // with: its edges are drawn as the signal passes, and each node pops up
    // when it is reached (the DEG itself is known from the start).
    const starts = new Set(startOf.values());
    nodes = nodes.map((n) =>
      !n.active ? n : !route.has(n.id) ? { ...n, dim: true } : starts.has(n.id) ? n : { ...n, reveal: true });
    edges = edges.map((e) => {
      if (!routeEdges.has(e.id)) return { ...e, dim: true };
      const bezier = [...e.bezier].reverse() as Bezier;
      const lut = arcLengthLut(bezier);
      return {
        ...e, from: e.to, to: e.from, bezier, lut, length: lut[lut.length - 1],
        depthFrom: e.depthTo, depthTo: e.depthFrom, reveal: true,
      };
    });
    pathways = pathways.map((p) => (startOf.has(p.id) ? { ...p, start: startOf.get(p.id) } : p));
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

  return { ...g, nodes, edges, receptors, pathways, nodeById: new Map(nodes.map((n) => [n.id, n])) };
}
