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
  module: ModuleSettings;
}

/**
 * The client's views of one pathway, one per tab. Each module changes how the
 * same network is shown; 'custom' shows it unchanged.
 */
export type ModuleKind = 'targetId' | 'moa' | 'combination' | 'toxicity' | 'tissue' | 'custom' | 'body' | 'journey';

/** Organs of the body view (core/body.ts). */
export type OrganId = 'brain' | 'lungs' | 'heart' | 'liver' | 'stomach' | 'kidneys' | 'intestines' | 'bladder';

export interface ModuleSettings {
  kind: ModuleKind;
  /** Target ID, target combination: only the receptor and its DEGs, joined directly. */
  directOnly: boolean;
  /** Ring each pathway receptor as a drug target. */
  markTargets: boolean;
  targetColor: string;
  /** MOA elucidation: the DEG whose route is traced (1 = leftmost active DEG; 0 = every DEG). */
  focusDeg: number;
  /** MOA elucidation: how many routes into the DEG are traced (1–3), each one protein per layer. */
  routes: number;
  /** MOA elucidation: how visible the proteins off the traced route stay, 0–1. */
  dimOpacity: number;
  /** Target toxicity: how many DEGs of each pathway are toxic. */
  toxicDegs: number;
  /** Target toxicity: the colour the cell and toxic DEGs turn. */
  toxicColor: string;
  /** Target toxicity: a warning badge on the membrane as the cell turns. */
  warning: boolean;
  /** Where the badge sits on the membrane: degrees, 0 = top, clockwise. */
  warningAngle: number;
  /** Body and journey: the organ the signal starts from (and the journey zooms out of). */
  organ: OrganId;
  /** Journey: seconds per section (cell, cell → tissue, tissue, tissue → body, body). */
  sectionLength: number;
  /** Body: how far the glow reaches in from the outline, 0–1. */
  bodyGlow: number;
  /** Body: the wireframe mesh. */
  bodyMesh: boolean;
  /** Body: the particle field. */
  bodyParticles: boolean;
  /** Body: an image of a figure drawn instead of the outline (data URL; '' for none). */
  bodyImage: string;
  /** Body image placement: height as a share of the canvas, and offset (shares of the canvas). */
  imageScale: number;
  imageX: number;
  imageY: number;
  /** Network placement on the image: size, and offset (shares of the canvas), after the automatic fit. */
  netScale: number;
  netX: number;
  netY: number;
}

/** One cell of an imported map. Coordinates are flat x,y pairs in the map's own units. */
export interface MapCell {
  id: string; // 'c1', 'c2'… in reading order
  membrane: number[];
  nucleus: number[] | null; // null: a nucleus is made from the membrane shape
  enabled: boolean; // has pathways (click a cell in the preview to toggle)
  seed: number; // per-cell variation of the shared pathway settings
  hero?: boolean; // the single cell itself, at the centre of a tissue (`around` maps)
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
  links: { enabled: boolean; amount: number }; // links per pair of touching cells, 0–8
  relayHops: number; // how many cells in a row a relayed signal can re-trigger (0: arrivals only pulse)
  startShare: number; // 0–1: share of pathways that start on their own; the rest fire only when relayed
  variation: number; // 0–1: how much node and layer counts vary from cell to cell
  /**
   * A tissue around the single cell instead of an imported map: the cells
   * are generated from the scene (core/tissue.ts); `cells` only keeps each
   * cell's pathways on/off and seed by id. `detailScale` sizes the centre cell.
   */
  around: boolean;
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
  /** Off the traced route (MOA elucidation): drawn faint, never signalled. */
  dim?: boolean;
  /** A DEG that makes the cell toxic when it fires (target toxicity). */
  toxic?: boolean;
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
  /** Off the traced route (MOA elucidation): drawn faint, never signalled. */
  dim?: boolean;
  /** Layer hops this edge stands for (a direct receptor → DEG edge spans several); scales its travel time. */
  hops?: number;
}

export interface ReceptorGeom {
  id: string;
  pathwayId: string | null; // null for decorative receptors
  center: Vec2; // on the membrane line
  angle: number; // radians, direction of the inward normal
  inner: Vec2; // inner end, where edges start
  /** The receptor node this capsule belongs to (pathway and relay receptors). */
  nodeId?: string;
  /** Marked as a drug target. */
  target?: boolean;
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
  /** Draw no nucleus (the body outline). */
  noNucleus?: boolean;
}

export interface SceneGeom {
  scale: number;
  cell: Outline;
  nucleus: Outline;
  /** Every cell to draw (one in single-cell mode). */
  cells: CellGeom[];
  /** Extra outlines drawn in the nucleus style (the organs of the body view). */
  organs?: Outline[];
  /** Size of outline strokes and glows, when not `scale` (the body's narrow limbs take a thinner glow). */
  outlineScale?: number;
  /**
   * Body view detail: a field of particles (each lit by the signal reaching
   * its nearest network node, `delay` seconds later), a wireframe mesh
   * (segments x1,y1,x2,y2…) and open anatomy lines, drawn as soft highlights
   * that model the form. The body is filled, and its glow reaches `glowDepth`
   * pixels in from the outline.
   */
  particles?: { x: number; y: number; r: number; tone: number; node: string; delay: number }[];
  mesh?: Float32Array;
  anatomy?: { b: Bezier; strength: number }[];
  bodyFill?: boolean;
  glowDepth?: number;
  /** A body image drawn in place of the outline: its data URL and canvas rectangle. */
  image?: { src: string; x: number; y: number; w: number; h: number };
  /**
   * Every pathway laid out, with its effective start delay (cell offsets
   * included). A pathway with `relayOnly` never starts on its own: it fires
   * only when a relay from a neighbouring cell reaches it.
   */
  pathways: { id: string; startDelay: number; relayOnly?: boolean; start?: string }[];
  receptors: ReceptorGeom[];
  nodes: NodeGeom[];
  nodeById: Map<string, NodeGeom>;
  edges: EdgeGeom[];
  warnings: string[];
}
