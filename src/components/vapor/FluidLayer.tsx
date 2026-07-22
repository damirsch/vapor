"use client"

import { useEffect, useRef } from "react"
import { loadImageMeta } from "@/lib/imageParticles"
import { useVaporStore } from "@/lib/store"
import { directionToVec } from "@/lib/types"
import { FluidSim, type ImageTex } from "@/lib/fluid/FluidSim"

/**
 * Rate (0..1 per frame) at which band pixels approach the source image color.
 * The emit shader saturates at the true color, so this only controls how
 * quickly dye ramps up as the sweep crosses — it can't blow out to white.
 */
const EMIT_AMOUNT = 0.5
/**
 * Vertical velocity injected in the band. Negative = the smoke sinks/falls
 * downward as the sweep line travels up (heavy vapor pouring down).
 */
const EMIT_RISE = -34
/** Sideways jitter injected in the band for natural swirl. */
const EMIT_JITTER = 7
/**
 * Scales down the image's emitted dye so its bloom/glow is gentler than the
 * cursor smoke's. Bloom is non-linear near the threshold, so a small cut here
 * removes a lot of the halo while keeping the smoke clearly coloured.
 */
const IMAGE_DYE_BRIGHTNESS = 0.6

/** Reference multiplies the pointer delta by 5 to get the splat velocity. */
const REF_FORCE = 5

/**
 * Reference `generateColor`: a vivid random hue, scaled way down so the raw dye
 * is dim and the bloom pass is what makes it glow (matches the reference look).
 */
const COLOR_INTENSITY = 0.15
/** Reference picks a fresh random colour every 100ms. */
const COLOR_CHANGE_MS = 100

/** HSV (0..1) → RGB (0..1). */
function hsv(h: number, s: number, v: number): [number, number, number] {
	const i = Math.floor(h * 6)
	const f = h * 6 - i
	const p = v * (1 - s)
	const q = v * (1 - f * s)
	const t = v * (1 - (1 - f) * s)
	switch (i % 6) {
		case 0:
			return [v, t, p]
		case 1:
			return [q, v, p]
		case 2:
			return [p, v, t]
		case 3:
			return [p, q, v]
		case 4:
			return [t, p, v]
		default:
			return [v, p, q]
	}
}

export default function FluidLayer() {
	const containerRef = useRef<HTMLDivElement>(null)

	useEffect(() => {
		const container = containerRef.current
		if (!container) return

		// Create a fresh canvas per mount. Reusing a canvas across mounts is unsafe:
		// disposing the sim calls loseContext(), and React Strict Mode's
		// mount→unmount→mount cycle would then hand the remount a permanently lost
		// context (shaders fail to compile with a null log). A new element each time
		// always yields a fresh, healthy WebGL2 context.
		const canvas = document.createElement("canvas")
		canvas.className = "pointer-events-none absolute inset-0 h-full w-full"
		container.appendChild(canvas)

		let sim: FluidSim
		try {
			sim = new FluidSim(canvas)
		} catch (e) {
			console.warn("[fluid] init failed:", (e as Error)?.message ?? String(e))
			canvas.remove()
			return
		}

		const dpr = Math.min(window.devicePixelRatio || 1, 2)

		// Cursor tracking (the canvas itself is non-interactive; we listen globally).
		let curX = 0
		let curY = 0
		let curDX = 0
		let curDY = 0
		let moved = false
		let hasCursor = false
		// Reference-style colour: a random vivid hue refreshed every 100ms.
		let color = hsv(Math.random(), 1, 1)
		let lastColorMs = 0
		const onMove = (e: PointerEvent) => {
			const x = e.clientX
			const y = e.clientY
			if (hasCursor) {
				curDX = x - curX
				curDY = y - curY
				moved = true
			}
			curX = x
			curY = y
			hasCursor = true
		}
		window.addEventListener("pointermove", onMove)

		// Per-image dye texture in the fluid's own GL context.
		let currentSrc: string | null = null
		let imageTex: ImageTex | null = null
		let loadToken = 0

		const syncImage = (src: string | null) => {
			if (src === currentSrc) return
			currentSrc = src
			sim.reset()
			if (imageTex) {
				sim.disposeImageTexture(imageTex)
				imageTex = null
			}
			if (!src) return
			const token = ++loadToken
			loadImageMeta(src)
				.then((m) => {
					if (token !== loadToken) return
					imageTex = sim.createImageTexture(m.image)
				})
				.catch(() => {})
		}

		let raf = 0
		const loop = () => {
			raf = requestAnimationFrame(loop)
			const st = useVaporStore.getState()
			const s = st.settings
			const dt = 0.016

			sim.resize(window.innerWidth, window.innerHeight, dpr)

			const cur = st.images[st.currentIndex]
			syncImage(cur ? cur.src : null)

			// Refresh the jet colour on the reference's 100ms cadence.
			const nowMs = performance.now()
			if (nowMs - lastColorMs > COLOR_CHANGE_MS) {
				lastColorMs = nowMs
				color = hsv(Math.random(), 1, 1)
			}
			const dye: [number, number, number] = [
				color[0] * COLOR_INTENSITY,
				color[1] * COLOR_INTENSITY,
				color[2] * COLOR_INTENSITY,
			]

			// Reference cursor model (one-to-one): on each pointer move, splat once at
			// the cursor with velocity = delta × 5 and the current colour. No motion,
			// no splat — exactly like the CodePen example. When "cursor smoke" is off
			// we still splat the velocity (so the pointer keeps stirring vaporized
			// smoke) but pass no dye, so it paints no coloured swirls of its own.
			if (moved) {
				sim.splat(curX * dpr, curY * dpr, curDX * REF_FORCE, curDY * REF_FORCE, s.cursorSmoke ? dye : undefined)
				moved = false
			}

			// Emit dye + buoyancy from the dissolving image along the sweep band.
			// This only runs during an active vaporize; when idle the sim behaves
			// exactly like the reference (pure step + cursor splat, no extra forces).
			if (imageTex && cur && cur.status !== "idle") {
				sim.emit(
					imageTex,
					st.imageRect,
					directionToVec(s.direction),
					st.vaporProgress,
					s.edge,
					EMIT_AMOUNT,
					EMIT_RISE * s.strength,
					EMIT_JITTER * (0.5 + s.turbulence),
					IMAGE_DYE_BRIGHTNESS
				)
			}

			sim.step(dt)
			sim.render()
		}
		raf = requestAnimationFrame(loop)

		return () => {
			cancelAnimationFrame(raf)
			window.removeEventListener("pointermove", onMove)
			if (imageTex) sim.disposeImageTexture(imageTex)
			sim.dispose()
			canvas.remove()
		}
	}, [])

	return <div ref={containerRef} className='z-[5] absolute inset-0 pointer-events-none' />
}
