import { middleCellId, suggestedDetailScale } from './cellMap';
import { makeEdge } from './connect';
import { defaultCellMap, defaultModule, defaultScene, makePathway } from './defaults';
import { ZOOM_VIEWS } from './layout';
import { organicTissue } from './organic';
import { withStructureOf } from './layers';
import { hash, rngFor } from './rng';
import type { CellMap, EdgeGeom, LayerSpec, ModuleKind, NodeGeom, ReceptorGeom, Scene, SceneGeom } from './types';

/** A tissue built round the single cell: the same cell at the centre, neighbours relaying its signal on. */
export function tissueMap(): CellMap {
  return { ...defaultCellMap(), enabled: true, around: true, name: 'tissue', detailScale: 0.5, startShare: 0, relayHops: 4 };
}

// The client's modules: views of the same pathway, one per tab. Each is a
// preset scene plus a pure transform of its geometry (applyModule), so the
// schedule, renderer and exporters need to know very little about them.

export interface ModuleInfo {
  kind: ModuleKind;
  label: string;
  blurb: string;
}

export const MODULES: ModuleInfo[] = [
  {
    kind: 'moa',
    label: 'Target identification and MOA',
    blurb: 'The whole signalling pathway, always on in the gradient, with pulses running back and forth between the receptor and the nucleus.',
  },
  {
    kind: 'combination',
    label: 'Target combination',
    blurb: 'The signalling pathway of tab 1 and one more: two receptors, each with its own pathway to the nucleus, talking to each other at the DEGs.',
  },
  {
    kind: 'toxicity',
    label: 'Target toxicity',
    blurb: 'The same receptor as tab 1, a different signalling pathway, ending at a different dot in the nucleus: the large red one, radiating a ring.',
  },
  {
    kind: 'tissue',
    label: 'Tissue-level target ID',
    blurb: 'Indication extension: the whole tissue map, the signal starting in the selected cell and spreading from cell to cell.',
  },
  {
    kind: 'crossTissue',
    label: 'Cross-tissue communication',
    blurb: 'One tissue map, its cells split between two tissues by colour (click cells to switch them): the signal starts in the selected cell, spreads through its tissue and crosses into the other where they meet.',
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
  {
    kind: 'realCell',
    label: 'Virtual → real cell',
    blurb: 'The virtual cell, then a real cell video under its network, where new edges and nodes are found, then back to the virtual cell with them. Five sections of equal length; export it as a video or PNG sequence.',
  },
  {
    kind: 'sequence',
    label: 'Tabs in sequence',
    blurb: 'The tabs you pick, played one after another as they are set up in their own tabs, each crossfading into the next: export it as one PNG sequence (or video) for smooth transitions between them.',
  },
];

export const moduleInfo = (kind: ModuleKind): ModuleInfo =>
  MODULES.find((m) => m.kind === kind) ?? { kind, label: 'Pathway', blurb: 'The standard animator.' };

/**
 * Tabs 4 and 5: every cell is active, all starting within this many seconds
 * of each other, their signals crossing between cells along the links (an
 * arrival pulses; it does not run the next cell's pathway again), so the
 * loop is about one pathway long, like tabs 1–3.
 */
export const TISSUE_ALL_ACTIVE = { startShare: 1, relayHops: 0, stagger: 1 };
/** Tabs 1–5: seconds a pulse takes per layer (slower than the plain animator's 0.5). */
export const TAB_LAYER_DURATION = 1;
const SLOW_TABS: ModuleKind[] = ['moa', 'combination', 'toxicity', 'tissue', 'crossTissue'];
/** Short loops keep exported videos small: the rest at the end of a loop (seconds). */
const SHORT_HOLD = 0.5;
/** Seconds per section of the virtual → real cell tab. */
const REAL_CELL_SECTION = 2;

/** The views that show one cell on its own (and, with an uploaded map, only its selected cell). */
/** The tabs that trace routes through the network. */
export const TRACED: ModuleKind[] = ['moa', 'combination', 'toxicity'];
/** The traced tabs' pulse size and line thickness, in px. */
export const TRACED_COMET_SIZE = 6.5;
export const TRACED_LINE_WIDTH = 3.55;

export const SINGLE_CELL: ModuleKind[] = ['moa', 'combination', 'toxicity', 'realCell'];


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
  // The tissue view lays the map out as the cross-tissue view does, in one colour.
  if (kind === 'tissue') return { ...scene, cellMap: { ...base, ...TISSUE_ALL_ACTIVE, detailScale: fit(scene) } };
  if (kind === 'journey') return { ...scene, cellMap: { ...base, startShare: 0, relayHops: 4, detailScale: fit(scene) } };
  if (kind === 'crossTissue') {
    // A new map: the default split (right half in the second colour) applies again.
    return { ...scene, module: { ...scene.module, pinkCells: null }, cellMap: { ...base, ...TISSUE_ALL_ACTIVE, detailScale: fit(scene) } };
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
  if (kind === 'journey') return { ...scene, cellMap: { ...tissueMap(), detailScale: 0.4 } };
  if (kind === 'tissue' || kind === 'crossTissue') return withOrganicTissue(scene, scene.seed);
  return scene;
}

/**
 * The cross-tissue view's own tissue, when no map is uploaded: a generated
 * one, its cells packed wall to wall, with its middle cell selected.
 */
export function withOrganicTissue(scene: Scene, seed: number): Scene {
  // Wide enough to fill a landscape canvas, with room for two tissues.
  const map = organicTissue(seed, 40, 1.75);
  const probe = { ...scene, cellMap: { ...defaultCellMap(), viewBox: map.viewBox, cells: map.cells } };
  return withTissueMap(scene, map, middleCellId(probe) ?? map.cells[0]?.id ?? '');
}

/** Each zoomable tab's starting zoom: the single cell about half the canvas across. */
const DEFAULT_ZOOM: Partial<Record<ModuleKind, number>> = {
  moa: 0.6, combination: 0.6, toxicity: 0.6,
};

/**
 * A module's starting scene. Every module starts from the same seed, so the
 * tabs show the same pathway; each then adjusts what it needs.
 */
export function moduleScene(kind: ModuleKind, seed = 1234): Scene {
  const s = defaultScene(seed);
  s.module = defaultModule(kind);
  s.name = moduleInfo(kind).label.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  if (ZOOM_VIEWS.includes(kind)) {
    // Tabs 1–3: a square canvas, zoomed out so the cells round the centre cell show.
    s.canvas = { ...s.canvas, width: 2000, height: 2000 };
    s.module.zoom = DEFAULT_ZOOM[kind] ?? 1;
    s.cell.neighbours = { ...s.cell.neighbours, show: true };
  }
  if (SLOW_TABS.includes(kind)) s.animation = { ...s.animation, layerDuration: TAB_LAYER_DURATION };
  if (TRACED.includes(kind)) {
    s.animation = { ...s.animation, cometSize: TRACED_COMET_SIZE };
    s.style = { ...s.style, edgeWidth: TRACED_LINE_WIDTH };
  }
  if (kind === 'combination') {
    // Tab 1's pathway and one more, hit together.
    s.pathwayCount = 2;
    s.pathways = [0, 1].map((i) => ({ ...makePathway(seed, i, s.pathways[0].layers), startDelay: 0 }));
  }
  // Motion that never stops, so the network keeps moving over the video.
  if (kind === 'realCell') {
    s.animation = { ...s.animation, continuous: true };
    s.module.sectionLength = REAL_CELL_SECTION;
  }
  if (kind === 'tissue' || kind === 'crossTissue' || kind === 'body') s.animation = { ...s.animation, holdAtEnd: SHORT_HOLD };
  if (kind === 'tissue' || kind === 'crossTissue') return withOrganicTissue(s, seed);
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
 * count, spacing and start delays, and name.
 */
export function shareScene(from: Scene, to: Scene): Scene {
  return {
    ...from,
    name: to.name,
    module: to.module,
    cellMap: to.cellMap,
    pathwayCount: to.pathwayCount,
    spacingVariation: to.spacingVariation,
    rotation: to.rotation,
    crosstalk: to.crosstalk,
    pathways: [
      ...from.pathways.map((p, i) => ({ ...p, startDelay: to.pathways[i]?.startDelay ?? p.startDelay })),
      ...to.pathways.slice(from.pathways.length),
    ],
  };
}

/**
 * Keep a traced tab (1–3) in step with the one being edited: the same cell,
 * look, motion and first pathway, so tab 2 always shows tab 1's pathway. The
 * tab keeps what makes it its own: any added pathway and its toxicity colour.
 */
export function linkTraced(from: Scene, to: Scene): Scene {
  const first = from.pathways[0];
  const added = to.pathways.slice(1).map((p, i) => ({
    ...p,
    seed: from.seed !== to.seed && !p.locked ? hash(from.seed, 'pathway', i + 1) : p.seed,
    layers: from.sameLayersForAll ? withStructureOf(p.layers, first.layers) : p.layers,
  }));
  const { zoom, trips, markTargets, targetColor } = from.module;
  return {
    ...to,
    seed: from.seed,
    canvas: from.canvas,
    cell: from.cell,
    nucleus: from.nucleus,
    style: from.style,
    animation: from.animation,
    rotation: from.rotation,
    sameLayersForAll: from.sameLayersForAll,
    cellMap: from.cellMap,
    pathways: [{ ...first, startDelay: to.pathways[0].startDelay }, ...added],
    module: { ...to.module, zoom, trips, markTargets, targetColor },
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

/** Hops a signal takes to cross between the combination's DEGs. */
const DEG_CROSSTALK_HOPS = 0.5;

/** Target combination: DEGs of the first pathway each DEG of an added one talks to (the nearest). */
const DEG_CROSSTALK_LINKS = 2;

/**
 * Target combination: each DEG of an added pathway talks to the nearest DEGs
 * of the first (DEG_CROSSTALK_LINKS of them), and every DEG of the first
 * hears from at least one, so the two meet across all of the first's DEGs.
 */
function degCrosstalk(scene: Scene, nodes: NodeGeom[]): EdgeGeom[] {
  const [first, ...added] = [...degsByPathway(nodes).values()];
  if (!first || !added.length) return [];
  const d = (a: NodeGeom, b: NodeGeom) => Math.hypot(a.x - b.x, a.y - b.y);
  const pairs = new Map<string, [NodeGeom, NodeGeom]>();
  for (const a of added.flat()) {
    for (const b of [...first].sort((x, y) => d(a, x) - d(a, y)).slice(0, DEG_CROSSTALK_LINKS)) pairs.set(`${a.id}|${b.id}`, [a, b]);
  }
  for (const b of first) {
    if ([...pairs.values()].some(([, x]) => x === b)) continue;
    const a = added.flat().reduce((near, x) => (d(x, b) < d(near, b) ? x : near));
    pairs.set(`${a.id}|${b.id}`, [a, b]);
  }
  return [...pairs.values()].map(([a, b]) => ({ ...makeEdge(scene, a, b, true, rngFor(scene.seed, 'deg-crosstalk', a.id, b.id)), hops: DEG_CROSSTALK_HOPS }));
}

/**
 * Target combination: the added pathway, simpler than the first so the two
 * stay clear of each other where they meet: one cytoplasm row fewer, a
 * protein fewer in each of its three deepest rows (3-2-2 from 4-4-3-3), and
 * fewer branches and merges. The first pathway is tab 1's, unchanged.
 */
const memoSimpler = new WeakMap<Scene, Scene>();
/** A pathway's layers less its last cytoplasm row (when it has more than one). */
function oneRowFewer(layers: LayerSpec[]): LayerSpec[] {
  const cyto = layers.map((l, i) => (i > 0 && l.region === 'cytoplasm' ? i : -1)).filter((i) => i >= 0);
  return cyto.length > 1 ? layers.filter((_, i) => i !== cyto[cyto.length - 1]) : layers;
}
export function withSimplerAdded(scene: Scene): Scene {
  const hit = memoSimpler.get(scene);
  if (hit) return hit;
  const out = {
    ...scene,
    pathways: scene.pathways.map((p, i) => (i === 0 ? p : {
      ...p,
      branching: Math.min(p.branching, 0.15),
      convergence: Math.min(p.convergence, 0.15),
      layers: oneRowFewer(p.layers).map((l, li, ls) => {
        if (li === 0 || li < ls.length - 3) return l;
        const n = Math.max(1, l.nodeCount - 1);
        return { ...l, nodeCount: n, activeCount: Math.min(l.activeCount, n) };
      }),
    })),
  };
  memoSimpler.set(scene, out);
  return out;
}

/**
 * The module's view of a scene's geometry. Pure: new node, edge and receptor
 * objects where anything changes, the input untouched.
 *
 * - Tabs 1–3: every active protein and line of the pathway, always on in the
 *   gradient, carrying a pulse from the receptor to the DEGs.
 * - Toxicity: one DEG of each pathway is marked toxic, and everything off the
 *   main route into it fades back.
 * - Drug targets: each pathway's own receptor is marked.
 */
export function applyModule(scene: Scene, g: SceneGeom): SceneGeom {
  const m = scene.module;
  const kind = m.kind;
  if (!TRACED.includes(kind)) return g;

  let nodes = g.nodes;
  const crosstalk = kind === 'combination' ? degCrosstalk(scene, g.nodes) : [];
  let edges: EdgeGeom[] = [...g.edges, ...crosstalk].map((e) => ({ ...e, traced: true }));
  if (kind === 'toxicity') {
    const toxic = new Set([...degsByPathway(nodes).values()].map((list) => list[list.length - 1].id));
    nodes = nodes.map((n) => (toxic.has(n.id) ? { ...n, toxic: true } : n));
    // The route into the toxic DEG stands out; everything else fades back.
    const route = toxicRoute(edges, toxic);
    edges = edges.map((e) => (route.edges.has(e.id) ? e : { ...e, dim: OFF_ROUTE }));
    nodes = nodes.map((n) => (route.nodes.has(n.id) ? n : { ...n, dim: OFF_ROUTE }));
  }

  let receptors = g.receptors;
  if (m.markTargets) {
    // A pathway's own receptor, not a relay receptor or a decorative one.
    const own = (r: ReceptorGeom) => r.pathwayId !== null && r.id === `receptor-${r.pathwayId}`;
    receptors = receptors.map((r) => (own(r) ? { ...r, target: true } : r));
  }

  let discoverSpan = g.discoverSpan;
  if (kind === 'combination' && m.seqPart) ({ nodes, edges, receptors, discoverSpan } = buildOut(nodes, edges, receptors));

  return { ...g, nodes, edges, receptors, discoverSpan, nodeById: new Map(nodes.map((n) => [n.id, n])) };
}

/** Opacity of the network off the route to the toxic DEG (target toxicity). */
const OFF_ROUTE = 0.28;
/** Inputs each protein on that route keeps (the shortest lines into it). */
const ROUTE_INPUTS = 2;

/**
 * The route into the toxic DEG: back from it, layer by layer, each protein on
 * the route keeping its ROUTE_INPUTS shortest incoming lines, out to the
 * receptor. (Following every line back would take in nearly the whole
 * pathway, which is densely wired.)
 */
function toxicRoute(edges: EdgeGeom[], toxic: Set<string>) {
  const nodes = new Set(toxic);
  const kept = new Set<string>();
  const into = new Map<string, EdgeGeom[]>();
  for (const e of edges) if (!e.crosstalk) into.set(e.to, [...(into.get(e.to) ?? []), e]);
  const queue = [...toxic];
  while (queue.length) {
    const id = queue.shift()!;
    for (const e of [...(into.get(id) ?? [])].sort((a, b) => a.length - b.length).slice(0, ROUTE_INPUTS)) {
      kept.add(e.id);
      if (!nodes.has(e.from)) (nodes.add(e.from), queue.push(e.from));
    }
  }
  return { nodes, edges: kept };
}

/**
 * The sequence's combination scene: the added pathways build out from where
 * they meet the first one (the DEG crosstalk, in the nucleus) back to their
 * receptor, a layer at a time, as discovery (0–1) runs. Each edge grows from
 * its DEG end; each node pops up as its edge reaches it; the receptor last.
 */
function buildOut(nodes: NodeGeom[], edges: EdgeGeom[], receptors: ReceptorGeom[]) {
  const first = nodes.find((n) => n.layer === 0)?.pathwayId;
  const added = (pid: string | null) => pid !== null && pid !== first;
  const last = Math.max(0, ...nodes.filter((n) => added(n.pathwayId)).map((n) => n.layer));
  const steps = last + 2; // the crosstalk, then each layer back to the receptor
  const at = (step: number) => step / steps;
  const layerOf = new Map(nodes.map((n) => [n.id, n.layer]));
  return {
    discoverSpan: 1 / steps,
    nodes: nodes.map((n) => (added(n.pathwayId) ? { ...n, discoverAt: at(last - n.layer + 1) } : n)),
    edges: edges.map((e) => {
      if (e.crosstalk && added(e.pathwayId)) return { ...e, discoverAt: at(0), growBack: true };
      if (!added(e.pathwayId)) return e;
      return { ...e, discoverAt: at(last - (layerOf.get(e.to) ?? last) + 1), growBack: true };
    }),
    receptors: receptors.map((r) => (added(r.pathwayId) ? { ...r, discoverAt: at(last + 1) } : r)),
  };
}
