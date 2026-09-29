import { useRef, useState } from 'react';
import { suggestedDetailScale } from '../core/cellMap';
import { defaultCellMap } from '../core/defaults';
import { randomSeed } from '../core/rng';
import { importCellMapSvg } from '../core/svgImport';
import { Section, Slider, Toggle } from './controls';
import { useApp } from './store';

/** Import an SVG of a cell cluster and grow pathways in its cells. */
export function CellMapSection() {
  const scene = useApp((s) => s.scene);
  const setScene = useApp((s) => s.setScene);
  const setCellMap = useApp((s) => s.setCellMap);
  const fileRef = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);
  const m = scene.cellMap;
  const loaded = m.cells.length > 0;
  const on = m.cells.filter((c) => c.enabled).length;
  const set = (v: Partial<typeof m>) => setCellMap((x) => ({ ...x, ...v }));
  const setAll = (pick: (i: number) => boolean) =>
    setCellMap((x) => ({ ...x, cells: x.cells.map((c, i) => ({ ...c, enabled: pick(i) })) }));

  const onFile = async (file: File) => {
    setMessage(null);
    try {
      const imported = importCellMapSvg(await file.text(), randomSeed());
      setScene((s) => ({
        ...s,
        cellMap: {
          ...defaultCellMap(),
          stagger: s.cellMap.stagger,
          links: s.cellMap.links,
          enabled: true,
          name: file.name,
          viewBox: imported.viewBox,
          cells: imported.cells,
          detailScale: suggestedDetailScale(s, imported),
        },
      }));
      setMessage({ text: [`${imported.cells.length} cells found in ${file.name}.`, ...imported.warnings].join(' ') });
    } catch (e) {
      setMessage({ text: (e as Error).message, error: true });
    }
  };

  return (
    <Section title="Cell map" aside={loaded ? <Toggle label="Use" checked={m.enabled} onChange={(enabled) => set({ enabled })} /> : undefined}>
      <button className="btn wide" onClick={() => fileRef.current?.click()}>
        {loaded ? 'Replace SVG map…' : 'Import SVG map…'}
      </button>
      <input
        ref={fileRef}
        type="file"
        accept="image/svg+xml,.svg"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) onFile(file);
        }}
      />
      {!loaded && (
        <p className="hint">
          An SVG with each cell's membrane and nucleus as closed shapes (paths, polygons, circles or ellipses). Every
          cell gets its own pathways from the settings below.
        </p>
      )}
      {message && <p className={`hint ${message.error ? 'error' : 'ok'}`}>{message.text}</p>}

      {loaded && (
        <>
          <p className="hint">
            {m.name || 'Map'}: {on} of {m.cells.length} cells with pathways. Click a cell in the preview to add or remove
            its pathways; Shift-click to re-roll its layout.
          </p>
          <div className="row">
            <button className="btn small grow" onClick={() => setAll(() => true)}>All</button>
            <button className="btn small grow" onClick={() => setAll(() => false)}>None</button>
            <button
              className="btn small grow"
              title="Pathways in a random half of the cells"
              onClick={() => {
                const seed = randomSeed();
                setAll((i) => ((seed ^ Math.imul(i + 1, 2654435761)) >>> 0) % 2 === 0);
              }}
            >
              Random half
            </button>
          </div>
          <Toggle label="Point pathways into the widest space" checked={m.orient} onChange={(orient) => set({ orient })} />
          <Slider
            label="Cell variation"
            value={m.variation}
            min={0}
            max={1}
            onChange={(variation) => set({ variation })}
          />
          <Slider label="Detail size" value={m.detailScale} min={0.2} max={1} onChange={(detailScale) => set({ detailScale })} />
          <Slider label="Start spread" value={m.stagger} min={0} max={10} step={0.1} unit=" s" onChange={(stagger) => set({ stagger })} />
          <Toggle
            label="Signals pass to neighbouring cells"
            checked={m.links.enabled}
            onChange={(enabled) => set({ links: { ...m.links, enabled } })}
          />
          {m.links.enabled && (
            <>
              <Slider
                label="Links per neighbour"
                value={m.links.amount}
                min={0}
                max={8}
                step={0.05}
                onChange={(amount) => set({ links: { ...m.links, amount } })}
              />
              <Slider
                label="Relay chain"
                value={m.relayHops}
                min={0}
                max={10}
                step={1}
                unit={m.relayHops === 1 ? ' cell' : ' cells'}
                onChange={(relayHops) => set({ relayHops })}
              />
              <Slider
                label="Spontaneous starts"
                value={Math.round(m.startShare * 100)}
                min={0}
                max={100}
                step={5}
                unit="%"
                onChange={(v) => set({ startShare: v / 100 })}
              />
              <p className="hint">
                A link enters the neighbour through a receptor on the shared wall and runs its pathway again from there;
                the relay chain is how many cells in a row it can pass on. Lower spontaneous starts so only some
                pathways fire on their own and the rest wait for a relay: a chain reaction (pair with “Grey out idle
                pathways” in Style).
              </p>
            </>
          )}
          <div className="row">
            <button
              className="btn small grow"
              title="Set the canvas height so the map fills it"
              onClick={() =>
                setScene((s) => ({
                  ...s,
                  canvas: { ...s.canvas, height: Math.round((s.canvas.width * m.viewBox.height) / m.viewBox.width) },
                }))
              }
            >
              Fit canvas to map
            </button>
            <button className="btn small grow" onClick={() => setCellMap(() => defaultCellMap())}>
              Remove map
            </button>
          </div>
        </>
      )}
    </Section>
  );
}
