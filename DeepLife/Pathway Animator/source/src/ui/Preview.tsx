import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { heroCellOf, mapActive, soloActive } from '../core/cellMap';
import { render } from '../render/render';
import { useApp } from './store';

/** Canvas preview, fit to the available space at the scene's aspect ratio. */
export function Preview() {
  const scene = useApp((s) => s.scene);
  const time = useApp((s) => s.time);
  const clickMapCell = useApp((s) => s.clickMapCell);
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });

  useLayoutEffect(() => {
    const el = wrapRef.current!;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setBox({ w: width, h: height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { width: W, height: H } = scene.canvas;
  const fit = box.w && box.h ? Math.min(box.w / W, box.h / H) : 0;
  const cssW = Math.floor(W * fit), cssH = Math.floor(H * fit);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !cssW || !cssH) return;
    const dpr = window.devicePixelRatio || 1;
    // Only resize when needed: resizing reallocates the canvas every frame otherwise.
    const bw = Math.round(cssW * dpr), bh = Math.round(cssH * dpr);
    if (canvas.width !== bw) canvas.width = bw;
    if (canvas.height !== bh) canvas.height = bh;
    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(canvas.width / W, 0, 0, canvas.height / H, 0, 0);
    render(ctx, scene, time);
  }, [scene, time, cssW, cssH, W, H]);

  // Cells can be clicked on a map, but not in a solo view (one cell) or the two-tissue view.
  const onMap = mapActive(scene) && !soloActive(scene) && scene.module.kind !== 'crossTissue';
  const picking = onMap && !!heroCellOf(scene.cellMap);
  return (
    <div className="preview" ref={wrapRef}>
      <canvas
        ref={canvasRef}
        style={{ width: cssW, height: cssH, cursor: onMap ? 'pointer' : undefined }}
        title={
          picking ? 'Click a cell to select it; Alt-click to add or remove its pathways; Shift-click to re-roll it'
            : onMap ? 'Click a cell to add or remove its pathways; Shift-click to re-roll it' : undefined
        }
        onClick={(e) => {
          if (!onMap || !cssW) return;
          const r = e.currentTarget.getBoundingClientRect();
          const p = { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H };
          clickMapCell(p, e.shiftKey, e.altKey);
        }}
      />
    </div>
  );
}
