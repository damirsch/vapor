"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import {
  buildParticleData,
  loadImageMeta,
  type ImageMeta,
  type ParticleData,
} from "@/lib/imageParticles";
import {
  directionToVec,
  type ImageStatus,
  type Settings,
} from "@/lib/types";
import { useVaporStore } from "@/lib/store";
import {
  PARTICLE_FRAGMENT,
  PARTICLE_VERTEX,
  PLANE_FRAGMENT,
  PLANE_VERTEX,
} from "./shaders";

/**
 * Option B (fluid mode): the dissolving image becomes dye in the FluidLayer, so
 * the in-scene particle system is disabled. The particle code is kept intact
 * behind this flag so we can compare / revert.
 */
const USE_PARTICLES = false;

/** Max cursor-path samples kept for the wake (must match the shader). */
const TRAIL_MAX = 16;
/** How long (seconds) a sample influences the smoke before relaxing away. */
const TRAIL_LIFE = 0.45;
/** Minimum pointer travel (world units) before recording a new sample. */
const TRAIL_MIN_DIST = 0.012;

interface ParticleImageProps {
  src: string;
  status: ImageStatus;
  settings: Settings;
  isCurrent: boolean;
  onComplete: () => void;
  onReady: (ready: boolean) => void;
  onSelect?: () => void;
}

export default function ParticleImage({
  src,
  status,
  settings,
  isCurrent,
  onComplete,
  onReady,
  onSelect,
}: ParticleImageProps) {
  // Lightweight metadata (decoded image + plane size) is enough to display an
  // idle image as a textured plane. This is cheap and loads immediately.
  const [meta, setMeta] = useState<ImageMeta | null>(null);
  // Heavy particle buffers are only built once an image actually needs to
  // vaporize, and kept afterwards so the reset (reassemble) animation works.
  const [data, setData] = useState<ParticleData | null>(null);

  useEffect(() => {
    let alive = true;
    onReady(false);
    setMeta(null);
    setData(null);
    loadImageMeta(src)
      .then((m) => {
        if (alive) {
          setMeta(m);
          onReady(true);
        }
      })
      .catch(() => alive && onReady(true));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src]);

  // Build the particle field lazily: only when the image leaves the idle state
  // (i.e. the user hit vaporize). Density changes re-trigger a build too.
  useEffect(() => {
    if (!USE_PARTICLES || status === "idle") return;
    let alive = true;
    buildParticleData(src, settings.density).then((d) => {
      if (alive) setData(d);
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, src, settings.density]);

  if (!meta) return null;

  return (
    <ImageMesh
      key={src}
      meta={meta}
      data={data}
      status={status}
      settings={settings}
      isCurrent={isCurrent}
      onComplete={onComplete}
      onSelect={onSelect}
    />
  );
}

function ImageMesh({
  meta,
  data,
  status,
  settings,
  isCurrent,
  onComplete,
  onSelect,
}: {
  meta: ImageMeta;
  data: ParticleData | null;
  status: ImageStatus;
  settings: Settings;
  isCurrent: boolean;
  onComplete: () => void;
  onSelect?: () => void;
}) {
  const { pointer, camera, gl } = useThree();

  const progress = useRef(0);
  const completed = useRef(false);
  const opacity = useRef(isCurrent ? 1 : 0.28);
  const groupRef = useRef<THREE.Group>(null);
  const tmpV = useMemo(() => new THREE.Vector3(), []);
  const tmpWorld = useMemo(() => new THREE.Vector3(), []);
  const tmpGroup = useMemo(() => new THREE.Vector3(), []);

  // Cursor path ring buffer, shared by reference with the shader uniforms so
  // in-place mutations upload each frame. uTrail packs [x, y, vx, vy].
  const trailPos = useMemo(() => new Float32Array(TRAIL_MAX * 4), []);
  const trailAge = useMemo(() => {
    const a = new Float32Array(TRAIL_MAX);
    a.fill(TRAIL_LIFE + 1); // start inactive
    return a;
  }, []);
  const trailWrite = useRef(0);
  const prevMouse = useRef<THREE.Vector2 | null>(null);
  const lastSample = useRef<THREE.Vector2 | null>(null);

  const texture = useMemo(() => {
    const tex = new THREE.Texture(meta.image);
    // Raw passthrough: the canvas runs in `linear`/`flat` mode, so we keep the
    // texture data as-is to match the source image and the per-particle colors
    // (also raw bytes from getImageData). No color-space conversion.
    tex.colorSpace = THREE.LinearSRGBColorSpace;
    tex.needsUpdate = true;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    return tex;
  }, [meta.image]);

  // Only allocate the points geometry once the heavy particle data exists.
  const geometry = useMemo(() => {
    if (!data) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(data.positions, 3));
    g.setAttribute("aColor", new THREE.BufferAttribute(data.colors, 3));
    g.setAttribute("aCoord", new THREE.BufferAttribute(data.coords, 2));
    g.setAttribute("aRnd", new THREE.BufferAttribute(data.seeds, 3));
    return g;
  }, [data]);

  const pixelRatio = Math.min(gl.getPixelRatio() || 1, 2);

  const pointsMaterial = useMemo(() => {
    return new THREE.ShaderMaterial({
      vertexShader: PARTICLE_VERTEX,
      fragmentShader: PARTICLE_FRAGMENT,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.NormalBlending,
      uniforms: {
        uProgress: { value: 0 },
        uTime: { value: 0 },
        uStrength: { value: settings.strength },
        uTurbulence: { value: settings.turbulence },
        uLifetime: { value: settings.lifetime },
        uSize: { value: settings.particleSize },
        uPixelRatio: { value: pixelRatio },
        uHoverRadius: { value: settings.hoverRadius },
        uHoverForce: { value: settings.hoverForce },
        uDirection: {
          value: new THREE.Vector2(...directionToVec(settings.direction)),
        },
        uDrift: { value: new THREE.Vector2(settings.driftX, settings.driftY) },
        uTrail: { value: trailPos },
        uTrailAge: { value: trailAge },
        uTrailLife: { value: TRAIL_LIFE },
        uOpacity: { value: opacity.current },
      },
    });
    // Uniform values are synced every frame; only rebuild on structural change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pixelRatio]);

  const planeMaterial = useMemo(() => {
    return new THREE.ShaderMaterial({
      vertexShader: PLANE_VERTEX,
      fragmentShader: PLANE_FRAGMENT,
      transparent: true,
      depthWrite: false,
      uniforms: {
        uTex: { value: texture },
        uProgress: { value: 0 },
        uEdge: { value: settings.edge },
        uDirection: {
          value: new THREE.Vector2(...directionToVec(settings.direction)),
        },
        uEdgeColor: { value: new THREE.Color(0.9, 0.92, 0.98) },
        uOpacity: { value: opacity.current },
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [texture]);

  const dir = directionToVec(settings.direction);

  // Progress must travel past the furthest particle's threshold plus a full
  // lifetime so everything fully vanishes at the end.
  const maxThreshold = 0.5 + 0.5 * (Math.abs(dir[0]) + Math.abs(dir[1]));
  const completeAt = maxThreshold + settings.lifetime + 0.06;

  useEffect(() => {
    return () => {
      geometry?.dispose();
      pointsMaterial.dispose();
      planeMaterial.dispose();
      texture.dispose();
    };
  }, [geometry, pointsMaterial, planeMaterial, texture]);

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.05);

    // Advance / rewind the sweep.
    if (status === "vaporizing") {
      progress.current += dt * settings.speed;
      if (progress.current >= completeAt) {
        progress.current = completeAt;
        if (!completed.current) {
          completed.current = true;
          onComplete();
        }
      }
    } else if (status === "done") {
      progress.current = completeAt;
    } else {
      completed.current = false;
      progress.current += (0 - progress.current) * Math.min(1, dt * 6);
      if (progress.current < 0.0005) progress.current = 0;
    }

    // Non-current images in the filmstrip fade to semi-transparent.
    const targetOpacity = isCurrent ? 1 : 0.28;
    opacity.current += (targetOpacity - opacity.current) * Math.min(1, dt * 6);

    planeMaterial.uniforms.uProgress.value = progress.current;
    planeMaterial.uniforms.uEdge.value = settings.edge;
    planeMaterial.uniforms.uDirection.value.set(dir[0], dir[1]);
    planeMaterial.uniforms.uOpacity.value = opacity.current;

    // Report this image's live sweep progress + on-screen rect so the fluid
    // overlay knows where (and how far) to emit dye. Project the plane corners
    // through the camera into screen uv (y up).
    if (isCurrent) {
      if (groupRef.current) groupRef.current.getWorldPosition(tmpGroup);
      else tmpGroup.set(0, 0, 0);
      const hw = meta.width / 2;
      const hh = meta.height / 2;
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const sx of [-1, 1]) {
        for (const sy of [-1, 1]) {
          tmpV.set(tmpGroup.x + sx * hw, tmpGroup.y + sy * hh, tmpGroup.z);
          tmpV.project(camera);
          const ux = tmpV.x * 0.5 + 0.5;
          const uy = tmpV.y * 0.5 + 0.5;
          minX = Math.min(minX, ux);
          maxX = Math.max(maxX, ux);
          minY = Math.min(minY, uy);
          maxY = Math.max(maxY, uy);
        }
      }
      useVaporStore
        .getState()
        .setVaporFrame(progress.current, [minX, minY, maxX, maxY]);
    }

    // Nothing below needs updating if there are no particles yet.
    if (!USE_PARTICLES || !geometry) return;

    // Pointer → world position on the z=0 plane, then into this image's local
    // space (it may be offset in the filmstrip) so the wake lines up.
    tmpV.set(pointer.x, pointer.y, 0.5).unproject(camera);
    tmpV.sub(camera.position).normalize();
    const dist = -camera.position.z / tmpV.z;
    tmpWorld.copy(camera.position).addScaledVector(tmpV, dist);
    if (groupRef.current) groupRef.current.getWorldPosition(tmpGroup);
    else tmpGroup.set(0, 0, 0);
    const mx = tmpWorld.x - tmpGroup.x;
    const my = tmpWorld.y - tmpGroup.y;

    // Age every existing trail sample; the shader ignores expired ones.
    for (let i = 0; i < TRAIL_MAX; i++) trailAge[i] += dt;

    // Instantaneous pointer velocity (per frame) drives the drag direction.
    let vx = 0;
    let vy = 0;
    if (prevMouse.current && dt > 0) {
      vx = (mx - prevMouse.current.x) / dt;
      vy = (my - prevMouse.current.y) / dt;
      prevMouse.current.set(mx, my);
    } else if (!prevMouse.current) {
      prevMouse.current = new THREE.Vector2(mx, my);
    }

    // Drop a new sample once the pointer has travelled far enough, so fast
    // swipes lay down a longer path (a longer tail) and slow ones a short one.
    const last = lastSample.current;
    const moved = last ? Math.hypot(mx - last.x, my - last.y) : Infinity;
    if (moved > TRAIL_MIN_DIST) {
      const idx = trailWrite.current;
      trailPos[idx * 4] = mx;
      trailPos[idx * 4 + 1] = my;
      trailPos[idx * 4 + 2] = vx;
      trailPos[idx * 4 + 3] = vy;
      trailAge[idx] = 0;
      trailWrite.current = (idx + 1) % TRAIL_MAX;
      if (last) last.set(mx, my);
      else lastSample.current = new THREE.Vector2(mx, my);
    }

    const pu = pointsMaterial.uniforms;
    pu.uProgress.value = progress.current;
    pu.uTime.value += dt;
    pu.uStrength.value = settings.strength;
    pu.uTurbulence.value = settings.turbulence;
    pu.uLifetime.value = settings.lifetime;
    pu.uSize.value = settings.particleSize;
    pu.uHoverRadius.value = settings.hoverRadius;
    pu.uHoverForce.value = settings.hoverForce;
    pu.uDirection.value.set(dir[0], dir[1]);
    pu.uDrift.value.set(settings.driftX, settings.driftY);
    pu.uOpacity.value = opacity.current;
  });

  return (
    <group ref={groupRef}>
      <mesh
        material={planeMaterial}
        onClick={
          onSelect
            ? (e) => {
                e.stopPropagation();
                onSelect();
              }
            : undefined
        }
        onPointerOver={
          onSelect
            ? () => {
                document.body.style.cursor = "pointer";
              }
            : undefined
        }
        onPointerOut={
          onSelect
            ? () => {
                document.body.style.cursor = "";
              }
            : undefined
        }
      >
        <planeGeometry args={[meta.width, meta.height]} />
      </mesh>
      {USE_PARTICLES && geometry && (
        <points geometry={geometry} material={pointsMaterial} />
      )}
    </group>
  );
}
