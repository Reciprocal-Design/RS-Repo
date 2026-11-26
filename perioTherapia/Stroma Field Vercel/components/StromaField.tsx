"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ExportPanel, { type Clip } from "./ExportPanel";
import LayoutPad, { loadStoredLayout } from "./LayoutPad";
import {
  DAYS_PER_S, DEFAULT_N, LOOP, MAX_DOSE, MAX_N, MIN_N, STAGE, THEMES, autoState, clamp, cloneSim, computeView, createSim, draw, generate, metrics, resetSim, stepSim,
  type Layout, type Sim, type StyleName, type Tissue, type View,
} from "@/lib/engine";
import type { ExportApp } from "@/lib/exportMedia";

const SEED_KEY = "stroma-field-vercel.seed";
const STYLE_KEY = "stroma-field-vercel.style";
const EDGE_KEY = "stroma-field-vercel.edge";
const BG_KEY = (st: StyleName) => `stroma-field-vercel.bg.${st}`;
const HEX = /^#?[0-9a-f]{6}$/i;
const DOTS_KEY = "stroma-field-vercel.dots";
const LAYOUT_ON_KEY = "stroma-field-vercel.layoutOn";
const MODE_KEY = "stroma-field-vercel.mode";
const PANEL_KEY = "stroma-field-vercel.panel";
type Mode = "auto" | "cursor";
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
  dots: number;
  layout: Layout | null;
  resize: () => void;
  mode: Mode;
  autoT: number; // position on the two-stage timeline (s)
  panel: boolean;
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
  const [readout, setReadout] = useState({ burden: 100, barrier: 100, ecm: 0, chemo: 0, chemoOn: false, day: 0, autoT: 0, trend: "stable" as "stable" | "shrinking" | "regrowing" });
  const [mode, setModeState] = useState<Mode>("auto");
  const [panelOn, setPanelOn] = useState(true);
  const [hud, setHud] = useState({ field: "", scaleUm: 200, scalePx: 60 });
  const [touched, setTouched] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [padOpen, setPadOpen] = useState(false);
  const [layoutOn, setLayoutOn] = useState(false);
  const [dots, setDots] = useState(DEFAULT_N);
  const [frame, setFrame] = useState({ w: 1, h: 1 });
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
    e.autoT = 0;
    e.hist.length = 0;
  }, []);
  const setMode = useCallback((m: Mode) => {
    setModeState(m);
    const e = eng.current;
    if (e) {
      e.mode = m;
      e.S = createSim(e.T);
      e.autoT = 0;
      e.hist.length = 0;
      e.pointer = null;
    }
    try {
      localStorage.setItem(MODE_KEY, m);
    } catch {}
  }, []);
  const togglePanel = useCallback((on: boolean) => {
    setPanelOn(on);
    if (eng.current) eng.current.panel = on;
    try {
      localStorage.setItem(PANEL_KEY, on ? "1" : "0");
    } catch {}
  }, []);
  const scrub = useCallback((t: number) => {
    const e = eng.current;
    if (!e) return;
    e.autoT = clamp(t, 0, STAGE.end);
    e.hist.length = 0;
  }, []);
  /** Rebuild the tissue with the current seed, dot count and layout. */
  const regenerate = useCallback((seed?: number) => {
    const e = eng.current;
    if (!e) return;
    e.T = generate(seed ?? e.T.seed, e.dots, e.layout);
    e.sweep = null;
    restart();
    e.resize();
  }, [restart]);
  const newTissue = useCallback(() => {
    const e = eng.current;
    if (!e) return;
    const seed = (e.T.seed % 9973) + 1 + Math.floor(Math.random() * 500);
    try {
      localStorage.setItem(SEED_KEY, String(seed));
    } catch {}
    regenerate(seed);
  }, [regenerate]);
  // dot count: update the label at once, rebuild shortly after the slider settles
  const dotsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const changeDots = useCallback((n: number) => {
    setDots(n);
    if (dotsTimer.current) clearTimeout(dotsTimer.current);
    dotsTimer.current = setTimeout(() => {
      const e = eng.current;
      if (!e || e.dots === n) return;
      e.dots = n;
      try {
        localStorage.setItem(DOTS_KEY, String(n));
      } catch {}
      regenerate();
    }, 140);
  }, [regenerate]);
  const applyLayout = useCallback((layout: Layout | null) => {
    const e = eng.current;
    if (!e) return;
    e.layout = layout;
    setLayoutOn(!!layout);
    try {
      localStorage.setItem(LAYOUT_ON_KEY, layout ? "1" : "0");
    } catch {}
    regenerate();
  }, [regenerate]);

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
    let n = DEFAULT_N;
    const qd = Number(new URLSearchParams(location.search).get("dots"));
    if (qd) n = qd;
    else
      try {
        const sd = Number(localStorage.getItem(DOTS_KEY));
        if (sd) n = sd;
      } catch {}
    n = Math.round(clamp(n, MIN_N, MAX_N));
    setDots(n);
    const T = generate(seed, n);
    let md: Mode = "auto", pn = true;
    const qm = new URLSearchParams(location.search).get("mode");
    try {
      md = qm === "cursor" || qm === "auto" ? qm : localStorage.getItem(MODE_KEY) === "cursor" ? "cursor" : "auto";
      pn = localStorage.getItem(PANEL_KEY) !== "0";
    } catch {}
    if (new URLSearchParams(location.search).get("panel") === "off") pn = false;
    setModeState(md);
    setPanelOn(pn);
    const e: Engine = { T, dots: n, layout: null, resize: () => {}, mode: md, autoT: 0, panel: pn, S: createSim(T), view: computeView(2, 2, 1, false, T.N), dpr: 1, animT: 0, pointer: null, hist: [], exporting: false, exportBg: THEMES[st].bg, clip: "sweep", hold: null, sweep: null, style: st, bleed: bl, bg: THEMES[st].bg };
    eng.current = e;
    const reduce = matchMedia("(prefers-reduced-motion: reduce)");

    const resize = () => {
      if (e.exporting) return;
      e.dpr = Math.min(2, window.devicePixelRatio || 1);
      const r = stage.getBoundingClientRect();
      canvas.width = Math.max(2, Math.round(r.width * e.dpr));
      canvas.height = Math.max(2, Math.round(r.height * e.dpr));
      e.view = computeView(canvas.width, canvas.height, e.dpr, false, e.T.N);
      const sr = spark.getBoundingClientRect();
      spark.width = Math.max(2, Math.round(sr.width * e.dpr));
      spark.height = Math.max(2, Math.round(sr.height * e.dpr));
      const cssP = e.view.p / e.dpr, UM = e.T.um, um = (100 / UM) * cssP > 150 ? 100 : 200;
      setHud({
        field: `${((canvas.width / e.view.p) * UM / 1000).toFixed(2)} × ${((canvas.height / e.view.p) * UM / 1000).toFixed(2)} mm`,
        scaleUm: um,
        scalePx: (um / UM) * cssP,
      });
      setFrame({ w: canvas.width / e.view.p / e.T.N, h: canvas.height / e.view.p / e.T.N });
    };
    e.resize = resize;
    const ro = new ResizeObserver(resize);
    ro.observe(stage);
    resize();
    // bring back a drawn layout from last time
    let layoutWanted = false;
    try {
      layoutWanted = localStorage.getItem(LAYOUT_ON_KEY) === "1";
    } catch {}
    if (layoutWanted)
      void loadStoredLayout().then((L) => {
        if (!L || eng.current !== e) return;
        e.layout = L;
        e.T = generate(e.T.seed, e.dots, L);
        e.S = createSim(e.T);
        e.hist.length = 0;
        setLayoutOn(true);
        resize();
      });

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
        if (e.mode === "auto") {
          // the two-stage timeline plays once, holds on the final frame for a moment, then starts again
          e.autoT += dt;
          if (e.autoT > STAGE.end + 2.5) (e.autoT = 0), (e.hist.length = 0);
          autoState(e.T, e.S, Math.min(e.autoT, STAGE.end));
        } else stepSim(e.T, e.S, dt, e.pointer, doseRef.current);
        histAcc += dt;
        if (histAcc >= 0.25) {
          histAcc = 0;
          e.hist.push(metrics(e.T, e.S).burden);
          if (e.hist.length > 240) e.hist.shift();
        }
      }
      if (e.mode === "auto" && pausedRef.current) autoState(e.T, e.S, Math.min(e.autoT, STAGE.end)); // scrubbing while paused
      const mt0 = e.panel ? metrics(e.T, e.S) : null;
      draw(ctx, e.T, e.S, e.view, e.animT, {
        bg: e.bg, reduceMotion: reduce.matches, style: e.style, bleed: e.bleed,
        panel: mt0 && { ecm: mt0.ecm, chemo: mt0.chemo, chemoOn: mt0.chemoOn || (e.mode === "auto" && e.autoT >= STAGE.chemoStart) },
      });
      uiAcc += dt;
      if (uiAcc > 0.1) {
        uiAcc = 0;
        const mt = metrics(e.T, e.S);
        const prev = e.hist.length > 8 ? e.hist[e.hist.length - 9] : mt.burden, d = mt.burden - prev;
        setReadout({ ...mt, autoT: Math.min(e.autoT, STAGE.end), day: (e.mode === "auto" ? Math.min(e.autoT, STAGE.end) : e.S.simT) * DAYS_PER_S, trend: d < -0.3 ? "shrinking" : d > 0.3 ? "regrowing" : "stable" });
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
    if (e.mode !== "cursor") return;
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
    const N = e.T.N, st = 1.5 * e.T.s;
    const cur = e.pointer ?? { x: N / 2, y: N / 2 };
    if (!e.pointer) (e.S.lx = cur.x), (e.S.ly = cur.y);
    e.pointer = { x: clamp(cur.x + mv[0] * st, 0, N), y: clamp(cur.y + mv[1] * st, 0, N) };
    setTouched(true);
  };

  /* ---------- keyboard shortcuts ---------- */
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (exportOpen || padOpen || ev.metaKey || ev.ctrlKey || ev.altKey) return;
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
  }, [exportOpen, padOpen, togglePause, restart, newTissue]);

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
        const mh = e.panel ? metrics(e.T, e.hold!) : null;
        draw(ctx, e.T, e.hold!, e.view, t, { bg: e.exportBg, style: e.style, bleed: e.bleed, panel: mh && { ecm: mh.ecm, chemo: mh.chemo, chemoOn: mh.chemoOn } });
        return;
      }
      // the two-stage timeline is a pure function of t, so exports are exact
      if (!e.sweep) e.sweep = createSim(e.T);
      const S = e.sweep;
      resetSim(S);
      autoState(e.T, S, Math.min(t, STAGE.end));
      const mt = e.panel ? metrics(e.T, S) : null;
      draw(ctx, e.T, S, e.view, t, { bg: e.exportBg, style: e.style, bleed: e.bleed, panel: mt && { ecm: mt.ecm, chemo: mt.chemo, chemoOn: t >= STAGE.chemoStart } });
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
      e.view = computeView(width, height, Math.max(1, Math.min(width, height) / 1080), true, e.T.N);
      e.exportBg = transparent ? null : matte || e.bg;
      return () => {
        e.exporting = false;
        e.hold = e.sweep = null;
        stage.classList.remove("exporting", "checker");
        const r = stage.getBoundingClientRect();
        canvas.width = Math.max(2, Math.round(r.width * e.dpr));
        canvas.height = Math.max(2, Math.round(r.height * e.dpr));
        e.view = computeView(canvas.width, canvas.height, e.dpr, false, e.T.N);
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
        <div className={`hint${touched || mode === "auto" ? " gone" : ""}`} aria-hidden={touched || mode === "auto"}>
          {dose > 0 ? "Move or drag across the tissue to deliver antibody" : "Raise the antibody dose, then move across the tissue"}
        </div>
      </main>

      <aside className="panel" aria-label="Controls and readouts">
        <header className="brand">
          <h1>Stroma <span>Field</span></h1>
          <p>A simulated tumour section. Each dot is a 20 µm patch of tissue: the core shows its main cell type, the grey ring is the collagen (ECM) wrapped around it. Treatment runs in two stages: an antibody clears the ECM, then chemotherapy clears the tumour.</p>
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
          <div className="switch-row">
            <span className="label" id="shapeLabel">Shape</span>
            <div className="bg-pick">
              <span className="num shape-state">{layoutOn ? "Drawn layout" : "Random"}</span>
              <button type="button" className="chip" onClick={() => setPadOpen(true)}>Draw layout…</button>
            </div>
          </div>
          <label className="switch-row">
            <span className="label">Dots</span>
            <span className="dots-row">
              <input type="range" min={MIN_N} max={MAX_N} step={4} value={dots} aria-valuetext={`${dots} dots across`} onChange={(ev) => changeDots(+ev.target.value)} />
              <span className="num">{dots} across</span>
            </span>
          </label>
        </div>

        <section className="playback" aria-labelledby="playLabel">
          <div className="switch-row">
            <span className="label" id="playLabel">Playback</span>
            <div className="style-switch" role="group" aria-labelledby="playLabel">
              <button type="button" className="chip" aria-pressed={mode === "auto"} onClick={() => setMode("auto")}>Two-stage timeline</button>
              <button type="button" className="chip" aria-pressed={mode === "cursor"} onClick={() => setMode("cursor")}>Cursor</button>
            </div>
          </div>
          {mode === "auto" && (
            <div className="timeline">
              <div className="tl-track" aria-hidden="true">
                <span className="tl-stage s1" style={{ left: `${(STAGE.ecmStart / STAGE.end) * 100}%`, width: `${((STAGE.ecmStart + STAGE.ecmSpan + STAGE.ecmFade * 0.5 - STAGE.ecmStart) / STAGE.end) * 100}%` }}>1 Antibody</span>
                <span className="tl-stage s2" style={{ left: `${(STAGE.chemoStart / STAGE.end) * 100}%`, width: `${((STAGE.chemoSpan + STAGE.chemoFade * 0.5) / STAGE.end) * 100}%` }}>2 Chemo</span>
              </div>
              <input
                type="range" min={0} max={STAGE.end} step={0.05} value={readout.autoT} aria-label="Timeline position"
                aria-valuetext={`${readout.autoT.toFixed(1)} seconds`}
                onChange={(ev) => { if (!pausedRef.current) togglePause(); scrub(+ev.target.value); }}
              />
              <div className="tl-time num">{readout.autoT.toFixed(1)} s / {STAGE.end} s</div>
            </div>
          )}
          <label className="check-row">
            <input type="checkbox" checked={panelOn} onChange={(ev) => togglePanel(ev.target.checked)} />
            <span>Show stage panel on the map (included in exports)</span>
          </label>
        </section>

        {mode === "cursor" && <section className="dose" aria-labelledby="doseLabel">
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
            Stage 1: move across the tissue to send out ripples of antibody that bring the grey ECM rings down; a higher dose sends wider, stronger ripples. Stage 2: once 40% of the ECM is cleared, chemotherapy starts and the cancer cells whose rings are open shrink into small grey dots. Leave an area alone and its ECM slowly grows back.
          </p>
        </section>}

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
              <dt>Stage 1 · ECM cleared (antibody)</dt><dd>{readout.ecm.toFixed(0)}%</dd>
              <span className="mini fib"><i style={{ width: `${readout.ecm}%` }} /></span>
            </div>
            <div>
              <dt>Stage 2 · Tumour cleared (chemo)</dt><dd>{readout.chemo.toFixed(0)}%</dd>
              <span className="mini tum"><i style={{ width: `${readout.chemo}%` }} /></span>
            </div>
          </dl>
        </section>

        <section className="key" aria-labelledby="keyLabel">
          <h2 className="label" id="keyLabel">Core: cell type</h2>
          <ul>
            {["Tumour cell", "Fibroblast (CAF)", "Macrophage", "Cytotoxic T cell", "Blood vessel", "Cleared cancer cell"].map((n, i) => (
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

      <LayoutPad open={padOpen} onClose={() => setPadOpen(false)} onApply={applyLayout} frame={frame} active={layoutOn} />
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
