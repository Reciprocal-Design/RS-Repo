import { useEffect, useState, type ReactNode } from 'react';
import { hexString, parseColor } from '../core/color';

export function Section({ title, children, defaultOpen = true, aside }: {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
  aside?: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className={`section ${open ? '' : 'closed'}`}>
      <div className="section-head">
        <button className="section-toggle" onClick={() => setOpen(!open)} aria-expanded={open}>
          <span className="caret">{open ? '▾' : '▸'}</span>
          <h2>{title}</h2>
        </button>
        {aside}
      </div>
      {open && <div className="section-body">{children}</div>}
    </section>
  );
}

export function Slider({ label, value, min, max, step = 0.01, unit = '', digits, onChange }: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  digits?: number;
  onChange: (v: number) => void;
}) {
  const d = digits ?? (step >= 1 ? 0 : step >= 0.1 ? 1 : 2);
  return (
    <label className="field slider">
      <span>
        {label}
        <b>{value.toFixed(d)}{unit}</b>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}

export function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

/** Hex colour picker. */
export function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="field color">
      <span>{label}</span>
      <div className="color-row">
        <input type="color" value={hexString(parseColor(value))} onChange={(e) => onChange(e.target.value)} />
        <code>{value}</code>
      </div>
    </label>
  );
}

/** Colour picker with an opacity slider, producing an rgba() string. */
export function ColorAlphaField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const [r, g, b, a] = parseColor(value);
  const emit = (hex: string, alpha: number) => {
    const [nr, ng, nb] = parseColor(hex);
    onChange(`rgba(${nr},${ng},${nb},${+alpha.toFixed(2)})`);
  };
  const hex = hexString([r, g, b, 1]);
  return (
    <div className="field color">
      <span>{label}</span>
      <div className="color-row">
        <input type="color" value={hex} onChange={(e) => emit(e.target.value, a)} />
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={a}
          title="Opacity"
          onChange={(e) => emit(hex, Number(e.target.value))}
        />
        <code>{Math.round(a * 100)}%</code>
      </div>
    </div>
  );
}

export function Select<T extends string>({ label, value, options, onChange }: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value as T)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </label>
  );
}

export function Stepper({ value, min, max, onChange, title }: {
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
  title?: string;
}) {
  return (
    <div className="stepper" title={title}>
      <button onClick={() => onChange(Math.max(min, value - 1))} disabled={value <= min}>−</button>
      <span>{value}</span>
      <button onClick={() => onChange(Math.min(max, value + 1))} disabled={value >= max}>+</button>
    </div>
  );
}

/** Integer input that commits on Enter or blur, so typing isn't clamped mid-way. */
export function NumberInput({ value, min, max, onCommit }: {
  value: number;
  min: number;
  max: number;
  onCommit: (v: number) => void;
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const commit = () => {
    const n = Math.round(Number(text));
    if (!Number.isFinite(n) || text.trim() === '') return setText(String(value));
    const v = Math.max(min, Math.min(max, n));
    setText(String(v));
    if (v !== value) onCommit(v);
  };
  return (
    <input
      type="number"
      value={text}
      min={min}
      max={max}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && commit()}
    />
  );
}
