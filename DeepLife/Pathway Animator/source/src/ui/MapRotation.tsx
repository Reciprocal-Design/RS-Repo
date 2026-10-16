import { Slider } from './controls';

/** Turn an imported map: quarter turns either way, or any angle. */
export function MapRotation({ value, onChange }: { value: number; onChange: (deg: number) => void }) {
  return (
    <>
      <div className="row">
        <button className="btn small grow" title="Turn the map 90° anticlockwise" onClick={() => onChange(value - 90)}>
          ↺ 90°
        </button>
        <button className="btn small grow" title="Turn the map 90° clockwise" onClick={() => onChange(value + 90)}>
          ↻ 90°
        </button>
        <button className="btn small grow" title="Back to the SVG as uploaded" disabled={!value} onClick={() => onChange(0)}>
          Reset
        </button>
      </div>
      <Slider label="Rotation" value={value} min={-180} max={180} step={1} unit="°" onChange={onChange} />
    </>
  );
}
