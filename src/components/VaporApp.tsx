"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { AnimatePresence, motion } from "framer-motion";
import { ImagePlus, Clipboard, MousePointer2 } from "lucide-react";
import { useVaporStore } from "@/lib/store";
import Sidebar from "@/components/ui/Sidebar";
import Header from "@/components/ui/Header";
import BottomBar from "@/components/ui/BottomBar";
import LeftRail from "@/components/ui/LeftRail";
import MobilePager from "@/components/ui/MobilePager";
import SwipeLock from "@/components/ui/SwipeLock";

const Scene = dynamic(() => import("@/components/vapor/Scene"), {
  ssr: false,
});
const FluidLayer = dynamic(() => import("@/components/vapor/FluidLayer"), {
  ssr: false,
});

export default function VaporApp() {
  const images = useVaporStore((s) => s.images);
  const effect = useVaporStore((s) => s.settings.effect);
  const addFiles = useVaporStore((s) => s.addFiles);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);

  const openPicker = useCallback(() => fileInputRef.current?.click(), []);

  // Paste image from clipboard.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const files: File[] = [];
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.type.startsWith("image/")) {
          const f = item.getAsFile();
          if (f) files.push(f);
        }
      }
      if (files.length) {
        e.preventDefault();
        addFiles(files);
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [addFiles]);

  // Trackpad / wheel swipe to navigate the filmstrip. One step per flick: after
  // a step we start a short cooldown that swallows the inertial momentum tail,
  // then automatically clears — so consecutive swipes always work without
  // needing to nudge the cursor to "unstick" a lock.
  useEffect(() => {
    let accum = 0;
    let cooldownUntil = 0;
    const STEP = 40;
    const COOLDOWN = 420;

    const step = (dir: number) => {
      const { images: imgs, currentIndex, setCurrent } =
        useVaporStore.getState();
      const ni = Math.min(imgs.length - 1, Math.max(0, currentIndex + dir));
      if (ni !== currentIndex) setCurrent(ni);
    };

    const onWheel = (e: WheelEvent) => {
      const { images: imgs, swipeLocked } = useVaporStore.getState();
      if (swipeLocked) return;
      if (imgs.length < 2) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest("[data-no-swipe]")) return;

      const d = Math.abs(e.deltaX) >= Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      // Stop the browser's horizontal overscroll (back/forward) gesture.
      if (e.cancelable) e.preventDefault();

      const now = performance.now();
      // During cooldown, keep eating the decaying momentum so it can't stack
      // up into an unwanted second step.
      if (now < cooldownUntil) {
        accum = 0;
        return;
      }

      accum += d;
      if (Math.abs(accum) > STEP) {
        step(accum > 0 ? 1 : -1);
        accum = 0;
        cooldownUntil = now + COOLDOWN;
      }
    };

    window.addEventListener("wheel", onWheel, { passive: false });
    return () => window.removeEventListener("wheel", onWheel);
  }, []);

  // Pointer drag to navigate — works for mouse click-drag, touch, and pen, with
  // the filmstrip following the finger live and snapping on release.
  const drag = useRef<{
    startX: number;
    startY: number;
    axis: null | "x" | "y";
    pointerId: number;
  } | null>(null);

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    // In cigarette mode a press means "burn here", so don't hijack it for the
    // filmstrip swipe navigation.
    if (effect === "cigarette") return;
    if (useVaporStore.getState().swipeLocked) return;
    const target = e.target as HTMLElement | null;
    if (target?.closest("[data-no-swipe]")) return;
    if (useVaporStore.getState().images.length < 2) return;
    drag.current = {
      startX: e.clientX,
      startY: e.clientY,
      axis: null,
      pointerId: e.pointerId,
    };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.pointerId) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;

    // Lock the gesture to an axis once it's moved enough to tell them apart.
    if (d.axis === null) {
      if (Math.hypot(dx, dy) < 8) return;
      d.axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
      if (d.axis === "y") {
        drag.current = null; // vertical → not a swipe
        return;
      }
      try {
        (e.currentTarget as HTMLElement).setPointerCapture(d.pointerId);
      } catch {}
    }

    if (d.axis === "x") useVaporStore.getState().setDrag(dx, true);
  };

  const endDrag = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    const { dragging, setDrag } = useVaporStore.getState();
    if (!d || d.axis !== "x") {
      if (dragging) setDrag(0, false);
      return;
    }
    const dx = e.clientX - d.startX;
    const { images: imgs, currentIndex, setCurrent } = useVaporStore.getState();
    const threshold = Math.min(140, window.innerWidth * 0.12);
    let ni = currentIndex;
    if (dx <= -threshold) ni = Math.min(imgs.length - 1, currentIndex + 1);
    else if (dx >= threshold) ni = Math.max(0, currentIndex - 1);
    setDrag(0, false);
    if (ni !== currentIndex) setCurrent(ni);
  };

  const onDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer?.types?.includes("Files")) {
      dragDepth.current += 1;
      setDragging(true);
    }
  };
  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };
  const onDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    dragDepth.current -= 1;
    if (dragDepth.current <= 0) {
      dragDepth.current = 0;
      setDragging(false);
    }
  };
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    const files = Array.from(e.dataTransfer?.files ?? []);
    if (files.length) addFiles(files);
  };

  const hasImages = images.length > 0;

  const cigarette = effect === "cigarette";

  return (
    <main
      className={`relative h-dvh w-screen touch-none overflow-hidden${
        cigarette ? " cursor-cig" : ""
      }`}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      <Scene />
      <FluidLayer />

      <Header />
      <LeftRail openPicker={openPicker} />
      <Sidebar />
      <BottomBar openPicker={openPicker} />
      <MobilePager />
      <SwipeLock />

      {/* Empty state */}
      <AnimatePresence>
        {!hasImages && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-10 flex items-center justify-center px-6 pt-[52px] md:pl-[140px] lg:pr-[328px]"
          >
            <button
              onClick={openPicker}
              className="glass glass-hover group flex w-full max-w-md flex-col items-center gap-5 rounded-3xl px-10 py-14 text-center transition-transform hover:scale-[1.01]"
            >
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.03] text-text transition-colors group-hover:border-white/25">
                <ImagePlus size={26} />
              </div>
              <div>
                <p className="text-lg font-medium text-text">
                  Drop an image to begin
                </p>
                <p className="mt-1 text-sm text-text-dim">
                  or click to browse — then hit{" "}
                  <span className="text-text">Vaporize</span>
                </p>
              </div>
              <div className="mt-1 flex items-center gap-5 text-[11px] text-text-faint">
                <span className="flex items-center gap-1.5">
                  <MousePointer2 size={12} /> Click
                </span>
                <span className="flex items-center gap-1.5">
                  <ImagePlus size={12} /> Drag &amp; drop
                </span>
                <span className="flex items-center gap-1.5">
                  <Clipboard size={12} /> Paste
                </span>
              </div>
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Drag overlay */}
      <AnimatePresence>
        {dragging && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center bg-black/40 backdrop-blur-sm"
          >
            <div className="rounded-3xl border-2 border-dashed border-white/40 px-16 py-12 text-center">
              <ImagePlus size={32} className="mx-auto text-white" />
              <p className="mt-3 text-base font-medium text-white">
                Release to add
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          if (files.length) addFiles(files);
          e.target.value = "";
        }}
      />
    </main>
  );
}
