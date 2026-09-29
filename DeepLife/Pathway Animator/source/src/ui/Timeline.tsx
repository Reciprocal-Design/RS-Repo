import { useEffect } from 'react';
import { buildSchedule, cycleTime, loops } from '../core/timeline';
import { useApp } from './store';

/** Drives playback with requestAnimationFrame; rendering itself stays a pure function of time. */
function usePlayback() {
  const playing = useApp((s) => s.playing);
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000); // avoid jumps after a hidden tab
      last = now;
      const { scene, time, setTime, setPlaying } = useApp.getState();
      const { total } = buildSchedule(scene);
      const next = time + dt;
      if (!loops(scene) && next >= total) {
        setTime(total);
        setPlaying(false);
        return;
      }
      // Keep time within one cycle so it never grows without bound.
      setTime(loops(scene) && total > 0 ? next % total : next);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);
}

export function Timeline() {
  usePlayback();
  const scene = useApp((s) => s.scene);
  const time = useApp((s) => s.time);
  const playing = useApp((s) => s.playing);
  const setTime = useApp((s) => s.setTime);
  const setPlaying = useApp((s) => s.setPlaying);
  const setScene = useApp((s) => s.setScene);
  const { total } = buildSchedule(scene);
  const t = cycleTime(scene, time);

  const toggle = () => {
    const st = useApp.getState();
    // Pressing play at the end of a non-looping run starts again.
    if (!st.playing && !loops(st.scene) && st.time >= total) setTime(0);
    setPlaying(!st.playing);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (e.code !== 'Space' || tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || tag === 'BUTTON') return;
      e.preventDefault();
      toggle();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <footer className="timeline">
      <button className="btn icon" onClick={toggle} title={playing ? 'Pause (Space)' : 'Play (Space)'}>
        {playing ? '❚❚' : '▶'}
      </button>
      <button
        className="btn icon"
        onClick={() => {
          setPlaying(false);
          setTime(0);
        }}
        title="Back to start"
      >
        ⏮
      </button>
      <input
        type="range"
        min={0}
        max={total}
        step={0.001}
        value={t}
        onChange={(e) => {
          setPlaying(false);
          setTime(Number(e.target.value));
        }}
        aria-label="Scrub"
      />
      <span className="time">
        {t.toFixed(2)} / {total.toFixed(2)} s
      </span>
      <label className="toggle loop" title={scene.animation.continuous ? 'Continuous motion always loops' : undefined}>
        <input
          type="checkbox"
          checked={loops(scene)}
          disabled={scene.animation.continuous}
          onChange={(e) => {
            const loop = e.target.checked;
            setScene((s) => ({ ...s, animation: { ...s.animation, loop } }));
          }}
        />
        <span>Loop</span>
      </label>
    </footer>
  );
}
