"use client";
/* eslint-disable react-hooks/immutability */

import { useCallback, useEffect, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { PANEL_OCCUPY, RAIL_OCCUPY, TOPBAR_H, useVaporStore } from "@/lib/store";
import { buildParticleData, FIT, loadImageMeta } from "@/lib/imageParticles";
import ParticleImage from "./ParticleImage";

/** Horizontal spacing between images in the filmstrip (world units). */
const SPACING = 3.4;
/** How many images on each side of the current one to keep mounted. */
const WINDOW = 1;

/**
 * Frames the current image: zooms the camera out so the plane always fits the
 * free area (with a margin) and shifts it sideways to clear the sidebars.
 * Moving the camera — rather than scaling the meshes — keeps pointer→world /
 * burn-UV math consistent (they unproject through the live camera).
 */
function CameraRig({ imgW, imgH }: { imgW: number; imgH: number }) {
  const { camera, size, viewport } = useThree();

  useFrame(() => {
    const persp = camera as THREE.PerspectiveCamera;
    const wide = size.width >= 768;
    const multi = useVaporStore.getState().images.length > 1;

    // Fit the CURRENT image (by its real world dimensions, not a FIT×FIT square)
    // into the free area, pulling the camera back until whichever axis is the
    // tighter constraint just fits. Using real dims is what lets a tall/narrow
    // image fill the height instead of being over-shrunk by a width rule that
    // assumed every image was FIT units wide.
    const tan = Math.tan(((persp.fov * Math.PI) / 180) / 2);
    const sidePx = wide ? RAIL_OCCUPY + PANEL_OCCUPY : 0;
    const padX = wide ? 24 : 16;
    // Reserve room for the chrome so the image never sits under it:
    //  top    → header (+ the mobile swipe-lock pill when multiple images)
    //  bottom → action bar (+ the mobile page dots when multiple images)
    const padTop = wide ? TOPBAR_H + 16 : multi ? 96 : 68;
    const padBottom = wide ? 98 : multi ? 128 : 100;
    const availWpx = Math.max(40, size.width - sidePx - padX * 2);
    const availHpx = Math.max(40, size.height - padTop - padBottom);

    const zForW = (size.height * imgW) / (2 * tan * availWpx);
    const zForH = (size.height * imgH) / (2 * tan * availHpx);
    // Desktop keeps its roomy default framing (floor 5); phones are free to move
    // closer so portrait images actually fill the available space.
    const targetZ = Math.max(wide ? 5 : 2, zForW, zForH);
    persp.position.z += (targetZ - persp.position.z) * 0.12;

    // Center the image in the free area between the left rail and right panel.
    // Positive camera.x shifts the view right => content appears further left.
    const targetPx = wide ? (PANEL_OCCUPY - RAIL_OCCUPY) / 2 : 0;
    const targetWorld = (targetPx / size.width) * viewport.width;
    persp.position.x += (targetWorld - persp.position.x) * 0.12;
    persp.updateProjectionMatrix();
  });

  return null;
}

/**
 * The sliding filmstrip: lerps its x so the current image sits at world 0,
 * offset live by any in-progress drag. Reads drag state per-frame (via
 * getState) so dragging never re-renders the React tree.
 */
function Strip({
  currentIndex,
  children,
}: {
  currentIndex: number;
  children: React.ReactNode;
}) {
  const ref = useRef<THREE.Group>(null);
  const { size, camera } = useThree();

  useFrame(() => {
    if (!ref.current) return;
    const { dragPx, dragging } = useVaporStore.getState();
    // Derive world-per-pixel from the live camera distance so the drag tracks
    // the finger 1:1 even after the rig has zoomed out on mobile.
    const persp = camera as THREE.PerspectiveCamera;
    const visH = 2 * Math.tan(((persp.fov * Math.PI) / 180) / 2) * persp.position.z;
    const worldPerPx = visH / Math.max(1, size.height);
    const target = -currentIndex * SPACING + dragPx * worldPerPx;
    // Follow the finger tightly while dragging, ease on snap-back.
    const k = dragging ? 0.5 : 0.11;
    ref.current.position.x += (target - ref.current.position.x) * k;
  });

  return <group ref={ref}>{children}</group>;
}

export default function Scene() {
  const images = useVaporStore((s) => s.images);
  const currentIndex = useVaporStore((s) => s.currentIndex);
  const settings = useVaporStore((s) => s.settings);
  const completeCurrent = useVaporStore((s) => s.completeCurrent);
  const setCurrent = useVaporStore((s) => s.setCurrent);

  const [ready, setReady] = useState<Record<string, boolean>>({});
  const markReady = useCallback((id: string, r: boolean) => {
    setReady((m) => (m[id] === r ? m : { ...m, [id]: r }));
  }, []);

  const current = images[currentIndex];
  const loading = current ? ready[current.id] === false : false;

  // World dimensions of the current image's plane, so the camera can frame it
  // by its real aspect (see CameraRig). Defaults to a square until it decodes.
  const [curDims, setCurDims] = useState<{ w: number; h: number }>({ w: FIT, h: FIT });
  useEffect(() => {
    const cur = images[currentIndex];
    if (!cur) return;
    let alive = true;
    loadImageMeta(cur.src)
      .then((m) => {
        if (alive) setCurDims({ w: m.width, h: m.height });
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [images, currentIndex]);

  // Prewarm: neighbors only decode their image + plane size (cheap) so they
  // render instantly when swiped into view. Only the current image prebuilds
  // the heavy particle buffers, since it's the one most likely to vaporize —
  // idle neighbors stay as lightweight textured planes until they need it.
  useEffect(() => {
    for (let i = currentIndex - WINDOW - 1; i <= currentIndex + WINDOW + 1; i++) {
      const img = images[i];
      if (img) loadImageMeta(img.src).catch(() => {});
    }
    const cur = images[currentIndex];
    if (cur) buildParticleData(cur.src, settings.density).catch(() => {});
  }, [images, currentIndex, settings.density]);

  return (
    <>
      <Canvas
        flat
        linear
        dpr={[1, 2]}
        gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
        camera={{ position: [0, 0, 5], fov: 45 }}
        style={{ position: "absolute", inset: 0 }}
      >
        <CameraRig imgW={curDims.w} imgH={curDims.h} />

        <Strip currentIndex={currentIndex}>
          {images.map((img, i) =>
            Math.abs(i - currentIndex) <= WINDOW ? (
              <group key={img.id} position={[i * SPACING, 0, 0]}>
                <ParticleImage
                  src={img.src}
                  status={img.status}
                  settings={settings}
                  isCurrent={i === currentIndex}
                  onComplete={completeCurrent}
                  onReady={(r) => markReady(img.id, r)}
                  onSelect={
                    i === currentIndex ? undefined : () => setCurrent(i)
                  }
                />
              </group>
            ) : null,
          )}
        </Strip>
      </Canvas>

      {loading ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="flex items-center gap-2 text-xs tracking-widest text-text-dim uppercase">
            <span className="h-1.5 w-1.5 animate-ping rounded-full bg-white/70" />
            preparing particles
          </div>
        </div>
      ) : null}
    </>
  );
}
