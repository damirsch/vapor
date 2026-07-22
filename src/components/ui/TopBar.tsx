"use client";

import { ImagePlus, RotateCcw, SlidersHorizontal, Wand2, Wind } from "lucide-react";
import { useVaporStore } from "@/lib/store";

interface TopBarProps {
  openPicker: () => void;
}

export default function TopBar({ openPicker }: TopBarProps) {
  const images = useVaporStore((s) => s.images);
  const currentIndex = useVaporStore((s) => s.currentIndex);
  const mode = useVaporStore((s) => s.mode);
  const vaporizeCurrent = useVaporStore((s) => s.vaporizeCurrent);
  const vaporizeAll = useVaporStore((s) => s.vaporizeAll);
  const reset = useVaporStore((s) => s.reset);
  const setSidebarOpen = useVaporStore((s) => s.setSidebarOpen);
  const sidebarOpen = useVaporStore((s) => s.sidebarOpen);

  const current = images[currentIndex];
  const hasImages = images.length > 0;
  const isPlaying = mode !== "idle";
  const anyIdle = images.some((i) => i.status === "idle");
  const anyTouched = images.some((i) => i.status !== "idle");
  const canVaporize = !isPlaying && current?.status === "idle";

  return (
    <header className="glass-panel pointer-events-auto absolute inset-x-2.5 top-2.5 z-30 flex h-[52px] items-center justify-between gap-3 rounded-2xl px-3 md:px-4">
      {/* Brand */}
      <div className="flex shrink-0 items-center gap-2.5 select-none">
        <span className="h-2 w-2 rounded-full bg-white shadow-[0_0_10px_2px_rgba(255,255,255,0.55)]" />
        <span className="text-[13px] font-semibold tracking-[0.22em] text-text uppercase">
          Vapor&nbsp;OS
        </span>
      </div>

      {/* Center: current file */}
      <div className="pointer-events-none absolute left-1/2 hidden -translate-x-1/2 items-center gap-2 md:flex">
        {hasImages && current ? (
          <>
            <span className="max-w-[280px] truncate text-[12px] text-text-dim">
              {current.name}
            </span>
            <span className="rounded-md bg-white/5 px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-text-faint">
              {currentIndex + 1} / {images.length}
            </span>
          </>
        ) : (
          <span className="text-[12px] tracking-wide text-text-faint">
            no image loaded
          </span>
        )}
      </div>

      {/* Actions */}
      <div className="flex shrink-0 items-center gap-2">
        <button
          onClick={openPicker}
          className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-xl border border-white/10 bg-white/[0.03] text-text-dim transition-colors hover:bg-white/8 hover:text-text md:hidden"
          aria-label="Add image"
        >
          <ImagePlus size={16} />
        </button>

        <button
          onClick={reset}
          disabled={!anyTouched}
          className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-xl border border-white/10 bg-white/[0.03] text-text transition-colors hover:bg-white/8 disabled:cursor-not-allowed disabled:text-text-faint disabled:hover:bg-white/[0.03]"
          aria-label="Reset"
          title="Reset"
        >
          <RotateCcw size={15} />
        </button>

        <button
          onClick={vaporizeAll}
          disabled={isPlaying || !anyIdle}
          className="hidden h-9 cursor-pointer items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 text-[13px] font-medium text-text transition-colors hover:bg-white/8 disabled:cursor-not-allowed disabled:text-text-faint disabled:hover:bg-white/[0.03] sm:flex"
        >
          <Wind size={15} />
          Vaporize all
        </button>

        <button
          onClick={vaporizeCurrent}
          disabled={!canVaporize}
          className="flex h-9 cursor-pointer items-center gap-2 rounded-xl bg-white px-3.5 text-[13px] font-semibold text-black transition-colors hover:bg-white/90 disabled:cursor-not-allowed disabled:bg-white/15 disabled:text-text-faint"
        >
          <Wand2 size={15} />
          Vaporize
        </button>

        {/* Mobile: open the control panel */}
        <button
          onClick={() => setSidebarOpen(!sidebarOpen)}
          className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-xl border border-white/10 bg-white/[0.03] text-text-dim transition-colors hover:bg-white/8 hover:text-text lg:hidden"
          aria-label="Toggle controls"
        >
          <SlidersHorizontal size={15} />
        </button>
      </div>
    </header>
  );
}
