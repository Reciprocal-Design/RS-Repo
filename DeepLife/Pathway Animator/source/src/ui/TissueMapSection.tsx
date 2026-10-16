import { useRef, useState } from 'react';
import { heroCellOf } from '../core/cellMap';
import { SINGLE_CELL } from '../core/modules';
import { importCellMapSvg } from '../core/svgImport';
import { Section } from './controls';
import { MapRotation } from './MapRotation';
import { useApp } from './store';

const points = (a: number[]) => {
  let s = '';
  for (let i = 0; i + 1 < a.length; i += 2) s += `${a[i]},${a[i + 1]} `;
  return s;
};

/**
 * The tissue map every cell view shares: upload it once, pick the cell that
 * is the single cell of the first views, and each view shows its part of it.
 */
export function TissueMapSection() {
  const scene = useApp((s) => s.scene);
  const setTissueMap = useApp((s) => s.setTissueMap);
  const setHeroCell = useApp((s) => s.setHeroCell);
  const clearTissueMap = useApp((s) => s.clearTissueMap);
  const rotateTissueMap = useApp((s) => s.rotateTissueMap);
  const fileRef = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);
  const kind = scene.module.kind;
  if (![...SINGLE_CELL, 'tissue', 'crossTissue', 'journey'].includes(kind)) return null;

  const cm = scene.cellMap;
  const hero = heroCellOf(cm);
  const vb = cm.viewBox;
  const what = SINGLE_CELL.includes(kind)
    ? 'This view shows the selected cell on its own.'
    : kind === 'tissue'
      ? 'This view shows the whole map, the selected cell in the middle.'
      : kind === 'crossTissue'
        ? 'This view shows the map twice, side by side; the signal starts in the selected cell.'
        : 'The sequence starts on the selected cell, then pulls back to the whole map.';

  return (
    <Section title="Tissue map">
      <button className="btn wide" onClick={() => fileRef.current?.click()}>
        {hero ? 'Replace SVG tissue map…' : 'Upload SVG tissue map…'}
      </button>
      <input
        ref={fileRef}
        type="file"
        accept="image/svg+xml,.svg"
        data-role="tissue-map"
        hidden
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (!file) return;
          setMessage(null);
          try {
            const imported = importCellMapSvg(await file.text(), 1);
            setTissueMap({ name: file.name, viewBox: imported.viewBox, cells: imported.cells });
            setMessage({ text: [`${imported.cells.length} cells found in ${file.name}.`, ...imported.warnings].join(' ') });
          } catch (err) {
            setMessage({ text: (err as Error).message, error: true });
          }
        }}
      />
      {message && <p className={`hint ${message.error ? 'error' : 'ok'}`}>{message.text}</p>}

      {hero ? (
        <>
          <svg
            className="cell-picker"
            viewBox={`${vb.x} ${vb.y} ${vb.width} ${vb.height}`}
            role="listbox"
            aria-label="Cells of the tissue map: click one to select it"
          >
            {cm.cells.map((c) => (
              <polygon
                key={c.id}
                points={points(c.membrane)}
                className={c.id === hero.id ? 'on' : ''}
                role="option"
                aria-selected={c.id === hero.id}
                onClick={() => setHeroCell(c.id)}
              >
                <title>{c.id === hero.id ? 'Selected cell' : 'Select this cell'}</title>
              </polygon>
            ))}
          </svg>
          <p className="hint">
            {cm.name || 'Map'}: cell {cm.cells.findIndex((c) => c.id === hero.id) + 1} of {cm.cells.length} selected. Click
            a cell above to select another; it applies to every view. {what}
          </p>
          <MapRotation value={cm.rotation ?? 0} onChange={rotateTissueMap} />
          <button className="btn small" onClick={() => { clearTissueMap(); setMessage(null); }}>Remove the map</button>
        </>
      ) : (
        <p className="hint">
          One SVG of the tissue (each cell's membrane and nucleus as closed shapes) for every view: tabs 1–4 show the
          cell you select in it, tab 5 the whole map round that cell, tab 6 the map twice, side by side.
        </p>
      )}
    </Section>
  );
}
