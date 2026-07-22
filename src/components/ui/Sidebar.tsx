"use client";

import { RotateCcw, X } from "lucide-react";
import { useVaporStore } from "@/lib/store";
import Slider from "./Slider";

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="mt-1 mb-3 text-[10px] font-semibold tracking-[0.2em] text-text-faint uppercase">
      {children}
    </h3>
  );
}

function Toggle({
  label,
  caption,
  checked,
  onChange,
}: {
  label: string;
  caption?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className="flex w-full cursor-pointer items-center justify-between"
      >
        <span className="text-[12px] text-text-dim">{label}</span>
        <span
          className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
            checked ? "bg-white/85" : "bg-white/12"
          }`}
        >
          <span
            className={`inline-block h-4 w-4 rounded-full bg-black transition-transform ${
              checked ? "translate-x-[18px]" : "translate-x-0.5"
            }`}
          />
        </span>
      </button>
      {caption ? (
        <p className="mt-1.5 text-[10.5px] leading-snug text-text-faint">
          {caption}
        </p>
      ) : null}
    </div>
  );
}

export default function Sidebar() {
  const settings = useVaporStore((s) => s.settings);
  const update = useVaporStore((s) => s.updateSetting);
  const resetSettings = useVaporStore((s) => s.resetSettings);
  const open = useVaporStore((s) => s.sidebarOpen);
  const setOpen = useVaporStore((s) => s.setSidebarOpen);

  return (
    <>
      {/* Mobile backdrop */}
      <div
        onClick={() => setOpen(false)}
        className={`absolute inset-0 z-30 bg-black/50 backdrop-blur-[2px] transition-opacity duration-300 lg:hidden ${
          open ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      />

      <aside
        data-no-swipe
        style={{ top: 70, bottom: 40 }}
        className={`glass-panel absolute right-2.5 z-40 flex w-[300px] max-w-[calc(100vw-1.25rem)] flex-col rounded-2xl transition-[transform,opacity] duration-300 ease-out lg:pointer-events-auto lg:translate-x-0 lg:opacity-100 ${
          open
            ? "pointer-events-auto translate-x-0 opacity-100"
            : "pointer-events-none translate-x-[112%] opacity-0 lg:pointer-events-auto"
        }`}
      >
        <div className="flex items-center justify-between px-5 pt-4 pb-3">
          <span className="text-[11px] font-semibold tracking-[0.22em] text-text uppercase">
            Controls
          </span>
          <button
            onClick={() => setOpen(false)}
            className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-lg text-text-faint transition-colors hover:bg-white/5 hover:text-text lg:hidden"
            aria-label="Close controls"
          >
            <X size={16} />
          </button>
        </div>

        <div className="thin-scroll flex-1 space-y-6 overflow-y-auto px-5 pt-1 pb-5">
          <div className="space-y-5">
            <SectionTitle>Motion</SectionTitle>
            <Slider
              label="Speed"
              value={settings.speed}
              min={0.1}
              max={1.2}
              onChange={(v) => update("speed", v)}
              format={(v) => `${v.toFixed(2)}×`}
              caption="How fast the sweep dissolves the image."
            />
            <Slider
              label="Strength"
              value={settings.strength}
              min={0.1}
              max={2.5}
              onChange={(v) => update("strength", v)}
              format={(v) => v.toFixed(2)}
              caption="Force pushed into the vapor as it lifts off."
            />
            <Slider
              label="Turbulence"
              value={settings.turbulence}
              min={0.1}
              max={2.5}
              onChange={(v) => update("turbulence", v)}
              format={(v) => v.toFixed(2)}
              caption="Amount of swirl in the rising smoke."
            />
            <Slider
              label="Drift X"
              value={settings.driftX}
              min={-1.5}
              max={1.5}
              onChange={(v) => update("driftX", v)}
              format={(v) => v.toFixed(2)}
              caption="Sideways bias of the drifting smoke."
            />
            <Slider
              label="Drift Y"
              value={settings.driftY}
              min={-1.5}
              max={1.5}
              onChange={(v) => update("driftY", v)}
              format={(v) => v.toFixed(2)}
              caption="Vertical bias — negative falls, positive rises."
            />
          </div>

          <div className="space-y-5">
            <SectionTitle>Look</SectionTitle>
            <Toggle
              label="Cursor smoke"
              checked={settings.cursorSmoke}
              onChange={(v) => update("cursorSmoke", v)}
              caption="Let the pointer stir colored smoke into the scene."
            />
            <Slider
              label="Sweep line width"
              value={settings.edge}
              min={0.05}
              max={0.7}
              step={0.01}
              onChange={(v) => update("edge", v)}
              format={(v) => v.toFixed(2)}
              caption="Thickness of the bright dissolve edge."
            />
            <Slider
              label="Smoke lifetime"
              value={settings.lifetime}
              min={0.2}
              max={2}
              step={0.05}
              onChange={(v) => update("lifetime", v)}
              format={(v) => v.toFixed(2)}
              caption="How long vapor lingers before fading out."
            />
          </div>

          <div className="space-y-5">
            <SectionTitle>Sequence</SectionTitle>
            <Slider
              label="Delay between images"
              value={settings.delay}
              min={0}
              max={3}
              step={0.1}
              onChange={(v) => update("delay", v)}
              format={(v) => `${v.toFixed(1)}s`}
              caption="Pause between images during Vaporize all."
            />
          </div>

          <button
            onClick={resetSettings}
            className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl border border-white/8 bg-white/[0.02] py-2.5 text-[10px] font-semibold tracking-[0.18em] text-text-dim uppercase transition-colors hover:bg-white/5 hover:text-text"
          >
            <RotateCcw size={13} />
            Reset settings
          </button>
        </div>
      </aside>
    </>
  );
}
