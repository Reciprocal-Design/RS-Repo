import { BACKGROUND_PRESETS, CANVAS_PRESETS } from '../core/defaults';
import { buildGeometry } from '../core/geometry';
import { useApp } from './store';

export function Panel() {
  const scene = useApp((s) => s.scene);
  const setScene = useApp((s) => s.setScene);
  const regenerateAll = useApp((s) => s.regenerateAll);
  const warnings = buildGeometry(scene).warnings;
  const sizeKey = `${scene.canvas.width}x${scene.canvas.height}`;

  return (
    <aside className="panel">
      <header className="panel-head">
        <div className="eyebrow">DeepLife</div>
        <h1>Pathway Animator</h1>
        <p>Receptor → cytoplasm → transcription factors → DEGs.</p>
      </header>

      <section className="section">
        <h2>Scene</h2>
        <div className="row">
          <label className="field grow">
            <span>Seed</span>
            <input
              type="number"
              value={scene.seed}
              onChange={(e) => {
                const seed = Math.max(0, Math.floor(Number(e.target.value) || 0));
                setScene((s) => ({ ...s, seed }));
              }}
            />
          </label>
          <button className="btn primary" onClick={regenerateAll}>Regenerate all</button>
        </div>
        <label className="field">
          <span>Canvas size</span>
          <select
            value={sizeKey}
            onChange={(e) => {
              const p = CANVAS_PRESETS.find((c) => `${c.width}x${c.height}` === e.target.value);
              if (p) setScene((s) => ({ ...s, canvas: { ...s.canvas, width: p.width, height: p.height } }));
            }}
          >
            {CANVAS_PRESETS.map((p) => (
              <option key={p.label} value={`${p.width}x${p.height}`}>{p.label}</option>
            ))}
            {!CANVAS_PRESETS.some((p) => `${p.width}x${p.height}` === sizeKey) && (
              <option value={sizeKey}>{scene.canvas.width} × {scene.canvas.height}</option>
            )}
          </select>
        </label>
        <div className="field">
          <span>Background</span>
          <div className="row">
            {BACKGROUND_PRESETS.map((b) => (
              <button
                key={b.value}
                className={`chip ${scene.canvas.background.toLowerCase() === b.value ? 'on' : ''}`}
                onClick={() => setScene((s) => ({ ...s, canvas: { ...s.canvas, background: b.value } }))}
              >
                <i style={{ background: b.value }} />
                {b.label}
              </button>
            ))}
            <input
              type="color"
              value={scene.canvas.background}
              onChange={(e) => {
                const background = e.target.value;
                setScene((s) => ({ ...s, canvas: { ...s.canvas, background } }));
              }}
            />
          </div>
        </div>
      </section>

      <section className="section muted">
        <h2>Coming next</h2>
        <p>Cell, nucleus, style and layer controls (milestone 2), multiple pathways and crosstalk (3), animation (4), export (5–6).</p>
      </section>

      {warnings.length > 0 && (
        <section className="section warn">
          {warnings.map((w) => <p key={w}>{w}</p>)}
        </section>
      )}
    </aside>
  );
}
