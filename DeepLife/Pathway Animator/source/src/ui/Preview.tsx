import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { render } from '../render/render';
import { useApp } from './store';

/** Canvas preview, fit to the available space at the scene's aspect ratio. */
export function Preview() {
  const scene = useApp((s) => s.scene);
  const time = useApp((s) => s.time);
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

  return (
    <div className="preview" ref={wrapRef}>
      <canvas ref={canvasRef} style={{ width: cssW, height: cssH }} />
    </div>
  );
}
