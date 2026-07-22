"use client";

interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  format?: (v: number) => string;
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
  onChange,
}: SliderProps) {
  const pct = ((value - min) / (max - min)) * 100;
  const display = format ? format(value) : `${value}${unit ?? ""}`;

  return (
    <label className="block">
      <div className="mb-1.5 flex items-baseline justify-between">
        <span className="text-[11px] font-medium tracking-wide text-text-dim uppercase">
          {label}
        </span>
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
            "--fill": "#e7e8ea",
          } as React.CSSProperties
        }
      />
    </label>
  );
}
