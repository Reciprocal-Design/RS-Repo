import { arcLengthLut } from './bezier';
import { delaunay } from './delaunay';
import { REFERENCE_SHORT_SIDE } from './layout';
import { pointInPolygon } from './polygon';
import { hash, range, rngFor, signed } from './rng';
import type { Bezier, EdgeGeom, NodeGeom, OrganId, Outline, Scene, SceneGeom, Vec2 } from './types';

// The body view: a human outline drawn like a cell membrane, organs drawn
// like nuclei, and the same firing lines between them, out along the limbs
// to the hands and feet. A faint wireframe mesh and a field of particles,
// lit as the signal passes, give it the density of the cell views.

/**
 * Front-view silhouette, right half, from the top of the head round the
 * outside of the arm and leg and back up the inside to the crotch, in body
 * units (height 1, x = 0 on the midline). Mirrored for the left half.
 */
const HALF: [number, number][] = [
  [0.022, 0.004], [0.036, 0.014], [0.043, 0.03], [0.045, 0.05], // crown
  [0.047, 0.062], [0.051, 0.07], [0.047, 0.08], // ear
  [0.043, 0.09], [0.038, 0.105], [0.03, 0.117], // jaw
  [0.029, 0.13], [0.033, 0.143], // neck
  [0.05, 0.152], [0.075, 0.164], [0.1, 0.173], [0.118, 0.182], // trapezius to shoulder
  [0.13, 0.197], [0.136, 0.22], [0.139, 0.26], [0.146, 0.29], // deltoid, upper arm
  [0.149, 0.32], [0.156, 0.36], [0.163, 0.4], [0.165, 0.44], // elbow, forearm
  [0.162, 0.48], [0.165, 0.52], [0.163, 0.55], [0.155, 0.575], [0.145, 0.585], // wrist, hand
  [0.135, 0.578], [0.13, 0.565], [0.124, 0.54], [0.126, 0.5], // thumb side, inner wrist
  [0.12, 0.45], [0.111, 0.41], [0.106, 0.36], [0.096, 0.325], [0.088, 0.305], // inner arm to the armpit
  [0.08, 0.32], [0.073, 0.35], [0.069, 0.38], // flank, waist
  [0.072, 0.42], [0.082, 0.46], [0.09, 0.495], [0.094, 0.53], [0.095, 0.57], // hip
  [0.093, 0.61], [0.089, 0.66], [0.087, 0.71], // thigh, knee
  [0.093, 0.75], [0.098, 0.79], [0.094, 0.84], [0.087, 0.89], [0.085, 0.93], // calf, ankle
  [0.093, 0.955], [0.106, 0.98], [0.108, 0.993], [0.09, 1.0], [0.06, 1.0], // foot
  [0.045, 0.99], [0.043, 0.96], [0.044, 0.92], // heel, inner ankle
  [0.041, 0.88], [0.033, 0.83], [0.027, 0.78], [0.024, 0.72], // inner calf, knee
  [0.017, 0.67], [0.01, 0.62], [0.005, 0.585], [0.002, 0.55], // inner thigh
];

export const SILHOUETTE: Vec2[] = [
  { x: 0, y: 0 },
  ...HALF.map(([x, y]) => ({ x, y })),
  { x: 0, y: 0.528 },
  ...[...HALF].reverse().map(([x, y]) => ({ x: -x, y })),
];

/**
 * Anatomy lines (body units, cubic Bézier control points; right side, mirrored
 * unless on the midline), drawn as soft highlights that model the form like
 * light catching a 3D figure: collarbones, sternum, chest, ribs, the V of the
 * hips, shoulders, elbows, knees and shins. `s` is how bright each one is.
 */
const ANATOMY: { pts: [number, number][]; s: number; mid?: boolean }[] = [
  { pts: [[0.012, 0.16], [0.04, 0.152], [0.075, 0.158], [0.108, 0.176]], s: 1 }, // collarbone
  { pts: [[0, 0.175], [0, 0.21], [0, 0.25], [0, 0.29]], s: 0.6, mid: true }, // sternum
  { pts: [[0.112, 0.258], [0.1, 0.287], [0.05, 0.298], [0.014, 0.284]], s: 1 }, // chest
  { pts: [[0.068, 0.3], [0.06, 0.33], [0.052, 0.36], [0.046, 0.385]], s: 0.55 }, // ribs
  { pts: [[0.076, 0.44], [0.062, 0.47], [0.036, 0.5], [0.014, 0.518]], s: 0.8 }, // hips
  { pts: [[0.104, 0.19], [0.113, 0.215], [0.118, 0.245], [0.121, 0.275]], s: 0.7 }, // shoulder
  { pts: [[0.13, 0.31], [0.136, 0.325], [0.142, 0.335], [0.15, 0.34]], s: 0.5 }, // elbow
  { pts: [[0.038, 0.7], [0.05, 0.716], [0.064, 0.718], [0.078, 0.706]], s: 0.7 }, // knee
  { pts: [[0.062, 0.75], [0.06, 0.79], [0.058, 0.84], [0.057, 0.89]], s: 0.45 }, // shin
];

interface OrganSpec {
  id: OrganId;
  label: string;
  /** One or two lobes (lungs, kidneys): centre and radii in body units. */
  lobes: { c: [number, number]; r: [number, number] }[];
  /** Nodes inside each lobe besides its hub. */
  nodes: number;
}

export const ORGANS: OrganSpec[] = [
  { id: 'brain', label: 'Brain', lobes: [{ c: [0, 0.056], r: [0.032, 0.033] }], nodes: 9 },
  { id: 'lungs', label: 'Lungs', lobes: [{ c: [-0.05, 0.235], r: [0.026, 0.05] }, { c: [0.05, 0.235], r: [0.026, 0.05] }], nodes: 6 },
  { id: 'heart', label: 'Heart', lobes: [{ c: [0.01, 0.266], r: [0.017, 0.016] }], nodes: 4 },
  { id: 'liver', label: 'Liver', lobes: [{ c: [-0.028, 0.325], r: [0.04, 0.02] }], nodes: 6 },
  { id: 'stomach', label: 'Stomach', lobes: [{ c: [0.036, 0.33], r: [0.02, 0.017] }], nodes: 4 },
  { id: 'kidneys', label: 'Kidneys', lobes: [{ c: [-0.04, 0.37], r: [0.011, 0.016] }, { c: [0.04, 0.37], r: [0.011, 0.016] }], nodes: 3 },
  { id: 'intestines', label: 'Intestines', lobes: [{ c: [0, 0.43], r: [0.05, 0.04] }], nodes: 9 },
  { id: 'bladder', label: 'Bladder', lobes: [{ c: [0, 0.495], r: [0.016, 0.012] }], nodes: 2 },
];

/** Organ-to-organ connections (by lobe hub: organ id, or organ id + lobe index; `neck` is a relay node). */
const LINKS: [string, string][] = [
  ['brain', 'neck'], ['neck', 'heart'], ['heart', 'lungs0'], ['heart', 'lungs1'], ['heart', 'liver'],
  ['heart', 'stomach'], ['liver', 'stomach'], ['liver', 'intestines'], ['stomach', 'intestines'],
  ['heart', 'kidneys0'], ['heart', 'kidneys1'], ['liver', 'kidneys0'], ['kidneys0', 'bladder'],
  ['kidneys1', 'bladder'], ['intestines', 'bladder'], ['neck', 'lungs0'], ['neck', 'lungs1'],
];

/** Vessels and nerves out along the limbs (right side; mirrored), from a hub to the hand or foot. */
const CHAINS: { from: string; pts: [number, number][] }[] = [
  { from: 'heart', pts: [[0.08, 0.19], [0.112, 0.215], [0.118, 0.26], [0.122, 0.31], [0.13, 0.36], [0.137, 0.41], [0.142, 0.46], [0.144, 0.51], [0.143, 0.555]] },
  { from: 'bladder', pts: [[0.045, 0.535], [0.049, 0.6], [0.052, 0.67], [0.056, 0.73], [0.062, 0.8], [0.065, 0.87], [0.065, 0.93], [0.078, 0.975]] },
];

/** Body units → canvas pixels: the body fills 90% of the canvas height, centred. */
export function bodyTransform(scene: Scene) {
  const { width: W, height: H } = scene.canvas;
  const h = 0.9 * H;
  const top = (H - h) / 2;
  return { h, map: (x: number, y: number): Vec2 => ({ x: W / 2 + x * h, y: top + y * h }) };
}

/** An outline through the given points (radiusAt about their centroid, for completeness). */
function outlineOf(points: Vec2[]): Outline {
  const c = points.reduce((a, p) => ({ x: a.x + p.x / points.length, y: a.y + p.y / points.length }), { x: 0, y: 0 });
  const angles = points.map((p) => Math.atan2(p.y - c.y, p.x - c.x));
  const radii = points.map((p) => Math.hypot(p.x - c.x, p.y - c.y));
  return {
    center: c,
    points,
    radiusAt: (th) => {
      let best = 0, d = Infinity;
      angles.forEach((a, i) => {
        const x = Math.abs(Math.atan2(Math.sin(th - a), Math.cos(th - a)));
        if (x < d) (d = x), (best = i);
      });
      return radii[best];
    },
  };
}

/** A softly irregular ellipse. */
function lobeOutline(c: Vec2, rx: number, ry: number, seed: number): Outline {
  const rng = rngFor(seed, 'lobe');
  const ph = [rng() * 6.28, rng() * 6.28];
  const pts: Vec2[] = [];
  for (let i = 0; i < 32; i++) {
    const th = (i / 32) * Math.PI * 2;
    const k = 1 + 0.06 * Math.sin(2 * th + ph[0]) + 0.04 * Math.sin(3 * th + ph[1]);
    pts.push({ x: c.x + Math.cos(th) * rx * k, y: c.y + Math.sin(th) * ry * k });
  }
  return outlineOf(pts);
}

/** A gently bent curve from a to b; `hops` scales its travel time with its length. */
function bodyEdge(scene: Scene, a: NodeGeom, b: NodeGeom, hops: number, crosstalk: boolean, bendAmp = 0.22): EdgeGeom {
  const rng = rngFor(scene.seed, 'body-edge', a.id, b.id);
  const d = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const ux = (b.x - a.x) / d, uy = (b.y - a.y) / d;
  const bend = signed(rng, bendAmp) * d;
  const bezier: Bezier = [
    { x: a.x, y: a.y },
    { x: a.x + ux * d * 0.33 - uy * bend, y: a.y + uy * d * 0.33 + ux * bend },
    { x: b.x - ux * d * 0.33 - uy * bend * 0.6, y: b.y - uy * d * 0.33 + ux * bend * 0.6 },
    { x: b.x, y: b.y },
  ];
  const lut = arcLengthLut(bezier);
  const { min, max } = scene.style.edgeOpacity;
  return {
    id: `${crosstalk ? 'xt' : 'e'}-${a.id}-to-${b.id}`, from: a.id, to: b.id, pathwayId: 'body', crosstalk, bezier,
    length: lut[lut.length - 1], lut, opacity: range(rng, Math.min(min, max), Math.max(min, max)),
    depthFrom: a.depth, depthTo: b.depth, hops,
  };
}

const makeNode = (id: string, p: Vec2): NodeGeom => ({
  id, pathwayId: 'body', layer: 1, depth: 0, x: p.x, y: p.y, active: true, region: 'cytoplasm',
  flow: { x: 0, y: 1 }, rho: 0, lateral: 0,
});

const lobeKey = (o: OrganSpec, i: number) => (o.lobes.length > 1 ? `${o.id}${i}` : o.id);

/** The organ hub a journey zooms out of (canvas pixels). */
export function organCenter(scene: Scene, organ: OrganId): Vec2 {
  const spec = ORGANS.find((o) => o.id === organ) ?? ORGANS[2];
  const { map } = bodyTransform(scene);
  const n = spec.lobes.length;
  return map(spec.lobes.reduce((a, l) => a + l.c[0], 0) / n, spec.lobes.reduce((a, l) => a + l.c[1], 0) / n);
}

const PARTICLES = 2600;
const MESH_SPACING = 0.022;
/** Body units a lit wave travels per second, out from each network node into the particles round it. */
const WAVE_SPEED = 0.12;

const insideBody = (p: Vec2, margin: number) =>
  pointInPolygon(p, SILHOUETTE) &&
  [[margin, 0], [-margin, 0], [0, margin], [0, -margin]].every(([dx, dy]) => pointInPolygon({ x: p.x + dx, y: p.y + dy }, SILHOUETTE));

/**
 * The body as geometry the schedule and renderer already understand: the
 * outline is the one cell (no nucleus), organs are extra outlines, and the
 * network (organ hubs and the nodes round them, a relay in the neck, chains
 * out along each limb) is one pathway. The signal starts at the chosen
 * organ's hub and spreads outward: every connection runs from the end nearer
 * the start, and colour follows how far the signal has come.
 */
export function buildBodyGeometry(scene: Scene): SceneGeom {
  const { h, map } = bodyTransform(scene);
  const scale = (Math.min(scene.canvas.width, scene.canvas.height) / REFERENCE_SHORT_SIDE) * 0.65;
  const body = outlineOf(SILHOUETTE.map((p) => map(p.x, p.y)));
  const seed = scene.seed;

  // ---- Network nodes and undirected connections ----
  const nodes: NodeGeom[] = [];
  const byKey = new Map<string, NodeGeom>();
  const add = (key: string, x: number, y: number) => {
    const n = makeNode(`body-${key}`, map(x, y));
    nodes.push(n);
    byKey.set(key, n);
  };
  const links: { a: string; b: string; hops: number; bend?: number }[] = [];
  const organs: Outline[] = [];

  for (const o of ORGANS) {
    o.lobes.forEach((l, i) => {
      const key = lobeKey(o, i);
      add(key, l.c[0], l.c[1]);
      organs.push(lobeOutline(map(l.c[0], l.c[1]), l.r[0] * h, l.r[1] * h, hash(seed, 'organ', key)));
      // Nodes inside the organ on two rings: inner ones fed from the hub,
      // each outer one from the inner node before it.
      const rng = rngFor(seed, 'organ-nodes', key);
      for (let j = 0; j < o.nodes; j++) {
        const outer = j % 2 === 1;
        const th = ((j + rng() * 0.7) / o.nodes) * Math.PI * 2;
        const ring = outer ? 0.75 : 0.42;
        add(`${key}-${j + 1}`, l.c[0] + Math.cos(th) * l.r[0] * ring, l.c[1] + Math.sin(th) * l.r[1] * ring);
        links.push(outer ? { a: `${key}-${j}`, b: `${key}-${j + 1}`, hops: 0.4 } : { a: key, b: `${key}-${j + 1}`, hops: 0.5 });
      }
    });
  }
  add('neck', 0, 0.15);
  for (const [a, b] of LINKS) links.push({ a, b, hops: 0 });
  for (const side of [1, -1]) {
    CHAINS.forEach((ch, ci) => {
      let prev = ch.from;
      ch.pts.forEach(([x, y], j) => {
        const k = `limb${ci}${side > 0 ? 'r' : 'l'}-${j + 1}`;
        add(k, side * x, y);
        links.push({ a: prev, b: k, hops: 0, bend: 0.08 });
        prev = k;
      });
    });
  }

  // ---- Direction and colour: hop distance from the start ----
  const source = ORGANS.find((o) => o.id === scene.module.organ) ?? ORGANS[2];
  const startKeys = source.lobes.map((_, i) => lobeKey(source, i));
  const adj = new Map<string, string[]>();
  for (const { a, b } of links) {
    adj.set(a, [...(adj.get(a) ?? []), b]);
    adj.set(b, [...(adj.get(b) ?? []), a]);
  }
  const dist = new Map<string, number>(startKeys.map((k) => [k, 0]));
  const queue = [...startKeys];
  while (queue.length) {
    const k = queue.shift()!;
    for (const m of adj.get(k) ?? []) if (!dist.has(m)) dist.set(m, dist.get(k)! + 1), queue.push(m);
  }
  const maxD = Math.max(1, ...dist.values());
  for (const [k, n] of byKey) n.depth = 0.9 * ((dist.get(k) ?? maxD) / maxD);

  const unit = 0.08 * h; // a typical organ-to-organ hop
  const edges: EdgeGeom[] = [];
  for (const { a, b, hops, bend } of links) {
    const da = dist.get(a) ?? Infinity, db = dist.get(b) ?? Infinity;
    const [from, to] = da <= db ? [a, b] : [b, a];
    const A = byKey.get(from)!, B = byKey.get(to)!;
    const len = Math.hypot(B.x - A.x, B.y - A.y);
    // Connections between nodes equally far from the start run alongside, like crosstalk.
    edges.push(bodyEdge(scene, A, B, hops || Math.max(0.5, Math.min(2.5, len / unit)), da === db, bend));
  }

  const anatomy: NonNullable<SceneGeom['anatomy']> = [];
  for (const a of ANATOMY) {
    for (const side of a.mid ? [1] : [1, -1]) anatomy.push({ b: a.pts.map(([x, y]) => map(side * x, y)) as Bezier, strength: a.s });
  }
  const detail = bodyDetail(`${seed}|${scene.canvas.width}|${scene.canvas.height}|${source.id}`, () => detailFor(seed, h, map, nodes));
  return {
    scale,
    cell: body,
    nucleus: body,
    cells: [{ id: 'body', cell: body, nucleus: body, enabled: true, noNucleus: true }],
    organs,
    outlineScale: scale * 0.55,
    particles: scene.module.bodyParticles ? detail.particles : undefined,
    mesh: scene.module.bodyMesh ? detail.mesh : undefined,
    anatomy,
    bodyFill: true,
    // The glow reaches 1.5–8.5% of the body's height in from the outline.
    glowDepth: (0.015 + 0.07 * Math.max(0, Math.min(1, scene.module.bodyGlow))) * h,
    pathways: startKeys.map((k) => ({ id: 'body', startDelay: 0, start: byKey.get(k)!.id })),
    receptors: [],
    nodes,
    nodeById: new Map(nodes.map((n) => [n.id, n])),
    edges,
    warnings: [],
  };
}

/**
 * Particles and wireframe depend only on the seed, canvas and network (not
 * on style), so they are kept for the last few of those: style edits stay quick.
 */
const detailCache = new Map<string, { particles: NonNullable<SceneGeom['particles']>; mesh: Float32Array }>();
function bodyDetail(key: string, make: () => { particles: NonNullable<SceneGeom['particles']>; mesh: Float32Array }) {
  let hit = detailCache.get(key);
  if (!hit) {
    hit = make();
    detailCache.set(key, hit);
    if (detailCache.size > 8) detailCache.delete(detailCache.keys().next().value!);
  }
  return hit;
}

function detailFor(seed: number, h: number, map: (x: number, y: number) => Vec2, nodes: NodeGeom[]) {
  // ---- Particles: denser in the torso, each lit from its nearest node ----
  const rng = rngFor(seed, 'body-particles');
  const particles: NonNullable<SceneGeom['particles']> = [];
  for (let tries = 0; particles.length < PARTICLES && tries < PARTICLES * 12; tries++) {
    const p = { x: range(rng, -0.17, 0.17), y: rng() };
    const torso = p.y > 0.15 && p.y < 0.56 && Math.abs(p.x) < 0.1;
    if (rng() > (torso ? 1 : 0.55) || !insideBody(p, 0.004)) continue;
    const q = map(p.x, p.y);
    let near = nodes[0], d = Infinity;
    for (const n of nodes) {
      const dd = Math.hypot(n.x - q.x, n.y - q.y);
      if (dd < d) (d = dd), (near = n);
    }
    particles.push({
      x: q.x,
      y: q.y,
      r: 0.6 + 1.7 * rng() ** 3,
      tone: Math.min(0.999, Math.max(0, near.depth + signed(rng, 0.25))),
      node: near.id,
      delay: d / h / WAVE_SPEED,
    });
  }

  // ---- Wireframe: a triangulation of points inside the body and along its outline ----
  const mrng = rngFor(seed, 'body-mesh');
  const mpts: Vec2[] = [];
  for (let i = 0; i < SILHOUETTE.length; i++) {
    const a = SILHOUETTE[i], b = SILHOUETTE[(i + 1) % SILHOUETTE.length];
    const steps = Math.max(1, Math.round(Math.hypot(b.x - a.x, b.y - a.y) / MESH_SPACING));
    for (let s = 0; s < steps; s++) mpts.push({ x: a.x + ((b.x - a.x) * s) / steps, y: a.y + ((b.y - a.y) * s) / steps });
  }
  for (let tries = 0; tries < 6000; tries++) {
    const p = { x: range(mrng, -0.17, 0.17), y: mrng() };
    if (!insideBody(p, 0.006)) continue;
    if (mpts.every((q) => (q.x - p.x) ** 2 + (q.y - p.y) ** 2 > MESH_SPACING ** 2)) mpts.push(p);
  }
  const seen = new Set<string>();
  const segs: number[] = [];
  for (const [a, b, c] of delaunay(mpts)) {
    const P = mpts[a], Q = mpts[b], R = mpts[c];
    // Keep triangles inside the body, not across the gaps between the arms and torso, or the legs.
    if (!pointInPolygon({ x: (P.x + Q.x + R.x) / 3, y: (P.y + Q.y + R.y) / 3 }, SILHOUETTE)) continue;
    for (const [u, v] of [[a, b], [b, c], [c, a]]) {
      const k = u < v ? `${u},${v}` : `${v},${u}`;
      if (seen.has(k)) continue;
      seen.add(k);
      const U = map(mpts[u].x, mpts[u].y), V = map(mpts[v].x, mpts[v].y);
      segs.push(U.x, U.y, V.x, V.y);
    }
  }

  return { particles, mesh: new Float32Array(segs) };
}
