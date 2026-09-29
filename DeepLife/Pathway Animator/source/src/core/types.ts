export type Region = 'membrane' | 'cytoplasm' | 'nucleus';
export type ReceptorStyle = 'capsule' | 'diamond' | 'capsuleDiamond';
export type OutlineStyle = 'line' | 'glow';

/** How an outline is drawn: a plain line, or a bright rim with light fading inward. */
export interface OutlineLook {
  outlineStyle: OutlineStyle;
  glowWidth: number; // px at 1080: how far the rim glow reaches inward
  glowColor: string; // the inner glow
  edgeColor: string; // the bright rim
}

export interface Vec2 {
  x: number;
  y: number;
}

export interface LayerSpec {
  region: Region;
  nodeCount: number; // 1–10 (receptor layer fixed at 1)
  activeCount: number; // ≤ nodeCount
}

export interface Pathway {
  id: string;
  seed: number;
  layers: LayerSpec[]; // layers[0] is always the receptor
  branching: number; // 0–1 → fan-out 1–4
  convergence: number; // 0–1, likelihood of merging branches
  locked: boolean; // "Regenerate all" skips locked pathways
  startDelay: number; // seconds
}

export interface AnimationSettings {
  layerDuration: number; // seconds per layer hop
  nucleusSpeedFactor: number;
  easing: 'linear' | 'easeInOut';
  pathwayStagger: number; // default delay between pathways
  trailLength: number; // fraction of edge length
  cometSize: number;
  glow: number; // 0–1
  litEdgeOpacity: number;
  nodePulseScale: number;
  holdAtEnd: number; // seconds; in continuous mode, how long an edge stays lit after its comet
  loop: boolean;
  continuous: boolean; // never-ending motion: a seamless loop that always has a signal running
  density: number; // 0–1, continuous mode: how much of the signal overlaps itself
}

export interface Scene {
  version: 1;
  name: string;
  seed: number;
  canvas: { width: number; height: number; background: string };
  cell: OutlineLook & {
    visible: boolean;
    radius: number; // fraction of min(canvas w,h)
    wobble: number; // 0–1, low-frequency outline noise
    strokeWidth: number;
    color: string;
    decorativeReceptors: number; // inactive capsules, 0–12
    showDecorativeReceptors: boolean;
  };
  nucleus: OutlineLook & {
    visible: boolean;
    radiusRatio: number; // relative to cell radius
    offset: { x: number; y: number }; // fraction of cell radius
    wobble: number;
    strokeWidth: number;
    color: string;
    layerDepth: number; // 0–1, how deep into the nucleus the last layer sits
  };
  style: {
    edgeWidth: number; // THE "line thickness" control (px at 1080 short side)
    edgeOpacity: { min: number; max: number };
    edgeCurvature: number; // 0 = gentle, 1 = full S-curve
    gradientStops: string[];
    activeNodeRadius: number;
    haloRadius: number;
    haloColor: string;
    inactiveNodeColor: string;
    inactiveNodeRadius: number;
    receptorStyle: ReceptorStyle;
    greyIdle: boolean; // idle pathways drawn grey; a pathway lights up while a signal runs through it
    idleOpacity: number; // 0–1, how visible idle pathways stay
    receptorSize: { length: number; width: number };
  };
  pathwayCount: number; // 1–5, placed around the cell
  spacingVariation: number; // 0 = evenly spaced round the cell, 1 = most uneven
  rotation: number; // degrees, 0 = top, clockwise
  sameLayersForAll: boolean; // pathways share layer structure (count and regions); node counts stay per pathway
  pathways: Pathway[];
  crosstalk: { enabled: boolean; amount: number };
  animation: AnimationSettings;
  cellMap: CellMap;
}

/** One cell of an imported map. Coordinates are flat x,y pairs in the map's own units. */
export interface MapCell {
  id: string; // 'c1', 'c2'… in reading order
  membrane: number[];
  nucleus: number[] | null; // null: a nucleus is made from the membrane shape
  enabled: boolean; // has pathways (click a cell in the preview to toggle)
  seed: number; // per-cell variation of the shared pathway settings
}

/** A cluster of cells imported from an SVG, drawn instead of the single cell. */
export interface CellMap {
  enabled: boolean;
  name: string; // source file name
  viewBox: { x: number; y: number; width: number; height: number };
  cells: MapCell[];
  detailScale: number; // 0.2–1: node, line, receptor and glow size relative to the single cell
  stagger: number; // seconds: each cell starts at a random offset within this
  orient: boolean; // turn each cell's pathways toward its widest cytoplasm (else a random turn)
  links: { enabled: boolean; amount: number }; // links per pair of touching cells, 0–3
  relayHops: number; // how many cells in a row a relayed signal can re-trigger (0: arrivals only pulse)
  startShare: number; // 0–1: share of pathways that start on their own; the rest fire only when relayed
  variation: number; // 0–1: how much node and layer counts vary from cell to cell
}

// ---- Derived geometry (regenerated from the Scene, never stored) ----

export interface NodeGeom {
  id: string;
  pathwayId: string;
  layer: number;
  depth: number; // 0 at the receptor, 1 at the final layer
  x: number;
  y: number;
  active: boolean;
  region: Region;
  /** Unit vector of local signal flow (toward the centre of the node's row arc). */
  flow: Vec2;
  /** Signed radial coordinate rows are laid out on; decreases toward (and past) the nucleus centre. */
  rho: number;
  /** Signed arc-length position across the node's row (0 on the pathway axis). */
  lateral: number;
}

export type Bezier = [Vec2, Vec2, Vec2, Vec2];

export interface EdgeGeom {
  id: string;
  from: string;
  to: string;
  pathwayId: string;
  crosstalk: boolean;
  bezier: Bezier;
  length: number;
  /** Cumulative arc length at evenly spaced t samples, for constant-speed travel. */
  lut: Float32Array;
  opacity: number;
  depthFrom: number;
  depthTo: number;
  /** A cell-to-cell link into a neighbour's relay receptor (cell maps). */
  link?: boolean;
}

export interface ReceptorGeom {
  id: string;
  pathwayId: string | null; // null for decorative receptors
  center: Vec2; // on the membrane line
  angle: number; // radians, direction of the inward normal
  inner: Vec2; // inner end, where edges start
  /** The receptor node this capsule belongs to (pathway and relay receptors). */
  nodeId?: string;
}

export interface Outline {
  center: Vec2;
  /** Sample points of the closed curve (drawn as a smooth spline through them). */
  points: Vec2[];
  radiusAt: (theta: number) => number;
}

/** A cell's outlines as drawn: the single cell, or one cell of a map. */
export interface CellGeom {
  id: string; // '' for the single cell
  cell: Outline;
  nucleus: Outline;
  enabled: boolean;
}

export interface SceneGeom {
  scale: number;
  cell: Outline;
  nucleus: Outline;
  /** Every cell to draw (one in single-cell mode). */
  cells: CellGeom[];
  /**
   * Every pathway laid out, with its effective start delay (cell offsets
   * included). A pathway with `relayOnly` never starts on its own: it fires
   * only when a relay from a neighbouring cell reaches it.
   */
  pathways: { id: string; startDelay: number; relayOnly?: boolean }[];
  receptors: ReceptorGeom[];
  nodes: NodeGeom[];
  nodeById: Map<string, NodeGeom>;
  edges: EdgeGeom[];
  warnings: string[];
}
