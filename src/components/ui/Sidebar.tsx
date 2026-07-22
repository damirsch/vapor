"use client";

import { AnimatePresence, motion } from "framer-motion";
import { RotateCcw, Settings2, X } from "lucide-react";
import { useVaporStore } from "@/lib/store";
import Slider from "./Slider";

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="mt-1 mb-3 text-[10px] font-semibold tracking-[0.18em] text-text-faint uppercase">
      {children}
    </h3>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex w-full cursor-pointer items-center justify-between"
    >
      <span className="text-xs text-text-dim">{label}</span>
      <span
        className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
          checked ? "bg-white/80" : "bg-white/12"
        }`}
      >
        <span
          className={`inline-block h-4 w-4 rounded-full bg-black transition-transform ${
            checked ? "translate-x-[18px]" : "translate-x-0.5"
          }`}
        />
      </span>
    </button>
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
      {/* Toggle button (mostly for small screens / when collapsed) */}
      <AnimatePresence>
        {!open && (
          <motion.button
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            onClick={() => setOpen(true)}
            className="glass glass-hover absolute top-5 right-5 z-30 flex h-11 w-11 items-center justify-center rounded-full text-text"
            aria-label="Open settings"
          >
            <Settings2 size={18} />
          </motion.button>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {open && (
          <motion.aside
            initial={{ opacity: 0, x: 32, filter: "blur(6px)" }}
            animate={{ opacity: 1, x: 0, filter: "blur(0px)" }}
            exit={{ opacity: 0, x: 32, filter: "blur(6px)" }}
            transition={{ type: "spring", stiffness: 260, damping: 30 }}
            data-no-swipe
            className="panel-solid absolute top-4 right-4 bottom-4 z-30 flex w-[320px] max-w-[calc(100vw-2rem)] flex-col rounded-2xl"
          >
            <div className="flex items-center justify-between px-5 pt-4 pb-3">
              <div className="flex items-center gap-2">
                <Settings2 size={15} className="text-text-dim" />
                <span className="text-[11px] font-semibold tracking-[0.2em] text-text uppercase">
                  Controls
                </span>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="flex h-7 w-7 items-center justify-center rounded-lg text-text-faint transition-colors hover:bg-white/5 hover:text-text"
                aria-label="Collapse settings"
              >
                <X size={16} />
              </button>
            </div>

            <div className="thin-scroll flex-1 space-y-6 overflow-y-auto px-5 pt-1 pb-5">
              <div className="space-y-4">
                <SectionTitle>Motion</SectionTitle>
                <Slider
                  label="Speed"
                  value={settings.speed}
                  min={0.1}
                  max={1.2}
                  onChange={(v) => update("speed", v)}
                  format={(v) => `${(v).toFixed(2)}×`}
                />
                <Slider
                  label="Strength"
                  value={settings.strength}
                  min={0.1}
                  max={2.5}
                  onChange={(v) => update("strength", v)}
                  format={(v) => v.toFixed(2)}
                />
                <Slider
                  label="Turbulence"
                  value={settings.turbulence}
                  min={0.1}
                  max={2.5}
                  onChange={(v) => update("turbulence", v)}
                  format={(v) => v.toFixed(2)}
                />
                <Slider
                  label="Drift X"
                  value={settings.driftX}
                  min={-1.5}
                  max={1.5}
                  onChange={(v) => update("driftX", v)}
                  format={(v) => v.toFixed(2)}
                />
                <Slider
                  label="Drift Y"
                  value={settings.driftY}
                  min={-1.5}
                  max={1.5}
                  onChange={(v) => update("driftY", v)}
                  format={(v) => v.toFixed(2)}
                />
              </div>

              <div className="space-y-4">
                <SectionTitle>Look</SectionTitle>
                <Toggle
                  label="Cursor smoke"
                  checked={settings.cursorSmoke}
                  onChange={(v) => update("cursorSmoke", v)}
                />
                <Slider
                  label="Sweep line width"
                  value={settings.edge}
                  min={0.05}
                  max={0.7}
                  step={0.01}
                  onChange={(v) => update("edge", v)}
                  format={(v) => v.toFixed(2)}
                />
                <Slider
                  label="Smoke lifetime"
                  value={settings.lifetime}
                  min={0.2}
                  max={2}
                  step={0.05}
                  onChange={(v) => update("lifetime", v)}
                  format={(v) => v.toFixed(2)}
                />
              </div>

              <div className="space-y-4">
                <SectionTitle>Sequence</SectionTitle>
                <Slider
                  label="Delay between images"
                  value={settings.delay}
                  min={0}
                  max={3}
                  step={0.1}
                  onChange={(v) => update("delay", v)}
                  format={(v) => `${v.toFixed(1)}s`}
                />
              </div>

              <button
                onClick={resetSettings}
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-white/8 bg-white/[0.02] py-2.5 text-[11px] font-medium tracking-wide text-text-dim uppercase transition-colors hover:bg-white/5 hover:text-text"
              >
                <RotateCcw size={13} />
                Reset settings
              </button>
            </div>
          </motion.aside>
        )}
      </AnimatePresence>
    </>
  );
}
