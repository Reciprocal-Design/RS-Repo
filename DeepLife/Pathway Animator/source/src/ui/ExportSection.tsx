import { useRef, useState } from 'react';
import { buildSchedule, cycleTime, loops } from '../core/timeline';
import { planVideo, VIDEO_FPS, videoSize, videoSizeError } from '../core/video';
import { Section, Select, Toggle } from './controls';
import { exportPng, exportSvg, pngSize, pngSizeError, readSceneFile, saveSceneJson } from './exporters';
import { useApp } from './store';
import { exportVideo, videoSupported, type VideoFormat, type VideoQuality } from './videoExport';

type Msg = { text: string; error?: boolean } | null;

/** Video export: format, size, frame rate, length in loops, quality; progress with cancel. */
function VideoExport({ busy, setBusy, setMessage }: { busy: boolean; setBusy: (b: boolean) => void; setMessage: (m: Msg) => void }) {
  const scene = useApp((s) => s.scene);
  const setPlaying = useApp((s) => s.setPlaying);
  const [scale, setScale] = useState(1);
  const [fps, setFps] = useState(30);
  const [loopCount, setLoopCount] = useState(1);
  const [quality, setQuality] = useState<VideoQuality>('high');
  const [format, setFormat] = useState<VideoFormat>('mp4');
  const [progress, setProgress] = useState<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const looping = loops(scene);
  const { width, height } = videoSize(scene, scale);
  const sizeError = videoSizeError(width, height);
  const plan = planVideo(scene, fps, loopCount);
  const loopLen = buildSchedule(scene).total;

  const start = async () => {
    const ac = new AbortController();
    abortRef.current = ac;
    setBusy(true);
    setPlaying(false);
    setMessage(null);
    setProgress(0);
    try {
      const saved = await exportVideo(scene, { scale, fps, loops: loopCount, quality, format }, (d, n) => setProgress(d / n), ac.signal);
      setMessage({
        text: saved === format ? 'Video saved.' : 'Saved as WebM: this browser cannot encode MP4 (H.264). Chrome, Edge and Safari can.',
      });
    } catch (e) {
      const err = e as Error;
      setMessage(err.name === 'AbortError' ? { text: 'Video export cancelled.' } : { text: err.message, error: true });
    } finally {
      setBusy(false);
      setProgress(null);
      abortRef.current = null;
    }
  };

  return (
    <>
      <div className="subhead">Video</div>
      {!videoSupported() ? (
        <p className="hint error">This browser cannot encode video. Use a recent Chrome, Edge, Safari (17+) or Firefox (130+).</p>
      ) : (
        <>
          <Select<VideoFormat>
            label="Format"
            value={format}
            options={[
              { value: 'mp4', label: 'MP4 (H.264): plays everywhere, After Effects, Premiere' },
              { value: 'webm', label: 'WebM (VP9): web, smaller files' },
            ]}
            onChange={setFormat}
          />
          <div className="seg">
            {[0.5, 1, 2].map((k) => (
              <button key={k} className={`chip ${scale === k ? 'on' : ''}`} onClick={() => setScale(k)}>
                ×{k}
              </button>
            ))}
          </div>
          <Select<string>
            label="Frame rate"
            value={String(fps)}
            options={VIDEO_FPS.map((f) => ({ value: String(f), label: `${f} fps` }))}
            onChange={(v) => setFps(Number(v))}
          />
          {looping && (
            <label className="field">
              <span>Loops ({loopLen.toFixed(2)} s each)</span>
              <input type="number" min={1} max={20} value={loopCount} onChange={(e) => setLoopCount(Math.max(1, Math.min(20, Number(e.target.value) || 1)))} />
            </label>
          )}
          <Select<VideoQuality>
            label="Quality"
            value={quality}
            options={[
              { value: 'medium', label: 'Medium (smaller file)' },
              { value: 'high', label: 'High' },
              { value: 'veryHigh', label: 'Very high (larger file)' },
            ]}
            onChange={setQuality}
          />
          <p className={`hint ${sizeError ? 'error' : ''}`}>
            {sizeError ??
              `${width} × ${height} px, ${plan.frames} frames, ${(plan.frames / fps).toFixed(2)} s${looping ? ', loops seamlessly' : ''}. The background is included (no transparency).`}
          </p>
          {progress === null ? (
            <button className="btn wide" disabled={busy || !!sizeError} onClick={start}>
              Export video
            </button>
          ) : (
            <div className="row">
              <div className="progress grow" title={`${Math.round(progress * 100)}%`}>
                <i style={{ width: `${progress * 100}%` }} />
              </div>
              <span className="hint">{Math.round(progress * 100)}%</span>
              <button className="btn small" onClick={() => abortRef.current?.abort()}>Cancel</button>
            </div>
          )}
        </>
      )}
    </>
  );
}

type PngMode = '1' | '2' | '4' | 'custom';

export function ExportSection() {
  const scene = useApp((s) => s.scene);
  const time = useApp((s) => s.time);
  const setScene = useApp((s) => s.setScene);
  const loadScene = useApp((s) => s.loadScene);
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

      <VideoExport busy={busy} setBusy={setBusy} setMessage={setMessage} />

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
            loadScene(loaded);
          });
        }}
      />
      {message && <p className={`hint ${message.error ? 'error' : 'ok'}`}>{message.text}</p>}
    </Section>
  );
}
