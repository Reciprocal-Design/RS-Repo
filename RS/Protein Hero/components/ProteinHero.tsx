"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import { usePointer } from "./protein-hero/usePointer";
import styles from "./ProteinHero.module.css";

// WebGL only runs in the browser, so the scene is loaded client-side.
const Scene = dynamic(() => import("./protein-hero/Scene"), { ssr: false });

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
  const pointer = usePointer(root);
  const [ready, setReady] = useState(false);
  const [active, setActive] = useState(true);
  const [reducedMotion, setReducedMotion] = useState(false);
  const onReady = useCallback(() => setReady(true), []);

  // Stop rendering while the hero is scrolled out of view.
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const io = new IntersectionObserver(([entry]) => setActive(entry.isIntersecting), { threshold: 0 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  return (
    <section ref={root} className={styles.hero} data-ready={ready || undefined}>
      <div className={styles.canvas} aria-hidden="true">
        <Scene pointer={pointer.current} eventSource={root} active={active} reducedMotion={reducedMotion} onReady={onReady} />
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

      <p className={styles.hint} aria-hidden="true">
        Drag to rotate
      </p>
    </section>
  );
}
