"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { SIDEBAR_OCCUPY, useVaporStore } from "@/lib/store";
import { buildParticleData, loadImageMeta } from "@/lib/imageParticles";
import ParticleImage from "./ParticleImage";

/** Horizontal spacing between images in the filmstrip (world units). */
const SPACING = 3.4;
/** How many images on each side of the current one to keep mounted. */
const WINDOW = 1;

/**
 * Shifts the camera sideways so the current image is centered within the area
 * not covered by the sidebar. Nudging the camera (rather than the content)
 * keeps pointer→world math consistent.
 */
function CameraCentering() {
  const sidebarOpen = useVaporStore((s) => s.sidebarOpen);
  const { camera, size, viewport } = useThree();

  useFrame(() => {
    const wide = size.width >= 768;
    const targetPx = sidebarOpen && wide ? SIDEBAR_OCCUPY / 2 : 0;
    const targetWorld = (targetPx / size.width) * viewport.width;
    camera.position.x += (targetWorld - camera.position.x) * 0.12;
    camera.updateProjectionMatrix();
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
  const { viewport, size } = useThree();

  useFrame(() => {
    if (!ref.current) return;
    const { dragPx, dragging } = useVaporStore.getState();
    const worldPerPx = viewport.width / Math.max(1, size.width);
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
        <CameraCentering />

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
