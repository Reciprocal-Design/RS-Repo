import { useRef, useState } from 'react';
import { cycleTime } from '../core/timeline';
import { Section, Toggle } from './controls';
import { exportPng, exportSvg, pngSize, pngSizeError, readSceneFile, saveSceneJson } from './exporters';
import { useApp } from './store';

type PngMode = '1' | '2' | '4' | 'custom';

export function ExportSection() {
  const scene = useApp((s) => s.scene);
  const time = useApp((s) => s.time);
  const setScene = useApp((s) => s.setScene);
  const setTime = useApp((s) => s.setTime);
  const setPlaying = useApp((s) => s.setPlaying);

  const [pngMode, setPngMode] = useState<PngMode>('1');
  const [customWidth, setCustomWidth] = useState(3840);
  const [pngTransparent, setPngTransparent] = useState(false);
  const [svgSignal, setSvgSignal] = useState(false);
  const [svgTransparent, setSvgTransparent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const t = cycleTime(scene, time);
  const mode = pngMode === 'custom' ? { width: Math.max(100, customWidth) } : { scale: Number(pngMode) };
  const size = pngSize(scene, mode);
  const sizeError = pngSizeError(size.width, size.height);

  const run = async (label: string, fn: () => Promise<void> | void) => {
    setBusy(true);
    setMessage(null);
    try {
      await fn();
      setMessage({ text: label });
    } catch (e) {
      setMessage({ text: (e as Error).message, error: true });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section title="Export">
      <label className="field">
        <span>Scene name (used in file names)</span>
        <input
          type="text"
          value={scene.name}
          onChange={(e) => {
            const name = e.target.value;
            setScene((s) => ({ ...s, name }));
          }}
        />
      </label>
      <p className="hint">Exports the current frame at {t.toFixed(2)} s.</p>

      <div className="subhead">PNG</div>
      <div className="seg">
        {(['1', '2', '4'] as const).map((m) => (
          <button key={m} className={`chip ${pngMode === m ? 'on' : ''}`} onClick={() => setPngMode(m)}>
            ×{m}
          </button>
        ))}
        <button className={`chip ${pngMode === 'custom' ? 'on' : ''}`} onClick={() => setPngMode('custom')}>
          Width…
        </button>
      </div>
      {pngMode === 'custom' && (
        <label className="field">
          <span>Width (height follows the canvas aspect)</span>
          <input type="number" min={100} max={16384} value={customWidth} onChange={(e) => setCustomWidth(Number(e.target.value) || 0)} />
        </label>
      )}
      <p className={`hint ${sizeError ? 'error' : ''}`}>{sizeError ?? `${size.width} × ${size.height} px`}</p>
      <Toggle label="Transparent background" checked={pngTransparent} onChange={setPngTransparent} />
      <button
        className="btn wide"
        disabled={busy || !!sizeError}
        onClick={() => run('PNG saved.', () => exportPng(scene, t, mode, pngTransparent))}
      >
        Export PNG
      </button>

      <div className="subhead">SVG (vector, for Illustrator)</div>
      <Toggle label="Include signal layer (comets, lit edges)" checked={svgSignal} onChange={setSvgSignal} />
      <Toggle label="Transparent background" checked={svgTransparent} onChange={setSvgTransparent} />
      <button className="btn wide" disabled={busy} onClick={() => run('SVG saved.', () => exportSvg(scene, t, svgSignal, svgTransparent))}>
        Export SVG
      </button>

      <div className="subhead">Scene JSON</div>
      <div className="row">
        <button className="btn grow" disabled={busy} onClick={() => run('Scene saved.', () => saveSceneJson(scene))}>
          Save scene
        </button>
        <button className="btn grow" disabled={busy} onClick={() => fileRef.current?.click()}>
          Load scene…
        </button>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (!file) return;
          run(`Loaded ${file.name}.`, async () => {
            const loaded = await readSceneFile(file);
            setPlaying(false);
            setTime(0);
            setScene(() => loaded);
          });
        }}
      />
      {message && <p className={`hint ${message.error ? 'error' : 'ok'}`}>{message.text}</p>}
    </Section>
  );
}
