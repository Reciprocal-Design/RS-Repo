import { buildMapGeometry } from './cellMap';
import { connectCellLinks, type LinkCell } from './connect';
import { hash } from './rng';
import type { Scene, SceneGeom } from './types';

// Cross-tissue communication: the tissue twice, side by side. The first (in
// the scene's own colour) holds the selected cell, which starts the signal;
// the second (in its own colour, with its own networks) only ever answers.
// A few connections join cells of one to cells of the other across the gap.

/** Share of the canvas width left between the two tissues. */
const GAP = 0.08;
/** Id prefix of everything in the second tissue. */
export const SECOND_TISSUE = 'b';

export function buildCrossTissueGeometry(scene: Scene): SceneGeom | null {
  const { width: W, height: H } = scene.canvas;
  const gap = GAP * W;
  const w = (W - gap) / 2;
  const cm = { ...scene.cellMap, solo: false, centerHero: false };
  const first: Scene = { ...scene, cellMap: { ...cm, frame: { x: 0, y: 0, w, h: H } } };
  const second: Scene = {
    ...scene,
    seed: hash(scene.seed, 'second-tissue'),
    cellMap: { ...cm, heroId: '', frame: { x: w + gap, y: 0, w, h: H } },
  };

  const cellsA: LinkCell[] = [], cellsB: LinkCell[] = [];
  const a = buildMapGeometry(first, { collect: cellsA });
  const b = buildMapGeometry(second, {
    prefix: SECOND_TISSUE,
    noStart: true,
    glow: scene.module.tissue2Color,
    // Inside the second tissue, the signal spreads away from the side it arrives on.
    linkOrigin: { x: w + gap, y: H / 2 },
    collect: cellsB,
  });
  if (!a || !b) return a ?? b;

  // Connections: the pairs of cells (one from each tissue) nearest each
  // other across the gap, each cell used once.
  const want = Math.max(0, Math.round(scene.module.crossLinks));
  const cands: { key: string; a: string; b: string; d: number }[] = [];
  for (const A of cellsA) {
    if (!A.layouts.length) continue;
    for (const B of cellsB) {
      if (!B.layouts.length) continue;
      const d = Math.hypot(A.frame.center.x - B.frame.center.x, A.frame.center.y - B.frame.center.y) - A.R - B.R;
      cands.push({ key: `${A.id}|${B.id}`, a: A.id, b: B.id, d });
    }
  }
  cands.sort((x, y) => x.d - y.d);
  const used = new Set<string>();
  const pairs = new Set<string>();
  for (const c of cands) {
    if (pairs.size >= want) break;
    if (used.has(c.a) || used.has(c.b)) continue;
    used.add(c.a);
    used.add(c.b);
    pairs.add(c.key);
  }
  // They run from the first tissue into the second.
  const cross = connectCellLinks(scene, [...cellsA, ...cellsB], { pairs, amount: 1, tag: 'x', origin: { x: 0, y: H / 2 } });

  // The connections themselves (not the short edges from a relay receptor into
  // its cell) are drawn heavier and at full strength: they are the point of the view.
  const crossEdges = cross.edges.map((e) => (e.link ? { ...e, opacity: 1, weight: 2.2 } : e));
  const nodes = [...a.nodes, ...b.nodes, ...cross.nodes];
  return {
    scale: a.scale,
    cell: a.cell,
    nucleus: a.nucleus,
    cells: [...a.cells, ...b.cells],
    pathways: [...a.pathways, ...b.pathways],
    receptors: [...a.receptors, ...b.receptors, ...cross.receptors],
    nodes,
    nodeById: new Map(nodes.map((n) => [n.id, n])),
    edges: [...a.edges, ...b.edges, ...crossEdges],
    warnings: [...new Set([...a.warnings, ...b.warnings])],
  };
}
