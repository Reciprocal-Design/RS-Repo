import type { OutlineLook, OutlineStyle } from '../core/types';
import { ColorField, Select, Slider } from './controls';

/** Outline look: a plain line, or a glowing rim with light fading inward. */
export function OutlineControls({ look, onChange }: { look: OutlineLook; onChange: (v: Partial<OutlineLook>) => void }) {
  return (
    <>
      <Select<OutlineStyle>
        label="Outline"
        value={look.outlineStyle}
        options={[
          { value: 'glow', label: 'Glowing rim' },
          { value: 'line', label: 'Line' },
        ]}
        onChange={(outlineStyle) => onChange({ outlineStyle })}
      />
      {look.outlineStyle === 'glow' && (
        <>
          <Slider label="Glow depth" value={look.glowWidth} min={0} max={200} step={1} unit=" px" onChange={(glowWidth) => onChange({ glowWidth })} />
          <ColorField label="Rim colour" value={look.edgeColor} onChange={(edgeColor) => onChange({ edgeColor })} />
          <ColorField label="Glow colour" value={look.glowColor} onChange={(glowColor) => onChange({ glowColor })} />
        </>
      )}
    </>
  );
}
