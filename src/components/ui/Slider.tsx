"use client";

interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  format?: (v: number) => string;
  /** Optional helper line shown under the slider (ref-1 style). */
  caption?: string;
  onChange: (v: number) => void;
}

export default function Slider({
  label,
  value,
  min,
  max,
  step = 0.01,
  unit,
  format,
  caption,
  onChange,
}: SliderProps) {
  const pct = ((value - min) / (max - min)) * 100;
  const display = format ? format(value) : `${value}${unit ?? ""}`;

  return (
    <label className="block">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <span className="text-[12px] text-text-dim">{label}</span>
        <span className="font-mono text-[11px] tabular-nums text-text">
          {display}
        </span>
      </div>
      <input
        type="range"
        className="v-range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        style={
          {
            "--pct": `${pct}%`,
            "--fill": "var(--accent)",
          } as React.CSSProperties
        }
      />
      {caption ? (
        <p className="mt-1.5 text-[10.5px] leading-snug text-text-faint">
          {caption}
        </p>
      ) : null}
    </label>
  );
}
