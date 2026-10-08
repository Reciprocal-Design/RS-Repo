import { buildBodyGeometry } from './body';
import { buildMapGeometry, mapActive } from './cellMap';
import { connectCrosstalk, connectPathway } from './connect';
import { cellFrame, decorativeReceptors, layoutPathway } from './layout';
import { applyModule } from './modules';
import type { NodeGeom, Scene, SceneGeom } from './types';

const cache = new WeakMap<Scene, SceneGeom>();

/**
 * Derive all geometry from a Scene. Pure and deterministic; memoised by Scene
 * identity (scenes are immutable in the store), so it runs once per edit.
 * Visibility flags are deliberately never read here: hiding the membrane or
 * nucleus never moves anything.
 */
export function buildGeometry(scene: Scene): SceneGeom {
  const hit = cache.get(scene);
  if (hit) return hit;
  const geom = scene.module.kind === 'body'
    ? buildBodyGeometry(scene)
    : applyModule(scene, (mapActive(scene) && buildMapGeometry(scene)) || buildCellGeometry(scene));
  cache.set(scene, geom);
  return geom;
}

function buildCellGeometry(scene: Scene): SceneGeom {
  const frame = cellFrame(scene);
  const pathways = scene.pathways.slice(0, Math.max(1, scene.pathwayCount));
  const layouts = pathways.map((p, i) => layoutPathway(frame, scene, p, i));
  const nodes = layouts.flatMap((l) => l.nodes);
  const edges = [
    ...pathways.flatMap((p, i) => connectPathway(scene, p, layouts[i])),
    ...connectCrosstalk(scene, layouts, pathways, frame.R),
  ];
  const nodeById = new Map<string, NodeGeom>(nodes.map((n) => [n.id, n]));

  return {
    scale: frame.scale,
    cell: frame.cell,
    nucleus: frame.nucleus,
    cells: [{ id: '', cell: frame.cell, nucleus: frame.nucleus, enabled: true }],
    pathways: pathways.map((p) => ({ id: p.id, startDelay: p.startDelay })),
    receptors: [...layouts.map((l) => l.receptor), ...decorativeReceptors(frame, scene)],
    nodes,
    nodeById,
    edges,
    warnings: [...new Set(layouts.flatMap((l) => l.warnings))],
  };
}
