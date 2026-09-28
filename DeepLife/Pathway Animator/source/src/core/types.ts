export type Region = 'membrane' | 'cytoplasm' | 'nucleus';
export type ReceptorStyle = 'capsule' | 'diamond' | 'capsuleDiamond';

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
  holdAtEnd: number;
  loop: boolean;
}

export interface Scene {
  version: 1;
  name: string;
  seed: number;
  canvas: { width: number; height: number; background: string };
  cell: {
    visible: boolean;
    radius: number; // fraction of min(canvas w,h)
    wobble: number; // 0–1, low-frequency outline noise
    strokeWidth: number;
    color: string;
    decorativeReceptors: number; // inactive capsules, 0–12
    showDecorativeReceptors: boolean;
  };
  nucleus: {
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
    receptorSize: { length: number; width: number };
  };
  pathwayCount: number; // 1–5, placed evenly around the cell
  rotation: number; // degrees, 0 = top, clockwise
  sameLayersForAll: boolean;
  pathways: Pathway[];
  crosstalk: { enabled: boolean; amount: number };
  animation: AnimationSettings;
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
}

export interface ReceptorGeom {
  id: string;
  pathwayId: string | null; // null for decorative receptors
  center: Vec2; // on the membrane line
  angle: number; // radians, direction of the inward normal
  inner: Vec2; // inner end, where edges start
}

export interface Outline {
  center: Vec2;
  /** Sample points of the closed curve (drawn as a smooth spline through them). */
  points: Vec2[];
  radiusAt: (theta: number) => number;
}

export interface SceneGeom {
  scale: number;
  cell: Outline;
  nucleus: Outline;
  receptors: ReceptorGeom[];
  nodes: NodeGeom[];
  nodeById: Map<string, NodeGeom>;
  edges: EdgeGeom[];
  warnings: string[];
}
