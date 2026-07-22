"use client";

import { Plus, X } from "lucide-react";
import { useVaporStore } from "@/lib/store";

interface LeftRailProps {
  openPicker: () => void;
}

export default function LeftRail({ openPicker }: LeftRailProps) {
  const images = useVaporStore((s) => s.images);
  const currentIndex = useVaporStore((s) => s.currentIndex);
  const setCurrent = useVaporStore((s) => s.setCurrent);
  const removeImage = useVaporStore((s) => s.removeImage);

  return (
    <aside
      data-no-swipe
      className="glass-panel pointer-events-auto absolute left-2.5 z-20 hidden w-[96px] flex-col gap-2.5 rounded-2xl p-2.5 md:flex"
      style={{ top: 70, bottom: 40 }}
    >
      <button
        onClick={openPicker}
        className="flex aspect-square w-full shrink-0 cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-white/15 bg-white/[0.02] text-text-faint transition-colors hover:border-white/30 hover:text-text"
        aria-label="Add new image"
      >
        <Plus size={16} />
        <span className="text-[9px] leading-tight tracking-wide">Add</span>
      </button>

      <div className="thin-scroll flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto">
        {images.map((img, i) => {
          const active = i === currentIndex;
          return (
            <div key={img.id} className="group relative shrink-0">
              <button
                onClick={() => setCurrent(i)}
                className={`relative block aspect-square w-full cursor-pointer overflow-hidden rounded-xl border transition-all ${
                  active
                    ? "border-white/60 ring-1 ring-white/25"
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
                className="absolute -top-1.5 -right-1.5 flex h-5 w-5 cursor-pointer items-center justify-center rounded-full border border-white/15 bg-bg-1 text-text-faint opacity-0 transition-opacity group-hover:opacity-100 hover:text-text"
                aria-label="Remove"
              >
                <X size={11} />
              </button>
            </div>
          );
        })}
      </div>
    </aside>
  );
}
