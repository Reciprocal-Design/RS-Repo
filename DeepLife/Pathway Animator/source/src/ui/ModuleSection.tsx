import { useEffect, useRef, useState } from 'react';
import { bodyImageInfo } from '../core/bodyImage';
import { ORGANS } from '../core/body';
import { degCount, MODULES, moduleInfo, tissueMap, withOrganicTissue } from '../core/modules';
import { ORGANIC_NAME } from '../core/organic';
import { randomSeed } from '../core/rng';
import type { ModuleSettings, OrganId } from '../core/types';
import { JOURNEY_SECTIONS, sectionLength } from '../render/journey';
import { REAL_CELL_SECTIONS } from '../render/realCell';
import { realVideoInfo } from '../core/realVideo';
import { loadRealVideo } from './realVideoLoader';
import { ColorField, Section, Select, Slider, Toggle } from './controls';
import { loadBodyImage, readImageFile } from './bodyImageLoader';
import { useApp } from './store';

/** The module tabs, above the preview. */
export function ModuleTabs() {
  const active = useApp((s) => s.active);
  const setTab = useApp((s) => s.setTab);
  return (
    <nav className="module-tabs" role="tablist">
      {MODULES.map((m, i) => (
        <button
          key={m.kind}
          role="tab"
          aria-selected={i === active}
          className={`module-tab ${i === active ? 'on' : ''}`}
          onClick={() => setTab(i)}
          title={m.blurb}
        >
          <em>{i + 1}</em>
          {m.label}
        </button>
      ))}
    </nav>
  );
}

/** Settings of the current tab's module. */
export function ModuleSection() {
  const scene = useApp((s) => s.scene);
  const active = useApp((s) => s.active);
  const setScene = useApp((s) => s.setScene);
  const setPathwayCount = useApp((s) => s.setPathwayCount);
  const setTime = useApp((s) => s.setTime);
  const setPlaying = useApp((s) => s.setPlaying);
  const shareToAllTabs = useApp((s) => s.shareToAllTabs);
  const setBodyImage = useApp((s) => s.setBodyImage);
  const [shared, setShared] = useState(false);
  const imageRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLInputElement>(null);
  const [videoMsg, setVideoMsg] = useState<{ text: string; error?: boolean } | null>(null);
  const [imageMsg, setImageMsg] = useState<{ text: string; error?: boolean } | null>(null);
  const m = scene.module;
  const info = moduleInfo(m.kind);
  const set = (v: Partial<ModuleSettings>) => setScene((s) => ({ ...s, module: { ...s.module, ...v } }));
  const degs = degCount(scene);
  // A scene loaded with a body image: analyse it (once) so it can be drawn.
  useEffect(() => {
    if (m.bodyImage) loadBodyImage(m.bodyImage).catch((e) => setImageMsg({ text: (e as Error).message, error: true }));
  }, [m.bodyImage]);
  const imageReady = !!bodyImageInfo(m.bodyImage);

  const targets = (
    <>
      <Toggle label="Mark drug targets" checked={m.markTargets} onChange={(markTargets) => set({ markTargets })} />
      {m.markTargets && <ColorField label="Target ring colour" value={m.targetColor} onChange={(targetColor) => set({ targetColor })} />}
    </>
  );
  const direct = (
    <Toggle label="Receptor → DEG only" checked={m.directOnly} onChange={(directOnly) => set({ directOnly })} />
  );
  const organ = (label: string) => (
    <Select<OrganId>
      label={label}
      value={m.organ}
      options={ORGANS.map((o) => ({ value: o.id, label: o.label }))}
      onChange={(organ) => set({ organ })}
    />
  );

  return (
    <Section title={m.kind === 'custom' ? info.label : `Module ${active + 1}: ${info.label}`}>
      <p className="hint module-blurb">{info.blurb}</p>

      {m.kind === 'targetId' && (
        <>
          {direct}
          {targets}
        </>
      )}

      {m.kind === 'moa' && (
        <>
          <Slider label="Traced DEG" value={Math.min(m.focusDeg, degs)} min={0} max={degs} step={1}
            onChange={(focusDeg) => set({ focusDeg })} />
          <p className="hint">Numbered left to right across the DEG row; 0 shows every route.</p>
          {m.focusDeg > 0 && (
            <>
              <Slider label="Routes" value={m.routes} min={1} max={3} step={1} onChange={(routes) => set({ routes })} />
              <Slider label="Other proteins" value={m.dimOpacity} min={0} max={1} onChange={(dimOpacity) => set({ dimOpacity })} />
            </>
          )}
        </>
      )}

      {m.kind === 'combination' && (
        <>
          <Slider label="Targets" value={scene.pathwayCount} min={1} max={5} step={1}
            onChange={(n) => {
              setPathwayCount(n);
              // Targets in a combination are hit together.
              setScene((s) => ({ ...s, pathways: s.pathways.map((p) => ({ ...p, startDelay: 0 })) }));
            }} />
          <Slider label="Spacing randomness" value={scene.spacingVariation} min={0} max={2}
            onChange={(spacingVariation) => setScene((s) => ({ ...s, spacingVariation }))} />
          <Slider label="Turn" value={scene.rotation} min={-180} max={180} step={1} unit="°"
            onChange={(rotation) => setScene((s) => ({ ...s, rotation }))} />
          <Slider label="Interconnection" value={scene.crosstalk.enabled ? scene.crosstalk.amount : 0} min={0} max={1}
            onChange={(amount) => setScene((s) => ({ ...s, crosstalk: { enabled: amount > 0, amount } }))} />
          <p className="hint">Links between the targets' networks: each receptor also reaches DEGs of the others (crosstalk).</p>
          {direct}
          {targets}
        </>
      )}

      {m.kind === 'toxicity' && (
        <>
          <Slider label="Toxic DEGs" value={Math.min(m.toxicDegs, degs)} min={1} max={degs} step={1}
            onChange={(toxicDegs) => set({ toxicDegs })} />
          <ColorField label="Toxicity colour" value={m.toxicColor} onChange={(toxicColor) => set({ toxicColor })} />
          <p className="hint">The cell turns this colour when the signal reaches a toxic DEG, and back as the loop ends.</p>
          <Toggle label="Warning symbol in the middle of the cell" checked={m.warning} onChange={(warning) => set({ warning })} />
          {m.warning && (
            <Slider label="Warning size" value={m.warningSize} min={0.3} max={2.5} onChange={(warningSize) => set({ warningSize })} />
          )}
          {targets}
        </>
      )}

      {m.kind === 'crossTissue' && (
        <>
          <ColorField label="Second tissue colour" value={m.tissue2Color} onChange={(tissue2Color) => set({ tissue2Color })} />
          <p className="hint">
            Click cells in the preview to switch them between the membrane colour and this one.
            {m.pinkCells ? ` ${m.pinkCells.length} cell${m.pinkCells.length === 1 ? '' : 's'} in this colour.` : ' Now: the right-hand half of the map.'}
          </p>
          <div className="row">
            <button className="btn small grow" onClick={() => set({ pinkCells: null })}>Right half</button>
            <button className="btn small grow" onClick={() => set({ pinkCells: [] })}>None</button>
          </div>
          <p className="hint">
            The other cells take the cell membrane colour. Links where the two tissues meet are drawn heavier. Cell
            size, links per neighbour and how far a signal relays are under Cell map.
          </p>
          {scene.cellMap.name === ORGANIC_NAME && (
            <button className="btn wide" title="New cell shapes for the generated tissue"
              onClick={() => setScene((s) => withOrganicTissue(s, randomSeed()))}>
              New tissue shapes
            </button>
          )}
        </>
      )}

      {m.kind === 'tissue' && !scene.cellMap.around && scene.cellMap.heroId && (
        <>
          <Toggle label="Keep the selected cell in the middle" checked={scene.cellMap.centerHero}
            onChange={(centerHero) => setScene((s) => ({ ...s, cellMap: { ...s.cellMap, centerHero } }))} />
          {scene.cellMap.centerHero && (
            <>
              <Slider label="Cells shown beyond it" value={scene.cellMap.rings} min={0} max={6} step={1}
                onChange={(rings) => setScene((s) => ({ ...s, cellMap: { ...s.cellMap, rings } }))} />
              <p className="hint">How far the view reaches from the selected cell, along the canvas's short side. 0 shows the whole map.</p>
            </>
          )}
        </>
      )}

      {m.kind === 'tissue' && (
        <>
          {scene.cellMap.around && scene.cellMap.enabled ? (
            <>
              <Slider label="Centre cell size" value={scene.cellMap.detailScale} min={0.2} max={1}
                onChange={(detailScale) => setScene((s) => ({ ...s, cellMap: { ...s.cellMap, detailScale } }))} />
              <p className="hint">
                The centre cell is the same cell as the other tabs; neighbours fill the canvas around it, and Regenerate
                all re-rolls them with it. Links, relays and spontaneous starts are under Cell map.
              </p>
            </>
          ) : (
            <button className="btn wide" onClick={() => setScene((s) => ({ ...s, cellMap: tissueMap() }))}>
              Build tissue around the cell
            </button>
          )}
        </>
      )}

      {(m.kind === 'body' || m.kind === 'journey') && (
        <>
          <button className="btn wide" onClick={() => imageRef.current?.click()}>
            {m.bodyImage ? 'Replace body image…' : 'Use a body image…'}
          </button>
          <input
            ref={imageRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            hidden
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (!file) return;
              setImageMsg(null);
              try {
                const src = await readImageFile(file);
                await loadBodyImage(src);
                setBodyImage(src);
                setImageMsg({ text: `Using ${file.name} in the Body and journey tabs.` });
              } catch (err) {
                setImageMsg({ text: (err as Error).message, error: true });
              }
            }}
          />
          {imageMsg && <p className={`hint ${imageMsg.error ? 'error' : 'ok'}`}>{imageMsg.text}</p>}
          {m.bodyImage ? (
            <>
              {!imageReady && <p className="hint">Preparing the image…</p>}
              <p className="hint">
                A figure on a plain background: it is cut out, and the network and particles are placed on it. Fit them
                with the sliders below.
              </p>
              <Slider label="Image size" value={m.imageScale} min={0.3} max={3} onChange={(imageScale) => set({ imageScale })} />
              <Slider label="Image X" value={m.imageX} min={-0.5} max={0.5} onChange={(imageX) => set({ imageX })} />
              <Slider label="Image Y" value={m.imageY} min={-0.5} max={0.5} onChange={(imageY) => set({ imageY })} />
              <Slider label="Network size" value={m.netScale} min={0.4} max={2} onChange={(netScale) => set({ netScale })} />
              <Slider label="Network X" value={m.netX} min={-0.3} max={0.3} onChange={(netX) => set({ netX })} />
              <Slider label="Network Y" value={m.netY} min={-0.3} max={0.3} onChange={(netY) => set({ netY })} />
              <button className="btn small" onClick={() => setBodyImage('')}>Back to the drawn body</button>
            </>
          ) : (
            <>
              <Slider label="Body glow" value={m.bodyGlow} min={0} max={1} onChange={(bodyGlow) => set({ bodyGlow })} />
              <Toggle label="Wireframe" checked={m.bodyMesh} onChange={(bodyMesh) => set({ bodyMesh })} />
            </>
          )}
          <Toggle label="Particles" checked={m.bodyParticles} onChange={(bodyParticles) => set({ bodyParticles })} />
        </>
      )}

      {m.kind === 'body' && (
        <>
          {organ('Signal starts in')}
          <p className="hint">The drawn outline and organs take the cell membrane and nucleus styles; firing lines take the Style and Animation settings.</p>
        </>
      )}

      {m.kind === 'realCell' && (
        <>
          <button className="btn wide" onClick={() => videoRef.current?.click()}>
            {m.realVideo ? 'Replace the real cell video…' : 'Add a real cell video…'}
          </button>
          <input
            ref={videoRef}
            type="file"
            accept="video/*"
            data-role="real-video"
            hidden
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (!file) return;
              setVideoMsg(null);
              try {
                const src = await loadRealVideo(file);
                set({ realVideo: src, realVideoName: file.name });
                const info = realVideoInfo(src)!;
                setVideoMsg({ text: `${file.name}: ${info.width} × ${info.height}, ${info.duration.toFixed(1)} s.` });
              } catch (err) {
                setVideoMsg({ text: (err as Error).message, error: true });
              }
            }}
          />
          {videoMsg && <p className={`hint ${videoMsg.error ? 'error' : 'ok'}`}>{videoMsg.text}</p>}
          {m.realVideo && realVideoInfo(m.realVideo) ? (
            <>
              <p className="hint">
                Line the real cell up with the virtual one: the network is drawn over the video as it is placed here. The
                video is kept for this session only; add it again after reloading.
              </p>
              <Slider label="Video size" value={m.videoScale} min={0.3} max={4} onChange={(videoScale) => set({ videoScale })} />
              <Slider label="Video X" value={m.videoX} min={-0.5} max={0.5} onChange={(videoX) => set({ videoX })} />
              <Slider label="Video Y" value={m.videoY} min={-0.5} max={0.5} onChange={(videoY) => set({ videoY })} />
              <Slider label="Video brightness" value={m.videoBrightness} min={0.1} max={1} onChange={(videoBrightness) => set({ videoBrightness })} />
              <button className="btn small" onClick={() => { set({ realVideo: '', realVideoName: '' }); setVideoMsg(null); }}>
                Remove the video
              </button>
            </>
          ) : (
            <p className="hint">
              {m.realVideoName
                ? `${m.realVideoName} was used here before: add it again (videos are kept for one session only).`
                : 'A video of a real cell (MP4 or WebM). Until one is added, sections 2–4 show the network on its own.'}
            </p>
          )}
          <Slider label="New nodes per layer" value={m.newNodes} min={0} max={4} step={1} onChange={(newNodes) => set({ newNodes })} />
          <p className="hint">Inactive nodes the real cell reveals: they appear, with their edges, in section 3.</p>
          <Slider label="Section length" value={sectionLength(scene)} min={0.5} max={10} step={0.5} unit=" s"
            onChange={(sectionLength) => set({ sectionLength })} />
          <div className="sections">
            {REAL_CELL_SECTIONS.map((label, i) => {
              const L = sectionLength(scene);
              return (
                <button key={label} className="btn small" title="Jump to this section"
                  onClick={() => { setPlaying(false); setTime(i * L + 0.5 * L); }}>
                  <em>{i + 1}</em> {label}
                  <span>{(i * L).toFixed(1)}–{((i + 1) * L).toFixed(1)} s</span>
                </button>
              );
            })}
          </div>
          <p className="hint">
            Five sections of {sectionLength(scene)} s each ({Math.round(sectionLength(scene) * 30)} frames at 30 fps). Pick the
            cell under Tissue map; export under Export (video, or a PNG sequence).
          </p>
        </>
      )}

      {m.kind === 'journey' && (
        <>
          <div className="field">
            <span>Layout</span>
            <div className="seg">
              {([
                { label: 'Mobile · landscape', width: 1920, height: 1080 },
                { label: 'Desktop · portrait', width: 1080, height: 1350 },
              ] as const).map((o) => {
                const on = (o.height > o.width) === (scene.canvas.height > scene.canvas.width);
                return (
                  <button key={o.label} className={`chip ${on ? 'on' : ''}`}
                    onClick={() => setScene((s) => ({ ...s, canvas: { ...s.canvas, width: o.width, height: o.height } }))}>
                    {o.label}
                  </button>
                );
              })}
            </div>
          </div>
          <p className="hint">
            Portrait turns the cell and tissue 90° and fits the body upright. Any canvas taller than it is wide works
            this way: set an exact size under Scene.
          </p>
          <Slider label="Section length" value={sectionLength(scene)} min={0.5} max={10} step={0.5} unit=" s"
            onChange={(sectionLength) => set({ sectionLength })} />
          <Slider label="Cell size in the tissue" value={scene.cellMap.detailScale} min={0.2} max={0.8}
            onChange={(detailScale) => setScene((s) => ({ ...s, cellMap: { ...s.cellMap, detailScale } }))} />
          {organ('Zoom out of')}
          <div className="sections">
            {JOURNEY_SECTIONS.map((label, i) => {
              const L = sectionLength(scene);
              return (
                <button
                  key={label}
                  className="btn small"
                  title="Jump to this section"
                  onClick={() => {
                    setPlaying(false);
                    setTime(i * L + (i % 2 ? 0.5 * L : 0));
                  }}
                >
                  <em>{i + 1}</em> {label}
                  <span>{(i * L).toFixed(1)}–{((i + 1) * L).toFixed(1)} s</span>
                </button>
              );
            })}
          </div>
          <p className="hint">
            Five sections of {sectionLength(scene)} s each ({Math.round(sectionLength(scene) * 30)} frames at 30 fps). Export
            it under Export → PNG sequence. The cell, tissue and body follow this tab's own settings.
          </p>
        </>
      )}

      <button
        className="btn wide"
        title="Seed, pathway, cell, style and animation go to every tab; each keeps its own module settings, pathway count and cell map"
        onClick={() => {
          shareToAllTabs();
          setShared(true);
          setTimeout(() => setShared(false), 2000);
        }}
      >
        {shared ? 'Copied to all tabs' : 'Use this look and pathway in all tabs'}
      </button>
    </Section>
  );
}
