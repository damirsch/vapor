"use client";

import { motion } from "framer-motion";
import {
  Flame,
  ImagePlus,
  RotateCcw,
  SlidersHorizontal,
  Wand2,
  Wind,
} from "lucide-react";
import { useVaporStore } from "@/lib/store";
import Button from "./Button";

interface BottomBarProps {
  openPicker: () => void;
}

export default function BottomBar({ openPicker }: BottomBarProps) {
  const images = useVaporStore((s) => s.images);
  const currentIndex = useVaporStore((s) => s.currentIndex);
  const mode = useVaporStore((s) => s.mode);
  const effect = useVaporStore((s) => s.settings.effect);
  const vaporizeCurrent = useVaporStore((s) => s.vaporizeCurrent);
  const vaporizeAll = useVaporStore((s) => s.vaporizeAll);
  const reset = useVaporStore((s) => s.reset);
  const sidebarOpen = useVaporStore((s) => s.sidebarOpen);
  const setSidebarOpen = useVaporStore((s) => s.setSidebarOpen);

  if (images.length === 0) return null;

  const current = images[currentIndex];
  const isPlaying = mode !== "idle";
  const anyIdle = images.some((i) => i.status === "idle");
  const anyTouched = images.some((i) => i.status !== "idle");
  const canVaporize = !isPlaying && current?.status === "idle";

  const cig = effect === "cigarette";
  const oneLabel = cig ? "Burn" : "Vaporize";
  const allLabel = cig ? "Burn all" : "Vaporize all";

  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 240, damping: 28 }}
      data-no-swipe
      className="pointer-events-none absolute inset-x-0 bottom-4 z-20 flex justify-center px-4 md:pl-[140px] lg:pr-[328px]"
    >
      <div className="glass-panel pointer-events-auto flex items-center gap-2 rounded-2xl px-3 py-3 md:gap-3">
        {/* Mobile-only: add image (left rail is hidden on small screens) */}
        <Button
          variant="ghost"
          iconOnly
          onClick={openPicker}
          aria-label="Add image"
          className="md:hidden"
        >
          <ImagePlus size={17} />
        </Button>

        <Button
          variant="primary"
          onClick={vaporizeCurrent}
          disabled={!canVaporize}
          className="font-semibold"
        >
          {cig ? <Flame size={16} /> : <Wand2 size={16} />}
          <span className="hidden sm:inline">{oneLabel}</span>
        </Button>

        <Button
          variant="secondary"
          onClick={vaporizeAll}
          disabled={isPlaying || !anyIdle}
        >
          {cig ? <Flame size={16} /> : <Wind size={16} />}
          <span className="hidden sm:inline">{allLabel}</span>
        </Button>

        <Button
          variant="secondary"
          iconOnly
          onClick={reset}
          disabled={!anyTouched}
          aria-label="Reset"
          title="Reset"
        >
          <RotateCcw size={16} />
        </Button>

        {/* Mobile-only: open the control panel */}
        <Button
          variant="ghost"
          iconOnly
          onClick={() => setSidebarOpen(!sidebarOpen)}
          aria-label="Toggle controls"
          className="lg:hidden"
        >
          <SlidersHorizontal size={16} />
        </Button>
      </div>
    </motion.div>
  );
}
