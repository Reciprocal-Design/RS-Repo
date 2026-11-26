"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { canEncode, download, even, exportMedia, hasWebCodecs, type ExportApp, type Format, type Quality } from "@/lib/exportMedia";

export type Clip = "sweep" | "loop";
export const CLIP_SECONDS = { sweep: 15, loop: 6 } as const;

const EXT: Record<Format, string> = { mp4: "mp4", webm: "webm", "png-seq": "zip", png: "png", realtime: "webm" };
const FPS_EXACT: Record<string, number> = { "23.976": 24000 / 1001, "29.97": 30000 / 1001 };
const FPS_FFMPEG: Record<string, string> = { "23.976": "24000/1001", "29.97": "30000/1001" };
const SIZES = [
  ["1920x1080", "1080p · 1920 × 1080"],
  ["2560x1440", "1440p · 2560 × 1440"],
  ["3840x2160", "4K · 3840 × 2160"],
  ["1080x1080", "Square · 1080 × 1080"],
  ["1080x1920", "Vertical · 1080 × 1920"],
  ["custom", "Custom"],
];
const KEY = "stroma-field-vercel.export";

type Saved = { format: Format; quality: Quality; sizeV: string; w: number; h: number; fpsV: string; fpsCustom: number; alpha: boolean; matte: string; clip: Clip; loops: number };
const DEFAULTS: Saved = { format: "mp4", quality: "high", sizeV: "1920x1080", w: 1920, h: 1080, fpsV: "30", fpsCustom: 30, alpha: false, matte: "#06050c", clip: "sweep", loops: 2 };

const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
const isChromium = () => {
  const brands = (navigator as Navigator & { userAgentData?: { brands: { brand: string }[] } }).userAgentData?.brands || [];
  return brands.some((b) => /Chromium|Chrome|Edge/.test(b.brand));
};

export default function ExportPanel({ open, onClose, app, setClip, doseLabel, matte }: {
  open: boolean;
  onClose: () => void;
  app: ExportApp;
  setClip: (c: Clip) => void;
  doseLabel: string;
  matte: string;
}) {
  const dlg = useRef<HTMLDialogElement>(null);
  const [s, setS] = useState<Saved>(DEFAULTS);
  const [range, setRange] = useState<{ start: number; end: number }>({ start: 0, end: CLIP_SECONDS.sweep });
  const [name, setName] = useState("");
  const [nameTouched, setNameTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ frame: number; total: number; eta: number | null } | null>(null);
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");
  const [encodeNote, setEncodeNote] = useState<string>("");
  const [copied, setCopied] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  // browser capabilities are read after mount so the server render matches the first client render
  const [mounted, setMounted] = useState(false);
  const [webcodecs, setWebcodecs] = useState(true);
  useEffect(() => {
    setWebcodecs(hasWebCodecs());
    setMounted(true);
  }, []);

  // open / close the native dialog, restoring the last settings
  useEffect(() => {
    const d = dlg.current;
    if (!d) return;
    if (open && !d.open) {
      let saved: Partial<Saved> = {};
      try {
        saved = JSON.parse(localStorage.getItem(KEY) || "{}") || {};
      } catch {}
      const next = { ...DEFAULTS, ...saved, matte };
      if (!webcodecs && (next.format === "mp4" || next.format === "webm")) next.format = "png-seq";
      setS(next);
      setRange({ start: 0, end: next.clip === "sweep" ? CLIP_SECONDS.sweep : CLIP_SECONDS.loop * next.loops });
      setNameTouched(false);
      setError("");
      setOk("");
      setProgress(null);
      d.showModal();
    } else if (!open && d.open) d.close();
  }, [open, webcodecs, matte]);

  const o = useMemo(() => {
    const [w0, h0] = s.sizeV === "custom" ? [s.w, s.h] : s.sizeV.split("x").map(Number);
    const width = clamp(Math.round(w0 || 1920), 16, 7680), height = clamp(Math.round(h0 || 1080), 16, 7680);
    const fps = s.fpsV === "custom" ? clamp(s.fpsCustom || 30, 1, 120) : FPS_EXACT[s.fpsV] ?? +s.fpsV;
    const fpsLabel = s.fpsV === "custom" ? String(+fps.toFixed(3)) : s.fpsV;
    const span = s.clip === "sweep" ? CLIP_SECONDS.sweep : CLIP_SECONDS.loop * s.loops;
    const start = clamp(range.start || 0, 0, span);
    let end = clamp(range.end || span, 0, span);
    if (end <= start) end = Math.min(span, start + 1 / fps);
    const isVideo = s.format === "mp4" || s.format === "webm" || s.format === "realtime";
    const W = isVideo ? even(width) : width, H = isVideo ? even(height) : height;
    const transparent = s.alpha && s.format !== "mp4";
    const defName = `stroma-field_${W}x${H}_${fpsLabel}fps`;
    const finalName = ((nameTouched ? name.trim() : "") || defName).replace(/[\\/:*?"<>|]+/g, "-");
    const frames = s.format === "png" ? 1 : Math.max(1, Math.round((end - start) * fps));
    return { width, height, W, H, fps, fpsLabel, span, start, end, transparent, defName, finalName, frames, isVideo };
  }, [s, range, name, nameTouched]);

  useEffect(() => {
    if (!nameTouched) setName(o.defName);
  }, [o.defName, nameTouched]);

  // ask the browser whether it can encode this codec at this size
  useEffect(() => {
    let live = true;
    setEncodeNote("");
    if (!open || !(s.format === "mp4" || s.format === "webm") || !webcodecs) return;
    canEncode(s.format, o.W, o.H, s.quality, o.fps, o.transparent)
      .then((can) => {
        if (live && !can) setEncodeNote(`This browser cannot encode ${s.format === "mp4" ? "H.264" : "VP9"} at ${o.W} × ${o.H}.${o.W * o.H > 1920 * 1080 ? " Try 1080p." : " Try the other video format or a PNG sequence."}`);
      })
      .catch(() => live && setEncodeNote("The video encoder could not load. Check your connection and reload the page."));
    return () => {
      live = false;
    };
  }, [open, s.format, s.quality, o.W, o.H, o.fps, o.transparent, webcodecs]);

  const set = <K extends keyof Saved>(k: K, v: Saved[K]) => setS((p) => ({ ...p, [k]: v }));
  const setClipKind = (clip: Clip) => {
    setS((p) => ({ ...p, clip }));
    setRange({ start: 0, end: clip === "sweep" ? CLIP_SECONDS.sweep : CLIP_SECONDS.loop * s.loops });
  };

  const notes: [string, string][] = [];
  if (!webcodecs) notes.push(["warn", "Video export needs a recent Chrome, Edge or Safari. PNG sequence still works."]);
  if (encodeNote) notes.push(["warn", encodeNote]);
  if (s.format === "mp4") notes.push(["", "MP4 cannot carry transparency. Use WebM for web pages, or the PNG sequence for editing software."]);
  if (s.format === "webm" && o.transparent)
    notes.push([typeof navigator !== "undefined" && isChromium() ? "" : "warn", "Transparent WebM is encoded by Chrome and Edge. It does not open in QuickTime, Safari or most editors; for After Effects, Premiere, DaVinci or Final Cut use the PNG sequence."]);
  if (s.format === "png-seq") {
    notes.push(["", `Frames are named ${o.finalName}_00001.png onwards. To make a ProRes 4444 .mov with alpha:`]);
    if (o.frames > 1500 || Math.max(o.W, o.H) >= 3840)
      notes.push(["warn", `${o.frames} frames at this size use a lot of memory. ${typeof window !== "undefined" && "showDirectoryPicker" in window ? "You will be asked for a folder to write frames into directly." : "Consider a shorter range or smaller size."}`]);
  }
  if (s.format === "realtime") notes.push(["warn", "Realtime recording plays the clip live while recording. It can drop frames and may lose transparency."]);
  if (s.format !== "png") notes.push(["", "Frame rate is constant. Each frame is rendered exactly at frame ÷ fps, never screen-recorded."]);
  const ffmpeg = `ffmpeg -framerate ${FPS_FFMPEG[s.fpsV] || +o.fps.toFixed(3)} -i ${o.finalName}_%05d.png -c:v prores_ks -profile:v 4444 -pix_fmt yuva444p10le ${o.finalName}.mov`;

  async function run(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    let dir: FileSystemDirectoryHandle | null = null;
    const w = window as Window & { showDirectoryPicker?: (o: { mode: string }) => Promise<FileSystemDirectoryHandle> };
    if (s.format === "png-seq" && (o.frames > 1500 || Math.max(o.W, o.H) >= 3840) && w.showDirectoryPicker) {
      try {
        dir = await w.showDirectoryPicker({ mode: "readwrite" });
      } catch (err) {
        if ((err as Error)?.name === "AbortError") return;
      }
    }
    try {
      localStorage.setItem(KEY, JSON.stringify(s));
    } catch {}
    const ac = new AbortController();
    abortRef.current = ac;
    setBusy(true);
    setError("");
    setOk("");
    setProgress({ frame: 0, total: o.frames, eta: null });
    setClip(s.clip);
    try {
      const res = await exportMedia(
        app,
        { format: s.format, fps: o.fps, width: o.W, height: o.H, start: o.start, end: o.end, transparent: o.transparent, quality: s.quality, name: o.finalName, matte: s.matte, dir },
        setProgress,
        ac.signal,
      );
      if ("folder" in res) setOk(`Wrote ${o.frames} frames to the folder you chose.`);
      else {
        const file = `${o.finalName}.${res.ext}`;
        download(res.blob, file);
        setOk(`Saved ${file} (${(res.blob.size / 1048576).toFixed(1)} MB).`);
      }
    } catch (err) {
      const msg = String((err as Error)?.message || err);
      if ((err as Error)?.name === "AbortError") setOk("Export cancelled. Nothing was saved.");
      else if (/memory|allocation|Array buffer/i.test(msg)) setError(`Ran out of memory while exporting. Try a shorter range or a smaller size. (${msg})`);
      else if (/not supported|unsupported|codec/i.test(msg)) setError(`The browser refused this codec or size. Try 1080p, or switch between MP4 and WebM. (${msg})`);
      else setError(`Export failed: ${msg}. Try a smaller size or another format.`);
      if ((err as Error)?.name !== "AbortError") {
        setProgress(null);
        console.error(err);
      }
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  }

  const closeOrCancel = () => (busy ? abortRef.current?.abort() : onClose());
  const pct = progress ? (progress.frame / progress.total) * 100 : 0;
  const progText = !progress
    ? ""
    : busy
      ? progress.frame === 0
        ? "Preparing…"
        : `${progress.frame} / ${progress.total}${progress.eta != null && progress.frame < progress.total ? ` · ${progress.eta < 60 ? Math.ceil(progress.eta) + " s" : Math.ceil(progress.eta / 60) + " min"} left` : ""}`
      : ok.startsWith("Export cancelled")
        ? "Cancelled"
        : "Done";

  return (
    <dialog
      ref={dlg}
      aria-labelledby="xTitle"
      onCancel={(e) => {
        e.preventDefault();
        closeOrCancel();
      }}
    >
      {mounted && <form className="xp" onSubmit={run} noValidate>
        <header>
          <h2 id="xTitle">Export</h2>
          <button className="close" type="button" aria-label="Close export" onClick={closeOrCancel}>×</button>
        </header>
        <fieldset className="clips" disabled={busy}>
          <legend>Clip</legend>
          <label className="clip">
            <input type="radio" name="clip" checked={s.clip === "sweep"} onChange={() => setClipKind("sweep")} />
            <span>
              <strong>Two-stage treatment</strong>
              <em>15 s: antibody clears the ECM, then chemotherapy clears the tumour{doseLabel ? "" : ""}</em>
            </span>
          </label>
          <label className="clip">
            <input type="radio" name="clip" checked={s.clip === "loop"} onChange={() => setClipKind("loop")} />
            <span>
              <strong>Current state, looping</strong>
              <em>6 s seamless loop of what you see now</em>
            </span>
          </label>
        </fieldset>
        <fieldset className="xgrid" disabled={busy}>
          <label className="f">
            <span>Format</span>
            <select value={s.format} onChange={(e) => set("format", e.target.value as Format)}>
              <option value="mp4" disabled={!webcodecs}>MP4 (H.264)</option>
              <option value="webm" disabled={!webcodecs}>WebM (VP9)</option>
              <option value="png-seq">PNG sequence (.zip)</option>
              <option value="png">Single frame (PNG)</option>
              {!webcodecs && <option value="realtime">WebM, realtime recording (fallback)</option>}
            </select>
          </label>
          {(s.format === "mp4" || s.format === "webm") && (
            <label className="f">
              <span>Quality</span>
              <select value={s.quality} onChange={(e) => set("quality", e.target.value as Quality)}>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="veryHigh">Very high</option>
              </select>
            </label>
          )}
          <label className="f">
            <span>Size</span>
            <select value={s.sizeV} onChange={(e) => set("sizeV", e.target.value)}>
              {SIZES.map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </select>
          </label>
          {s.sizeV === "custom" && (
            <div className="pair">
              <label className="f"><span>Width</span><input type="number" min={16} max={7680} step={2} value={s.w} onChange={(e) => set("w", +e.target.value)} /></label>
              <span className="x">×</span>
              <label className="f"><span>Height</span><input type="number" min={16} max={7680} step={2} value={s.h} onChange={(e) => set("h", +e.target.value)} /></label>
            </div>
          )}
          <label className="f">
            <span>Frame rate</span>
            <select value={s.fpsV} onChange={(e) => set("fpsV", e.target.value)}>
              {["24", "23.976", "25", "29.97", "30", "50", "60"].map((v) => (
                <option key={v} value={v}>{v}</option>
              ))}
              <option value="custom">Custom</option>
            </select>
          </label>
          {s.fpsV === "custom" && (
            <label className="f"><span>Custom fps</span><input type="number" min={1} max={120} step={0.001} value={s.fpsCustom} onChange={(e) => set("fpsCustom", +e.target.value)} /></label>
          )}
          <label className="check">
            <input type="checkbox" checked={s.alpha && s.format !== "mp4"} disabled={s.format === "mp4"} onChange={(e) => set("alpha", e.target.checked)} />
            <span>Transparent background</span>
          </label>
          {!o.transparent && (
            <label className="f"><span>Background colour</span><input type="color" value={s.matte} onChange={(e) => set("matte", e.target.value)} /></label>
          )}
          <label className="f"><span>Start (s)</span><input type="number" min={0} max={o.span} step={0.1} value={range.start} onChange={(e) => setRange((r) => ({ ...r, start: +e.target.value }))} /></label>
          <label className="f"><span>End (s)</span><input type="number" min={0} max={o.span} step={0.1} value={range.end} onChange={(e) => setRange((r) => ({ ...r, end: +e.target.value }))} /></label>
          {s.clip === "loop" && (
            <label className="f">
              <span>Loops</span>
              <input
                type="number" min={1} max={20} step={1} value={s.loops}
                onChange={(e) => {
                  const loops = clamp(Math.round(+e.target.value || 1), 1, 20);
                  set("loops", loops);
                  setRange({ start: 0, end: CLIP_SECONDS.loop * loops });
                }}
              />
            </label>
          )}
          <label className="f full">
            <span>Filename</span>
            <input type="text" spellCheck={false} autoComplete="off" value={name} onChange={(e) => { setNameTouched(true); setName(e.target.value); }} />
          </label>
        </fieldset>
        <p className="summary">
          {s.format === "png"
            ? `${o.W} × ${o.H} px · 1 frame at ${o.start.toFixed(2)} s · ${o.finalName}.png`
            : `${o.W} × ${o.H} px · ${o.fpsLabel} fps · ${o.frames} frames · ${(o.end - o.start).toFixed(2)} s · ${o.finalName}.${EXT[s.format]}`}
        </p>
        <ul className="notes">
          {notes.map(([cls, text]) => (
            <li key={text} className={cls}>{text}</li>
          ))}
        </ul>
        {s.format === "png-seq" && (
          <div className="cmd">
            <code>{ffmpeg}</code>
            <button
              className="btn" type="button"
              onClick={() => navigator.clipboard?.writeText(ffmpeg).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }).catch(() => {})}
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        )}
        {progress && (
          <div className="prog">
            <span className="mini"><i style={{ width: `${pct}%` }} /></span>
            <span>{progText}</span>
          </div>
        )}
        {error && <p className="err" role="alert">{error}</p>}
        {ok && <p className="ok" role="status">{ok}</p>}
        <footer>
          <button className="btn" type="button" onClick={closeOrCancel}>{busy ? "Cancel export" : "Close"}</button>
          <button className="btn primary" type="submit" disabled={busy || !!encodeNote}>Export</button>
        </footer>
      </form>}
    </dialog>
  );
}
