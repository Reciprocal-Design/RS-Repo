import { DEFAULT_ANIMATION, defaultLayers, defaultScene, makePathway } from './defaults';
import { MAX_LAYERS, MAX_NODES, MIN_LAYERS } from './layers';
import type { LayerSpec, Pathway, Region, Scene } from './types';

// Scene JSON: save the full Scene, and load it back tolerantly. Missing fields
// take their defaults and out-of-range values are clamped, so older or
// hand-edited files still open; anything that isn't a scene is rejected.

export function serializeScene(scene: Scene): string {
  return JSON.stringify(scene, null, 2);
}

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown, d: number, min = -Infinity, max = Infinity) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.max(min, Math.min(max, v)) : d;
const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d);
const str = (v: unknown, d: string) => (typeof v === 'string' && v.trim() ? v : d);

/** Merge `raw` over `base` for plain objects, keeping base's shape and types. */
function merge<T>(base: T, raw: unknown): T {
  if (!isObj(raw) || !isObj(base)) return base;
  const out: Json = { ...(base as Json) };
  for (const [k, b] of Object.entries(base as Json)) {
    const r = raw[k];
    if (r === undefined) continue;
    if (isObj(b)) out[k] = merge(b, r);
    else if (Array.isArray(b)) out[k] = Array.isArray(r) ? r : b;
    else if (typeof r === typeof b) out[k] = r;
  }
  return out as T;
}

function validLayers(raw: unknown): LayerSpec[] | null {
  if (!Array.isArray(raw) || raw.length < MIN_LAYERS || raw.length > MAX_LAYERS) return null;
  const layers: LayerSpec[] = [];
  for (const [i, l] of raw.entries()) {
    if (!isObj(l)) return null;
    const region = (i === 0 ? 'membrane' : l.region) as Region;
    if (i > 0 && region !== 'cytoplasm' && region !== 'nucleus') return null;
    const nodeCount = i === 0 ? 1 : Math.round(num(l.nodeCount, 5, 1, MAX_NODES));
    const activeCount = i === 0 ? 1 : Math.round(num(l.activeCount, 3, 1, nodeCount));
    layers.push({ region, nodeCount, activeCount });
  }
  // Cytoplasm before nucleus, at least one of each.
  const regions = layers.slice(1).map((l) => l.region);
  const firstNuc = regions.indexOf('nucleus');
  if (firstNuc < 1 || regions.slice(firstNuc).some((r) => r !== 'nucleus')) return null;
  return layers;
}

export function normalizeScene(raw: unknown): Scene {
  if (!isObj(raw) || !isObj(raw.canvas) || !Array.isArray(raw.pathways)) {
    throw new Error('This file is not a Pathway Animator scene.');
  }
  if (raw.version !== undefined && raw.version !== 1) {
    throw new Error(`Unsupported scene version ${String(raw.version)}.`);
  }
  const seed = Math.round(num(raw.seed, 1234, 0, 2 ** 31));
  const base = defaultScene(seed);
  const s = merge(base, raw);

  s.version = 1;
  s.seed = seed;
  s.name = str(raw.name, base.name);
  s.canvas.width = Math.round(num(s.canvas.width, 1920, 200, 8192));
  s.canvas.height = Math.round(num(s.canvas.height, 1080, 200, 8192));
  s.cell.radius = num(s.cell.radius, base.cell.radius, 0.1, 0.5);
  s.cell.decorativeReceptors = Math.round(num(s.cell.decorativeReceptors, 7, 0, 12));
  s.nucleus.radiusRatio = num(s.nucleus.radiusRatio, base.nucleus.radiusRatio, 0.1, 0.9);
  s.nucleus.layerDepth = num(s.nucleus.layerDepth, base.nucleus.layerDepth, 0.1, 0.97);
  s.style.gradientStops = (Array.isArray(s.style.gradientStops) ? s.style.gradientStops : [])
    .filter((c): c is string => typeof c === 'string');
  if (s.style.gradientStops.length < 2) s.style.gradientStops = [...base.style.gradientStops];
  if (!['capsule', 'diamond', 'capsuleDiamond'].includes(s.style.receptorStyle)) s.style.receptorStyle = base.style.receptorStyle;
  for (const [o, d] of [[s.cell, base.cell], [s.nucleus, base.nucleus]] as const) {
    if (o.outlineStyle !== 'line' && o.outlineStyle !== 'glow') o.outlineStyle = d.outlineStyle;
    o.glowWidth = num(o.glowWidth, d.glowWidth, 0, 400);
  }
  s.pathwayCount = Math.round(num(s.pathwayCount, 1, 1, 5));
  s.animation = merge({ ...DEFAULT_ANIMATION }, raw.animation);
  if (!['linear', 'easeInOut'].includes(s.animation.easing)) s.animation.easing = 'linear';
  s.crosstalk.amount = num(s.crosstalk.amount, 0.4, 0, 1);

  const rawPathways = raw.pathways as unknown[];
  const pathways: Pathway[] = [];
  for (let i = 0; i < Math.max(s.pathwayCount, rawPathways.length) && i < 5; i++) {
    const rp = rawPathways[i];
    const def = makePathway(seed, i, pathways[0]?.layers ?? defaultLayers());
    const p = merge(def, rp);
    p.id = `p${i + 1}`;
    p.seed = Math.round(num(p.seed, def.seed, 0, 2 ** 32));
    p.layers = validLayers(isObj(rp) ? rp.layers : undefined) ?? def.layers;
    p.branching = num(p.branching, def.branching, 0, 1);
    p.convergence = num(p.convergence, def.convergence, 0, 1);
    p.startDelay = num(p.startDelay, 0, 0, 60);
    p.locked = bool(p.locked, false);
    pathways.push(p);
  }
  s.pathways = pathways;
  return s;
}

export function parseSceneJson(text: string): Scene {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('This file is not valid JSON.');
  }
  return normalizeScene(raw);
}

/** `{sceneName}_{width}x{height}_{timestamp}.{ext}` */
export function exportFileName(scene: Scene, width: number, height: number, ext: string, date = new Date()): string {
  const name = (scene.name || 'pathway').trim().replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'pathway';
  const p = (v: number) => String(v).padStart(2, '0');
  const stamp = `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`;
  return `${name}_${width}x${height}_${stamp}.${ext}`;
}
