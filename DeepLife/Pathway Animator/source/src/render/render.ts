import type { Scene } from '../core/types';
import { drawDisplayList, type CanvasDrawOptions } from './canvas';
import { buildDisplayList } from './displayList';
import { drawJourney } from './journey';

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/**
 * The one pure entry point: draws `scene` at time `t` (seconds) in scene
 * coordinates. No timing logic or state lives here, so preview, PNG and
 * video frames all come from the same call. The journey composites its
 * tissue and body scenes (render/journey.ts).
 */
export function render(ctx: Ctx, scene: Scene, t: number, opts?: CanvasDrawOptions): void {
  if (scene.module.kind === 'journey') drawJourney(ctx, scene, t, opts);
  else drawDisplayList(ctx, buildDisplayList(scene, t), opts);
}
