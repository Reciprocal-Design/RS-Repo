"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { usePointer } from "./protein-hero/usePointer";
import styles from "./ProteinHero.module.css";

// WebGL only runs in the browser, so the scene is loaded client-side.
const Scene = dynamic(() => import("./protein-hero/Scene"), { ssr: false });

// Probe for WebGL once and release the test context straight away (probing per render leaks
// contexts until the browser refuses to make any more).
let webglSupport: boolean | undefined;
function hasWebGL() {
  if (webglSupport === undefined) {
    try {
      const canvas = document.createElement("canvas");
      const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
      gl?.getExtension("WEBGL_lose_context")?.loseContext();
      webglSupport = !!gl;
    } catch {
      webglSupport = false;
    }
  }
  return webglSupport;
}
const noSubscribe = () => () => {};

/** Shown when WebGL is unavailable: a flat drawing of the same idea, and a line saying why. */
function Fallback() {
  return (
    <div className={styles.fallback}>
      <svg viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
        {/* Three strands merging behind the protein and splitting again, as in the 3D scene. */}
        <g fill="none" stroke="currentColor" strokeWidth="2" opacity="0.45">
          <path d="M-40 60 C 420 260, 700 360, 1010 430 S 1500 620, 1660 760" />
          <path d="M-40 250 C 420 340, 700 400, 1010 435 S 1500 700, 1660 900" />
          <path d="M160 -40 C 480 200, 720 360, 1010 440 S 1400 540, 1660 600" />
        </g>
        <circle cx="1010" cy="435" r="230" fill="#8797a6" />
      </svg>
      <p>Interactive 3D is unavailable in this browser (WebGL is turned off or unsupported).</p>
    </div>
  );
}

type Props = {
  eyebrow?: string;
  title?: React.ReactNode;
  children?: React.ReactNode;
};

export default function ProteinHero({
  eyebrow = "Structural biology",
  title = (
    <>
      Every fold
      <br />
      tells a story.
    </>
  ),
  children,
}: Props) {
  const root = useRef<HTMLElement>(null);
  const switchAnchor = useRef<HTMLDivElement>(null);
  const [signalOn, setSignalOn] = useState(true);
  const pointer = usePointer(root);
  const [ready, setReady] = useState(false);
  const [inView, setInView] = useState(true);
  const [pageVisible, setPageVisible] = useState(true);
  const [noPause, setNoPause] = useState(false);
  const webgl = useSyncExternalStore(noSubscribe, hasWebGL, () => true);
  // Rendering pauses off screen and in hidden tabs. `?nopause` bypasses that for automated
  // browsers, which often report the page as hidden and would otherwise screenshot a stale frame.
  const active = noPause || (inView && pageVisible);
  const [reducedMotion, setReducedMotion] = useState(false);
  const onReady = useCallback(() => setReady(true), []);

  // Stop rendering while the hero is scrolled out of view.
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const io = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), { threshold: 0 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    const update = () => setPageVisible(document.visibilityState !== "hidden");
    update();
    document.addEventListener("visibilitychange", update);
    setNoPause(new URLSearchParams(window.location.search).has("nopause"));
    return () => document.removeEventListener("visibilitychange", update);
  }, []);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  return (
    <section ref={root} className={styles.hero} data-ready={ready || undefined} data-signal={signalOn ? "on" : "off"}>
      {webgl ? (
        <div className={styles.canvas} aria-hidden="true">
          <Scene
            pointer={pointer.current}
            eventSource={root}
            switchAnchor={switchAnchor}
            signalOn={signalOn}
            active={active}
            reducedMotion={reducedMotion}
            onReady={onReady}
          />
        </div>
      ) : (
        <Fallback />
      )}

      {/* Pinned to the protein by the scene each frame. */}
      <div ref={switchAnchor} className={styles.switchAnchor} hidden={!webgl}>
        <button
          type="button"
          role="switch"
          aria-checked={signalOn}
          aria-label="Signalling"
          className={styles.switch}
          data-on={signalOn || undefined}
          onClick={() => setSignalOn((on) => !on)}
        >
          <span className={styles.knob} aria-hidden="true" />
          <span className={styles.label} data-active={signalOn || undefined}>
            ON
          </span>
          <span className={styles.label} data-active={!signalOn || undefined}>
            OFF
          </span>
        </button>
      </div>

      <div className={styles.content}>
        <p className={styles.eyebrow}>{eyebrow}</p>
        <h1 className={styles.title}>{title}</h1>
        {children ?? (
          <div className={styles.actions}>
            <a className={styles.primary} href="#">
              Explore the work
            </a>
          </div>
        )}
      </div>

      <p className={styles.hint} aria-hidden="true" hidden={!webgl}>
        Drag to rotate
      </p>
    </section>
  );
}
