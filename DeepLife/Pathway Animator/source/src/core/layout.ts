import { makeOutline, outlineNormal } from './outline';
import { hash, rngFor, signed } from './rng';
import type { NodeGeom, Outline, Pathway, ReceptorGeom, Scene, Vec2 } from './types';

/** Reference short side: style sizes in the Scene are pixels at 1080px. */
export const REFERENCE_SHORT_SIDE = 1080;

const TAU = Math.PI * 2;
const polar = (c: Vec2, r: number, th: number): Vec2 => ({ x: c.x + Math.cos(th) * r, y: c.y + Math.sin(th) * r });
const angleOf = (from: Vec2, to: Vec2) => Math.atan2(to.y - from.y, to.x - from.x);
const dist = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y);

/** Screen angle (radians) of pathway i; rotation 0 puts the first pathway at the top. */
export function pathwayAngle(scene: Scene, i: number): number {
  const n = Math.max(1, scene.pathwayCount);
  return ((scene.rotation - 90 + (i * 360) / n) * Math.PI) / 180;
}

export interface CellFrame {
  scale: number;
  center: Vec2;
  R: number;
  cell: Outline;
  nucleus: Outline;
}

export function cellFrame(scene: Scene): CellFrame {
  const { width, height } = scene.canvas;
  const S = Math.min(width, height);
  const scale = S / REFERENCE_SHORT_SIDE;
  const center = { x: width / 2, y: height / 2 };
  const R = scene.cell.radius * S;
  const cell = makeOutline(center, R, scene.cell.wobble, hash(scene.seed, 'membrane'));
  const nc = { x: center.x + scene.nucleus.offset.x * R, y: center.y + scene.nucleus.offset.y * R };
  const nucleus = makeOutline(nc, R * scene.nucleus.radiusRatio, scene.nucleus.wobble, hash(scene.seed, 'nucleus'));
  return { scale, center, R, cell, nucleus };
}

/** Point on an outline in the direction θ from its own centre. */
const onOutline = (o: Outline, th: number) => polar(o.center, o.radiusAt(th), th);

export function receptorAt(frame: CellFrame, scene: Scene, phi: number, id: string, pathwayId: string | null): ReceptorGeom {
  const center = onOutline(frame.cell, phi);
  const n = outlineNormal(frame.cell, phi);
  const { length, width } = scene.style.receptorSize;
  const inset = Math.max(0, (length / 2 - width / 2)) * frame.scale;
  return {
    id,
    pathwayId,
    center,
    angle: Math.atan2(-n.y, -n.x),
    inner: { x: center.x - n.x * inset, y: center.y - n.y * inset },
  };
}

/** Decorative receptors fill the gaps between pathways, evenly with a little seeded jitter. */
export function decorativeReceptors(frame: CellFrame, scene: Scene): ReceptorGeom[] {
  const n = Math.max(1, scene.pathwayCount);
  const total = Math.max(0, Math.round(scene.cell.decorativeReceptors));
  const out: ReceptorGeom[] = [];
  const gap = TAU / n;
  for (let g = 0; g < n; g++) {
    const count = Math.floor(total / n) + (g < total % n ? 1 : 0);
    const start = pathwayAngle(scene, g);
    for (let j = 0; j < count; j++) {
      const rng = rngFor(scene.seed, 'decorative', g, j, count);
      const slot = gap / (count + 1);
      const phi = start + slot * (j + 1) + signed(rng, slot * 0.28);
      out.push(receptorAt(frame, scene, phi, `receptor-deco-${g + 1}-${j + 1}`, null));
    }
  }
  return out;
}

export interface PathwayLayout {
  receptor: ReceptorGeom;
  nodes: NodeGeom[];
  layers: NodeGeom[][];
  /** Tangential spacing used per layer, for connection weighting. */
  spacing: number[];
  warnings: string[];
}

/**
 * Lays out one pathway in polar coordinates around the nucleus centre (the
 * point the pathway axis heads for), so rows curve with the cell. Each row is
 * seeded on its own, so editing one layer never moves another.
 */
export function layoutPathway(frame: CellFrame, scene: Scene, pathway: Pathway, index: number): PathwayLayout {
  const { R, scale, cell, nucleus } = frame;
  const N = nucleus.center;
  const phi = pathwayAngle(scene, index);
  const receptor = receptorAt(frame, scene, phi, `receptor-${pathway.id}`, pathway.id);
  const warnings: string[] = [];

  const thAxis = angleOf(N, receptor.center);
  // Rows are spaced from a nominal point just inside the membrane, not from the
  // receptor's inner end, so resizing receptors never moves the network.
  const rhoReceptor = dist(N, receptor.center) - 0.05 * R;
  const rhoNucEdge = nucleus.radiusAt(thAxis);

  const layers = pathway.layers;
  const L = layers.length;
  const cytoIdx = layers.map((l, i) => (i > 0 && l.region === 'cytoplasm' ? i : -1)).filter((i) => i >= 0);
  const nucIdx = layers.map((l, i) => (i > 0 && l.region === 'nucleus' ? i : -1)).filter((i) => i >= 0);

  // Radial row positions (distance from the nucleus centre).
  const rows = new Array<number>(L).fill(rhoReceptor);
  const stepC = (rhoReceptor - rhoNucEdge) / (cytoIdx.length + 1);
  cytoIdx.forEach((li, k) => (rows[li] = rhoReceptor - stepC * (k + 1)));
  const depth = Math.max(0.1, Math.min(0.95, scene.nucleus.layerDepth));
  const stepN = Math.min(1.6 * stepC, (rhoNucEdge * depth) / Math.max(0.5, nucIdx.length - 0.5));
  nucIdx.forEach((li, k) => (rows[li] = rhoNucEdge - stepN * (k + 0.5)));
  const stepOf = (li: number) => (layers[li].region === 'nucleus' ? stepN : stepC);

  const n = Math.max(1, scene.pathwayCount);
  const maxSpan = n === 1 ? 2.3 : Math.min(2.0, (0.84 * TAU) / n);
  // Deep rows sit on a flatter arc than the nucleus-centred one, so they bend
  // gently instead of curling round the centre. Fewer pathways, more room.
  const minArc = (0.5 * R) / n;
  const baseSpacing = (n === 1 ? 0.2 : 0.15) * R;
  const minSpacing = 0.07 * R;
  const pad = 0.035 * R + scene.style.haloRadius * scale;

  const out: NodeGeom[][] = [];
  const spacing: number[] = [];
  const mk = (li: number, j: number, p: Vec2, active: boolean): NodeGeom => {
    const rho = dist(p, N);
    return {
      id: `${pathway.id}-L${li + 1}-N${j + 1}`,
      pathwayId: pathway.id,
      layer: li,
      depth: L > 1 ? li / (L - 1) : 0,
      x: p.x,
      y: p.y,
      active,
      region: layers[li].region,
      flow: rho > 1e-6 ? { x: (N.x - p.x) / rho, y: (N.y - p.y) / rho } : { x: 0, y: 1 },
      rho,
    };
  };

  out.push([mk(0, 0, receptor.inner, true)]);
  spacing.push(baseSpacing);

  for (let li = 1; li < L; li++) {
    const spec = layers[li];
    const m = Math.max(1, Math.min(10, Math.round(spec.nodeCount)));
    const rowRng = rngFor(pathway.seed, 'row', li);
    const rho0 = Math.max(rows[li], 0.05 * R);
    const arc = Math.max(rho0, minArc);
    // Arc centre: on the axis, behind the nucleus centre when the arc is flattened.
    const arcC = polar(N, rho0 - arc, thAxis);
    const step = stepOf(li);

    let sp = baseSpacing * (0.88 + 0.24 * rowRng());
    if (m > 1) {
      const avail = (arc * maxSpan) / (m - 1);
      if (avail < sp) sp = avail;
      if (sp < minSpacing) {
        sp = minSpacing;
        warnings.push(`Pathway ${index + 1}, layer ${li + 1} is crowded: fewer nodes or pathways will read better.`);
      }
    }
    spacing.push(sp);

    const bend = signed(rowRng, 0.3);
    const tilt = signed(rowRng, 0.14);
    const shift = signed(rowRng, 0.22) * sp;

    // Tangential (arc-length) and radial coordinates per node.
    const pts = [];
    for (let j = 0; j < m; j++) {
      const r = rngFor(pathway.seed, 'node', li, j);
      const u = m > 1 ? (2 * j) / (m - 1) - 1 : 0;
      const t = (j - (m - 1) / 2) * sp + shift + signed(r, 0.15 * sp);
      const rad = rho0 + (bend * (u * u - 1 / 3) + tilt * u + signed(r, 0.1)) * step;
      pts.push({ t, rad, u });
    }
    // Minimum distance between neighbours in a row.
    const minGap = 0.62 * sp;
    for (let it = 0; it < 6; it++) {
      for (let j = 1; j < m; j++) {
        const d = pts[j].t - pts[j - 1].t;
        if (d < minGap) {
          const push = (minGap - d) / 2;
          pts[j - 1].t -= push;
          pts[j].t += push;
        }
      }
    }

    // Active nodes: seeded, biased toward the centre of the row.
    const activeCount = Math.max(0, Math.min(m, Math.round(spec.activeCount)));
    const aRng = rngFor(pathway.seed, 'active', li, m);
    const keyed = pts.map((p, j) => ({ j, key: aRng() ** (1 / (1 - 0.55 * p.u * p.u)) }));
    keyed.sort((a, b) => b.key - a.key);
    const activeSet = new Set(keyed.slice(0, activeCount).map((k) => k.j));

    const row: NodeGeom[] = [];
    pts.forEach((p, j) => {
      const q0 = polar(arcC, arc + (p.rad - rho0), thAxis + p.t / arc);
      const th = angleOf(N, q0);
      let rho = dist(N, q0);
      // Containment, adjusting only the radial coordinate.
      if (spec.region === 'nucleus') {
        rho = Math.min(rho, nucleus.radiusAt(th) - pad);
        rho = Math.max(rho, 0.02 * R);
      } else {
        rho = Math.max(rho, nucleus.radiusAt(th) + pad);
        for (let k = 0; k < 8; k++) {
          const q = polar(N, rho, th);
          const thC = angleOf(cell.center, q);
          const limit = cell.radiusAt(thC) - pad;
          const over = dist(cell.center, q) - limit;
          if (over <= 0) break;
          rho -= over;
        }
      }
      row.push(mk(li, j, polar(N, rho, th), activeSet.has(j)));
    });
    out.push(row);
  }

  return { receptor, nodes: out.flat(), layers: out, spacing, warnings };
}
