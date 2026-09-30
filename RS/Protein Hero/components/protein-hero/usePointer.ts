import { useEffect, useRef } from "react";

export type PointerState = {
  /** Target pointer position over the hero, -1..1 (y up); 0,0 when the cursor is away. */
  x: number;
  y: number;
  /** Eased copy of x/y, advanced by the scene each frame. */
  smoothX: number;
  smoothY: number;
  dragging: boolean;
  /** Accumulated drag in pixels since the last frame read it. */
  dragDX: number;
  dragDY: number;
};

const INTERACTIVE = "a, button, input, select, textarea, [data-no-drag]";

/**
 * Tracks the cursor over `target` (for the gentle lean) and drag gestures (for free rotation).
 * Uses plain DOM events so text and buttons layered over the canvas keep working.
 */
export function usePointer(target: React.RefObject<HTMLElement | null>) {
  const state = useRef<PointerState>({ x: 0, y: 0, smoothX: 0, smoothY: 0, dragging: false, dragDX: 0, dragDY: 0 });

  useEffect(() => {
    const el = target.current;
    if (!el) return;
    const s = state.current;
    let last: { x: number; y: number; id: number } | null = null;

    const onMove = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
      if (e.pointerType === "mouse" && inside) {
        s.x = ((e.clientX - r.left) / r.width) * 2 - 1;
        s.y = -(((e.clientY - r.top) / r.height) * 2 - 1);
      }
      if (last && e.pointerId === last.id) {
        s.dragDX += e.clientX - last.x;
        s.dragDY += e.clientY - last.y;
        last = { x: e.clientX, y: e.clientY, id: e.pointerId };
      }
    };
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0 || (e.target as Element).closest(INTERACTIVE)) return;
      last = { x: e.clientX, y: e.clientY, id: e.pointerId };
      s.dragging = true;
      el.dataset.dragging = "true";
    };
    const onUp = (e: PointerEvent) => {
      if (!last || e.pointerId !== last.id) return;
      last = null;
      s.dragging = false;
      delete el.dataset.dragging;
    };
    const onLeave = (e: PointerEvent) => {
      if (e.pointerType === "mouse") s.x = s.y = 0;
    };

    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointerleave", onLeave);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointerleave", onLeave);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [target]);

  return state;
}
