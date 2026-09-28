import type { Scene } from '../core/types';
import { drawDisplayList, type CanvasDrawOptions } from './canvas';
import { buildDisplayList } from './displayList';

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/**
 * The one pure entry point: draws `scene` at time `t` (seconds) in scene
 * coordinates. No timing logic or state lives here, so preview, PNG and
 * video frames all come from the same call.
 */
export function render(ctx: Ctx, scene: Scene, t: number, opts?: CanvasDrawOptions): void {
  drawDisplayList(ctx, buildDisplayList(scene, t), opts);
}
