import { DEFAULT_ANIMATION, defaultCellMap, defaultLayers, defaultModule, defaultScene, makePathway } from './defaults';
import { MAX_LAYERS, MAX_NODES, MIN_LAYERS } from './layers';
import type { CellMap, LayerSpec, MapCell, ModuleKind, ModuleSettings, OrganId, Pathway, Region, Scene } from './types';

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

const coords = (v: unknown): number[] | null =>
  Array.isArray(v) && v.length >= 6 && v.length % 2 === 0 && v.every((x) => typeof x === 'number' && Number.isFinite(x)) ? v : null;

function normalizeCellMap(raw: unknown): CellMap {
  const base = defaultCellMap();
  if (!isObj(raw)) return base;
  const m = merge(base, raw);
  const vb = m.viewBox;
  if (!(vb.width > 0 && vb.height > 0) && raw.around !== true) return base;
  const cells: MapCell[] = [];
  for (const c of Array.isArray(raw.cells) ? raw.cells : []) {
    if (!isObj(c)) continue;
    const membrane = coords(c.membrane);
    if (!membrane) continue;
    cells.push({
      id: `c${cells.length + 1}`,
      membrane,
      nucleus: coords(c.nucleus),
      enabled: bool(c.enabled, true),
      seed: Math.round(num(c.seed, cells.length + 1, 0, 2 ** 32)),
      ...(c.hero === true ? { hero: true } : {}),
    });
  }
  const around = bool(raw.around, false);
  return {
    enabled: bool(m.enabled, false) && (cells.length > 0 || around),
    around,
    name: typeof m.name === 'string' ? m.name : '',
    viewBox: { x: num(vb.x, 0), y: num(vb.y, 0), width: vb.width, height: vb.height },
    cells,
    detailScale: num(m.detailScale, base.detailScale, 0.2, 1),
    stagger: num(m.stagger, base.stagger, 0, 20),
    orient: bool(m.orient, true),
    links: { enabled: bool(m.links.enabled, true), amount: num(m.links.amount, base.links.amount, 0, 8) },
    relayHops: Math.round(num(m.relayHops, base.relayHops, 0, 10)),
    startShare: num(m.startShare, base.startShare, 0, 1),
    // Maps saved before cell variation existed keep their cells alike.
    variation: num(raw.variation, 0, 0, 1),
  };
}

const MODULE_KINDS: ModuleKind[] = ['targetId', 'moa', 'combination', 'toxicity', 'tissue', 'custom', 'body', 'journey'];
const ORGAN_IDS: OrganId[] = ['brain', 'lungs', 'heart', 'liver', 'stomach', 'kidneys', 'intestines', 'bladder'];

/** Scenes saved before modules existed show their pathway unchanged ('custom'). */
function normalizeModule(raw: unknown): ModuleSettings {
  const kind = isObj(raw) && MODULE_KINDS.includes(raw.kind as ModuleKind) ? (raw.kind as ModuleKind) : 'custom';
  const base = defaultModule(kind);
  const m = merge(base, raw);
  return {
    ...m,
    kind,
    focusDeg: Math.round(num(m.focusDeg, base.focusDeg, 0, 10)),
    routes: Math.round(num(m.routes, base.routes, 1, 3)),
    dimOpacity: num(m.dimOpacity, base.dimOpacity, 0, 1),
    toxicDegs: Math.round(num(m.toxicDegs, base.toxicDegs, 0, 10)),
    warningAngle: num(m.warningAngle, base.warningAngle, -360, 360),
    organ: ORGAN_IDS.includes(m.organ) ? m.organ : base.organ,
    sectionLength: num(m.sectionLength, base.sectionLength, 0.5, 30),
    bodyGlow: num(m.bodyGlow, base.bodyGlow, 0, 1),
    bodyImage: typeof m.bodyImage === 'string' && m.bodyImage.startsWith('data:image/') ? m.bodyImage : '',
    imageScale: num(m.imageScale, 1, 0.2, 4),
    imageX: num(m.imageX, 0, -1, 1),
    imageY: num(m.imageY, 0, -1, 1),
    netScale: num(m.netScale, 1, 0.3, 3),
    netX: num(m.netX, 0, -1, 1),
    netY: num(m.netY, 0, -1, 1),
  };
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
  s.style.idleOpacity = num(s.style.idleOpacity, base.style.idleOpacity, 0, 1);
  for (const [o, d] of [[s.cell, base.cell], [s.nucleus, base.nucleus]] as const) {
    if (o.outlineStyle !== 'line' && o.outlineStyle !== 'glow') o.outlineStyle = d.outlineStyle;
    o.glowWidth = num(o.glowWidth, d.glowWidth, 0, 400);
  }
  s.pathwayCount = Math.round(num(s.pathwayCount, 1, 1, 5));
  // Scenes saved before spacing variation existed were evenly spaced: keep them so.
  s.spacingVariation = num(raw.spacingVariation, 0, 0, 2);
  s.animation = merge({ ...DEFAULT_ANIMATION }, raw.animation);
  if (!['linear', 'easeInOut'].includes(s.animation.easing)) s.animation.easing = 'linear';
  s.animation.density = num(s.animation.density, DEFAULT_ANIMATION.density, 0, 1);
  s.crosstalk.amount = num(s.crosstalk.amount, 0.4, 0, 1);
  s.cellMap = normalizeCellMap(raw.cellMap);
  s.module = normalizeModule(raw.module);

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
