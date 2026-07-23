import { create } from "zustand";
import { clearBurn } from "./burnState";
import {
  DEFAULT_SETTINGS,
  type PlaybackMode,
  type Settings,
  type VaporImage,
} from "./types";

let nextTimer: ReturnType<typeof setTimeout> | null = null;

function clearNextTimer() {
  if (nextTimer) {
    clearTimeout(nextTimer);
    nextTimer = null;
  }
}

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

/* App-chrome layout metrics (px). */
export const TOPBAR_H = 52;
export const FOOTER_H = 30;

export const RAIL_WIDTH = 116;
export const RAIL_MARGIN = 14;
/** Horizontal space the left thumbnail rail occupies. */
export const RAIL_OCCUPY = RAIL_WIDTH + RAIL_MARGIN * 2;

export const PANEL_WIDTH = 300;
export const PANEL_MARGIN = 14;
/** Horizontal space the right control panel occupies. */
export const PANEL_OCCUPY = PANEL_WIDTH + PANEL_MARGIN * 2;

interface VaporState {
  images: VaporImage[];
  currentIndex: number;
  mode: PlaybackMode;
  settings: Settings;
  sidebarOpen: boolean;
  /** Mobile: when true, swipe navigation is disabled so you can drag a finger
   * across the canvas for the effect without flipping to the next image. */
  swipeLocked: boolean;
  /** Live horizontal drag offset in pixels while a swipe is in progress. */
  dragPx: number;
  /** Whether the user is actively dragging the filmstrip. */
  dragging: boolean;
  /** Current image's live sweep progress (written by the 3D layer each frame). */
  vaporProgress: number;
  /** Current image's on-screen rect in uv (y up): [x0, y0, x1, y1]. */
  imageRect: [number, number, number, number];

  setDrag: (px: number, dragging: boolean) => void;
  setVaporFrame: (
    progress: number,
    rect: [number, number, number, number],
  ) => void;
  setSidebarOpen: (open: boolean) => void;
  setSwipeLocked: (locked: boolean) => void;
  addFiles: (files: File[]) => void;
  removeImage: (id: string) => void;
  reorderImages: (newOrder: VaporImage[]) => void;
  clearAll: () => void;
  setCurrent: (index: number) => void;

  vaporizeCurrent: () => void;
  vaporizeAll: () => void;
  completeCurrent: () => void;
  reset: () => void;

  updateSetting: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
  resetSettings: () => void;
}

export const useVaporStore = create<VaporState>((set, get) => ({
  images: [],
  currentIndex: 0,
  mode: "idle",
  settings: { ...DEFAULT_SETTINGS },
  // On desktop the panel is always docked (CSS lg override); this only gates the
  // mobile drawer, which should start closed.
  sidebarOpen: false,
  swipeLocked: false,
  dragPx: 0,
  dragging: false,
  vaporProgress: 0,
  imageRect: [0.5, 0.5, 0.5, 0.5],

  setDrag: (px, dragging) => set({ dragPx: px, dragging }),
  setVaporFrame: (progress, rect) => set({ vaporProgress: progress, imageRect: rect }),
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  setSwipeLocked: (locked) => set({ swipeLocked: locked }),

  addFiles: (files) => {
    const imageFiles = files.filter((f) => f.type.startsWith("image/"));
    if (imageFiles.length === 0) return;
    const newImages: VaporImage[] = imageFiles.map((f) => ({
      id: uid(),
      src: URL.createObjectURL(f),
      name: f.name || "pasted-image",
      status: "idle",
    }));
    set((s) => {
      const wasEmpty = s.images.length === 0;
      return {
        images: [...s.images, ...newImages],
        currentIndex: wasEmpty ? s.images.length : s.currentIndex,
      };
    });
  },

  removeImage: (id) => {
    clearNextTimer();
    set((s) => {
      const idx = s.images.findIndex((i) => i.id === id);
      if (idx === -1) return s;
      const target = s.images[idx];
      if (target.src.startsWith("blob:")) URL.revokeObjectURL(target.src);
      clearBurn(target.src);
      const images = s.images.filter((i) => i.id !== id);
      let currentIndex = s.currentIndex;
      if (idx < currentIndex) currentIndex -= 1;
      currentIndex = Math.max(0, Math.min(currentIndex, images.length - 1));
      return { images, currentIndex, mode: "idle" };
    });
  },

  reorderImages: (newOrder) => {
    set((s) => {
      // Keep the currently displayed image centered after the reorder.
      const currentId = s.images[s.currentIndex]?.id;
      const nextIndex = currentId
        ? newOrder.findIndex((i) => i.id === currentId)
        : s.currentIndex;
      return {
        images: newOrder,
        currentIndex: nextIndex === -1 ? s.currentIndex : nextIndex,
      };
    });
  },

  clearAll: () => {
    clearNextTimer();
    get().images.forEach((i) => {
      if (i.src.startsWith("blob:")) URL.revokeObjectURL(i.src);
    });
    clearBurn();
    set({ images: [], currentIndex: 0, mode: "idle" });
  },

  setCurrent: (index) => {
    clearNextTimer();
    set((s) => ({
      currentIndex: Math.max(0, Math.min(index, s.images.length - 1)),
      mode: "idle",
    }));
  },

  vaporizeCurrent: () => {
    set((s) => {
      const cur = s.images[s.currentIndex];
      if (!cur || cur.status !== "idle") return s;
      const images = s.images.map((img, i) =>
        i === s.currentIndex ? { ...img, status: "vaporizing" as const } : img,
      );
      return { images, mode: "single" };
    });
  },

  vaporizeAll: () => {
    set((s) => {
      const firstIdle = s.images.findIndex((i) => i.status === "idle");
      if (firstIdle === -1) return s;
      const images = s.images.map((img, i) =>
        i === firstIdle ? { ...img, status: "vaporizing" as const } : img,
      );
      return { images, currentIndex: firstIdle, mode: "all" };
    });
  },

  completeCurrent: () => {
    const s = get();
    const cur = s.images[s.currentIndex];
    if (!cur || cur.status !== "vaporizing") return;

    const images = s.images.map((img, i) =>
      i === s.currentIndex ? { ...img, status: "done" as const } : img,
    );

    if (s.mode === "all") {
      const nextIdle = images.findIndex((i) => i.status === "idle");
      if (nextIdle !== -1) {
        // Swipe to the next image immediately (it stays idle while it slides
        // into the center), then ignite it after the delay.
        set({ images, currentIndex: nextIdle });
        clearNextTimer();
        nextTimer = setTimeout(
          () => {
            set((st) => {
              if (st.mode !== "all") return st;
              const idle = st.images[st.currentIndex]?.status === "idle"
                ? st.currentIndex
                : st.images.findIndex((i) => i.status === "idle");
              if (idle === -1) return { mode: "idle" };
              const imgs = st.images.map((img, i) =>
                i === idle ? { ...img, status: "vaporizing" as const } : img,
              );
              return { images: imgs, currentIndex: idle };
            });
          },
          Math.max(0, s.settings.delay * 1000),
        );
        return;
      }
      set({ images, mode: "idle" });
      return;
    }

    // single mode: advance display to the next idle image if any
    const nextIdle = images.findIndex(
      (i, i2) => i.status === "idle" && i2 > s.currentIndex,
    );
    set({
      images,
      mode: "idle",
      currentIndex: nextIdle !== -1 ? nextIdle : s.currentIndex,
    });
  },

  reset: () => {
    clearNextTimer();
    clearBurn();
    set((s) => ({
      images: s.images.map((img) => ({ ...img, status: "idle" as const })),
      currentIndex: 0,
      mode: "idle",
    }));
  },

  updateSetting: (key, value) =>
    set((s) => {
      // Switching effect mode gives each mode a clean, interactive slate:
      // reset statuses to idle and clear any burns. Otherwise a "done" image
      // carried over from vapor would render whole under the burn shader but
      // stay un-ignitable (ignition is blocked while status === "done").
      if (key === "effect" && value !== s.settings.effect) {
        clearNextTimer();
        clearBurn();
        return {
          settings: { ...s.settings, [key]: value },
          images: s.images.map((img) => ({ ...img, status: "idle" as const })),
          mode: "idle",
        };
      }
      return { settings: { ...s.settings, [key]: value } };
    }),

  resetSettings: () => set({ settings: { ...DEFAULT_SETTINGS } }),
}));
