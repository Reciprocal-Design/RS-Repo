/* Stroma Field engine: tissue generation, the cursor-driven treatment model and the
   canvas renderer. Framework-free so the live page and the exporter share it.

   - Tissue: a seeded N × N grid (N adjustable, 48–200). Each cell has a type (core
     colour), a density (dot size) and a collagen level (ring thickness and colour).
     The overall shape comes from noise, or from a layout drawn on the pad.
   - Treatment: moving the cursor delivers antibody. Exposure builds up under the
     cursor's path, dense collagen needs more passes, and the ring breaks apart as it
     opens. Tumour cells whose ring is open die back over the next few seconds, and
     about half are replaced by T cells. Exposure fades slowly, so untouched barriers
     grow back.
   - Everything is deterministic for a given seed and pointer path, so exports replay
     exactly. */

export const TAU = Math.PI * 2;
export const DEFAULT_N = 120;
export const MIN_N = 48;
export const MAX_N = 200;
const REF_N = 84; // the grid the tissue scale was designed at
const REF_UM = 20; // µm per grid step at REF_N
export const LOOP = 6; // ambient motion period (s)
export const MAX_DOSE = 20; // mg/kg
export const DAYS_PER_S = 2;

export const clamp = (x: number, a: number, b: number) => (x < a ? a : x > b ? b : x);
export const sm = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

/* ---------- styles ---------- */
export type StyleName = "brand" | "neon" | "clinical";
export const STYLES: StyleName[] = ["brand", "clinical", "neon"];
export const LIGHT_STYLES: StyleName[] = ["brand", "clinical"];
export type Theme = {
  bg: string;
  inner: string[]; // tumour, CAF, macrophage, T cell, vessel, dying
  fib: [string, string, string]; // loose → dense collagen
  outline: string; // tumour boundary
  ringAlpha: number;
  field: string; // background dots when the grid bleeds to the edges
};
export const THEMES: Record<StyleName, Theme> = {
  // Periotherapia brand palette (Design Approach 3), keeping the red for cancer
  brand: {
    bg: "#f5f5f5",
    inner: ["#f2a887", "#3d6fb4", "#b5b0df", "#9ed9c6", "#f4cf7e", "#b9b9be"],
    fib: ["#cfcfd2", "#8c8c90", "#353535"],
    outline: "rgba(53,53,53,.55)",
    ringAlpha: 0.9,
    field: "#b5b0df",
  },
  neon: {
    bg: "#06050c",
    inner: ["#ff2fd0", "#9b5cff", "#4f86ff", "#28efe0", "#7d8bff", "#77738c"],
    fib: ["#b6ff3b", "#ffd60a", "#ff6f1a"],
    outline: "rgba(236,226,255,.8)",
    ringAlpha: 0.96,
    field: "#5b4a9e",
  },
  clinical: {
    bg: "#cdcdd1",
    inner: ["#dd5fa6", "#977fe3", "#5c78e2", "#6aa6c9", "#a9b6ec", "#9c9ba8"],
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
const FIB: Record<StyleName, string[]> = { brand: fibScale(THEMES.brand), neon: fibScale(THEMES.neon), clinical: fibScale(THEMES.clinical) };
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

/* ---------- drawn layouts ---------- */
/** Masks drawn on the layout pad, size × size, values 0..1, already softened. */
export type Layout = { size: number; tissue: Float32Array; tumour: Float32Array; hasTumour: boolean };
function sampleMask(L: Layout, m: Float32Array, u: number, v: number) {
  const n = L.size, x = clamp(u * n - 0.5, 0, n - 1), y = clamp(v * n - 0.5, 0, n - 1);
  const x0 = Math.floor(x), y0 = Math.floor(y), x1 = Math.min(n - 1, x0 + 1), y1 = Math.min(n - 1, y0 + 1);
  const fx = x - x0, fy = y - y0;
  const a = m[y0 * n + x0], b = m[y0 * n + x1], c = m[y1 * n + x0], d = m[y1 * n + x1];
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

/* ---------- tissue ---------- */
export type Tissue = {
  seed: number;
  N: number;
  M: number;
  um: number; // µm per grid step
  s: number; // grid scale relative to the 84-cell design grid
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
  TO: Float32Array; // auto timeline: time each ring starts to come down (stage 1)
  TK: Float32Array; // auto timeline: time each tumour cell starts to die (stage 2)
  OUTLINE: Float32Array; // tumour boundary segments [x1, y1, x2, y2, ...] in grid units
  preT: number;
  sumC0: number;
};

export function generate(seed: number, N = DEFAULT_N, layout: Layout | null = null): Tissue {
  N = Math.round(clamp(N, MIN_N, MAX_N));
  const M = N * N, sc = N / REF_N;
  const rand = mulberry32(seed * 7919 + 13);
  const fbm = makeNoise(rand);
  const o = Array.from({ length: 18 }, () => rand() * 200);
  const f = () => new Float32Array(M);
  const env = f(), tn = f(), fr = f(), vr = f(), tex = f(), n1 = f(), n2 = f(), n3 = f();
  for (let j = 0; j < N; j++)
    for (let i = 0; i < N; i++) {
      const k = j * N + i, u = (i + 0.5) / N, v = (j + 0.5) / N, r = Math.hypot(u - 0.5, v - 0.5) * 2;
      env[k] = fbm(u * 1.7 + o[0], v * 1.7 + o[1], 4) - (layout ? 0 : 0.32 * Math.max(0, r - 0.5) - 0.22 * Math.max(0, 1 - r));
      // the main tumour mass sits in the centre as the hero, with smaller satellite nests around it
      tn[k] = fbm(u * 2.5 + o[2], v * 2.5 + o[3], 4) + 0.18 * fbm(u * 7 + o[4], v * 7 + o[5], 2) - (layout ? 0 : 0.95 * r * r);
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
  // a drawn layout replaces the noise envelope (tissue) and the nest field (tumour); noise
  // still roughens the edges and textures the inside so it never looks stamped out
  if (layout) {
    for (let j = 0; j < N; j++)
      for (let i = 0; i < N; i++) {
        const k = j * N + i, u = (i + 0.5) / N, v = (j + 0.5) / N;
        const tu = sampleMask(layout, layout.tumour, u, v);
        const ti = Math.max(sampleMask(layout, layout.tissue, u, v), sm(0.05, 0.4, tu));
        const edge = 4 * ti * (1 - ti);
        D[k] = clamp(ti * (0.72 + 0.56 * TX[k]) + 0.45 * (E[k] - 0.5) * edge, 0, 1);
        if (layout.hasTumour) {
          const eT = 4 * tu * (1 - tu); // strongest along the drawn tumour border
          TN[k] = clamp(0.38 + 0.5 * tu + 0.34 * (TN[k] - 0.5) * (0.25 + 1.1 * eT), 0, 1);
        }
      }
  }
  for (let k = 0; k < M; k++) {
    if (!layout) D[k] = clamp(clamp((E[k] - 0.17) / 0.5, 0, 1) * (0.7 + 0.6 * TX[k]), 0, 1);
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
        else (TY[k] = 0), TUM.push(k), (INF[k] = 0), rand();
        RB[k] = 0.14 + 0.22 * D[k];
        continue;
      }
      const sCaf = 0.3 + 0.75 * C0[k] + 0.35 * R1[k] + 0.25 * rand();
      const sMy = 0.12 + 0.85 * RIM[k] + 0.45 * R2[k] + 0.25 * rand();
      const sT = 0.95 * Math.exp(-vd[k] / (4.5 * sc)) + 0.45 * R3[k] - 0.12 + 0.25 * rand();
      TY[k] = sCaf >= sMy && sCaf >= sT ? 1 : sMy >= sT ? 2 : 3;
      RB[k] = 0.1 + 0.25 * D[k];
    } else if (r < 0.2 * sm(-0.3, 0.08, D[k] - 0.1 + E[k] * 0.5) * (layout ? 0.5 : 1)) {
      const q = rand();
      TY[k] = q < 0.4 ? 1 : q < 0.7 ? 2 : 3;
      RB[k] = 0.05 + 0.07 * rand();
    }
  }
  const FRB = new Float32Array(M);
  for (let k = 0; k < M; k++) FRB[k] = TY[k] < 0 ? 0.07 + 0.07 * TX[k] + 0.04 * clamp(D[k] / 0.08, 0, 1) : 0;
  return {
    seed, N, M, um: (REF_UM * REF_N) / N, s: sc,
    TY, RB, FR: FRB, C0, RES, PH, RO, DIR, INF, KR, FL, TUM: Int32Array.from(TUM), RINGED: Int32Array.from(RINGED), preT, sumC0,
    OUTLINE: tumourOutline(isT, N, Math.max(1, Math.round(2 * sc))),
    ...stageTimes(N, TY, TUM, E),
  };
}

/* ---------- the two-stage timeline ---------- */
export const STAGE = {
  ecmStart: 0.6, // s: antibody arrives
  ecmSpan: 5.4, // s: outer edge to tumour core
  ecmFade: 2.2, // s: how long one ring takes to thin and fade away
  chemoStart: 6.2, // s: chemotherapy begins (slight overlap with stage 1)
  chemoSpan: 5.6,
  chemoFade: 1.8,
  end: 15,
};
/** Per-cell start times: both stages sweep in from the outside toward the tumour's centre,
 *  stage 1 in a six-petal wave pattern, stage 2 in a gentler spiral. */
function stageTimes(N: number, TY: Int8Array, TUM: number[], smooth: Float32Array) {
  const M = N * N;
  let cx = N / 2, cy = N / 2;
  if (TUM.length) {
    cx = cy = 0;
    for (const k of TUM) (cx += (k % N) + 0.5), (cy += ((k / N) | 0) + 0.5);
    cx /= TUM.length;
    cy /= TUM.length;
  }
  let maxD = 1;
  for (let k = 0; k < M; k++) if (TY[k] >= 0) maxD = Math.max(maxD, Math.hypot((k % N) + 0.5 - cx, ((k / N) | 0) + 0.5 - cy));
  let maxT = 1;
  for (const k of TUM) maxT = Math.max(maxT, Math.hypot((k % N) + 0.5 - cx, ((k / N) | 0) + 0.5 - cy));
  const TO = new Float32Array(M), TK = new Float32Array(M);
  for (let k = 0; k < M; k++) {
    const dx = (k % N) + 0.5 - cx, dy = ((k / N) | 0) + 0.5 - cy, d = Math.hypot(dx, dy), a = Math.atan2(dy, dx);
    const inward = 1 - clamp(d / maxD, 0, 1); // 0 at the outer edge, 1 at the centre
    const petal = 0.07 * Math.cos(6 * a + d * 0.12);
    // only smooth, large-scale variation, so neighbouring rings fade together rather than popping
    TO[k] = STAGE.ecmStart + STAGE.ecmSpan * clamp(inward + petal + 0.08 * (smooth[k] - 0.5), 0, 1) - STAGE.ecmFade * 0.5;
    const inT = 1 - clamp(d / maxT, 0, 1);
    const spiral = 0.05 * Math.sin(a * 2 + d * 0.08);
    TK[k] = Math.max(TO[k] + STAGE.ecmFade * 0.7, STAGE.chemoStart + STAGE.chemoSpan * clamp(inT + spiral + 0.08 * (smooth[k] - 0.5), 0, 1) - STAGE.chemoFade * 0.5);
  }
  return { TO, TK };
}
/** Fill the treatment state for time t on the auto timeline (pure function of t). */
export function autoState(T: Tissue, S: Sim, t: number) {
  const { TO, TK, RINGED, TUM, KR } = T;
  for (let n = 0; n < RINGED.length; n++) {
    const k = RINGED[n];
    const q = clamp((t - TO[k]) / STAGE.ecmFade, 0, 1);
    S.BF[k] = 1 - q * q * (3 - 2 * q); // thins and fades all the way to nothing
  }
  for (let n = 0; n < TUM.length; n++) {
    const k = TUM[n];
    S.K[k] = KR[k] * sm(TK[k], TK[k] + STAGE.chemoFade, t);
  }
  S.simT = t;
  S.chemo = sm(STAGE.chemoStart - 0.3, STAGE.chemoStart + 0.6, t);
  S.floor = 0;
}

/** Smooth contour around the tumour nests: marching squares over a blurred tumour mask. */
function tumourOutline(isT: Uint8Array, N: number, passes: number) {
  const M = N * N;
  let a = Float32Array.from(isT);
  for (let pass = 0; pass < passes; pass++) {
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
const PULSES = 192;
const WAVE_SPEED = 9; // cells per second at the design grid
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
  chemo: number; // 0..1, chemotherapy level (stage 2)
  ecm: number; // 0..1, share of the collagen barrier cleared (stage 1)
  floor: number; // ring fraction left when fully open: 0.1 in cursor mode, 0 on the timeline
};
export function createSim(T: Tissue): Sim {
  const f = () => new Float32Array(PULSES);
  return {
    E: new Float32Array(T.M), BF: new Float32Array(T.M).fill(1), K: new Float32Array(T.M),
    simT: 0, lx: NaN, ly: NaN,
    px: f(), py: f(), pt: f(), pa: f(), pr: f(), prMax: f(), prot: f(),
    pNext: 0, travel: 0, rand: mulberry32(T.seed * 31 + 5), delivered: 0, chemo: 0, ecm: 0, floor: 0.1,
  };
}
export function cloneSim(S: Sim): Sim {
  return { ...S, E: S.E.slice(), BF: S.BF.slice(), K: S.K.slice(), pa: new Float32Array(PULSES), rand: mulberry32(1) };
}
/** Reset a sim to untouched tissue in place (used by the auto timeline). */
export function resetSim(S: Sim) {
  S.BF.fill(1);
  S.K.fill(0);
  S.E.fill(0);
  S.pa.fill(0);
  S.chemo = S.ecm = 0;
}
/** Advance the treatment by dt seconds. pointer is in grid units, or null when the cursor is away. */
export function stepSim(T: Tissue, S: Sim, dt: number, pointer: { x: number; y: number } | null, dose: number) {
  const d01 = clamp(dose / MAX_DOSE, 0, 1);
  const N = T.N, sc = T.s;
  S.simT += dt;
  if (pointer && Number.isFinite(S.lx)) {
    const dx = pointer.x - S.lx, dy = pointer.y - S.ly;
    const travel = Math.min(4 * sc, Math.hypot(dx, dy));
    if (d01 > 0 && travel > 0.002) {
      S.travel += travel;
      S.delivered += travel * d01;
      // drop a ripple every 1.3 cells of movement
      const gapCells = 1.3 * sc;
      while (S.travel >= gapCells) {
        S.travel -= gapCells;
        const t = 1 - S.travel / Math.max(travel, 1e-6);
        const id = S.pNext++ % PULSES;
        S.px[id] = S.lx + dx * clamp(t, 0, 1);
        S.py[id] = S.ly + dy * clamp(t, 0, 1);
        S.pt[id] = S.simT;
        S.pa[id] = 0.22 + 0.5 * d01;
        S.pr[id] = 0;
        S.prMax[id] = (2.5 + 6 * d01) * sc;
        S.prot[id] = S.rand() * TAU;
      }
    }
  }
  // expand the ripples; each cell is dosed once as a front crosses it, with a six-petal pattern
  for (let q = 0; q < PULSES; q++) {
    if (S.pa[q] <= 0) continue;
    const r0 = S.pr[q], r1 = Math.min(S.prMax[q], r0 + WAVE_SPEED * sc * dt);
    const cx = S.px[q], cy = S.py[q], amp = S.pa[q], rMax = S.prMax[q], rot = S.prot[q];
    const i0 = Math.max(0, Math.floor(cx - r1)), i1 = Math.min(N - 1, Math.ceil(cx + r1));
    const j0 = Math.max(0, Math.floor(cy - r1)), j1 = Math.min(N - 1, Math.ceil(cy + r1));
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) {
        const ddx = i + 0.5 - cx, ddy = j + 0.5 - cy, d = Math.hypot(ddx, ddy);
        if (d < r0 || d >= r1) continue;
        const petal = 0.55 + 0.45 * Math.cos(6 * Math.atan2(ddy, ddx) + rot + (d / sc) * 0.35);
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
  let rem = 0;
  for (let n = 0; n < RINGED.length; n++) {
    const k = RINGED[n];
    rem += T.C0[k] * S.BF[k];
    S.E[k] = Math.max(0, S.E[k] - dt * 0.03);
    const target = 1 - 0.9 * sm(0.15, 1, S.E[k] / RES[k]);
    const rate = target < S.BF[k] ? 3.2 : 0.12;
    S.BF[k] += (target - S.BF[k]) * Math.min(1, rate * dt);
  }
  S.ecm = clamp((1 - rem / (T.sumC0 || 1)) / 0.9, 0, 1);
  // stage 2: chemotherapy starts once 40% of the barrier is down, then reaches tumour cells whose ring is open
  if (S.ecm >= 0.4 || S.chemo > 0) S.chemo = Math.min(1, S.chemo + dt / 1.5);
  const { TUM, KR } = T;
  for (let n = 0; n < TUM.length; n++) {
    const k = TUM[n];
    const open = (1 - S.BF[k]) / 0.9;
    if (S.chemo > 0 && open > 0.3 && S.K[k] < KR[k]) S.K[k] = Math.min(KR[k], S.K[k] + dt * 0.3 * S.chemo * sm(0.3, 0.85, open));
  }
}

export function metrics(T: Tissue, S: Sim) {
  let burden = 0;
  for (const k of T.TUM) burden += 1 - S.K[k] / (T.KR[k] || 1);
  let rem = 0;
  for (const k of T.RINGED) rem += T.C0[k] * S.BF[k];
  const tumN = T.TUM.length || 1;
  const barrier = (100 * rem) / (T.sumC0 || 1);
  return {
    burden: (100 * burden) / tumN,
    barrier,
    ecm: clamp((100 - barrier) / (1 - S.floor), 0, 100), // stage 1 progress
    chemo: clamp(100 - (100 * burden) / tumN, 0, 100), // stage 2 progress
    chemoOn: S.chemo > 0.02,
  };
}

/* ---------- view ---------- */
export type View = { p: number; ox: number; oy: number; W: number; H: number; unit: number };
export function computeView(W: number, H: number, unit: number, exportMode: boolean, N: number): View {
  let p = Math.max(W / N, H / N);
  if (!exportMode) p = Math.max(p, 5 * unit);
  return { p, ox: W / 2 - (N / 2) * p, oy: H / 2 - (N / 2) * p, W, H, unit };
}

/** Scripted cursor sweep used by the treatment export: a slow figure that covers the visible field. */
export function sweepPointer(t: number, view: View, N: number) {
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
  { bg = THEMES.neon.bg as string | null, reduceMotion = false, style = "neon" as StyleName, bleed = false, panel = null as StagePanel | null } = {},
) {
  const theme = THEMES[style], fibCols = FIB[style];
  const N = T.N;
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
  const rings = Array.from({ length: FIB_LV * 4 }, () => new Path2D()); // colour level × opacity step
  const i0 = Math.max(0, Math.floor(-ox / p) - 1), i1 = Math.min(N - 1, Math.ceil((W - ox) / p) + 1);
  const j0 = Math.max(0, Math.floor(-oy / p) - 1), j1 = Math.min(N - 1, Math.ceil((H - oy) / p) + 1);
  const gap = p * 0.045, minTh = 0.4 * unit;
  const { TY, RB, C0, PH, FL } = T;
  const { BF, K } = S;
  const field = new Path2D();
  // bleed: every dot shrinks smoothly toward the canvas edges, so the matrix never ends abruptly
  const margin = 0.17 * Math.min(W, H);
  const taper = (x: number, y: number) =>
    bleed ? 0.04 + 0.96 * sm(0, margin, x) * sm(0, margin, W - x) * sm(0, margin, y) * sm(0, margin, H - y) : 1;

  for (let j = j0; j <= j1; j++)
    for (let i = i0; i <= i1; i++) {
      const k = j * N + i;
      let ty = TY[k];
      if (ty < 0) {
        if (!bleed) continue;
        const ph0 = PH[k];
        const fx = ox + (i + 0.5) * p + m * p * 0.05 * Math.sin(ph + ph0);
        const fy = oy + (j + 0.5) * p + m * p * 0.05 * Math.cos(ph + ph0 * 1.7);
        const fr = p * T.FR[k] * (1 + m * 0.12 * Math.sin(2 * ph + ph0 * 2)) * taper(fx, fy);
        if (fr < 0.25 * unit) continue;
        field.moveTo(fx + fr, fy);
        field.arc(fx, fy, fr, 0, TAU);
        continue;
      }
      const phase = PH[k];
      const x = ox + (i + 0.5) * p + m * p * 0.07 * Math.sin(ph + phase);
      const y = oy + (j + 0.5) * p + m * p * 0.07 * Math.cos(ph + phase * 1.7);
      const tf = taper(x, y);
      let r = p * RB[k] * (1 + m * 0.09 * Math.sin(2 * ph + phase * 2)) * tf;
      let a = 1;
      if (ty === 0) {
        const kk = K[k];
        // stage 2: the cancer cell shrinks and turns into a small grey dot
        if (kk < 0.45) (r *= 1 - 0.5 * kk), (a = 1 - 0.2 * kk);
        else {
          const q = clamp((kk - 0.45) / 0.55, 0, 1);
          ty = 5;
          r *= 0.72 - 0.34 * q;
          a = 1 - 0.25 * q;
        }
      }
      if (r > 0.25 * unit) {
        const lv = a > 0.9 ? 3 : a > 0.67 ? 2 : a > 0.42 ? 1 : 0;
        const path = inner[ty * 4 + lv];
        path.moveTo(x + r, y);
        path.arc(x, y, r, 0, TAU);
      }
      const c0 = C0[k];
      if (c0 > 0.04) {
        // the ring thins continuously to nothing, the same way a cancer cell shrinks
        const bf = BF[k];
        const th = p * 0.22 * c0 * bf * (1 + m * 0.06 * Math.sin(ph + phase)) * tf;
        if (th > 0.08 * unit) {
          const path = rings[FL[k] * 4 + 3];
          const ri = Math.max(r, p * 0.06 * tf) + gap * tf, ro = ri + th;
          path.moveTo(x + ro, y);
          path.arc(x, y, ro, 0, TAU);
          path.moveTo(x + ri, y);
          path.arc(x, y, ri, TAU, 0, true);
        }
      }
    }
  if (bleed) {
    ctx.globalAlpha = style === "neon" ? 0.6 : 0.75;
    ctx.fillStyle = theme.field;
    ctx.fill(field);
  }
  for (let l = 0; l < FIB_LV; l++)
    for (let f = 0; f < 4; f++) {
      ctx.globalAlpha = theme.ringAlpha * [0.22, 0.48, 0.74, 1][f];
      ctx.fillStyle = fibCols[l];
      ctx.fill(rings[l * 4 + f]);
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
    const bands = bleed ? [new Path2D(), new Path2D(), new Path2D(), new Path2D()] : [new Path2D()];
    for (let s = 0; s < O.length; s += 4) {
      const x1 = ox + O[s] * p, y1 = oy + O[s + 1] * p, x2 = ox + O[s + 2] * p, y2 = oy + O[s + 3] * p;
      const b = bleed ? Math.min(3, Math.floor(taper((x1 + x2) / 2, (y1 + y2) / 2) * 4)) : 0;
      bands[b].moveTo(x1, y1);
      bands[b].lineTo(x2, y2);
    }
    bands.forEach((path, b) => {
      ctx.globalAlpha = bleed ? (b + 0.5) / 4 : 1;
      ctx.stroke(path);
    });
  }
  ctx.globalAlpha = 1;
  if (panel) drawStagePanel(ctx, view, theme, style, panel);
}

/* ---------- stage panel (drawn into the canvas, so it renders out with the map) ---------- */
export type StagePanel = { ecm: number; chemo: number; chemoOn: boolean; corner?: "br" | "bl" | "tr" | "tl" };
export function drawStagePanel(ctx: CanvasRenderingContext2D, view: View, theme: Theme, style: StyleName, P: StagePanel) {
  const u = Math.max(view.unit, Math.min(view.W, view.H) / 1080), W = view.W, H = view.H;
  const light = style !== "neon";
  const pad = 16 * u, R = 27 * u, lw = 6 * u, rowH = 2 * R + 24 * u, w = 252 * u, h = 2 * rowH + 2 * pad - 24 * u + 30 * u;
  const corner = P.corner ?? "br";
  const x0 = corner.endsWith("r") ? W - w - 24 * u : 24 * u;
  const y0 = corner.startsWith("b") ? H - h - 24 * u : 24 * u;
  const text = light ? "#25242d" : "#eeebf8", mute = light ? "#5c5b6a" : "#9a94b6", track = light ? "rgba(37,36,45,.12)" : "rgba(238,235,248,.12)";
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.fillStyle = light ? "rgba(240,240,243,.88)" : "rgba(13,11,23,.82)";
  ctx.strokeStyle = light ? "rgba(37,36,45,.12)" : "rgba(238,235,248,.1)";
  ctx.lineWidth = 1 * u;
  ctx.beginPath();
  ctx.roundRect(x0, y0, w, h, 10 * u);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = mute;
  ctx.font = `500 ${10.5 * u}px "IBM Plex Mono", ui-monospace, monospace`;
  ctx.textBaseline = "alphabetic";
  ctx.fillText("TREATMENT", x0 + pad, y0 + pad + 9 * u);
  const ecmActive = !P.chemoOn || P.ecm < 99.5;
  const rows = [
    { n: "1", title: "Antibody", sub: "ECM cleared", v: P.ecm, col: theme.fib[1], active: ecmActive && !(P.chemoOn && P.ecm > 97) },
    { n: "2", title: "Chemotherapy", sub: "Tumour cleared", v: P.chemo, col: theme.inner[0], active: P.chemoOn },
  ];
  rows.forEach((r, i) => {
    const cx = x0 + pad + R + lw / 2, cy = y0 + pad + 26 * u + i * rowH + R;
    ctx.globalAlpha = r.active || r.v >= 95 ? 1 : 0.45;
    ctx.lineWidth = lw;
    ctx.lineCap = "round";
    ctx.strokeStyle = track;
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, TAU);
    ctx.stroke();
    if (r.v > 0.3) {
      ctx.strokeStyle = r.col;
      ctx.beginPath();
      ctx.arc(cx, cy, R, -Math.PI / 2, -Math.PI / 2 + (TAU * clamp(r.v, 0, 100)) / 100);
      ctx.stroke();
    }
    ctx.fillStyle = text;
    ctx.textAlign = "center";
    ctx.font = `500 ${14 * u}px "IBM Plex Mono", ui-monospace, monospace`;
    ctx.fillText(`${Math.round(r.v)}%`, cx, cy + 5 * u);
    ctx.textAlign = "left";
    const tx = cx + R + lw / 2 + 16 * u;
    ctx.fillStyle = mute;
    ctx.font = `500 ${10.5 * u}px "IBM Plex Mono", ui-monospace, monospace`;
    ctx.fillText(`STAGE ${r.n}`, tx, cy - 12 * u);
    ctx.fillStyle = text;
    ctx.font = `600 ${16 * u}px "Instrument Sans", system-ui, sans-serif`;
    ctx.fillText(r.title, tx, cy + 6 * u);
    ctx.fillStyle = mute;
    ctx.font = `400 ${12.5 * u}px "Instrument Sans", system-ui, sans-serif`;
    ctx.fillText(r.sub, tx, cy + 23 * u);
  });
  ctx.restore();
}
