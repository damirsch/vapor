"use client"

/*
 * This is an imperative react-three-fiber component: THREE materials, geometries
 * and typed-array buffers are created once (useMemo) and then mutated in place
 * every frame inside useFrame (uniforms, opacity, trail buffers, etc.). That's
 * the intended r3f pattern — driving GPU state without re-rendering React — but
 * it conflicts with the React Compiler lint rules, which assume memoized values
 * are immutable and that refs aren't read during render. Those rules produce
 * only false positives here, so they're disabled for this file.
 */
/* eslint-disable react-hooks/immutability, react-hooks/refs, react-hooks/set-state-in-effect */

import { useEffect, useMemo, useRef, useState } from "react"
import { useFrame, useThree } from "@react-three/fiber"
import * as THREE from "three"
import { buildParticleData, loadImageMeta, type ImageMeta, type ParticleData } from "@/lib/imageParticles"
import { directionToVec, type ImageStatus, type Settings } from "@/lib/types"
import { useVaporStore } from "@/lib/store"
import { BURN_FRAGMENT, PARTICLE_FRAGMENT, PARTICLE_VERTEX, PLANE_FRAGMENT, PLANE_VERTEX } from "./shaders"
import {
	addBurnSeed,
	BURN_NOISE_SCALE,
	BURN_RAGGED,
	BURN_SPREAD_BASE,
	burnNow,
	burnPointer,
	getBurnSeeds,
	MAX_SEEDS,
	packBurnSeeds,
} from "@/lib/burnState"

/**
 * Option B (fluid mode): the dissolving image becomes dye in the FluidLayer, so
 * the in-scene particle system is disabled. The particle code is kept intact
 * behind this flag so we can compare / revert.
 */
const USE_PARTICLES = false

/** GLSL-style smoothstep for driving the scanner line's edge fades. */
function smoothstep(e0: number, e1: number, x: number) {
	const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)))
	return t * t * (3 - 2 * t)
}

/** Max cursor-path samples kept for the wake (must match the shader). */
const TRAIL_MAX = 16
/** How long (seconds) a sample influences the smoke before relaxing away. */
const TRAIL_LIFE = 0.45
/** Minimum pointer travel (world units) before recording a new sample. */
const TRAIL_MIN_DIST = 0.012

/* --- Cigarette burn tuning (image-UV, height units) --- */
/**
 * Burn front depths. A thin black scorch leads the front, a crisp red→yellow
 * ember sits right at the edge (`EMBER_PEAK` ± `EMBER_W`), the paper chars to
 * black over `CHAR_W`, and burns through at `HOLE_W`. The ragged noise front
 * (see burnState) is what gives the edge its varied, organic shape.
 */
const BURN_EMBER_W = 0.02
/** Glow sits this far *behind* the black leading front (bigger = more lag). */
const BURN_EMBER_PEAK = 0.02
/** Noise-driven extra depth so the ember periodically lags further back. */
const BURN_EMBER_LAG = 0.1
/** Small so the paper turns black almost immediately at the front. */
const BURN_CHAR_W = 0.05
const BURN_HOLE_W = 0.16
const BURN_EMBER_INTENSITY = 1.7
/**
 * Number of ignition points seeded across the bottom edge when a burn is started
 * from the Burn button (no cigarette). Their merging fronts rise up the sheet,
 * giving a bottom-to-top burn like the vapor sweep — but with our char/ember.
 */
const BURN_BOTTOM_SEEDS = 6
/** Image corners (uv) used to detect full coverage for completion. */
const BURN_CORNERS: ReadonlyArray<readonly [number, number]> = [
	[0, 0],
	[1, 0],
	[0, 1],
	[1, 1],
]

interface ParticleImageProps {
	src: string
	status: ImageStatus
	settings: Settings
	isCurrent: boolean
	onComplete: () => void
	onReady: (ready: boolean) => void
	onSelect?: () => void
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
	const [meta, setMeta] = useState<ImageMeta | null>(null)
	// Heavy particle buffers are only built once an image actually needs to
	// vaporize, and kept afterwards so the reset (reassemble) animation works.
	const [data, setData] = useState<ParticleData | null>(null)

	useEffect(() => {
		let alive = true
		onReady(false)
		setMeta(null)
		setData(null)
		loadImageMeta(src)
			.then((m) => {
				if (alive) {
					setMeta(m)
					onReady(true)
				}
			})
			.catch(() => alive && onReady(true))
		return () => {
			alive = false
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [src])

	// Build the particle field lazily: only when the image leaves the idle state
	// (i.e. the user hit vaporize). Density changes re-trigger a build too.
	useEffect(() => {
		if (!USE_PARTICLES || status === "idle") return
		let alive = true
		buildParticleData(src, settings.density).then((d) => {
			if (alive) setData(d)
		})
		return () => {
			alive = false
		}
	}, [status, src, settings.density])

	if (!meta) return null

	return (
		<ImageMesh
			key={src}
			src={src}
			meta={meta}
			data={data}
			status={status}
			settings={settings}
			isCurrent={isCurrent}
			onComplete={onComplete}
			onSelect={onSelect}
		/>
	)
}

function ImageMesh({
	src,
	meta,
	data,
	status,
	settings,
	isCurrent,
	onComplete,
	onSelect,
}: {
	src: string
	meta: ImageMeta
	data: ParticleData | null
	status: ImageStatus
	settings: Settings
	isCurrent: boolean
	onComplete: () => void
	onSelect?: () => void
}) {
	const { pointer, camera, gl } = useThree()

	const progress = useRef(0)
	const completed = useRef(false)
	// True once this vaporize cycle has auto-seeded the bottom row. Reset only
	// when the image is actually idle again — so clearing seeds on reset can't
	// re-ignite during the frame where `status` is still stale ("vaporizing").
	const hasSeeded = useRef(false)
	const opacity = useRef(isCurrent ? 1 : 0.28)
	const groupRef = useRef<THREE.Group>(null)
	const tmpV = useMemo(() => new THREE.Vector3(), [])
	const tmpWorld = useMemo(() => new THREE.Vector3(), [])
	const tmpGroup = useMemo(() => new THREE.Vector3(), [])

	// Cursor path ring buffer, shared by reference with the shader uniforms so
	// in-place mutations upload each frame. uTrail packs [x, y, vx, vy].
	const trailPos = useMemo(() => new Float32Array(TRAIL_MAX * 4), [])
	const trailAge = useMemo(() => {
		const a = new Float32Array(TRAIL_MAX)
		a.fill(TRAIL_LIFE + 1) // start inactive
		return a
	}, [])
	const trailWrite = useRef(0)
	const prevMouse = useRef<THREE.Vector2 | null>(null)
	const lastSample = useRef<THREE.Vector2 | null>(null)

	const texture = useMemo(() => {
		const tex = new THREE.Texture(meta.image)
		// Raw passthrough: the canvas runs in `linear`/`flat` mode, so we keep the
		// texture data as-is to match the source image and the per-particle colors
		// (also raw bytes from getImageData). No color-space conversion.
		tex.colorSpace = THREE.LinearSRGBColorSpace
		tex.needsUpdate = true
		tex.minFilter = THREE.LinearFilter
		tex.magFilter = THREE.LinearFilter
		return tex
	}, [meta.image])

	// Only allocate the points geometry once the heavy particle data exists.
	const geometry = useMemo(() => {
		if (!data) return null
		const g = new THREE.BufferGeometry()
		g.setAttribute("position", new THREE.BufferAttribute(data.positions, 3))
		g.setAttribute("aColor", new THREE.BufferAttribute(data.colors, 3))
		g.setAttribute("aCoord", new THREE.BufferAttribute(data.coords, 2))
		g.setAttribute("aRnd", new THREE.BufferAttribute(data.seeds, 3))
		return g
	}, [data])

	const pixelRatio = Math.min(gl.getPixelRatio() || 1, 2)

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
				uDrift: { value: new THREE.Vector2(0, 0) },
				uTrail: { value: trailPos },
				uTrailAge: { value: trailAge },
				uTrailLife: { value: TRAIL_LIFE },
				uOpacity: { value: opacity.current },
			},
		})
		// Uniform values are synced every frame; only rebuild on structural change.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [pixelRatio])

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
				uOpacity: { value: opacity.current },
			},
		})
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [texture])

	// Flat vec3 buffer of burn seeds, uploaded to the burn shader each frame.
	const burnSeeds = useMemo(() => new Float32Array(MAX_SEEDS * 3), [])

	const burnMaterial = useMemo(() => {
		return new THREE.ShaderMaterial({
			vertexShader: PLANE_VERTEX,
			fragmentShader: BURN_FRAGMENT,
			transparent: true,
			depthWrite: false,
			uniforms: {
				uTex: { value: texture },
				uOpacity: { value: opacity.current },
				uTime: { value: 0 },
				uSeeds: { value: burnSeeds },
				uSeedCount: { value: 0 },
				uAspect: { value: meta.width / meta.height },
				uSpread: { value: BURN_SPREAD_BASE },
				uRagged: { value: BURN_RAGGED },
				uNoiseScale: { value: BURN_NOISE_SCALE },
				uEmberW: { value: BURN_EMBER_W },
				uEmberPeak: { value: BURN_EMBER_PEAK },
				uEmberLag: { value: BURN_EMBER_LAG },
				uCharW: { value: BURN_CHAR_W },
				uHoleW: { value: BURN_HOLE_W },
				uEmberIntensity: { value: BURN_EMBER_INTENSITY },
			},
		})
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [texture])

	// Crisp "scanner" line: a flat white rectangle (no blur), drawn as its own
	// mesh so it stays sharp and can extend a little past the image edges. It
	// rides the sweep front, driven per-frame in useFrame below.
	const lineRef = useRef<THREE.Mesh>(null)
	const lineMaterial = useMemo(
		() =>
			new THREE.MeshBasicMaterial({
				color: new THREE.Color(0.95, 0.97, 1.0),
				transparent: true,
				depthWrite: false,
				depthTest: false,
				opacity: 0,
			}),
		[]
	)
	// How far the line sits past each edge of the image, and how thick it is —
	// both in world units, derived from the plane size so they scale per image.
	const LINE_OVERHANG = Math.max(meta.width, meta.height) * 0.06
	const LINE_THICKNESS = Math.max(meta.width, meta.height) * 0.01

	const dir = directionToVec(settings.direction)

	// Progress must travel past the furthest particle's threshold plus a full
	// lifetime so everything fully vanishes at the end.
	const maxThreshold = 0.5 + 0.5 * (Math.abs(dir[0]) + Math.abs(dir[1]))
	const completeAt = maxThreshold + settings.lifetime + 0.06

	useEffect(() => {
		return () => {
			geometry?.dispose()
			pointsMaterial.dispose()
			planeMaterial.dispose()
			burnMaterial.dispose()
			lineMaterial.dispose()
			texture.dispose()
		}
	}, [geometry, pointsMaterial, planeMaterial, burnMaterial, lineMaterial, texture])

	// Cigarette burn: ignite where the tip hovers, grow the front, and drive the
	// burn shader. Completion fires once the front has consumed the whole sheet.
	const updateBurn = () => {
		progress.current = 0
		if (lineRef.current) lineRef.current.visible = false

		// Button-triggered burn (no cigarette): the first frame of a vaporize cycle
		// ignites several staggered points across the bottom, so the fire starts
		// from a few distinct spots and climbs upward as they spread and merge.
		if (isCurrent && status === "vaporizing" && !hasSeeded.current && getBurnSeeds(src).length === 0) {
			for (let i = 0; i < BURN_BOTTOM_SEEDS; i++) {
				const u = (i + 0.5) / BURN_BOTTOM_SEEDS + (Math.random() - 0.5) * 0.05
				const v = 0.03 + Math.random() * 0.06
				addBurnSeed(src, Math.min(0.98, Math.max(0.02, u)), v)
			}
			hasSeeded.current = true
		}

		// Ignite only on hover *and* press — never automatically — so the burn (and
		// its hole) is always created by the cigarette, not by reset/vaporize.
		if (isCurrent && status !== "done" && burnPointer.down) {
			// Pointer → this image's local UV (0..1, v up).
			tmpV.set(pointer.x, pointer.y, 0.5).unproject(camera)
			tmpV.sub(camera.position).normalize()
			const dist = -camera.position.z / tmpV.z
			tmpWorld.copy(camera.position).addScaledVector(tmpV, dist)
			if (groupRef.current) groupRef.current.getWorldPosition(tmpGroup)
			else tmpGroup.set(0, 0, 0)
			const u = (tmpWorld.x - tmpGroup.x) / meta.width + 0.5
			const v = (tmpWorld.y - tmpGroup.y) / meta.height + 0.5
			if (u > 0 && u < 1 && v > 0 && v < 1) {
				const added = addBurnSeed(src, u, v)
				if (added && status === "idle") {
					useVaporStore.getState().vaporizeCurrent()
				}
			}
		}

		const count = packBurnSeeds(src, burnSeeds)
		const now = burnNow()
		const spread = BURN_SPREAD_BASE * settings.speed
		const aspect = meta.width / meta.height
		const bu = burnMaterial.uniforms
		bu.uSeedCount.value = count
		bu.uTime.value = now
		bu.uSpread.value = spread
		bu.uOpacity.value = opacity.current
		bu.uAspect.value = aspect

		if (status === "idle") {
			completed.current = false
			hasSeeded.current = false
		}

		// Complete once the whole sheet is consumed — i.e. every corner has burned
		// past the hole depth. Checking real coverage (not a fixed radius) keeps the
		// timing right no matter where the ignition points landed.
		if (status === "vaporizing" && !completed.current && count > 0) {
			const need = BURN_HOLE_W + BURN_RAGGED * 0.5
			let allBurned = true
			for (const [cu, cv] of BURN_CORNERS) {
				let depth = -1
				for (let i = 0; i < count; i++) {
					const age = now - burnSeeds[i * 3 + 2]
					if (age <= 0) continue
					const dx = (cu - burnSeeds[i * 3]) * aspect
					const dy = cv - burnSeeds[i * 3 + 1]
					depth = Math.max(depth, spread * age - Math.hypot(dx, dy))
				}
				if (depth < need) {
					allBurned = false
					break
				}
			}
			if (allBurned) {
				completed.current = true
				onComplete()
			}
		}
	}

	useFrame((_, delta) => {
		const dt = Math.min(delta, 0.05)

		const cig = settings.effect === "cigarette"

		// Non-current images in the filmstrip fade to semi-transparent.
		const targetOpacity = isCurrent ? 1 : 0.28
		opacity.current += (targetOpacity - opacity.current) * Math.min(1, dt * 6)

		if (cig) {
			updateBurn()
		} else {
			// Advance / rewind the sweep.
			if (status === "vaporizing") {
				progress.current += dt * settings.speed
				if (progress.current >= completeAt) {
					progress.current = completeAt
					if (!completed.current) {
						completed.current = true
						onComplete()
					}
				}
			} else if (status === "done") {
				progress.current = completeAt
			} else {
				completed.current = false
				progress.current += (0 - progress.current) * Math.min(1, dt * 6)
				if (progress.current < 0.0005) progress.current = 0
			}

			planeMaterial.uniforms.uProgress.value = progress.current
			planeMaterial.uniforms.uEdge.value = settings.edge
			planeMaterial.uniforms.uDirection.value.set(dir[0], dir[1])
			planeMaterial.uniforms.uOpacity.value = opacity.current

			// Drive the crisp scanner line: a flat rectangle riding the sweep front,
			// slightly wider than the image, sharp (no blur) and axis-aligned.
			if (lineRef.current) {
				const line = lineRef.current
				const vertical = Math.abs(dir[1]) >= Math.abs(dir[0])
				const sgn = vertical ? (dir[1] >= 0 ? 1 : -1) : dir[0] >= 0 ? 1 : -1
				// Front position in threshold units (0 = start edge, 1 = far edge); sit
				// a touch into the dissolve band so it reads as the cutting edge.
				const frontThresh = progress.current - settings.edge * 0.5

				if (vertical) {
					line.position.set(0, sgn * (frontThresh - 0.5) * meta.height, 0.02)
					line.scale.set(meta.width + LINE_OVERHANG * 2, LINE_THICKNESS, 1)
				} else {
					line.position.set(sgn * (frontThresh - 0.5) * meta.width, 0, 0.02)
					line.scale.set(LINE_THICKNESS, meta.height + LINE_OVERHANG * 2, 1)
				}

				// Visible only while the front crosses the image, only while vaporizing,
				// with a soft fade in/out at the two ends so it doesn't pop.
				const inBand = smoothstep(-0.03, 0.02, frontThresh) * (1 - smoothstep(0.98, 1.03, frontThresh))
				const target = (status === "vaporizing" ? 1 : 0) * inBand * opacity.current * 0.95
				lineMaterial.opacity += (target - lineMaterial.opacity) * Math.min(1, dt * 20)
				line.visible = lineMaterial.opacity > 0.002
			}
		}

		// Report this image's live sweep progress + on-screen rect so the fluid
		// overlay knows where (and how far) to emit dye. Project the plane corners
		// through the camera into screen uv (y up).
		if (isCurrent) {
			if (groupRef.current) groupRef.current.getWorldPosition(tmpGroup)
			else tmpGroup.set(0, 0, 0)
			const hw = meta.width / 2
			const hh = meta.height / 2
			let minX = Infinity
			let minY = Infinity
			let maxX = -Infinity
			let maxY = -Infinity
			for (const sx of [-1, 1]) {
				for (const sy of [-1, 1]) {
					tmpV.set(tmpGroup.x + sx * hw, tmpGroup.y + sy * hh, tmpGroup.z)
					tmpV.project(camera)
					const ux = tmpV.x * 0.5 + 0.5
					const uy = tmpV.y * 0.5 + 0.5
					minX = Math.min(minX, ux)
					maxX = Math.max(maxX, ux)
					minY = Math.min(minY, uy)
					maxY = Math.max(maxY, uy)
				}
			}
			useVaporStore.getState().setVaporFrame(progress.current, [minX, minY, maxX, maxY])
		}

		// Nothing below needs updating if there are no particles yet.
		if (!USE_PARTICLES || !geometry) return

		// Pointer → world position on the z=0 plane, then into this image's local
		// space (it may be offset in the filmstrip) so the wake lines up.
		tmpV.set(pointer.x, pointer.y, 0.5).unproject(camera)
		tmpV.sub(camera.position).normalize()
		const dist = -camera.position.z / tmpV.z
		tmpWorld.copy(camera.position).addScaledVector(tmpV, dist)
		if (groupRef.current) groupRef.current.getWorldPosition(tmpGroup)
		else tmpGroup.set(0, 0, 0)
		const mx = tmpWorld.x - tmpGroup.x
		const my = tmpWorld.y - tmpGroup.y

		// Age every existing trail sample; the shader ignores expired ones.
		for (let i = 0; i < TRAIL_MAX; i++) trailAge[i] += dt

		// Instantaneous pointer velocity (per frame) drives the drag direction.
		let vx = 0
		let vy = 0
		if (prevMouse.current && dt > 0) {
			vx = (mx - prevMouse.current.x) / dt
			vy = (my - prevMouse.current.y) / dt
			prevMouse.current.set(mx, my)
		} else if (!prevMouse.current) {
			prevMouse.current = new THREE.Vector2(mx, my)
		}

		// Drop a new sample once the pointer has travelled far enough, so fast
		// swipes lay down a longer path (a longer tail) and slow ones a short one.
		const last = lastSample.current
		const moved = last ? Math.hypot(mx - last.x, my - last.y) : Infinity
		if (moved > TRAIL_MIN_DIST) {
			const idx = trailWrite.current
			trailPos[idx * 4] = mx
			trailPos[idx * 4 + 1] = my
			trailPos[idx * 4 + 2] = vx
			trailPos[idx * 4 + 3] = vy
			trailAge[idx] = 0
			trailWrite.current = (idx + 1) % TRAIL_MAX
			if (last) last.set(mx, my)
			else lastSample.current = new THREE.Vector2(mx, my)
		}

		const pu = pointsMaterial.uniforms
		pu.uProgress.value = progress.current
		pu.uTime.value += dt
		pu.uStrength.value = settings.strength
		pu.uTurbulence.value = settings.turbulence
		pu.uLifetime.value = settings.lifetime
		pu.uSize.value = settings.particleSize
		pu.uHoverRadius.value = settings.hoverRadius
		pu.uHoverForce.value = settings.hoverForce
		pu.uDirection.value.set(dir[0], dir[1])
		pu.uOpacity.value = opacity.current
	})

	const activeMaterial = settings.effect === "cigarette" ? burnMaterial : planeMaterial

	return (
		<group ref={groupRef}>
			<mesh
				material={activeMaterial}
				onClick={
					onSelect
						? (e) => {
								e.stopPropagation()
								onSelect()
						  }
						: undefined
				}
				onPointerOver={
					onSelect
						? () => {
								document.body.style.cursor = "pointer"
						  }
						: undefined
				}
				onPointerOut={
					onSelect
						? () => {
								document.body.style.cursor = ""
						  }
						: undefined
				}
			>
				<planeGeometry args={[meta.width, meta.height]} />
			</mesh>
			<mesh ref={lineRef} material={lineMaterial} renderOrder={10} visible={false}>
				<planeGeometry args={[1, 1]} />
			</mesh>
			{USE_PARTICLES && geometry && <points geometry={geometry} material={pointsMaterial} />}
		</group>
	)
}
