import { buildMapGeometry } from './cellMap';
import type { CellGeom, Scene, SceneGeom } from './types';

// Cross-tissue communication: one tissue map, its cells split between two
// tissues by colour. The selected cell (in the membrane colour) starts the
// signal; it spreads through its own tissue and crosses into the other (in
// the second colour) wherever the two meet. The links that cross between
// them are drawn heavier: they are the point of the view.

/**
 * The cells in the second colour: those picked (by clicking them), or by
 * default every cell in the right-hand half of the map but the selected one.
 */
export function pinkCellIds(scene: Scene, cells: CellGeom[]): Set<string> {
  const picked = scene.module.pinkCells;
  if (picked) return new Set(picked);
  const xs = cells.map((c) => c.cell.center.x);
  const mid = (Math.min(...xs) + Math.max(...xs)) / 2;
  return new Set(cells.filter((c) => !c.hero && c.cell.center.x > mid).map((c) => c.id));
}

/** The cell a node belongs to: ids of map cells start with the cell's id; the selected cell's pathways have none. */
const cellOfNode = (id: string, hero: string) => /^(c\d+)-/.exec(id)?.[1] ?? hero;

export function buildCrossTissueGeometry(scene: Scene): SceneGeom | null {
  const g = buildMapGeometry({ ...scene, cellMap: { ...scene.cellMap, solo: false, centerHero: false, rings: 0 } });
  if (!g) return null;
  const pink = pinkCellIds(scene, g.cells);
  const hero = g.cells.find((c) => c.hero)?.id ?? '';
  const cells = g.cells.map((c) => (pink.has(c.id) ? { ...c, glow: scene.module.tissue2Color } : c));
  // Links from a cell of one tissue into a cell of the other: heavier, at full strength.
  const edges = g.edges.map((e) =>
    e.link && pink.has(cellOfNode(e.from, hero)) !== pink.has(cellOfNode(e.to, hero)) ? { ...e, opacity: 1, weight: 2.2 } : e);
  return { ...g, cells, edges };
}
