"use client";

import { motion } from "framer-motion";
import { Plus, RotateCcw, Wand2, Wind, X } from "lucide-react";
import { useVaporStore } from "@/lib/store";

interface ControlsProps {
  openPicker: () => void;
}

export default function Controls({ openPicker }: ControlsProps) {
  const images = useVaporStore((s) => s.images);
  const currentIndex = useVaporStore((s) => s.currentIndex);
  const mode = useVaporStore((s) => s.mode);
  const vaporizeCurrent = useVaporStore((s) => s.vaporizeCurrent);
  const vaporizeAll = useVaporStore((s) => s.vaporizeAll);
  const reset = useVaporStore((s) => s.reset);
  const setCurrent = useVaporStore((s) => s.setCurrent);
  const removeImage = useVaporStore((s) => s.removeImage);
  const sidebarOpen = useVaporStore((s) => s.sidebarOpen);

  if (images.length === 0) return null;

  const current = images[currentIndex];
  const isPlaying = mode !== "idle";
  const anyIdle = images.some((i) => i.status === "idle");
  const anyTouched = images.some((i) => i.status !== "idle");
  const canVaporize = !isPlaying && current?.status === "idle";

  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 240, damping: 28 }}
      data-no-swipe
      className={`pointer-events-none absolute inset-x-0 bottom-4 z-20 flex justify-center px-4 transition-[padding] duration-300 ${
        sidebarOpen ? "md:pr-[352px]" : ""
      }`}
    >
      <div className="glass pointer-events-auto flex max-w-[calc(100vw-2rem)] items-center gap-3 rounded-2xl px-3 py-3 md:gap-4 md:px-4">
        {/* Thumbnails — fixed width so the bar doesn't grow/recenter as images
            are added; the add button stays pinned to the left while thumbs
            scroll behind it. */}
        <div className="thin-scroll relative flex w-fit max-w-[46vw] items-center gap-2 overflow-x-auto md:max-w-[360px]">
          <button
            onClick={openPicker}
            className="sticky left-0 z-10 flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-dashed border-white/15 bg-[#16171b] text-text-faint transition-colors hover:border-white/30 hover:text-text"
            aria-label="Add images"
          >
            <Plus size={18} />
          </button>

          {images.map((img, i) => {
            const active = i === currentIndex;
            return (
              <div key={img.id} className="group relative shrink-0">
                <button
                  onClick={() => setCurrent(i)}
                  className={`relative h-12 w-12 overflow-hidden rounded-xl border transition-all ${
                    active
                      ? "border-white/60 ring-1 ring-white/30"
                      : "border-white/10 hover:border-white/30"
                  }`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={img.src}
                    alt={img.name}
                    className={`h-full w-full object-cover transition-opacity ${
                      img.status === "done" ? "opacity-25" : "opacity-90"
                    }`}
                  />
                  {img.status === "vaporizing" && (
                    <span className="absolute inset-0 flex items-center justify-center bg-black/40">
                      <span className="h-1.5 w-1.5 animate-ping rounded-full bg-white" />
                    </span>
                  )}
                </button>
                <button
                  onClick={() => removeImage(img.id)}
                  className="absolute -top-1.5 -right-1.5 flex h-5 w-5 items-center justify-center rounded-full border border-white/15 bg-bg-1 text-text-faint opacity-0 transition-opacity group-hover:opacity-100 hover:text-text"
                  aria-label="Remove"
                >
                  <X size={11} />
                </button>
              </div>
            );
          })}
        </div>

        <div className="h-9 w-px shrink-0 bg-white/10" />

        {/* Actions */}
        <div className="flex shrink-0 items-center gap-2">
          <button
            onClick={vaporizeCurrent}
            disabled={!canVaporize}
            className="flex h-11 items-center gap-2 rounded-xl bg-white px-4 text-sm font-semibold text-black transition-all hover:bg-white/90 disabled:cursor-not-allowed disabled:bg-white/15 disabled:text-text-faint"
          >
            <Wand2 size={16} />
            <span className="hidden sm:inline">Vaporize</span>
          </button>
          <button
            onClick={vaporizeAll}
            disabled={isPlaying || !anyIdle}
            className="flex h-11 items-center gap-2 rounded-xl border border-white/12 bg-white/[0.03] px-4 text-sm font-medium text-text transition-all hover:bg-white/8 disabled:cursor-not-allowed disabled:text-text-faint disabled:hover:bg-white/[0.03]"
          >
            <Wind size={16} />
            <span className="hidden sm:inline">Vaporize all</span>
          </button>
          <button
            onClick={reset}
            disabled={!anyTouched}
            className="flex h-11 w-11 items-center justify-center rounded-xl border border-white/12 bg-white/[0.03] text-text transition-all hover:bg-white/8 disabled:cursor-not-allowed disabled:text-text-faint disabled:hover:bg-white/[0.03]"
            aria-label="Reset"
            title="Reset"
          >
            <RotateCcw size={16} />
          </button>
        </div>
      </div>
    </motion.div>
  );
}
