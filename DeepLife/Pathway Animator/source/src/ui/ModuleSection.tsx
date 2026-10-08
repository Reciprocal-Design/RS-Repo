import { useState } from 'react';
import { defaultCellMap } from '../core/defaults';
import { suggestedDetailScale } from '../core/cellMap';
import { degCount, MODULES, moduleInfo } from '../core/modules';
import type { ModuleSettings } from '../core/types';
import { ColorField, Section, Slider, Toggle } from './controls';
import { sampleTissue, useApp } from './store';

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
  const shareToAllTabs = useApp((s) => s.shareToAllTabs);
  const [shared, setShared] = useState(false);
  const m = scene.module;
  const info = moduleInfo(m.kind);
  const set = (v: Partial<ModuleSettings>) => setScene((s) => ({ ...s, module: { ...s.module, ...v } }));
  const degs = degCount(scene);

  const targets = (
    <>
      <Toggle label="Mark drug targets" checked={m.markTargets} onChange={(markTargets) => set({ markTargets })} />
      {m.markTargets && <ColorField label="Target ring colour" value={m.targetColor} onChange={(targetColor) => set({ targetColor })} />}
    </>
  );
  const direct = (
    <Toggle label="Receptor → DEG only" checked={m.directOnly} onChange={(directOnly) => set({ directOnly })} />
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
          {targets}
        </>
      )}

      {m.kind === 'tissue' && (
        <>
          <p className="hint">Cell layout, links between neighbours and relays are under Cell map.</p>
          {!scene.cellMap.cells.length && (
            <button
              className="btn wide"
              onClick={() => {
                const map = sampleTissue();
                if (!map) return;
                setScene((s) => ({
                  ...s,
                  cellMap: { ...defaultCellMap(), enabled: true, ...map, detailScale: suggestedDetailScale(s, map) },
                }));
              }}
            >
              Load sample tissue
            </button>
          )}
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
