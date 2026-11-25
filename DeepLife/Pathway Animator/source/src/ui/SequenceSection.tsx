import { MODULES } from '../core/modules';
import { sequencePlan } from '../core/sequence';
import type { ModuleKind, ModuleSettings } from '../core/types';
import { Slider } from './controls';
import { useApp } from './store';

const LAYOUTS = [
  { label: 'Landscape', width: 1920, height: 1080 },
  { label: 'Square', width: 2000, height: 2000 },
  { label: 'Portrait', width: 1080, height: 1350 },
] as const;

/** The sequence tab: which tabs it plays, in what order, and how they crossfade. */
export function SequenceSettings() {
  const scene = useApp((s) => s.scene);
  const tabs = useApp((s) => s.tabs);
  const setScene = useApp((s) => s.setScene);
  const setTime = useApp((s) => s.setTime);
  const setPlaying = useApp((s) => s.setPlaying);
  const m = scene.module;
  const set = (v: Partial<ModuleSettings>) => setScene((s) => ({ ...s, module: { ...s.module, ...v } }));
  const plan = sequencePlan(scene, tabs);
  const choices = MODULES.filter((x) => x.kind !== 'sequence');
  const tabNo = (k: ModuleKind) => MODULES.findIndex((x) => x.kind === k) + 1;
  // The picked tabs in their order, then the rest in tab order.
  const ordered = [...m.seqTabs.map((k) => choices.find((c) => c.kind === k)!).filter(Boolean), ...choices.filter((c) => !m.seqTabs.includes(c.kind))];
  const move = (k: ModuleKind, by: number) => {
    const list = [...m.seqTabs];
    const i = list.indexOf(k), j = i + by;
    if (i < 0 || j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    set({ seqTabs: list });
  };

  return (
    <>
      <div className="field">
        <span>Tabs it plays, in order</span>
        <div className="seq-list">
          {ordered.map((c) => {
            const on = m.seqTabs.includes(c.kind);
            const i = m.seqTabs.indexOf(c.kind);
            return (
              <div key={c.kind} className={`seq-item ${on ? 'on' : ''}`}>
                <label className="toggle grow">
                  <input type="checkbox" checked={on}
                    onChange={(e) => set({ seqTabs: e.target.checked ? [...m.seqTabs, c.kind] : m.seqTabs.filter((k) => k !== c.kind) })} />
                  <span><em>{tabNo(c.kind)}</em> {c.label}</span>
                </label>
                {on && (
                  <>
                    <button className="btn small" title="Earlier" disabled={i === 0} onClick={() => move(c.kind, -1)}>↑</button>
                    <button className="btn small" title="Later" disabled={i === m.seqTabs.length - 1} onClick={() => move(c.kind, 1)}>↓</button>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>
      <Slider label="Crossfade" value={m.seqTransition} min={0} max={5} step={0.25} unit=" s" onChange={(seqTransition) => set({ seqTransition })} />
      <Slider label="Loops of each tab" value={m.seqLoops} min={1} max={10} step={1} onChange={(seqLoops) => set({ seqLoops })} />
      <div className="field">
        <span>Canvas</span>
        <div className="seg">
          {LAYOUTS.map((o) => (
            <button key={o.label} className={`chip ${scene.canvas.width === o.width && scene.canvas.height === o.height ? 'on' : ''}`}
              onClick={() => setScene((s) => ({ ...s, canvas: { ...s.canvas, width: o.width, height: o.height } }))}>
              {o.label}
            </button>
          ))}
        </div>
      </div>
      <p className="hint">
        Each tab plays exactly as it is set up in its own tab (change a tab there and the sequence follows), fitted inside
        this canvas. The journey and real-cell tabs run once. Export it under Export → PNG sequence: one numbered run of
        frames, the transitions included.
      </p>
      {plan.segments.length > 0 ? (
        <div className="sections">
          {plan.segments.map((seg, i) => (
            <button key={seg.kind} className="btn small" title="Jump to this tab"
              onClick={() => { setPlaying(false); setTime(seg.start + (i ? plan.fade : 0)); }}>
              <em>{tabNo(seg.kind)}</em> {seg.label}
              <span>{seg.start.toFixed(1)}–{(seg.start + seg.length).toFixed(1)} s</span>
            </button>
          ))}
        </div>
      ) : (
        <p className="hint error">Pick at least one tab.</p>
      )}
    </>
  );
}
