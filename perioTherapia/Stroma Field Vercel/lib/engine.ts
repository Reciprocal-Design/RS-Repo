/* Stroma Field engine: tissue generation, the cursor-driven treatment model and the
   canvas renderer. Framework-free so the live page and the exporter share it.

   - Tissue: a seeded 84 × 84 grid. Each cell has a type (core colour), a density
     (dot size) and a collagen level (ring thickness and colour).
   - Treatment: moving the cursor delivers antibody. Exposure builds up under the
     cursor's path, dense collagen needs more passes, and the ring breaks apart as it
     opens. Tumour cells whose ring is open die back over the next few seconds, and
     about half are replaced by T cells. Exposure fades slowly, so untouched barriers
     grow back.
   - Everything is deterministic for a given seed and pointer path, so exports replay
     exactly. */

export const TAU = Math.PI * 2;
export const N = 84;
export const M = N * N;
export const UM = 20; // µm per grid step
export const LOOP = 6; // ambient motion period (s)
export const MAX_DOSE = 20; // mg/kg
export const DAYS_PER_S = 2;

export const clamp = (x: number, a: number, b: number) => (x < a ? a : x > b ? b : x);
export const sm = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

/* ---------- styles ---------- */
export type StyleName = "neon" | "clinical";
export type Theme = {
  bg: string;
  inner: string[]; // tumour, CAF, macrophage, T cell, vessel, dying
  fib: [string, string, string]; // loose → dense collagen
  outline: string; // tumour boundary
  ringAlpha: number;
  field: string; // background dots when the grid bleeds to the edges
};
export const THEMES: Record<StyleName, Theme> = {
  neon: {
    bg: "#06050c",
    inner: ["#ff2fd0", "#9b5cff", "#4f86ff", "#28efe0", "#7d8bff", "#6c4b78"],
    fib: ["#b6ff3b", "#ffd60a", "#ff6f1a"],
    outline: "rgba(236,226,255,.8)",
    ringAlpha: 0.96,
    field: "#5b4a9e",
  },
  clinical: {
    bg: "#cdcdd1",
    inner: ["#dd5fa6", "#977fe3", "#5c78e2", "#6aa6c9", "#a9b6ec", "#b3a5c4"],
    fib: ["#b0b1c1", "#7f8199", "#4d4f66"],
    outline: "rgba(196,64,140,.8)",
    ringAlpha: 0.85,
    field: "#93a6ee",
  },
};
export const PALETTE = { ink: THEMES.neon.bg, inner: THEMES.neon.inner };
const hex = (h: string) => {
  const n = parseInt(h.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const mixHex = (a: string, b: string, t: number) => {
  const A = hex(a), B = hex(b);
  return `rgb(${A.map((v, i) => Math.round(v + (B[i] - v) * t)).join(",")})`;
};
const FIB_LV = 6;
const fibScale = (th: Theme) =>
  Array.from({ length: FIB_LV }, (_, i) => {
    const t = i / (FIB_LV - 1);
    return t < 0.5 ? mixHex(th.fib[0], th.fib[1], t * 2) : mixHex(th.fib[1], th.fib[2], (t - 0.5) * 2);
  });
const FIB: Record<StyleName, string[]> = { neon: fibScale(THEMES.neon), clinical: fibScale(THEMES.clinical) };
const ALPHAS = [0.3, 0.55, 0.8, 1];

/* ---------- seeded noise ---------- */
export function mulberry32(a: number) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function makeNoise(rand: () => number) {
  const p = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) {
    const j = (rand() * (i + 1)) | 0;
    [p[i], p[j]] = [p[j], p[i]];
  }
  const perm = new Uint8Array(512);
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  const vals = new Float32Array(256);
  for (let i = 0; i < 256; i++) vals[i] = rand();
  const fade = (t: number) => t * t * (3 - 2 * t);
  const n2 = (x: number, y: number) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, X = xi & 255, Y = yi & 255;
    const a = vals[perm[perm[X] + Y]], b = vals[perm[perm[X + 1] + Y]];
    const c = vals[perm[perm[X] + Y + 1]], d = vals[perm[perm[X + 1] + Y + 1]];
    const u = fade(xf), v = fade(yf);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
  return (x: number, y: number, oct = 4) => {
    let s = 0, amp = 0.5, f = 1, norm = 0;
    for (let o = 0; o < oct; o++) {
      s += amp * n2(x * f + o * 17.3, y * f + o * 9.1);
      norm += amp;
      amp *= 0.5;
      f *= 2.03;
    }
    return s / norm;
  };
}
function rankNorm(a: Float32Array) {
  const idx = Array.from(a.keys()).sort((x, y) => a[x] - a[y]);
  const out = new Float32Array(a.length);
  idx.forEach((k, r) => (out[k] = r / (a.length - 1)));
  return out;
}

/* ---------- tissue ---------- */
export type Tissue = {
  seed: number;
  TY: Int8Array; // -1 empty, 0 tumour, 1 CAF, 2 macrophage, 3 T cell, 4 vessel
  RB: Float32Array; // base radius (fraction of grid pitch)
  FR: Float32Array; // radius of the background dot an empty cell gets in bleed mode
  C0: Float32Array; // collagen 0..1
  RES: Float32Array; // exposure needed to open the ring
  PH: Float32Array;
  RO: Float32Array;
  DIR: Int8Array;
  INF: Uint8Array; // tumour cell replaced by a T cell when it dies
  KR: Float32Array; // max kill (a few cells resist)
  FL: Uint8Array; // ring colour level
  TUM: Int32Array;
  RINGED: Int32Array;
  OUTLINE: Float32Array; // tumour boundary segments [x1, y1, x2, y2, ...] in grid units
  preT: number;
  sumC0: number;
};

export function generate(seed: number): Tissue {
  const rand = mulberry32(seed * 7919 + 13);
  const fbm = makeNoise(rand);
  const o = Array.from({ length: 18 }, () => rand() * 200);
  const f = () => new Float32Array(M);
  const env = f(), tn = f(), fr = f(), vr = f(), tex = f(), n1 = f(), n2 = f(), n3 = f();
  for (let j = 0; j < N; j++)
    for (let i = 0; i < N; i++) {
      const k = j * N + i, u = (i + 0.5) / N, v = (j + 0.5) / N, r = Math.hypot(u - 0.5, v - 0.5) * 2;
      env[k] = fbm(u * 1.7 + o[0], v * 1.7 + o[1], 4) - 0.32 * Math.max(0, r - 0.5);
      tn[k] = fbm(u * 2.5 + o[2], v * 2.5 + o[3], 4) + 0.18 * fbm(u * 7 + o[4], v * 7 + o[5], 2);
      fr[k] = 1 - Math.abs(2 * fbm(u * 3.1 + o[6], v * 3.1 + o[7], 4) - 1);
      vr[k] = 1 - Math.abs(2 * fbm(u * 2.2 + o[8], v * 2.2 + o[9], 3) - 1);
      tex[k] = fbm(u * 11 + o[10], v * 11 + o[11], 2);
      n1[k] = fbm(u * 6 + o[12], v * 6 + o[13], 2);
      n2[k] = fbm(u * 4.5 + o[14], v * 4.5 + o[15], 3);
      n3[k] = fbm(u * 5 + o[16], v * 5 + o[17], 3);
    }
  const E = rankNorm(env), TN = rankNorm(tn), FR = rankNorm(fr), VR = rankNorm(vr), TX = rankNorm(tex);
  const R1 = rankNorm(n1), R2 = rankNorm(n2), R3 = rankNorm(n3);

  const D = f(), C0 = f(), RIM = f();
  const TY = new Int8Array(M).fill(-1), RB = f();
  const isT = new Uint8Array(M), vessel = new Uint8Array(M), tissue = new Uint8Array(M);
  for (let k = 0; k < M; k++) {
    D[k] = clamp(clamp((E[k] - 0.17) / 0.5, 0, 1) * (0.7 + 0.6 * TX[k]), 0, 1);
    tissue[k] = D[k] > 0.08 ? 1 : 0;
    isT[k] = tissue[k] && TN[k] > 0.66 && D[k] > 0.2 ? 1 : 0;
    const rim = isT[k] ? 0 : sm(0.48, 0.66, TN[k]);
    RIM[k] = rim;
    const fib = sm(0.8, 0.985, FR[k]);
    C0[k] = tissue[k]
      ? clamp(0.06 + 0.85 * rim + 0.62 * fib + (isT[k] ? 0.22 + 0.25 * R1[k] : 0.1 * R1[k]), 0, 1) * sm(0.08, 0.3, D[k])
      : 0;
    vessel[k] = tissue[k] && !isT[k] && VR[k] > 0.958 && D[k] > 0.18 ? 1 : 0;
  }

  // distance to the nearest vessel (cells), for placing T cells near vessels
  const vd = new Float32Array(M).fill(1e9);
  const queue: number[] = [];
  for (let k = 0; k < M; k++) if (vessel[k]) (vd[k] = 0), queue.push(k);
  for (let qi = 0; qi < queue.length; qi++) {
    const k = queue[qi], x = k % N, y = (k / N) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
      const n = ny * N + nx;
      if (vd[n] > vd[k] + 1) (vd[n] = vd[k] + 1), queue.push(n);
    }
  }

  const PH = f(), RO = f(), KR = f(), RES = f();
  const DIR = new Int8Array(M), INF = new Uint8Array(M), FL = new Uint8Array(M);
  const TUM: number[] = [], RINGED: number[] = [];
  let preT = 0, sumC0 = 0;
  for (let k = 0; k < M; k++) {
    PH[k] = TAU * (2.2 * E[k] + 0.35 * rand());
    RO[k] = rand() * TAU;
    DIR[k] = rand() < 0.5 ? 1 : -1;
    KR[k] = 0.9 + 0.1 * rand();
    FL[k] = Math.min(FIB_LV - 1, Math.floor(C0[k] * FIB_LV));
    RES[k] = 0.35 + 1.6 * Math.pow(C0[k], 1.3);
    if (C0[k] > 0.04) RINGED.push(k);
    sumC0 += C0[k];
    const r = rand();
    if (tissue[k]) {
      if (vessel[k]) {
        TY[k] = 4;
        RB[k] = 0.1 + 0.05 * rand();
        continue;
      }
      if (isT[k]) {
        if (r < 0.06) TY[k] = 2;
        else if (r < 0.09) (TY[k] = 3), preT++;
        else (TY[k] = 0), TUM.push(k), (INF[k] = rand() < 0.55 ? 1 : 0);
        RB[k] = 0.14 + 0.22 * D[k];
        continue;
      }
      const sCaf = 0.3 + 0.75 * C0[k] + 0.35 * R1[k] + 0.25 * rand();
      const sMy = 0.12 + 0.85 * RIM[k] + 0.45 * R2[k] + 0.25 * rand();
      const sT = 0.95 * Math.exp(-vd[k] / 4.5) + 0.45 * R3[k] - 0.12 + 0.25 * rand();
      TY[k] = sCaf >= sMy && sCaf >= sT ? 1 : sMy >= sT ? 2 : 3;
      RB[k] = 0.1 + 0.25 * D[k];
    } else if (r < 0.2 * sm(-0.3, 0.08, D[k] - 0.1 + E[k] * 0.5)) {
      const q = rand();
      TY[k] = q < 0.4 ? 1 : q < 0.7 ? 2 : 3;
      RB[k] = 0.05 + 0.07 * rand();
    }
  }
  const FRB = new Float32Array(M);
  for (let k = 0; k < M; k++) FRB[k] = TY[k] < 0 ? 0.07 + 0.07 * TX[k] + 0.04 * clamp(D[k] / 0.08, 0, 1) : 0;
  return { seed, TY, RB, FR: FRB, C0, RES, PH, RO, DIR, INF, KR, FL, TUM: Int32Array.from(TUM), RINGED: Int32Array.from(RINGED), preT, sumC0, OUTLINE: tumourOutline(isT) };
}

/** Smooth contour around the tumour nests: marching squares over a blurred tumour mask. */
function tumourOutline(isT: Uint8Array) {
  let a = Float32Array.from(isT);
  for (let pass = 0; pass < 2; pass++) {
    const b = new Float32Array(M);
    for (let j = 0; j < N; j++)
      for (let i = 0; i < N; i++) {
        let sum = 0, n = 0;
        for (let dj = -1; dj <= 1; dj++)
          for (let di = -1; di <= 1; di++) {
            const x = i + di, y = j + dj;
            if (x < 0 || y < 0 || x >= N || y >= N) continue;
            sum += a[y * N + x];
            n++;
          }
        b[j * N + i] = sum / n;
      }
    a = b;
  }
  const v = (i: number, j: number) => a[j * N + i];
  const seg: number[] = [];
  const iso = 0.5;
  const lerp = (x0: number, y0: number, v0: number, x1: number, y1: number, v1: number) => {
    const t = (iso - v0) / (v1 - v0 || 1e-6);
    return [x0 + (x1 - x0) * t, y0 + (y1 - y0) * t];
  };
  for (let j = 0; j < N - 1; j++)
    for (let i = 0; i < N - 1; i++) {
      const tl = v(i, j), tr = v(i + 1, j), br = v(i + 1, j + 1), bl = v(i, j + 1);
      const c = (tl > iso ? 8 : 0) | (tr > iso ? 4 : 0) | (br > iso ? 2 : 0) | (bl > iso ? 1 : 0);
      if (c === 0 || c === 15) continue;
      const x = i + 0.5, y = j + 0.5;
      const top = lerp(x, y, tl, x + 1, y, tr), right = lerp(x + 1, y, tr, x + 1, y + 1, br);
      const bottom = lerp(x, y + 1, bl, x + 1, y + 1, br), left = lerp(x, y, tl, x, y + 1, bl);
      const add = (p: number[], q: number[]) => seg.push(p[0], p[1], q[0], q[1]);
      switch (c) {
        case 1: case 14: add(left, bottom); break;
        case 2: case 13: add(bottom, right); break;
        case 3: case 12: add(left, right); break;
        case 4: case 11: add(top, right); break;
        case 6: case 9: add(top, bottom); break;
        case 7: case 8: add(left, top); break;
        case 5: add(left, top); add(bottom, right); break;
        case 10: add(top, right); add(left, bottom); break;
      }
    }
  return Float32Array.from(seg);
}

/* ---------- treatment state ---------- */
const PULSES = 128;
const WAVE_SPEED = 9; // cells per second
export type Sim = {
  E: Float32Array; // antibody exposure
  BF: Float32Array; // ring remaining, 0.1..1
  K: Float32Array; // tumour kill, 0..1
  simT: number;
  lx: number; // last pointer position (grid units), NaN when absent
  ly: number;
  // ripples sent out from the cursor path; each opens the barrier as its front passes
  px: Float32Array; py: Float32Array; pt: Float32Array; pa: Float32Array; pr: Float32Array; prMax: Float32Array; prot: Float32Array;
  pNext: number;
  travel: number;
  rand: () => number;
  delivered: number;
};
export function createSim(T: Tissue): Sim {
  const f = () => new Float32Array(PULSES);
  return {
    E: new Float32Array(M), BF: new Float32Array(M).fill(1), K: new Float32Array(M),
    simT: 0, lx: NaN, ly: NaN,
    px: f(), py: f(), pt: f(), pa: f(), pr: f(), prMax: f(), prot: f(),
    pNext: 0, travel: 0, rand: mulberry32(T.seed * 31 + 5), delivered: 0,
  };
}
export function cloneSim(S: Sim): Sim {
  return { ...S, E: S.E.slice(), BF: S.BF.slice(), K: S.K.slice(), pa: new Float32Array(PULSES), rand: mulberry32(1) };
}
/** Advance the treatment by dt seconds. pointer is in grid units, or null when the cursor is away. */
export function stepSim(T: Tissue, S: Sim, dt: number, pointer: { x: number; y: number } | null, dose: number) {
  const d01 = clamp(dose / MAX_DOSE, 0, 1);
  S.simT += dt;
  if (pointer && Number.isFinite(S.lx)) {
    const dx = pointer.x - S.lx, dy = pointer.y - S.ly;
    const travel = Math.min(4, Math.hypot(dx, dy));
    if (d01 > 0 && travel > 0.002) {
      S.travel += travel;
      S.delivered += travel * d01;
      // drop a ripple every 1.3 cells of movement
      const gapCells = 1.3;
      while (S.travel >= gapCells) {
        S.travel -= gapCells;
        const t = 1 - S.travel / Math.max(travel, 1e-6);
        const id = S.pNext++ % PULSES;
        S.px[id] = S.lx + dx * clamp(t, 0, 1);
        S.py[id] = S.ly + dy * clamp(t, 0, 1);
        S.pt[id] = S.simT;
        S.pa[id] = 0.22 + 0.5 * d01;
        S.pr[id] = 0;
        S.prMax[id] = 2.5 + 6 * d01;
        S.prot[id] = S.rand() * TAU;
      }
    }
  }
  // expand the ripples; each cell is dosed once as a front crosses it, with a six-petal pattern
  for (let q = 0; q < PULSES; q++) {
    if (S.pa[q] <= 0) continue;
    const r0 = S.pr[q], r1 = Math.min(S.prMax[q], r0 + WAVE_SPEED * dt);
    const cx = S.px[q], cy = S.py[q], amp = S.pa[q], rMax = S.prMax[q], rot = S.prot[q];
    const i0 = Math.max(0, Math.floor(cx - r1)), i1 = Math.min(N - 1, Math.ceil(cx + r1));
    const j0 = Math.max(0, Math.floor(cy - r1)), j1 = Math.min(N - 1, Math.ceil(cy + r1));
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) {
        const ddx = i + 0.5 - cx, ddy = j + 0.5 - cy, d = Math.hypot(ddx, ddy);
        if (d < r0 || d >= r1) continue;
        const petal = 0.55 + 0.45 * Math.cos(6 * Math.atan2(ddy, ddx) + rot + d * 0.35);
        const k = j * N + i;
        S.E[k] = Math.min(T.RES[k] * 1.6, S.E[k] + amp * petal * (1 - 0.55 * (d / rMax)));
      }
    S.pr[q] = r1;
    if (r1 >= rMax) S.pa[q] = 0;
  }
  S.lx = pointer ? pointer.x : NaN;
  S.ly = pointer ? pointer.y : NaN;

  // barrier: opens fast under exposure, grows back slowly as exposure fades
  const { RES, RINGED } = T;
  for (let n = 0; n < RINGED.length; n++) {
    const k = RINGED[n];
    S.E[k] = Math.max(0, S.E[k] - dt * 0.03);
    const target = 1 - 0.9 * sm(0.15, 1, S.E[k] / RES[k]);
    const rate = target < S.BF[k] ? 3.2 : 0.12;
    S.BF[k] += (target - S.BF[k]) * Math.min(1, rate * dt);
  }
  // tumour cells die back where their ring has opened
  const { TUM, KR } = T;
  for (let n = 0; n < TUM.length; n++) {
    const k = TUM[n];
    const open = (1 - S.BF[k]) / 0.9;
    if (open > 0.3 && S.K[k] < KR[k]) S.K[k] = Math.min(KR[k], S.K[k] + dt * 0.26 * sm(0.3, 0.85, open));
  }
}

export function metrics(T: Tissue, S: Sim) {
  let burden = 0, inf = 0;
  for (const k of T.TUM) {
    burden += 1 - S.K[k];
    if (T.INF[k] && S.K[k] > 0.85) inf++;
  }
  let rem = 0;
  for (const k of T.RINGED) rem += T.C0[k] * S.BF[k];
  const tumN = T.TUM.length || 1;
  return {
    burden: (100 * burden) / tumN,
    barrier: (100 * rem) / (T.sumC0 || 1),
    tcell: (100 * (inf + T.preT)) / (tumN + T.preT),
  };
}

/* ---------- view ---------- */
export type View = { p: number; ox: number; oy: number; W: number; H: number; unit: number };
export function computeView(W: number, H: number, unit: number, exportMode: boolean): View {
  let p = Math.max(W / N, H / N);
  if (!exportMode) p = Math.max(p, 11 * unit);
  return { p, ox: W / 2 - (N / 2) * p, oy: H / 2 - (N / 2) * p, W, H, unit };
}

/** Scripted cursor sweep used by the treatment export: a slow figure that covers the visible field. */
export function sweepPointer(t: number, view: View) {
  const cols = view.W / view.p, rows = view.H / view.p;
  return {
    x: N / 2 + cols * 0.36 * Math.sin((TAU * t) / 7.5) + cols * 0.06 * Math.sin((TAU * t) / 1.9),
    y: N / 2 + rows * 0.32 * Math.sin((TAU * t) / 4.3 + 0.7) + rows * 0.05 * Math.cos((TAU * t) / 2.3),
  };
}

/* ---------- renderer ---------- */
export function draw(
  ctx: CanvasRenderingContext2D,
  T: Tissue,
  S: Sim,
  view: View,
  t: number,
  { bg = THEMES.neon.bg as string | null, reduceMotion = false, style = "neon" as StyleName, bleed = false } = {},
) {
  const theme = THEMES[style], fibCols = FIB[style];
  const { p, ox, oy, W, H, unit } = view;
  ctx.globalCompositeOperation = "source-over";
  ctx.globalAlpha = 1;
  if (bg) {
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);
  } else ctx.clearRect(0, 0, W, H);
  const ph = (TAU * t) / LOOP;
  const m = reduceMotion ? 0.2 : 1;
  const inner = Array.from({ length: 6 * 4 }, () => new Path2D());
  const rings = Array.from({ length: FIB_LV }, () => new Path2D());
  const i0 = Math.max(0, Math.floor(-ox / p) - 1), i1 = Math.min(N - 1, Math.ceil((W - ox) / p) + 1);
  const j0 = Math.max(0, Math.floor(-oy / p) - 1), j1 = Math.min(N - 1, Math.ceil((H - oy) / p) + 1);
  const gap = p * 0.045, minTh = 0.4 * unit;
  const { TY, RB, C0, PH, RO, DIR, INF, FL } = T;
  const { BF, K } = S;
  const field = new Path2D();

  for (let j = j0; j <= j1; j++)
    for (let i = i0; i <= i1; i++) {
      const k = j * N + i;
      let ty = TY[k];
      if (ty < 0) {
        if (!bleed) continue;
        const ph0 = PH[k];
        const fx = ox + (i + 0.5) * p + m * p * 0.05 * Math.sin(ph + ph0);
        const fy = oy + (j + 0.5) * p + m * p * 0.05 * Math.cos(ph + ph0 * 1.7);
        const fr = p * T.FR[k] * (1 + m * 0.12 * Math.sin(2 * ph + ph0 * 2));
        field.moveTo(fx + fr, fy);
        field.arc(fx, fy, fr, 0, TAU);
        continue;
      }
      const phase = PH[k];
      const x = ox + (i + 0.5) * p + m * p * 0.07 * Math.sin(ph + phase);
      const y = oy + (j + 0.5) * p + m * p * 0.07 * Math.cos(ph + phase * 1.7);
      let r = p * RB[k] * (1 + m * 0.09 * Math.sin(2 * ph + phase * 2));
      let a = 1;
      if (ty === 0) {
        const kk = K[k];
        if (kk < 0.55) (r *= 1 - 0.45 * kk), (a = 1 - 0.3 * kk);
        else if (kk < 0.85 || !INF[k]) {
          const q = clamp((kk - 0.55) / 0.45, 0, 1);
          ty = 5;
          r *= Math.max(0.25, 0.62 - 0.45 * q);
          a = 0.9 - 0.45 * q;
        } else (ty = 3), (r *= 0.9 * sm(0.85, 1, kk));
      }
      if (r > 0.25 * unit) {
        const lv = a > 0.9 ? 3 : a > 0.67 ? 2 : a > 0.42 ? 1 : 0;
        const path = inner[ty * 4 + lv];
        path.moveTo(x + r, y);
        path.arc(x, y, r, 0, TAU);
      }
      const c0 = C0[k];
      if (c0 > 0.04) {
        const bf = BF[k], op = (1 - bf) / 0.9;
        const th = p * 0.22 * c0 * bf * (1 + m * 0.06 * Math.sin(ph + phase));
        if (th > minTh) {
          const path = rings[FL[k]];
          const ri = Math.max(r, p * 0.06) + gap, ro = ri + th;
          if (op < 0.03) {
            path.moveTo(x + ro, y);
            path.arc(x, y, ro, 0, TAU);
            path.moveTo(x + ri, y);
            path.arc(x, y, ri, TAU, 0, true);
          } else {
            // the ring breaks into fibre fragments that drift apart as it opens
            const nseg = 6, span = (TAU / nseg) * (1 - 0.78 * op), rot = RO[k] + ph * DIR[k];
            const spread = 1 + 0.35 * op;
            for (let s = 0; s < nseg; s++) {
              const a0 = rot + (s * TAU) / nseg, a1 = a0 + span;
              const ri2 = ri * spread, ro2 = ri2 + th;
              path.moveTo(x + ro2 * Math.cos(a0), y + ro2 * Math.sin(a0));
              path.arc(x, y, ro2, a0, a1);
              path.arc(x, y, ri2, a1, a0, true);
              path.closePath();
            }
          }
        }
      }
    }
  if (bleed) {
    ctx.globalAlpha = style === "clinical" ? 0.75 : 0.6;
    ctx.fillStyle = theme.field;
    ctx.fill(field);
  }
  ctx.globalAlpha = theme.ringAlpha;
  for (let l = 0; l < FIB_LV; l++) {
    ctx.fillStyle = fibCols[l];
    ctx.fill(rings[l]);
  }
  for (let ty = 0; ty < 6; ty++)
    for (let lv = 0; lv < 4; lv++) {
      ctx.globalAlpha = ALPHAS[lv];
      ctx.fillStyle = theme.inner[ty];
      ctx.fill(inner[ty * 4 + lv]);
    }

  // tumour boundary, always visible
  const O = T.OUTLINE;
  if (O.length) {
    ctx.globalAlpha = 1;
    ctx.strokeStyle = theme.outline;
    ctx.lineWidth = Math.max(1, 1.4 * unit);
    ctx.lineCap = "round";
    ctx.beginPath();
    for (let s = 0; s < O.length; s += 4) {
      ctx.moveTo(ox + O[s] * p, oy + O[s + 1] * p);
      ctx.lineTo(ox + O[s + 2] * p, oy + O[s + 3] * p);
    }
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}
