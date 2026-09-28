import { BACKGROUND_PRESETS, CANVAS_PRESETS, DEFAULT_GRADIENT } from '../core/defaults';
import { buildGeometry } from '../core/geometry';
import type { ReceptorStyle, Scene } from '../core/types';
import { ColorAlphaField, ColorField, NumberInput, Section, Select, Slider, Toggle } from './controls';
import { PathwaysSection } from './PathwaysSection';
import { useApp } from './store';

export function Panel() {
  const scene = useApp((s) => s.scene);
  const setScene = useApp((s) => s.setScene);
  const regenerateAll = useApp((s) => s.regenerateAll);
  const warnings = buildGeometry(scene).warnings;

  const patch = <K extends 'canvas' | 'cell' | 'nucleus' | 'style'>(key: K) =>
    (v: Partial<Scene[K]>) => setScene((s) => ({ ...s, [key]: { ...s[key], ...v } }));
  const canvas = patch('canvas');
  const cell = patch('cell');
  const nucleus = patch('nucleus');
  const style = patch('style');
  const { cell: c, nucleus: n, style: st } = scene;

  const sizeKey = `${scene.canvas.width}x${scene.canvas.height}`;
  const isPreset = CANVAS_PRESETS.some((p) => `${p.width}x${p.height}` === sizeKey);

  return (
    <aside className="panel">
      <header className="panel-head">
        <div className="eyebrow">DeepLife</div>
        <h1>Pathway Animator</h1>
        <p>Receptor → cytoplasm → transcription factors → DEGs.</p>
      </header>

      {warnings.length > 0 && (
        <div className="warn">
          {warnings.map((w) => <p key={w}>{w}</p>)}
        </div>
      )}

      <Section title="Scene">
        <div className="row">
          <label className="field grow">
            <span>Seed</span>
            <NumberInput value={scene.seed} min={0} max={2 ** 31} onCommit={(seed) => setScene((s) => ({ ...s, seed }))} />
          </label>
          <button className="btn primary" onClick={regenerateAll} title="New seeds for the cell and every unlocked pathway">
            Regenerate all
          </button>
        </div>
        <label className="field">
          <span>Canvas size</span>
          <select
            value={isPreset ? sizeKey : 'custom'}
            onChange={(e) => {
              const p = CANVAS_PRESETS.find((q) => `${q.width}x${q.height}` === e.target.value);
              if (p) canvas({ width: p.width, height: p.height });
            }}
          >
            {CANVAS_PRESETS.map((p) => <option key={p.label} value={`${p.width}x${p.height}`}>{p.label}</option>)}
            <option value="custom">Custom…</option>
          </select>
        </label>
        <div className="row">
          <label className="field grow">
            <span>Width</span>
            <NumberInput value={scene.canvas.width} min={200} max={8192} onCommit={(width) => canvas({ width })} />
          </label>
          <label className="field grow">
            <span>Height</span>
            <NumberInput value={scene.canvas.height} min={200} max={8192} onCommit={(height) => canvas({ height })} />
          </label>
        </div>
        <div className="field">
          <span>Background</span>
          <div className="row">
            {BACKGROUND_PRESETS.map((b) => (
              <button
                key={b.value}
                className={`chip ${scene.canvas.background.toLowerCase() === b.value ? 'on' : ''}`}
                onClick={() => canvas({ background: b.value })}
              >
                <i style={{ background: b.value }} />
                {b.label}
              </button>
            ))}
            <input type="color" value={scene.canvas.background} onChange={(e) => canvas({ background: e.target.value })} />
          </div>
        </div>
      </Section>

      <Section title="Cell membrane" aside={<Toggle label="Show" checked={c.visible} onChange={(visible) => cell({ visible })} />}>
        <Slider label="Size" value={c.radius} min={0.25} max={0.5} onChange={(radius) => cell({ radius })} />
        <Slider label="Wobble" value={c.wobble} min={0} max={1} onChange={(wobble) => cell({ wobble })} />
        <Slider label="Stroke width" value={c.strokeWidth} min={0.25} max={5} step={0.05} unit=" px" onChange={(strokeWidth) => cell({ strokeWidth })} />
        <ColorAlphaField label="Colour" value={c.color} onChange={(color) => cell({ color })} />
        <Slider label="Decorative receptors" value={c.decorativeReceptors} min={0} max={12} step={1}
          onChange={(decorativeReceptors) => cell({ decorativeReceptors })} />
        <Toggle label="Show decorative receptors" checked={c.showDecorativeReceptors}
          onChange={(showDecorativeReceptors) => cell({ showDecorativeReceptors })} />
      </Section>

      <Section title="Nucleus" aside={<Toggle label="Show" checked={n.visible} onChange={(visible) => nucleus({ visible })} />}>
        <Slider label="Size" value={n.radiusRatio} min={0.2} max={0.7} onChange={(radiusRatio) => nucleus({ radiusRatio })} />
        <Slider label="Offset X" value={n.offset.x} min={-0.3} max={0.3} onChange={(x) => nucleus({ offset: { ...n.offset, x } })} />
        <Slider label="Offset Y" value={n.offset.y} min={-0.3} max={0.3} onChange={(y) => nucleus({ offset: { ...n.offset, y } })} />
        <Slider label="Wobble" value={n.wobble} min={0} max={1} onChange={(wobble) => nucleus({ wobble })} />
        <Slider label="Stroke width" value={n.strokeWidth} min={0.25} max={5} step={0.05} unit=" px" onChange={(strokeWidth) => nucleus({ strokeWidth })} />
        <ColorAlphaField label="Colour" value={n.color} onChange={(color) => nucleus({ color })} />
        <Slider label="Layer depth" value={n.layerDepth} min={0.2} max={0.95} onChange={(layerDepth) => nucleus({ layerDepth })} />
      </Section>

      <PathwaysSection />

      <Section title="Style">
        <Slider label="Line thickness" value={st.edgeWidth} min={0.25} max={4} step={0.05} unit=" px" onChange={(edgeWidth) => style({ edgeWidth })} />
        <Slider label="Edge opacity min" value={st.edgeOpacity.min} min={0} max={1}
          onChange={(min) => style({ edgeOpacity: { min, max: Math.max(min, st.edgeOpacity.max) } })} />
        <Slider label="Edge opacity max" value={st.edgeOpacity.max} min={0} max={1}
          onChange={(max) => style({ edgeOpacity: { min: Math.min(max, st.edgeOpacity.min), max } })} />
        <Slider label="Curvature" value={st.edgeCurvature} min={0} max={1} onChange={(edgeCurvature) => style({ edgeCurvature })} />
        <div className="field">
          <span>
            Gradient
            <button className="link" onClick={() => style({ gradientStops: [...DEFAULT_GRADIENT] })}>Reset</button>
          </span>
          <div className="gradient-bar" style={{ background: `linear-gradient(90deg, ${st.gradientStops.join(',')})` }} />
          <div className="stops">
            {st.gradientStops.map((g, i) => (
              <input
                key={i}
                type="color"
                value={g}
                title={['Receptor', 'Cytoplasm', 'Nucleus', 'DEGs'][i] ?? `Stop ${i + 1}`}
                onChange={(e) => style({ gradientStops: st.gradientStops.map((x, j) => (j === i ? e.target.value : x)) })}
              />
            ))}
          </div>
        </div>
        <Slider label="Node size" value={st.activeNodeRadius} min={1} max={12} step={0.5} unit=" px" onChange={(activeNodeRadius) => style({ activeNodeRadius })} />
        <Slider label="Halo size" value={st.haloRadius} min={0} max={30} step={0.5} unit=" px" onChange={(haloRadius) => style({ haloRadius })} />
        <ColorAlphaField label="Halo colour" value={st.haloColor} onChange={(haloColor) => style({ haloColor })} />
        <Slider label="Inactive node size" value={st.inactiveNodeRadius} min={2} max={16} step={0.5} unit=" px"
          onChange={(inactiveNodeRadius) => style({ inactiveNodeRadius })} />
        <ColorField label="Inactive node colour" value={st.inactiveNodeColor} onChange={(inactiveNodeColor) => style({ inactiveNodeColor })} />
        <Select<ReceptorStyle>
          label="Receptor style"
          value={st.receptorStyle}
          options={[
            { value: 'capsuleDiamond', label: 'Capsule + diamond' },
            { value: 'capsule', label: 'Capsule' },
            { value: 'diamond', label: 'Diamond' },
          ]}
          onChange={(receptorStyle) => style({ receptorStyle })}
        />
        <Slider label="Receptor length" value={st.receptorSize.length} min={10} max={100} step={1} unit=" px"
          onChange={(length) => style({ receptorSize: { ...st.receptorSize, length: Math.max(length, st.receptorSize.width) } })} />
        <Slider label="Receptor width" value={st.receptorSize.width} min={4} max={40} step={1} unit=" px"
          onChange={(width) => style({ receptorSize: { width, length: Math.max(st.receptorSize.length, width) } })} />
      </Section>
    </aside>
  );
}
