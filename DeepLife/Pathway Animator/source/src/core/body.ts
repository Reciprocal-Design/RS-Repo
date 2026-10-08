import { arcLengthLut } from './bezier';
import { REFERENCE_SHORT_SIDE } from './layout';
import { hash, range, rngFor, signed } from './rng';
import type { Bezier, EdgeGeom, NodeGeom, OrganId, Outline, Scene, SceneGeom, Vec2 } from './types';

// The body view: a human outline drawn like a cell membrane, a few organs
// drawn like nuclei, and the same firing lines between them, so organ-level
// connectivity reads in the same visual language as the cell's pathways.

/**
 * Front-view silhouette, right half, top of the head to the crotch, in body
 * units (height 1, x = 0 on the midline). Mirrored for the left half.
 */
const HALF: [number, number][] = [
  [0.03, 0.006], [0.045, 0.03], [0.048, 0.06], [0.043, 0.09], [0.033, 0.112], // head
  [0.026, 0.13], [0.03, 0.148], [0.07, 0.16], [0.11, 0.172], [0.128, 0.19], // neck, shoulder
  [0.135, 0.23], [0.142, 0.29], [0.152, 0.35], [0.165, 0.41], [0.175, 0.44], // arm, outside
  [0.172, 0.475], [0.158, 0.49], [0.145, 0.475], [0.14, 0.44], // hand
  [0.125, 0.38], [0.112, 0.31], [0.1, 0.25], [0.088, 0.225], // arm, inside, to the armpit
  [0.085, 0.27], [0.078, 0.33], [0.085, 0.4], [0.097, 0.46], [0.098, 0.52], // torso, hip
  [0.092, 0.6], [0.08, 0.7], [0.074, 0.78], [0.066, 0.88], [0.058, 0.95], // leg, outside
  [0.07, 0.985], [0.055, 1.0], [0.03, 0.995], // foot
  [0.026, 0.95], [0.03, 0.86], [0.026, 0.75], [0.02, 0.63], [0.012, 0.545], // leg, inside
];

export const SILHOUETTE: Vec2[] = [
  { x: 0, y: 0 },
  ...HALF.map(([x, y]) => ({ x, y })),
  { x: 0, y: 0.53 },
  ...[...HALF].reverse().map(([x, y]) => ({ x: -x, y })),
];

interface OrganSpec {
  id: OrganId;
  label: string;
  /** One or two lobes (lungs, kidneys): centre and radii in body units. */
  lobes: { c: [number, number]; r: [number, number] }[];
  /** Small nodes inside each lobe besides its hub. */
  nodes: number;
}

export const ORGANS: OrganSpec[] = [
  { id: 'brain', label: 'Brain', lobes: [{ c: [0, 0.056], r: [0.032, 0.033] }], nodes: 4 },
  { id: 'lungs', label: 'Lungs', lobes: [{ c: [-0.05, 0.235], r: [0.026, 0.05] }, { c: [0.05, 0.235], r: [0.026, 0.05] }], nodes: 3 },
  { id: 'heart', label: 'Heart', lobes: [{ c: [0, 0.262], r: [0.017, 0.016] }], nodes: 2 },
  { id: 'liver', label: 'Liver', lobes: [{ c: [-0.03, 0.318], r: [0.042, 0.02] }], nodes: 3 },
  { id: 'stomach', label: 'Stomach', lobes: [{ c: [0.038, 0.322], r: [0.022, 0.018] }], nodes: 2 },
  { id: 'kidneys', label: 'Kidneys', lobes: [{ c: [-0.042, 0.362], r: [0.012, 0.017] }, { c: [0.042, 0.362], r: [0.012, 0.017] }], nodes: 1 },
  { id: 'intestines', label: 'Intestines', lobes: [{ c: [0, 0.415], r: [0.05, 0.038] }], nodes: 4 },
  { id: 'bladder', label: 'Bladder', lobes: [{ c: [0, 0.478], r: [0.016, 0.012] }], nodes: 1 },
];

/** Organ-to-organ connections (by lobe hub: organ id, or organ id + lobe index). */
const LINKS: [string, string][] = [
  ['brain', 'heart'], ['heart', 'lungs0'], ['heart', 'lungs1'], ['heart', 'liver'], ['heart', 'stomach'],
  ['liver', 'stomach'], ['liver', 'intestines'], ['stomach', 'intestines'], ['heart', 'kidneys0'],
  ['heart', 'kidneys1'], ['liver', 'kidneys0'], ['kidneys0', 'bladder'], ['kidneys1', 'bladder'],
  ['intestines', 'bladder'], ['brain', 'lungs0'], ['brain', 'lungs1'],
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
function bodyEdge(scene: Scene, a: NodeGeom, b: NodeGeom, hops: number, crosstalk: boolean): EdgeGeom {
  const rng = rngFor(scene.seed, 'body-edge', a.id, b.id);
  const d = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const ux = (b.x - a.x) / d, uy = (b.y - a.y) / d;
  const bend = signed(rng, 0.22) * d;
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

const node = (id: string, p: Vec2, depth: number): NodeGeom => ({
  id, pathwayId: 'body', layer: 1, depth, x: p.x, y: p.y, active: true, region: 'cytoplasm',
  flow: { x: 0, y: 1 }, rho: 0, lateral: 0,
});

/** The organ hub a journey zooms out of (canvas pixels). */
export function organCenter(scene: Scene, organ: OrganId): Vec2 {
  const spec = ORGANS.find((o) => o.id === organ) ?? ORGANS[2];
  const { map } = bodyTransform(scene);
  const n = spec.lobes.length;
  return map(spec.lobes.reduce((a, l) => a + l.c[0], 0) / n, spec.lobes.reduce((a, l) => a + l.c[1], 0) / n);
}

/**
 * The body as geometry the schedule and renderer already understand: the
 * outline is the one cell (no nucleus), organs are extra outlines, and every
 * organ lobe has a hub and a few nodes. The signal starts at the chosen
 * organ's hub and spreads organ to organ along the connections, outward
 * (an edge runs from the organ nearer the start), coloured by how far it
 * has travelled.
 */
export function buildBodyGeometry(scene: Scene): SceneGeom {
  const { h, map } = bodyTransform(scene);
  const scale = (Math.min(scene.canvas.width, scene.canvas.height) / REFERENCE_SHORT_SIDE) * 0.65;
  const body = outlineOf(SILHOUETTE.map((p) => map(p.x, p.y)));

  // Hubs: one per lobe.
  const hubs = new Map<string, Vec2>();
  const organs: Outline[] = [];
  for (const o of ORGANS) {
    o.lobes.forEach((l, i) => {
      const key = o.lobes.length > 1 ? `${o.id}${i}` : o.id;
      hubs.set(key, map(l.c[0], l.c[1]));
      organs.push(lobeOutline(map(l.c[0], l.c[1]), l.r[0] * h, l.r[1] * h, hash(scene.seed, 'organ', key)));
    });
  }
  const source = ORGANS.find((o) => o.id === scene.module.organ) ?? ORGANS[2];
  const sourceKey = source.lobes.length > 1 ? `${source.id}0` : source.id;

  // Hop distance of every hub from the start, along the connections.
  const adj = new Map<string, string[]>();
  for (const [a, b] of LINKS) {
    adj.set(a, [...(adj.get(a) ?? []), b]);
    adj.set(b, [...(adj.get(b) ?? []), a]);
  }
  const dist = new Map<string, number>([[sourceKey, 0]]);
  const queue = [sourceKey];
  // Two-lobed organs start from both lobes.
  if (source.lobes.length > 1) {
    dist.set(`${source.id}1`, 0);
    queue.push(`${source.id}1`);
  }
  while (queue.length) {
    const k = queue.shift()!;
    for (const m of adj.get(k) ?? []) if (!dist.has(m)) dist.set(m, dist.get(k)! + 1), queue.push(m);
  }
  const maxD = Math.max(1, ...dist.values());
  const depthOf = (k: string) => 0.85 * ((dist.get(k) ?? maxD) / maxD);

  const nodes: NodeGeom[] = [];
  const edges: EdgeGeom[] = [];
  const hubNode = new Map<string, NodeGeom>();
  for (const o of ORGANS) {
    o.lobes.forEach((l, i) => {
      const key = o.lobes.length > 1 ? `${o.id}${i}` : o.id;
      const hub = node(`body-${key}`, hubs.get(key)!, depthOf(key));
      hubNode.set(key, hub);
      nodes.push(hub);
      // A few nodes inside the organ, fed from its hub.
      const rng = rngFor(scene.seed, 'organ-nodes', key);
      for (let j = 0; j < o.nodes; j++) {
        const th = ((j + rng() * 0.6) / o.nodes) * Math.PI * 2;
        const p = map(l.c[0] + Math.cos(th) * l.r[0] * 0.6, l.c[1] + Math.sin(th) * l.r[1] * 0.6);
        const n = node(`body-${key}-${j + 1}`, p, Math.min(1, hub.depth + 0.12));
        nodes.push(n);
        edges.push(bodyEdge(scene, hub, n, 0.5, false));
      }
    });
  }
  const unit = 0.08 * h; // a typical organ-to-organ hop
  for (const [a, b] of LINKS) {
    const da = dist.get(a) ?? Infinity, db = dist.get(b) ?? Infinity;
    const [from, to] = da <= db ? [a, b] : [b, a];
    const A = hubNode.get(from)!, B = hubNode.get(to)!;
    const len = Math.hypot(B.x - A.x, B.y - A.y);
    // Links between organs equally far from the start run alongside, like crosstalk.
    edges.push(bodyEdge(scene, A, B, Math.max(0.6, Math.min(2.5, len / unit)), da === db));
  }

  const starts = source.lobes.map((_, i) => hubNode.get(source.lobes.length > 1 ? `${source.id}${i}` : source.id)!);
  return {
    scale,
    cell: body,
    nucleus: body,
    cells: [{ id: 'body', cell: body, nucleus: body, enabled: true, noNucleus: true }],
    organs,
    outlineScale: scale * 0.55,
    pathways: starts.map((n) => ({ id: 'body', startDelay: 0, start: n.id })),
    receptors: [],
    nodes,
    nodeById: new Map(nodes.map((n) => [n.id, n])),
    edges,
    warnings: [],
  };
}
