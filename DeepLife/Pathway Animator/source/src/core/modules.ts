import { middleCellId, suggestedDetailScale } from './cellMap';
import { reverseEdge } from './connect';
import { defaultCellMap, defaultModule, defaultScene, makePathway } from './defaults';
import { ZOOM_VIEWS } from './layout';
import { organicTissue } from './organic';
import { rngFor, type Rng } from './rng';
import type { CellMap, EdgeGeom, ModuleKind, NodeGeom, ReceptorGeom, Scene, SceneGeom } from './types';

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
    blurb: 'The signal uncovers the routes from a DEG in the nucleus to the receptor, then flows back and forth along them. The rest of the network stays dimmed.',
  },
  {
    kind: 'combination',
    label: 'Target combination',
    blurb: 'The signalling pathway of tab 1 and one more: two receptors, each with its own route to the nucleus.',
  },
  {
    kind: 'toxicity',
    label: 'Target toxicity',
    blurb: 'The same receptor as tab 1, a different signalling pathway, ending at a different dot in the nucleus: the red one, which pulses.',
  },
  {
    kind: 'tissue',
    label: 'Tissue-level target ID',
    blurb: 'Indication extension: the same cell at the centre of a tissue, its signal passing on into neighbouring cells.',
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
];

export const moduleInfo = (kind: ModuleKind): ModuleInfo =>
  MODULES.find((m) => m.kind === kind) ?? { kind, label: 'Pathway', blurb: 'The standard animator.' };

/** The views that show one cell on its own (and, with an uploaded map, only its selected cell). */
/** The tabs that trace routes through the network. */
export const TRACED: ModuleKind[] = ['moa', 'combination', 'toxicity'];

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
  // The tissue view is zoomed in on the selected cell, two cells showing beyond it.
  if (kind === 'tissue') return { ...scene, cellMap: { ...base, centerHero: true, rings: 2, startShare: 0, relayHops: 4, detailScale: fit(scene) } };
  if (kind === 'journey') return { ...scene, cellMap: { ...base, startShare: 0, relayHops: 4, detailScale: fit(scene) } };
  if (kind === 'crossTissue') {
    // A new map: the default split (right half in the second colour) applies again.
    return { ...scene, module: { ...scene.module, pinkCells: null }, cellMap: { ...base, startShare: 0, relayHops: 8, detailScale: fit(scene) } };
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
  // Wide enough to fill a landscape canvas, with room for two tissues.
  const map = organicTissue(seed, 40, 1.75);
  const probe = { ...scene, cellMap: { ...defaultCellMap(), viewBox: map.viewBox, cells: map.cells } };
  return withTissueMap(scene, map, middleCellId(probe) ?? map.cells[0]?.id ?? '');
}

/** Each zoomable tab's starting zoom: the single cell about half the canvas across, the tissue's centre cell a third. */
const DEFAULT_ZOOM: Partial<Record<ModuleKind, number>> = {
  moa: 0.6, combination: 0.6, toxicity: 0.6, tissue: 0.75,
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
    // Tabs 1–4: a square canvas, zoomed out so the cells round the centre cell show.
    s.canvas = { ...s.canvas, width: 2000, height: 2000 };
    s.module.zoom = DEFAULT_ZOOM[kind] ?? 1;
    if (kind !== 'tissue') s.cell.neighbours = { ...s.cell.neighbours, show: true };
  }
  if (kind === 'combination') {
    // Tab 1's pathway and one more, hit together.
    s.pathwayCount = 2;
    s.pathways = [0, 1].map((i) => ({ ...makePathway(seed, i, s.pathways[0].layers), startDelay: 0 }));
  }
  // Motion that never stops, so the network keeps moving over the video.
  if (kind === 'realCell') s.animation = { ...s.animation, continuous: true };
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

/** How many active DEGs the first pathway has (the range of the traced DEG control). */
export function degCount(scene: Scene): number {
  const layers = scene.pathways[0]?.layers ?? [];
  return Math.max(1, layers[layers.length - 1]?.activeCount ?? 1);
}

interface Traced { nodes: Set<string>; edges: Set<string> }

/**
 * Walk back from a DEG to its receptor, one incoming edge at a time. Later
 * routes prefer proteins not yet used, so they show other ways the signal can
 * arrive; `avoid` is a trace this one should differ from wherever it can.
 */
function traceRoutes(deg: string, into: Map<string, EdgeGeom[]>, routes: number, rng: Rng, avoid?: Traced): Traced {
  const nodes = new Set([deg]);
  const edges = new Set<string>();
  for (let r = 0; r < routes; r++) {
    let id = deg;
    for (let guard = 0; guard < 16; guard++) {
      const ins = into.get(id) ?? [];
      if (!ins.length) break;
      const newEdge = ins.filter((e) => !avoid?.edges.has(e.id));
      const fresh = newEdge.filter((e) => !nodes.has(e.from));
      const pool = [fresh.filter((e) => !avoid?.nodes.has(e.from)), fresh, newEdge, ins].find((p) => p.length)!;
      const e = pool[Math.floor(rng() * pool.length)];
      edges.add(e.id);
      nodes.add(e.from);
      id = e.from;
    }
  }
  return { nodes, edges };
}

/**
 * The module's view of a scene's geometry. Pure: new node, edge and receptor
 * objects where anything changes, the input untouched.
 *
 * - Traced routes (tabs 1–3): one to three routes into one DEG (receptor → one
 *   protein per layer → DEG) stay lit; the rest of the network is dimmed and
 *   carries no signal.
 * - Toxicity: the route ends at a different DEG, marked toxic, and takes
 *   different proteins from the route of tab 1 wherever it can.
 * - Drug targets: each pathway's own receptor is marked.
 */
export function applyModule(scene: Scene, g: SceneGeom): SceneGeom {
  const m = scene.module;
  const kind = m.kind;
  const toxicity = kind === 'toxicity';
  const traced = toxicity || (TRACED.includes(kind) && m.focusDeg > 0);
  const mark = m.markTargets && TRACED.includes(kind);
  if (!traced && !mark) return g;

  let nodes = g.nodes;
  let edges = g.edges;
  let pathways = g.pathways;

  if (traced) {
    const into = new Map<string, EdgeGeom[]>();
    for (const e of edges) {
      if (e.crosstalk || e.link) continue;
      const list = into.get(e.to) ?? [];
      list.push(e);
      into.set(e.to, list);
    }
    const route = new Set<string>();
    const routeEdges = new Set<string>();
    const startOf = new Map<string, string>(); // pathway → the DEG the trace starts from
    const toxicIds = new Set<string>();
    const routes = Math.max(1, Math.min(3, Math.round(m.routes)));
    const focusDeg = Math.max(1, m.focusDeg);
    for (const [pid, list] of degsByPathway(nodes)) {
      // An added pathway of the combination ends at the DEG straight ahead of its receptor, clear of the first.
      const added = kind === 'combination' && pid !== g.pathways[0]?.id;
      const ahead = [...list].sort((a, b) => Math.abs(a.lateral) - Math.abs(b.lateral))[0];
      const focus = added ? ahead : list[Math.min(focusDeg, list.length) - 1];
      let target = focus;
      let found = traceRoutes(focus.id, into, routes, rngFor(scene.seed, 'route', pid, focusDeg));
      if (toxicity) {
        // The DEG furthest along the row from the one tab 1 traces.
        target = focus === list[list.length - 1] ? list[0] : list[list.length - 1];
        toxicIds.add(target.id);
        found = traceRoutes(target.id, into, routes, rngFor(scene.seed, 'toxic-route', pid), found);
      }
      startOf.set(pid, target.id);
      found.nodes.forEach((id) => route.add(id));
      found.edges.forEach((id) => routeEdges.add(id));
    }
    // The signal starts at the DEG and first travels the route in reverse to
    // the receptor. The route is not there to begin with: its edges are drawn
    // as the signal passes, and each node pops up when it is reached (the DEG
    // itself is known from the start).
    const starts = new Set(startOf.values());
    nodes = nodes.map((n) => {
      if (!n.active) return n;
      if (!route.has(n.id)) return { ...n, dim: true };
      if (starts.has(n.id)) return toxicIds.has(n.id) ? { ...n, toxic: true } : n;
      return { ...n, reveal: true };
    });
    edges = edges.map((e) => (routeEdges.has(e.id) ? { ...reverseEdge(e), reveal: true } : { ...e, dim: true }));
    pathways = pathways.map((p) => (startOf.has(p.id) ? { ...p, start: startOf.get(p.id) } : p));
  }

  let receptors = g.receptors;
  if (mark) {
    // A pathway's own receptor, not a relay receptor or a decorative one.
    const own = (r: ReceptorGeom) => r.pathwayId !== null && r.id === `receptor-${r.pathwayId}`;
    receptors = receptors.map((r) => (own(r) ? { ...r, target: true } : r));
  }

  return { ...g, nodes, edges, receptors, pathways, nodeById: new Map(nodes.map((n) => [n.id, n])) };
}
