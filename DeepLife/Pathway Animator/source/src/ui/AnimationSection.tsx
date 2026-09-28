import type { AnimationSettings } from '../core/types';
import { Section, Select, Slider, Toggle } from './controls';
import { useApp } from './store';

export function AnimationSection() {
  const a = useApp((s) => s.scene.animation);
  const count = useApp((s) => s.scene.pathwayCount);
  const setScene = useApp((s) => s.setScene);
  const set = (v: Partial<AnimationSettings>) => setScene((s) => ({ ...s, animation: { ...s.animation, ...v } }));

  return (
    <Section title="Animation">
      <Slider label="Layer hop" value={a.layerDuration} min={0.2} max={3} step={0.05} unit=" s" onChange={(layerDuration) => set({ layerDuration })} />
      <Slider label="Nucleus slow-down" value={a.nucleusSpeedFactor} min={1} max={3} step={0.05} unit="×"
        onChange={(nucleusSpeedFactor) => set({ nucleusSpeedFactor })} />
      <Select<AnimationSettings['easing']>
        label="Easing"
        value={a.easing}
        options={[
          { value: 'linear', label: 'Linear' },
          { value: 'easeInOut', label: 'Ease in-out' },
        ]}
        onChange={(easing) => set({ easing })}
      />
      <div className="row">
        <div className="grow">
          <Slider label="Pathway stagger" value={a.pathwayStagger} min={0} max={5} step={0.1} unit=" s"
            onChange={(pathwayStagger) => set({ pathwayStagger })} />
        </div>
        <button
          className="btn small"
          disabled={count < 2}
          title="Set each pathway's start delay to its index × stagger"
          onClick={() =>
            setScene((s) => ({
              ...s,
              pathways: s.pathways.map((p, i) => ({ ...p, startDelay: +(i * s.animation.pathwayStagger).toFixed(2) })),
            }))
          }
        >
          Apply
        </button>
      </div>
      <Slider label="Trail length" value={a.trailLength} min={0} max={1.5} step={0.05} onChange={(trailLength) => set({ trailLength })} />
      <Slider label="Comet size" value={a.cometSize} min={0.5} max={10} step={0.25} unit=" px" onChange={(cometSize) => set({ cometSize })} />
      <Slider label="Glow" value={a.glow} min={0} max={1} onChange={(glow) => set({ glow })} />
      <Slider label="Lit edge opacity" value={a.litEdgeOpacity} min={0} max={1} onChange={(litEdgeOpacity) => set({ litEdgeOpacity })} />
      <Slider label="Node pulse" value={a.nodePulseScale} min={1} max={3} step={0.05} unit="×" onChange={(nodePulseScale) => set({ nodePulseScale })} />
      <Slider label="Hold at end" value={a.holdAtEnd} min={0} max={6} step={0.1} unit=" s" onChange={(holdAtEnd) => set({ holdAtEnd })} />
      <Toggle label="Loop" checked={a.loop} onChange={(loop) => set({ loop })} />
    </Section>
  );
}
