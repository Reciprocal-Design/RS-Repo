import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { heroCellOf, mapActive, soloActive } from '../core/cellMap';
import { realVideoInfo } from '../core/realVideo';
import { cycleTime } from '../core/timeline';
import { realCellState, videoTimeAt } from '../render/realCell';
import { render } from '../render/render';
import { useApp } from './store';

/** Canvas preview, fit to the available space at the scene's aspect ratio. */
export function Preview() {
  const scene = useApp((s) => s.scene);
  const time = useApp((s) => s.time);
  const clickMapCell = useApp((s) => s.clickMapCell);
  const togglePinkCell = useApp((s) => s.togglePinkCell);
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const playing = useApp((s) => s.playing);
  // Bumped when the real cell video lands on a new frame, so the canvas redraws with it.
  const [videoFrame, setVideoFrame] = useState(0);

  // The real-cell view: keep its video in step with the timeline. While
  // playing, the video plays along (nudged back when it drifts); when paused
  // or scrubbed, it seeks to the exact frame.
  const realVideo = scene.module.kind === 'realCell' ? realVideoInfo(scene.module.realVideo) : undefined;
  useEffect(() => {
    if (!realVideo) return;
    const v = realVideo.video;
    const tau = cycleTime(scene, time);
    const want = videoTimeAt(scene, tau, realVideo.duration);
    const showing = realCellState(scene, tau).video > 0;
    if (playing && showing) {
      if (v.paused) v.play().catch(() => {});
      if (Math.abs(v.currentTime - want) > 0.25) v.currentTime = want;
    } else {
      if (!v.paused) v.pause();
      if (Math.abs(v.currentTime - want) > 0.04) v.currentTime = want;
    }
  }, [realVideo, scene, time, playing]);
  useEffect(() => {
    if (!realVideo) return;
    const v = realVideo.video;
    const bump = () => setVideoFrame((n) => n + 1);
    v.addEventListener('seeked', bump);
    return () => {
      v.removeEventListener('seeked', bump);
      v.pause();
    };
  }, [realVideo]);

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
  }, [scene, time, cssW, cssH, W, H, videoFrame]);

  // Cells can be clicked on a map, but not in a solo view (one cell) or the two-tissue view.
  const onMap = mapActive(scene) && !soloActive(scene) && scene.module.kind !== 'crossTissue';
  const picking = onMap && !!heroCellOf(scene.cellMap);
  // Cross-tissue: clicking a cell switches its colour.
  const colouring = scene.module.kind === 'crossTissue';
  return (
    <div className="preview" ref={wrapRef}>
      <canvas
        ref={canvasRef}
        style={{ width: cssW, height: cssH, cursor: onMap || colouring ? 'pointer' : undefined }}
        title={
          colouring ? 'Click a cell to switch it between purple and pink'
            : picking ? 'Click a cell to select it; Alt-click to add or remove its pathways; Shift-click to re-roll it'
            : onMap ? 'Click a cell to add or remove its pathways; Shift-click to re-roll it' : undefined
        }
        onClick={(e) => {
          if (!(onMap || colouring) || !cssW) return;
          const r = e.currentTarget.getBoundingClientRect();
          const p = { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H };
          if (colouring) togglePinkCell(p);
          else clickMapCell(p, e.shiftKey, e.altKey);
        }}
      />
    </div>
  );
}
