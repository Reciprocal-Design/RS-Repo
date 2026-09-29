import {
  addLayer, canAddLayer, canRemoveLayer, MAX_NODES, regionOptions, removeLayer, setCounts, setRegion, withStructureOf,
} from '../core/layers';
import type { Pathway, Region } from '../core/types';
import { Section, Slider, Stepper, Toggle } from './controls';
import { useApp } from './store';

const REGION_LABEL: Record<Region, string> = { membrane: 'Receptor', cytoplasm: 'Cytoplasm', nucleus: 'Nucleus' };

export function PathwaysSection() {
  const scene = useApp((s) => s.scene);
  const setScene = useApp((s) => s.setScene);
  const setPathwayCount = useApp((s) => s.setPathwayCount);
  const pathways = scene.pathways.slice(0, scene.pathwayCount);

  return (
    <Section title="Pathways">
      <Slider label="Count" value={scene.pathwayCount} min={1} max={5} step={1} onChange={setPathwayCount} />
      <Slider
        label="Rotation"
        value={scene.rotation}
        min={-180}
        max={180}
        step={1}
        unit="°"
        onChange={(rotation) => setScene((s) => ({ ...s, rotation }))}
      />
      {scene.pathwayCount > 1 && (
        <Slider
          label="Spacing variation"
          value={scene.spacingVariation}
          min={0}
          max={1}
          onChange={(spacingVariation) => setScene((s) => ({ ...s, spacingVariation }))}
        />
      )}
      <Toggle
        label="Same layer structure for all pathways"
        checked={scene.sameLayersForAll}
        onChange={(sameLayersForAll) =>
          setScene((s) => ({
            ...s,
            sameLayersForAll,
            // Turning it on gives the rest pathway 1's structure; a pathway
            // whose structure already matches keeps its own node counts.
            pathways: sameLayersForAll
              ? s.pathways.map((p) => ({ ...p, layers: withStructureOf(p.layers, s.pathways[0].layers) }))
              : s.pathways,
          }))
        }
      />
      {pathways.map((p, i) => (
        <PathwayCard key={p.id} pathway={p} index={i} editStructure={!scene.sameLayersForAll || i === 0} />
      ))}
    </Section>
  );
}

function PathwayCard({ pathway: p, index, editStructure }: { pathway: Pathway; index: number; editStructure: boolean }) {
  const setPathway = useApp((s) => s.setPathway);
  const regeneratePathway = useApp((s) => s.regeneratePathway);
  const editLayers = useApp((s) => s.editLayers);
  const same = useApp((s) => s.scene.sameLayersForAll);
  const count = useApp((s) => s.scene.pathwayCount);

  return (
    <div className="card">
      <div className="card-head">
        <strong>Pathway {index + 1}</strong>
        <div className="card-actions">
          <button
            className={`btn small ${p.locked ? 'on' : ''}`}
            onClick={() => setPathway(index, (q) => ({ ...q, locked: !q.locked }))}
            title="Locked pathways are skipped by Regenerate all"
          >
            {p.locked ? 'Locked' : 'Lock'}
          </button>
          <button className="btn small" onClick={() => regeneratePathway(index)} title="New seed for this pathway">
            Regenerate
          </button>
        </div>
      </div>
      <Slider label="Branching" value={p.branching} min={0} max={1} onChange={(branching) => setPathway(index, (q) => ({ ...q, branching }))} />
      <Slider label="Convergence" value={p.convergence} min={0} max={1} onChange={(convergence) => setPathway(index, (q) => ({ ...q, convergence }))} />
      <Slider
        label="Start delay"
        value={p.startDelay}
        min={0}
        max={10}
        step={0.1}
        unit=" s"
        onChange={(startDelay) => setPathway(index, (q) => ({ ...q, startDelay }))}
      />

      {same && count > 1 && (
        <p className="hint">
          {editStructure
            ? 'Adding, removing or changing a layer applies to every pathway; node counts are per pathway.'
            : 'Layers follow pathway 1; node counts are this pathway’s own.'}
        </p>
      )}
      <div className="layers-head">
        <span>Layers</span>
        <span>Nodes</span>
        <span>Active</span>
        <span />
      </div>
      {p.layers.map((l, li) => {
        const opts = regionOptions(p.layers, li);
        return (
          <div className="layer-row" key={li}>
            <div className="layer-name">
              <em>{li + 1}</em>
              {editStructure && opts.length > 1 ? (
                <select value={l.region} onChange={(e) => editLayers(index, (ls) => setRegion(ls, li, e.target.value as Region))}>
                  {opts.map((r) => <option key={r} value={r}>{REGION_LABEL[r]}</option>)}
                </select>
              ) : (
                <span className={`region ${l.region}`}>{REGION_LABEL[l.region]}</span>
              )}
            </div>
            {li === 0 ? (
              <><span className="fixed">1</span><span className="fixed">1</span><span /></>
            ) : (
              <>
                <Stepper
                  value={l.nodeCount}
                  min={1}
                  max={MAX_NODES}
                  title="Nodes in this layer"
                  onChange={(n) => editLayers(index, (ls) => setCounts(ls, li, n, Math.min(l.activeCount, n)), { countsOnly: true })}
                />
                <Stepper
                  value={l.activeCount}
                  min={1}
                  max={l.nodeCount}
                  title="Active (connected) nodes"
                  onChange={(a) => editLayers(index, (ls) => setCounts(ls, li, l.nodeCount, a), { countsOnly: true })}
                />
                {editStructure ? (
                  <button
                    className="icon-btn"
                    title="Remove layer"
                    disabled={!canRemoveLayer(p.layers, li)}
                    onClick={() => editLayers(index, (ls) => removeLayer(ls, li))}
                  >
                    ×
                  </button>
                ) : (
                  <span />
                )}
              </>
            )}
          </div>
        );
      })}
      {editStructure && (
        <div className="row">
          <button className="btn small grow" disabled={!canAddLayer(p.layers)} onClick={() => editLayers(index, (ls) => addLayer(ls, 'cytoplasm'))}>
            + Cytoplasm layer
          </button>
          <button className="btn small grow" disabled={!canAddLayer(p.layers)} onClick={() => editLayers(index, (ls) => addLayer(ls, 'nucleus'))}>
            + Nucleus layer
          </button>
        </div>
      )}
    </div>
  );
}

export function CrosstalkSection() {
  const crosstalk = useApp((s) => s.scene.crosstalk);
  const count = useApp((s) => s.scene.pathwayCount);
  const setScene = useApp((s) => s.setScene);
  const set = (v: Partial<typeof crosstalk>) => setScene((s) => ({ ...s, crosstalk: { ...s.crosstalk, ...v } }));
  return (
    <Section title="Crosstalk" aside={<Toggle label="On" checked={crosstalk.enabled} onChange={(enabled) => set({ enabled })} />}>
      <Slider label="Amount" value={crosstalk.amount} min={0} max={1} onChange={(amount) => set({ amount })} />
      {count < 2 && <p className="hint">Crosstalk links neighbouring pathways, so it needs two or more.</p>}
    </Section>
  );
}
