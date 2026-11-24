"use client";

/* Layout pad: draw the overall shape of the composition on two layers.
   Tissue = where cells exist at all. Tumour = where the tumour nests sit
   (collagen rims form around them automatically). The drawing is stored as two
   alpha masks, softened, and handed to the tissue generator. */

import { useCallback, useEffect, useRef, useState } from "react";
import type { Layout } from "@/lib/engine";

const RES = 512; // drawing resolution of each layer
const MASK = 128; // resolution handed to the generator
const STORE_KEY = "stroma-field-vercel.layout";

type Tool = "brush" | "ellipse" | "rect" | "erase";
type LayerName = "tissue" | "tumour";
export type LayoutFile = { version: 1; tissue: string; tumour: string };

const TINT: Record<LayerName, string> = { tissue: "rgba(130,112,226,.55)", tumour: "rgba(221,95,166,.85)" };

function newLayer() {
  const c = document.createElement("canvas");
  c.width = c.height = RES;
  return c;
}
const loadImage = (src: string) =>
  new Promise<HTMLImageElement>((res, rej) => {
    const im = new Image();
    im.onload = () => res(im);
    im.onerror = () => rej(new Error("Could not read that layout image"));
    im.src = src;
  });

/** Downsample a layer to MASK × MASK alpha values and soften it so edges blend. */
function toMask(layer: HTMLCanvasElement) {
  const c = document.createElement("canvas");
  c.width = c.height = MASK;
  const g = c.getContext("2d", { willReadFrequently: true })!;
  g.drawImage(layer, 0, 0, MASK, MASK);
  const px = g.getImageData(0, 0, MASK, MASK).data;
  let a = new Float32Array(MASK * MASK);
  let ink = 0;
  for (let i = 0; i < a.length; i++) (a[i] = px[i * 4 + 3] / 255), (ink += a[i]);
  const r = 2;
  for (let pass = 0; pass < 3; pass++) {
    const b = new Float32Array(a.length);
    for (let y = 0; y < MASK; y++)
      for (let x = 0; x < MASK; x++) {
        let s = 0, n = 0;
        for (let dy = -r; dy <= r; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= MASK) continue;
          for (let dx = -r; dx <= r; dx++) {
            const xx = x + dx;
            if (xx < 0 || xx >= MASK) continue;
            s += a[yy * MASK + xx];
            n++;
          }
        }
        b[y * MASK + x] = s / n;
      }
    a = b;
  }
  return { mask: a, ink };
}

export function layoutFromCanvases(tissue: HTMLCanvasElement, tumour: HTMLCanvasElement): Layout | null {
  const t = toMask(tissue), u = toMask(tumour);
  if (t.ink < 1 && u.ink < 1) return null;
  return { size: MASK, tissue: t.mask, tumour: u.mask, hasTumour: u.ink >= 1 };
}

/** Rebuild the stored layout (if any) without opening the pad. */
export async function loadStoredLayout(): Promise<Layout | null> {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return null;
    const f = JSON.parse(raw) as LayoutFile;
    const t = newLayer(), u = newLayer();
    t.getContext("2d")!.drawImage(await loadImage(f.tissue), 0, 0, RES, RES);
    u.getContext("2d")!.drawImage(await loadImage(f.tumour), 0, 0, RES, RES);
    return layoutFromCanvases(t, u);
  } catch {
    return null;
  }
}

/* starting points */
const PRESETS: { id: string; label: string; draw: (t: CanvasRenderingContext2D, u: CanvasRenderingContext2D) => void }[] = [
  {
    id: "round",
    label: "Round tumour",
    draw: (t, u) => {
      t.beginPath(); t.ellipse(256, 256, 210, 180, 0, 0, Math.PI * 2); t.fill();
      u.beginPath(); u.ellipse(256, 256, 110, 95, 0, 0, Math.PI * 2); u.fill();
    },
  },
  {
    id: "ring",
    label: "Ring",
    draw: (t, u) => {
      t.beginPath(); t.ellipse(256, 256, 220, 200, 0, 0, Math.PI * 2); t.fill();
      u.lineWidth = 70; u.beginPath(); u.ellipse(256, 256, 130, 115, 0, 0, Math.PI * 2); u.stroke();
    },
  },
  {
    id: "lobes",
    label: "Two lobes",
    draw: (t, u) => {
      t.beginPath(); t.ellipse(180, 230, 150, 130, -0.3, 0, Math.PI * 2); t.fill();
      t.beginPath(); t.ellipse(340, 300, 150, 140, 0.2, 0, Math.PI * 2); t.fill();
      u.beginPath(); u.ellipse(170, 220, 70, 60, -0.3, 0, Math.PI * 2); u.fill();
      u.beginPath(); u.ellipse(350, 310, 80, 70, 0.2, 0, Math.PI * 2); u.fill();
    },
  },
  {
    id: "band",
    label: "Diagonal band",
    draw: (t, u) => {
      t.lineCap = u.lineCap = "round";
      t.lineWidth = 230; t.beginPath(); t.moveTo(40, 470); t.lineTo(470, 40); t.stroke();
      u.lineWidth = 90; u.beginPath(); u.moveTo(120, 390); u.lineTo(390, 120); u.stroke();
    },
  },
];

export default function LayoutPad({ open, onClose, onApply, frame, active }: {
  open: boolean;
  onClose: () => void;
  onApply: (layout: Layout | null) => void;
  frame: { w: number; h: number }; // visible part of the map, as fractions of the full grid
  active: boolean;
}) {
  const dlg = useRef<HTMLDialogElement>(null);
  const view = useRef<HTMLCanvasElement>(null);
  const layers = useRef<Record<LayerName, HTMLCanvasElement> | null>(null);
  const undo = useRef<{ layer: LayerName; data: ImageData }[]>([]);
  const drag = useRef<{ x0: number; y0: number; x: number; y: number; last: [number, number] } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [tool, setTool] = useState<Tool>("brush");
  const [layer, setLayer] = useState<LayerName>("tissue");
  const [size, setSize] = useState(48);
  const [note, setNote] = useState("");
  const [, bump] = useState(0);

  const ensure = useCallback(() => {
    if (!layers.current) layers.current = { tissue: newLayer(), tumour: newLayer() };
    return layers.current;
  }, []);

  const render = useCallback(() => {
    const c = view.current;
    if (!c) return;
    const L = ensure(), g = c.getContext("2d")!, W = c.width;
    g.clearRect(0, 0, W, W);
    g.fillStyle = "#ececf0";
    g.fillRect(0, 0, W, W);
    // faint dot grid so the pad reads as the dot matrix
    g.fillStyle = "rgba(90,88,110,.18)";
    for (let y = 16; y < W; y += 32) for (let x = 16; x < W; x += 32) g.fillRect(x - 1, y - 1, 2, 2);
    for (const name of ["tissue", "tumour"] as LayerName[]) {
      const tmp = document.createElement("canvas");
      tmp.width = tmp.height = W;
      const tg = tmp.getContext("2d")!;
      tg.drawImage(L[name], 0, 0, W, W);
      tg.globalCompositeOperation = "source-in";
      tg.fillStyle = TINT[name];
      tg.fillRect(0, 0, W, W);
      g.drawImage(tmp, 0, 0);
    }
    // shape being dragged out
    const d = drag.current;
    if (d && (tool === "ellipse" || tool === "rect")) {
      g.save();
      g.setLineDash([6, 5]);
      g.strokeStyle = "#25242d";
      g.lineWidth = 1.5;
      g.beginPath();
      const s = W / RES, x = Math.min(d.x0, d.x) * s, y = Math.min(d.y0, d.y) * s, w = Math.abs(d.x - d.x0) * s, h = Math.abs(d.y - d.y0) * s;
      if (tool === "rect") g.rect(x, y, w, h);
      else g.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
      g.stroke();
      g.restore();
    }
    // the part of the composition that is on screen
    const fw = Math.min(1, frame.w) * W, fh = Math.min(1, frame.h) * W;
    g.save();
    g.strokeStyle = "rgba(37,36,45,.7)";
    g.setLineDash([4, 4]);
    g.lineWidth = 1;
    g.strokeRect((W - fw) / 2 + 0.5, (W - fh) / 2 + 0.5, fw - 1, fh - 1);
    g.restore();
  }, [ensure, frame.w, frame.h, tool]);

  // open / close, restoring the saved drawing
  useEffect(() => {
    const d = dlg.current;
    if (!d) return;
    if (open && !d.open) {
      d.showModal();
      const L = ensure();
      setNote("");
      (async () => {
        try {
          const raw = localStorage.getItem(STORE_KEY);
          if (raw && undo.current.length === 0) await readFile(JSON.parse(raw) as LayoutFile, L);
        } catch {}
        render();
      })();
    } else if (!open && d.open) d.close();
  }, [open, ensure, render]);

  useEffect(render, [render, layer, size]);

  async function readFile(f: LayoutFile, L = ensure()) {
    if (!f || f.version !== 1 || !f.tissue || !f.tumour) throw new Error("That file is not a Stroma Field layout");
    const [a, b] = await Promise.all([loadImage(f.tissue), loadImage(f.tumour)]);
    for (const [name, im] of [["tissue", a], ["tumour", b]] as const) {
      const g = L[name].getContext("2d")!;
      g.clearRect(0, 0, RES, RES);
      g.drawImage(im, 0, 0, RES, RES);
    }
  }
  const snapshot = (name: LayerName) => {
    const L = ensure();
    undo.current.push({ layer: name, data: L[name].getContext("2d")!.getImageData(0, 0, RES, RES) });
    if (undo.current.length > 40) undo.current.shift();
  };
  const toPad = (ev: React.PointerEvent) => {
    const r = view.current!.getBoundingClientRect();
    return [((ev.clientX - r.left) / r.width) * RES, ((ev.clientY - r.top) / r.height) * RES] as [number, number];
  };
  const ctxFor = (name: LayerName, erase: boolean) => {
    const g = ensure()[name].getContext("2d")!;
    g.globalCompositeOperation = erase ? "destination-out" : "source-over";
    g.fillStyle = g.strokeStyle = "#fff";
    g.lineCap = g.lineJoin = "round";
    return g;
  };

  const down = (ev: React.PointerEvent) => {
    ev.currentTarget.setPointerCapture(ev.pointerId);
    const [x, y] = toPad(ev);
    snapshot(layer);
    drag.current = { x0: x, y0: y, x, y, last: [x, y] };
    if (tool === "brush" || tool === "erase") {
      const g = ctxFor(layer, tool === "erase");
      g.beginPath();
      g.arc(x, y, size / 2, 0, Math.PI * 2);
      g.fill();
      render();
    }
  };
  const move = (ev: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const [x, y] = toPad(ev);
    d.x = x;
    d.y = y;
    if (tool === "brush" || tool === "erase") {
      const g = ctxFor(layer, tool === "erase");
      g.lineWidth = size;
      g.beginPath();
      g.moveTo(d.last[0], d.last[1]);
      g.lineTo(x, y);
      g.stroke();
      d.last = [x, y];
    }
    render();
  };
  const up = () => {
    const d = drag.current;
    drag.current = null;
    if (d && (tool === "ellipse" || tool === "rect")) {
      const g = ctxFor(layer, false);
      const x = Math.min(d.x0, d.x), y = Math.min(d.y0, d.y), w = Math.abs(d.x - d.x0), h = Math.abs(d.y - d.y0);
      if (w > 3 && h > 3) {
        g.beginPath();
        if (tool === "rect") g.rect(x, y, w, h);
        else g.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
        g.fill();
      } else undo.current.pop();
    }
    render();
    bump((n) => n + 1);
  };

  const clearLayer = (name: LayerName | "both") => {
    const L = ensure();
    for (const n of name === "both" ? (["tissue", "tumour"] as LayerName[]) : [name]) {
      snapshot(n);
      L[n].getContext("2d")!.clearRect(0, 0, RES, RES);
    }
    render();
  };
  const preset = (id: string) => {
    const p = PRESETS.find((q) => q.id === id)!;
    clearLayer("both");
    const L = ensure();
    const t = ctxFor("tissue", false), u = ctxFor("tumour", false);
    p.draw(t, u);
    t.lineWidth = u.lineWidth = 1;
    render();
    void L;
  };
  const doUndo = () => {
    const last = undo.current.pop();
    if (!last) return;
    ensure()[last.layer].getContext("2d")!.putImageData(last.data, 0, 0);
    render();
    bump((n) => n + 1);
  };
  const toFile = (): LayoutFile => {
    const L = ensure();
    return { version: 1, tissue: L.tissue.toDataURL("image/png"), tumour: L.tumour.toDataURL("image/png") };
  };
  const apply = () => {
    const L = ensure();
    const layout = layoutFromCanvases(L.tissue, L.tumour);
    if (!layout) {
      setNote("Draw a tissue or tumour shape first, or choose Use random.");
      return;
    }
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(toFile()));
    } catch {}
    onApply(layout);
    onClose();
  };
  const useRandom = () => {
    onApply(null);
    onClose();
  };
  const save = () => {
    const blob = new Blob([JSON.stringify(toFile())], { type: "application/json" });
    const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: "stroma-field-layout.json" });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    setNote("Layout file saved.");
  };
  const openFile = async (file: File) => {
    try {
      snapshot("tissue");
      snapshot("tumour");
      await readFile(JSON.parse(await file.text()) as LayoutFile);
      render();
      setNote(`Opened ${file.name}. Press Apply to use it.`);
    } catch (e) {
      setNote(`Could not open ${file.name}: ${(e as Error).message}.`);
    }
  };

  return (
    <dialog ref={dlg} className="pad-dlg" aria-labelledby="padTitle" onCancel={(e) => { e.preventDefault(); onClose(); }}>
      <div className="xp pad">
        <header>
          <h2 id="padTitle">Layout</h2>
          <button className="close" type="button" aria-label="Close layout" onClick={onClose}>×</button>
        </header>
        <p className="pad-help">
          Draw the shape of the composition. <b className="sw-tissue">Tissue</b> is where cells grow; <b className="sw-tumour">Tumour</b> places the nests, and collagen rims form around them. Leave Tumour empty to scatter nests through the tissue. The dashed frame is what fits on screen now.
        </p>
        <div className="pad-body">
          <canvas
            ref={view}
            className="pad-canvas"
            width={RES}
            height={RES}
            aria-label="Layout drawing pad"
            onPointerDown={down}
            onPointerMove={move}
            onPointerUp={up}
            onPointerCancel={up}
          />
          <div className="pad-tools">
            <div className="pad-group" role="group" aria-label="Layer">
              <span className="label">Layer</span>
              <div className="seg">
                <button type="button" className="chip" aria-pressed={layer === "tissue"} onClick={() => setLayer("tissue")}><i className="sw sw-tissue" />Tissue</button>
                <button type="button" className="chip" aria-pressed={layer === "tumour"} onClick={() => setLayer("tumour")}><i className="sw sw-tumour" />Tumour</button>
              </div>
            </div>
            <div className="pad-group" role="group" aria-label="Tool">
              <span className="label">Tool</span>
              <div className="seg">
                {(["brush", "ellipse", "rect", "erase"] as Tool[]).map((t) => (
                  <button key={t} type="button" className="chip" aria-pressed={tool === t} onClick={() => setTool(t)}>
                    {t === "brush" ? "Brush" : t === "ellipse" ? "Ellipse" : t === "rect" ? "Rectangle" : "Eraser"}
                  </button>
                ))}
              </div>
            </div>
            <label className="pad-group">
              <span className="label">Brush size</span>
              <input type="range" min={8} max={160} step={2} value={size} onChange={(e) => setSize(+e.target.value)} />
            </label>
            <div className="pad-group">
              <span className="label">Start from</span>
              <div className="seg">
                {PRESETS.map((p) => (
                  <button key={p.id} type="button" className="chip" onClick={() => preset(p.id)}>{p.label}</button>
                ))}
              </div>
            </div>
            <div className="seg">
              <button type="button" className="chip" onClick={doUndo} disabled={undo.current.length === 0}>Undo</button>
              <button type="button" className="chip" onClick={() => clearLayer(layer)}>Clear {layer}</button>
              <button type="button" className="chip" onClick={() => clearLayer("both")}>Clear all</button>
            </div>
            <div className="seg">
              <button type="button" className="chip" onClick={save}>Save file</button>
              <button type="button" className="chip" onClick={() => fileRef.current?.click()}>Open file</button>
              <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void openFile(f); e.target.value = ""; }} />
            </div>
          </div>
        </div>
        {note && <p className="ok" role="status">{note}</p>}
        <footer>
          <button className="btn" type="button" onClick={useRandom}>{active ? "Back to random" : "Use random"}</button>
          <button className="btn primary" type="button" onClick={apply}>Apply layout</button>
        </footer>
      </div>
    </dialog>
  );
}
