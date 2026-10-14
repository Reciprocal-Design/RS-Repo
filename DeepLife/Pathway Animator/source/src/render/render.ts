import type { Scene } from '../core/types';
import { drawDisplayList, type CanvasDrawOptions } from './canvas';
import { buildDisplayList } from './displayList';
import { drawJourney } from './journey';
import { drawRealCell, seekRealVideo } from './realCell';

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/**
 * The one pure entry point: draws `scene` at time `t` (seconds) in scene
 * coordinates. No timing logic or state lives here, so preview, PNG and
 * video frames all come from the same call. The journey composites its
 * tissue and body scenes (render/journey.ts); the real-cell view draws its
 * video under the network (render/realCell.ts).
 */
export function render(ctx: Ctx, scene: Scene, t: number, opts?: CanvasDrawOptions): void {
  if (scene.module.kind === 'journey') drawJourney(ctx, scene, t, opts);
  else if (scene.module.kind === 'realCell') drawRealCell(ctx, scene, t, opts);
  else drawDisplayList(ctx, buildDisplayList(scene, t), opts);
}

/** Anything a frame at time t needs before it can be drawn exactly (the real cell video's frame). Exports await it. */
export async function prepareFrame(scene: Scene, t: number): Promise<void> {
  if (scene.module.kind === 'realCell') await seekRealVideo(scene, t);
}
