// Colour parsing and an OKLab gradient ramp, so blends between stops stay clean.

export type RGBA = [number, number, number, number]; // r,g,b 0–255, a 0–1

export function parseColor(input: string): RGBA {
  const s = input.trim().toLowerCase();
  if (s.startsWith('#')) {
    let hex = s.slice(1);
    if (hex.length === 3 || hex.length === 4) hex = [...hex].map((c) => c + c).join('');
    const n = parseInt(hex.slice(0, 6), 16);
    const a = hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1;
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, a];
  }
  const m = s.match(/rgba?\(([^)]+)\)/);
  if (m) {
    const [r, g, b, a = '1'] = m[1].split(/[\s,/]+/).filter(Boolean);
    return [parseFloat(r), parseFloat(g), parseFloat(b), parseFloat(a)];
  }
  return [255, 255, 255, 1];
}

export function rgbaString([r, g, b, a]: RGBA): string {
  const c = (v: number) => Math.round(Math.max(0, Math.min(255, v)));
  return a >= 1 ? `rgb(${c(r)},${c(g)},${c(b)})` : `rgba(${c(r)},${c(g)},${c(b)},${+a.toFixed(3)})`;
}

export function hexString([r, g, b]: RGBA): string {
  const c = (v: number) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

const toLinear = (c: number) => {
  c /= 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const fromLinear = (c: number) =>
  255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.max(c, 0) ** (1 / 2.4) - 0.055);

type Lab = [number, number, number];

function rgbToOklab([r, g, b]: RGBA): Lab {
  const lr = toLinear(r), lg = toLinear(g), lb = toLinear(b);
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function oklabToRgb([L, a, b]: Lab): RGBA {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    fromLinear(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    fromLinear(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    fromLinear(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
    1,
  ];
}

export type Ramp = (t: number) => RGBA;

/** Stops evenly spaced over 0–1, interpolated in OKLab. */
export function makeRamp(stops: string[]): Ramp {
  const labs = (stops.length ? stops : ['#ffffff']).map((s) => rgbToOklab(parseColor(s)));
  if (labs.length === 1) {
    const c = oklabToRgb(labs[0]);
    return () => c;
  }
  return (t: number) => {
    const x = Math.max(0, Math.min(1, t)) * (labs.length - 1);
    const i = Math.min(labs.length - 2, Math.floor(x));
    const f = x - i;
    const A = labs[i], B = labs[i + 1];
    return oklabToRgb([A[0] + (B[0] - A[0]) * f, A[1] + (B[1] - A[1]) * f, A[2] + (B[2] - A[2]) * f]);
  };
}
