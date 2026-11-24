"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ExportPanel, { type Clip } from "./ExportPanel";
import {
  DAYS_PER_S, LOOP, MAX_DOSE, N, THEMES, UM, clamp, cloneSim, computeView, createSim, draw, generate, metrics, stepSim, sweepPointer,
  type Sim, type StyleName, type Tissue, type View,
} from "@/lib/engine";
import type { ExportApp } from "@/lib/exportMedia";

const SEED_KEY = "stroma-field-vercel.seed";
const STYLE_KEY = "stroma-field-vercel.style";
const EDGE_KEY = "stroma-field-vercel.edge";
const BG_KEY = (st: StyleName) => `stroma-field-vercel.bg.${st}`;
const HEX = /^#?[0-9a-f]{6}$/i;
const SWEEP_DT = 1 / 120;

type Engine = {
  T: Tissue;
  S: Sim;
  view: View;
  dpr: number;
  animT: number;
  pointer: { x: number; y: number } | null;
  hist: number[];
  exporting: boolean;
  exportBg: string | null;
  clip: Clip;
  hold: Sim | null;
  sweep: Sim | null;
  style: StyleName;
  bleed: boolean;
  bg: string;
};

export default function StromaField() {
  const stageRef = useRef<HTMLElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sparkRef = useRef<HTMLCanvasElement>(null);
  const eng = useRef<Engine | null>(null);
  const [dose, setDoseState] = useState(10);
  const doseRef = useRef(10);
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(false);
  const [readout, setReadout] = useState({ burden: 100, barrier: 100, tcell: 0, day: 0, trend: "stable" as "stable" | "shrinking" | "regrowing" });
  const [hud, setHud] = useState({ field: "", scaleUm: 200, scalePx: 60 });
  const [touched, setTouched] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [style, setStyleState] = useState<StyleName>("neon");
  const setStyle = useCallback((st: StyleName) => {
    setStyleState(st);
    if (eng.current) eng.current.style = st;
    try {
      localStorage.setItem(STYLE_KEY, st);
    } catch {}
  }, []);
  const [bleed, setBleedState] = useState(false);
  const setBleed = useCallback((b: boolean) => {
    setBleedState(b);
    if (eng.current) eng.current.bleed = b;
    try {
      localStorage.setItem(EDGE_KEY, b ? "bleed" : "fade");
    } catch {}
  }, []);
  const [bgColor, setBgColorState] = useState<string | null>(null); // null = the style's own background
  const theme = THEMES[style];
  const bg = bgColor ?? theme.bg;
  const setBgColor = useCallback((c: string | null) => {
    setBgColorState(c);
    try {
      const k = BG_KEY(eng.current?.style ?? "neon");
      if (c) localStorage.setItem(k, c);
      else localStorage.removeItem(k);
    } catch {}
  }, []);
  // load the saved background whenever the style changes
  useEffect(() => {
    try {
      const saved = localStorage.getItem(BG_KEY(style));
      setBgColorState(saved && HEX.test(saved) ? saved : null);
    } catch {
      setBgColorState(null);
    }
  }, [style]);
  useEffect(() => {
    if (eng.current) eng.current.bg = bg;
  }, [bg]);
  useEffect(() => {
    document.documentElement.dataset.style = style;
  }, [style]);

  const setDose = useCallback((v: number) => {
    const d = clamp(v, 0, MAX_DOSE);
    doseRef.current = d;
    setDoseState(d);
  }, []);
  const togglePause = useCallback(() => {
    pausedRef.current = !pausedRef.current;
    setPaused(pausedRef.current);
  }, []);
  const restart = useCallback(() => {
    const e = eng.current;
    if (!e) return;
    e.S = createSim(e.T);
    e.hist.length = 0;
  }, []);
  const newTissue = useCallback(() => {
    const e = eng.current;
    if (!e) return;
    const seed = (e.T.seed % 9973) + 1 + Math.floor(Math.random() * 500);
    e.T = generate(seed);
    try {
      localStorage.setItem(SEED_KEY, String(seed));
    } catch {}
    restart();
  }, [restart]);

  /* ---------- engine boot, resize and the frame loop ---------- */
  useEffect(() => {
    const canvas = canvasRef.current!, stage = stageRef.current!, spark = sparkRef.current!;
    const ctx = canvas.getContext("2d", { alpha: true })!;
    let seed = 7;
    try {
      const s = Number(localStorage.getItem(SEED_KEY));
      if (Number.isFinite(s) && s > 0) seed = s;
    } catch {}
    let st: StyleName = "neon";
    const qs = new URLSearchParams(location.search).get("style");
    if (qs === "neon" || qs === "clinical") st = qs;
    else
      try {
        const saved = localStorage.getItem(STYLE_KEY);
        if (saved === "neon" || saved === "clinical") st = saved;
      } catch {}
    setStyleState(st);
    let bl = false;
    const qe = new URLSearchParams(location.search).get("edge");
    if (qe === "bleed" || qe === "fade") bl = qe === "bleed";
    else
      try {
        bl = localStorage.getItem(EDGE_KEY) === "bleed";
      } catch {}
    setBleedState(bl);
    const qb = new URLSearchParams(location.search).get("bg");
    if (qb && HEX.test(qb)) {
      try {
        localStorage.setItem(BG_KEY(st), qb.startsWith("#") ? qb : "#" + qb);
      } catch {}
      setBgColorState(qb.startsWith("#") ? qb : "#" + qb);
    }
    const T = generate(seed);
    const e: Engine = { T, S: createSim(T), view: computeView(2, 2, 1, false), dpr: 1, animT: 0, pointer: null, hist: [], exporting: false, exportBg: THEMES[st].bg, clip: "sweep", hold: null, sweep: null, style: st, bleed: bl, bg: THEMES[st].bg };
    eng.current = e;
    const reduce = matchMedia("(prefers-reduced-motion: reduce)");

    const resize = () => {
      if (e.exporting) return;
      e.dpr = Math.min(2, window.devicePixelRatio || 1);
      const r = stage.getBoundingClientRect();
      canvas.width = Math.max(2, Math.round(r.width * e.dpr));
      canvas.height = Math.max(2, Math.round(r.height * e.dpr));
      e.view = computeView(canvas.width, canvas.height, e.dpr, false);
      const sr = spark.getBoundingClientRect();
      spark.width = Math.max(2, Math.round(sr.width * e.dpr));
      spark.height = Math.max(2, Math.round(sr.height * e.dpr));
      const cssP = e.view.p / e.dpr, um = cssP * 10 > 150 ? 100 : 200;
      setHud({
        field: `${((canvas.width / e.view.p) * UM / 1000).toFixed(2)} × ${((canvas.height / e.view.p) * UM / 1000).toFixed(2)} mm`,
        scaleUm: um,
        scalePx: (um / UM) * cssP,
      });
    };
    const ro = new ResizeObserver(resize);
    ro.observe(stage);
    resize();

    let raf = 0, last = performance.now(), histAcc = 0, uiAcc = 1, visible = true;
    const io = new IntersectionObserver(([en]) => (visible = en.isIntersecting));
    io.observe(stage);
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (e.exporting || !visible || document.hidden) return;
      if (!pausedRef.current) {
        e.animT = (e.animT + dt) % (LOOP * 100);
        stepSim(e.T, e.S, dt, e.pointer, doseRef.current);
        histAcc += dt;
        if (histAcc >= 0.25) {
          histAcc = 0;
          e.hist.push(metrics(e.T, e.S).burden);
          if (e.hist.length > 240) e.hist.shift();
        }
      }
      draw(ctx, e.T, e.S, e.view, e.animT, { bg: e.bg, reduceMotion: reduce.matches, style: e.style, bleed: e.bleed });
      uiAcc += dt;
      if (uiAcc > 0.1) {
        uiAcc = 0;
        const mt = metrics(e.T, e.S);
        const prev = e.hist.length > 8 ? e.hist[e.hist.length - 9] : mt.burden, d = mt.burden - prev;
        setReadout({ ...mt, day: e.S.simT * DAYS_PER_S, trend: d < -0.3 ? "shrinking" : d > 0.3 ? "regrowing" : "stable" });
        drawSpark(spark, e.hist, e.dpr, THEMES[e.style].inner[0], e.style === "clinical" ? "rgba(60,60,80,.16)" : "rgba(154,148,182,.18)");
      }
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
    };
  }, []);

  /* ---------- pointer: the cursor is the antibody ---------- */
  const toGrid = (clientX: number, clientY: number) => {
    const e = eng.current!, r = canvasRef.current!.getBoundingClientRect();
    return { x: ((clientX - r.left) * e.dpr - e.view.ox) / e.view.p, y: ((clientY - r.top) * e.dpr - e.view.oy) / e.view.p };
  };
  const onPointerMove = (ev: React.PointerEvent) => {
    const e = eng.current;
    if (!e) return;
    if (ev.pointerType !== "mouse" && ev.buttons === 0) return; // touch and pen deliver while pressed
    e.pointer = toGrid(ev.clientX, ev.clientY);
    if (!touched && doseRef.current > 0) setTouched(true);
  };
  const onPointerDown = (ev: React.PointerEvent) => {
    const e = eng.current;
    if (!e) return;
    e.pointer = toGrid(ev.clientX, ev.clientY);
    e.S.lx = e.pointer.x;
    e.S.ly = e.pointer.y;
  };
  const onPointerLeave = () => {
    if (eng.current) eng.current.pointer = null;
  };
  const onCanvasKey = (ev: React.KeyboardEvent) => {
    const mv = ({ ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] } as Record<string, number[]>)[ev.key];
    const e = eng.current;
    if (!mv || !e) return;
    ev.preventDefault();
    const cur = e.pointer ?? { x: N / 2, y: N / 2 };
    if (!e.pointer) (e.S.lx = cur.x), (e.S.ly = cur.y);
    e.pointer = { x: clamp(cur.x + mv[0] * 1.5, 0, N), y: clamp(cur.y + mv[1] * 1.5, 0, N) };
    setTouched(true);
  };

  /* ---------- keyboard shortcuts ---------- */
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (exportOpen || ev.metaKey || ev.ctrlKey || ev.altKey) return;
      const t = ev.target as HTMLElement;
      const tag = (t.tagName || "").toLowerCase();
      if ((tag === "input" && (t as HTMLInputElement).type !== "range") || tag === "select") return;
      if (ev.code === "Space" && tag !== "button") (ev.preventDefault(), togglePause());
      else if (ev.key === "r" || ev.key === "R") restart();
      else if (ev.key === "n" || ev.key === "N") newTissue();
      else if (ev.key === "e" || ev.key === "E") setExportOpen(true);
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [exportOpen, togglePause, restart, newTissue]);

  /* ---------- export contract ---------- */
  const app = useMemo<ExportApp & { setClip: (c: Clip) => void }>(() => ({
    get canvas() {
      return canvasRef.current!;
    },
    setClip(c: Clip) {
      if (eng.current) eng.current.clip = c;
    },
    async renderAt(t: number) {
      const e = eng.current!, ctx = canvasRef.current!.getContext("2d")!;
      if (e.clip === "loop") {
        draw(ctx, e.T, e.hold!, e.view, t, { bg: e.exportBg, style: e.style, bleed: e.bleed });
        return;
      }
      // scripted sweep: replay the treatment deterministically from untouched tissue up to t
      if (!e.sweep || t < e.sweep.simT - 1e-6) e.sweep = createSim(e.T);
      const S = e.sweep, dose = doseRef.current || 12;
      if (!Number.isFinite(S.lx)) {
        const p0 = sweepPointer(0, e.view);
        S.lx = p0.x;
        S.ly = p0.y;
      }
      while (S.simT < t - 1e-9) {
        const dt = Math.min(SWEEP_DT, t - S.simT);
        stepSim(e.T, S, dt, sweepPointer(S.simT + dt, e.view), dose);
      }
      draw(ctx, e.T, S, e.view, t, { bg: e.exportBg, style: e.style, bleed: e.bleed });
    },
    beginExport({ width, height, transparent, matte }) {
      const e = eng.current!, canvas = canvasRef.current!, stage = stageRef.current!;
      e.exporting = true;
      stage.classList.add("exporting");
      stage.classList.toggle("checker", transparent);
      e.hold = cloneSim(e.S);
      e.sweep = null;
      canvas.width = width;
      canvas.height = height;
      e.view = computeView(width, height, Math.max(1, Math.min(width, height) / 1080), true);
      e.exportBg = transparent ? null : matte || e.bg;
      return () => {
        e.exporting = false;
        e.hold = e.sweep = null;
        stage.classList.remove("exporting", "checker");
        const r = stage.getBoundingClientRect();
        canvas.width = Math.max(2, Math.round(r.width * e.dpr));
        canvas.height = Math.max(2, Math.round(r.height * e.dpr));
        e.view = computeView(canvas.width, canvas.height, e.dpr, false);
      };
    },
  }), []);

  const doseLabel = `${(dose || 12).toFixed(1)} mg/kg`;

  return (
    <div className="app" data-style={style}>
      <main className="stage" ref={stageRef} style={{ background: bg }}>
        <canvas
          id="map"
          ref={canvasRef}
          tabIndex={0}
          aria-label="Animated tissue density map. Move the cursor across it, or use the arrow keys, to deliver antibody."
          onPointerMove={onPointerMove}
          onPointerDown={onPointerDown}
          onPointerUp={(ev) => ev.pointerType !== "mouse" && onPointerLeave()}
          onPointerLeave={onPointerLeave}
          onPointerCancel={onPointerLeave}
          onBlur={onPointerLeave}
          onKeyDown={onCanvasKey}
        />
        <div className="hud hud-tl">
          <span className={`live${paused ? " paused" : ""}`}>{paused ? "Paused" : "Live"}</span>
          <span>Day {readout.day.toFixed(1)}</span>
          <span aria-hidden="true">·</span>
          <span>{hud.field}</span>
        </div>
        <div className="hud hud-bl">
          <span className="scalebar" style={{ width: hud.scalePx }} />
          <span>{hud.scaleUm} µm</span>
        </div>
        <div className={`hint${touched ? " gone" : ""}`} aria-hidden={touched}>
          {dose > 0 ? "Move or drag across the tissue to deliver antibody" : "Raise the antibody dose, then move across the tissue"}
        </div>
      </main>

      <aside className="panel" aria-label="Controls and readouts">
        <header className="brand">
          <h1>Stroma <span>Field</span></h1>
          <p>A simulated tumour section. Each dot is a 20 µm patch of tissue: the core shows its main cell type, the ring shows the collagen wrapped around it. Your cursor carries the antibody.</p>
        </header>

        <div className="switches">
          <div className="switch-row">
            <span className="label" id="styleLabel">Style</span>
            <div className="style-switch" role="group" aria-labelledby="styleLabel">
              {(["neon", "clinical"] as const).map((st) => (
                <button key={st} type="button" className="chip" aria-pressed={style === st} onClick={() => setStyle(st)}>
                  {st === "neon" ? "Neon" : "Clinical"}
                </button>
              ))}
            </div>
          </div>
          <div className="switch-row">
            <span className="label" id="edgeLabel">Edges</span>
            <div className="style-switch" role="group" aria-labelledby="edgeLabel">
              <button type="button" className="chip" aria-pressed={!bleed} onClick={() => setBleed(false)}>Cropped</button>
              <button type="button" className="chip" aria-pressed={bleed} onClick={() => setBleed(true)}>Bleed</button>
            </div>
          </div>
          <div className="switch-row">
            <span className="label" id="bgLabel">Ground</span>
            <div className="bg-pick">
              <input type="color" aria-labelledby="bgLabel" value={bg} onChange={(ev) => setBgColor(ev.target.value)} />
              <span className="num">{bg.toUpperCase()}</span>
              <button type="button" className="chip" disabled={!bgColor} onClick={() => setBgColor(null)}>Reset</button>
            </div>
          </div>
        </div>

        <section className="dose" aria-labelledby="doseLabel">
          <div className="head">
            <h2 className="label" id="doseLabel">Antibody dose</h2>
            <output htmlFor="dose">{dose.toFixed(1)}<small>mg/kg</small></output>
          </div>
          <div className="gauge">
            <div className="fill" style={{ width: `${(dose / MAX_DOSE) * 100}%` }} />
            <div className="segs" />
            <input
              type="range" id="dose" min={0} max={MAX_DOSE} step={0.5} value={dose}
              aria-labelledby="doseLabel" aria-describedby="doseHelp" aria-valuetext={`${dose.toFixed(1)} milligrams per kilogram`}
              onChange={(ev) => setDose(+ev.target.value)}
            />
          </div>
          <div className="ticks" aria-hidden="true"><span>0</span><span>5</span><span>10</span><span>15</span><span>20</span></div>
          <div className="presets" role="group" aria-label="Dose presets">
            {[0, 4, 10, 20].map((v) => (
              <button key={v} type="button" className="chip" aria-pressed={dose === v} onClick={() => setDose(v)}>{v === 0 ? "Off" : v}</button>
            ))}
          </div>
          <p className="help" id="doseHelp">
            Move across the tissue to send out ripples of antibody. The collagen rings come down in a petal pattern as each ripple spreads; a higher dose sends wider, stronger ripples, and dense rings take more passes. Where a ring opens, the drug reaches the tumour cell inside, it dies back and T cells move in. Leave an area alone and its barrier slowly grows back.
          </p>
        </section>

        <section aria-labelledby="burdenLabel">
          <div className="burden">
            <div><h2 className="label" id="burdenLabel">Tumour burden</h2></div>
            <div className="day">Day {readout.day.toFixed(1)}</div>
            <div className="big"><span>{readout.burden.toFixed(0)}</span><small>%</small></div>
            <div><span className="state" data-s={readout.trend}>{readout.trend[0].toUpperCase() + readout.trend.slice(1)}</span></div>
            <canvas id="spark" ref={sparkRef} aria-hidden="true" />
          </div>
          <dl className="kv">
            <div>
              <dt>Collagen barrier intact</dt><dd>{readout.barrier.toFixed(0)}%</dd>
              <span className="mini fib"><i style={{ width: `${readout.barrier}%` }} /></span>
            </div>
            <div>
              <dt>T cells inside tumour nests</dt><dd>{readout.tcell.toFixed(0)}%</dd>
              <span className="mini cyan"><i style={{ width: `${readout.tcell}%` }} /></span>
            </div>
          </dl>
        </section>

        <section className="key" aria-labelledby="keyLabel">
          <h2 className="label" id="keyLabel">Core: cell type</h2>
          <ul>
            {["Tumour cell", "Fibroblast (CAF)", "Macrophage", "Cytotoxic T cell", "Blood vessel", "Dying cell"].map((n, i) => (
              <li key={n}><span className="dot" style={{ background: theme.inner[i] }} />{n}</li>
            ))}
          </ul>
          <div className="ringkey">
            <span className="ring-sample" aria-hidden="true" />
            <h2 className="label">Ring: collagen barrier</h2>
            <div><div className="ramp" /><div className="ramp-labels"><span>Loose fibres</span><span>Dense, cross-linked</span></div></div>
            <div className="frontkey"><i className="frag" /><span><em>Broken ring</em>: barrier being digested</span></div>
            <div className="frontkey"><i className="edge" /><span><em>Outline</em>: where the tumour started</span></div>
          </div>
        </section>

        <section className="actions" aria-label="Simulation controls">
          <button className="btn" type="button" onClick={togglePause}>{paused ? "Play" : "Pause"} <kbd>Space</kbd></button>
          <button className="btn" type="button" onClick={restart}>Restart <kbd>R</kbd></button>
          <button className="btn" type="button" onClick={newTissue}>New tissue <kbd>N</kbd></button>
          <button className="btn primary" type="button" onClick={() => setExportOpen(true)}>Export <kbd>E</kbd></button>
        </section>
        <p className="fine">An abstract illustration of stromal barriers, not a pharmacological model. One simulated day passes every half second.</p>
      </aside>

      <ExportPanel open={exportOpen} onClose={() => setExportOpen(false)} app={app} setClip={app.setClip} doseLabel={doseLabel} matte={bg} />
    </div>
  );
}

function drawSpark(c: HTMLCanvasElement, hist: number[], dpr: number, color: string, grid: string) {
  const g = c.getContext("2d")!, W = c.width, H = c.height;
  g.clearRect(0, 0, W, H);
  g.strokeStyle = grid;
  g.lineWidth = 1;
  for (const v of [0, 50, 100]) {
    const y = Math.round(4 * dpr + (1 - v / 100) * (H - 8 * dpr)) + 0.5;
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(W, y);
    g.stroke();
  }
  if (hist.length < 2) return;
  const n = 240, xAt = (i: number) => ((i + n - hist.length) / (n - 1)) * (W - 6 * dpr), yAt = (v: number) => 4 * dpr + (1 - v / 100) * (H - 8 * dpr);
  const line = () => {
    g.beginPath();
    hist.forEach((v, i) => (i ? g.lineTo(xAt(i), yAt(v)) : g.moveTo(xAt(i), yAt(v))));
  };
  line();
  g.lineTo(xAt(hist.length - 1), H);
  g.lineTo(xAt(0), H);
  g.closePath();
  const grd = g.createLinearGradient(0, 0, 0, H);
  grd.addColorStop(0, color);
  grd.addColorStop(1, "transparent");
  g.globalAlpha = 0.3;
  g.fillStyle = grd;
  g.fill();
  g.globalAlpha = 1;
  line();
  g.strokeStyle = color;
  g.lineWidth = 1.6 * dpr;
  g.stroke();
  g.beginPath();
  g.arc(xAt(hist.length - 1), yAt(hist[hist.length - 1]), 3 * dpr, 0, Math.PI * 2);
  g.fillStyle = color;
  g.fill();
}
