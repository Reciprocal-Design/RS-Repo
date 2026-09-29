import type { LayerSpec, Region } from './types';

// Layer rules: 3–8 layers; layer 1 is the receptor; cytoplasm layers come
// before nucleus layers, with at least one of each.

export const MIN_LAYERS = 3;
export const MAX_LAYERS = 8;
export const MAX_NODES = 10;

const count = (layers: LayerSpec[], region: Region) => layers.filter((l) => l.region === region).length;

/** Region choices that keep the order valid for layer i (i ≥ 1). */
export function regionOptions(layers: LayerSpec[], i: number): Region[] {
  if (i === 0) return ['membrane'];
  const cur = layers[i].region;
  const opts: Region[] = [];
  // Only the last cytoplasm layer can become nucleus, only the first nucleus layer cytoplasm.
  const prev = layers[i - 1]?.region;
  const next = layers[i + 1]?.region;
  const canCyto = cur === 'cytoplasm' || (prev !== 'nucleus' && count(layers, 'nucleus') > 1);
  const canNuc = cur === 'nucleus' || (next !== 'cytoplasm' && count(layers, 'cytoplasm') > 1);
  if (canCyto) opts.push('cytoplasm');
  if (canNuc) opts.push('nucleus');
  return opts;
}

export function setRegion(layers: LayerSpec[], i: number, region: Region): LayerSpec[] {
  if (!regionOptions(layers, i).includes(region)) return layers;
  return layers.map((l, j) => (j === i ? { ...l, region } : l));
}

export function canAddLayer(layers: LayerSpec[]): boolean {
  return layers.length < MAX_LAYERS;
}

/** Adds a layer at the end of its region, copying its neighbour's counts. */
export function addLayer(layers: LayerSpec[], region: 'cytoplasm' | 'nucleus'): LayerSpec[] {
  if (!canAddLayer(layers)) return layers;
  let at = region === 'cytoplasm' ? layers.findIndex((l) => l.region === 'nucleus') : layers.length;
  if (at < 0) at = layers.length;
  const like = layers[at - 1]?.region === region ? layers[at - 1] : layers.find((l) => l.region === region);
  const spec: LayerSpec = { region, nodeCount: like?.nodeCount ?? 5, activeCount: like?.activeCount ?? 3 };
  return [...layers.slice(0, at), spec, ...layers.slice(at)];
}

export function canRemoveLayer(layers: LayerSpec[], i: number): boolean {
  return i > 0 && layers.length > MIN_LAYERS && count(layers, layers[i].region) > 1;
}

export function removeLayer(layers: LayerSpec[], i: number): LayerSpec[] {
  return canRemoveLayer(layers, i) ? layers.filter((_, j) => j !== i) : layers;
}

export function setCounts(layers: LayerSpec[], i: number, nodeCount: number, activeCount: number): LayerSpec[] {
  if (i === 0) return layers; // receptor layer fixed at 1/1
  const n = Math.max(1, Math.min(MAX_NODES, Math.round(nodeCount)));
  const a = Math.max(1, Math.min(n, Math.round(activeCount)));
  return layers.map((l, j) => (j === i ? { ...l, nodeCount: n, activeCount: a } : l));
}

/** True when two pathways have the same layer structure (count and regions). */
export function sameStructure(a: LayerSpec[], b: LayerSpec[]): boolean {
  return a.length === b.length && a.every((l, i) => l.region === b[i].region);
}

/** Take `model`'s structure, keeping `own` node counts when the structures already match. */
export function withStructureOf(own: LayerSpec[], model: LayerSpec[]): LayerSpec[] {
  return sameStructure(own, model) ? own : model.map((l) => ({ ...l }));
}

/**
 * A cell's own take on shared layers (cell maps): with `amount` 0 the layers
 * are unchanged; toward 1 a layer may be added or removed (keeping the layer
 * rules) and node and active counts drift by up to about ±3 and ±2.
 */
export function varyLayers(layers: LayerSpec[], amount: number, rng: () => number): LayerSpec[] {
  const v = Math.max(0, Math.min(1, amount));
  if (v === 0) return layers;
  let out = layers;
  const r = rng(), region = rng() < 0.5 ? 'cytoplasm' : 'nucleus';
  if (r < 0.3 * v && canAddLayer(out)) out = addLayer(out, region);
  else if (r > 1 - 0.3 * v) {
    const removable = out.map((_, i) => i).filter((i) => canRemoveLayer(out, i));
    if (removable.length) out = removeLayer(out, removable[Math.floor(rng() * removable.length)]);
  }
  return out.map((l, i) => {
    if (i === 0) return l;
    const n = Math.max(1, Math.min(MAX_NODES, Math.round(l.nodeCount + (rng() * 2 - 1) * 3 * v)));
    const a = Math.round((l.activeCount * n) / l.nodeCount + (rng() * 2 - 1) * 2 * v);
    return { ...l, nodeCount: n, activeCount: Math.max(1, Math.min(n, a)) };
  });
}
