"use client"

import { useEffect, useRef } from "react"
import { BURN_NOISE_SCALE, BURN_RAGGED, BURN_SPREAD_BASE, burnNow, MAX_SEEDS, packBurnSeeds } from "@/lib/burnState"
import { loadImageMeta } from "@/lib/imageParticles"
import { useVaporStore } from "@/lib/store"
import { directionToVec } from "@/lib/types"
import { FluidSim, type ImageTex } from "@/lib/fluid/FluidSim"

/**
 * Rate (0..1 per frame) at which band pixels approach the source image color.
 * The emit shader saturates at the true color, so this only controls how
 * quickly dye ramps up as the sweep crosses — it can't blow out to white.
 */
const EMIT_AMOUNT = 0.9
/**
 * Vertical velocity injected in the band. Negative = the smoke sinks/falls
 * downward as the sweep line travels up (heavy vapor pouring down). Kept gentle
 * so the dye keeps the image's colour/shape as it lifts off instead of being
 * flung around and thinned out into invisibility.
 */
const EMIT_RISE = -24
/** Sideways jitter injected in the band for natural swirl. */
const EMIT_JITTER = 4
/**
 * Brightness of the image's emitted dye. 1.0 = emit the true image colour so
 * the smoke reads as the same colour as the picture (grey stays grey). Lower it
 * only if bright images bloom/halo too much.
 */
const IMAGE_DYE_BRIGHTNESS = 0.7

/** Reference multiplies the pointer delta by 5 to get the splat velocity. */
const REF_FORCE = 5

/**
 * Reference `generateColor`: a vivid random hue, scaled way down so the raw dye
 * is dim and the bloom pass is what makes it glow (matches the reference look).
 */
const COLOR_INTENSITY = 0.15
/** Reference picks a fresh random colour every 100ms. */
const COLOR_CHANGE_MS = 100

/* Cigarette burn smoke — faint, dim, plain grey (weaker than the vapor smoke). */
const BURN_SMOKE_COLOR: [number, number, number] = [0.22, 0.22, 0.24]
const BURN_SMOKE_AMOUNT = 0.1
/** UV width of the combustion band that emits smoke (sits over the char zone). */
const BURN_SMOKE_FRONT = 0.07
/** Upward buoyancy injected into the smoke — a stronger, straighter jet up. */
const BURN_SMOKE_RISE = 12
const BURN_SMOKE_JITTER = 2

/*
 * Cigarette tip wisp — the thin, continuous curl of smoke that always rises off
 * the lit tip (independent of the paper burning). Injected straight into the
 * fluid every frame as a small, thin splat so it reads as a real fluid wisp
 * (like the reference smoke, only fainter/greyer) instead of discrete DOM dots.
 */
const TIP_SMOKE_COLOR: [number, number, number] = [0.05, 0.05, 0.055]
/** Thinner than the default cursor splat so the column stays wispy. */
const TIP_SMOKE_RADIUS = 0.4
/** Upward buoyancy of the tip wisp. */
const TIP_SMOKE_RISE = 7
/** Tiny sideways wander — kept small so the column rises fairly straight. */
const TIP_SMOKE_JITTER = 1.2
/** How strongly cursor motion blows the wisp the opposite way (the wake). */
const TIP_SMOKE_WAKE = 0.8
/** Screen-space offset (px) from the cursor to the glowing tip of the cig. */
const TIP_OFFSET_X = -2
const TIP_OFFSET_Y = -4

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
		// Decaying estimate of the cursor's velocity, used to blow the cigarette's
		// smoke into the *opposite* direction (a wake trailing behind the tip).
		let velX = 0
		let velY = 0
		let moved = false
		let hasCursor = false
		// Whether the pointer is over the canvas (not hovering the UI chrome). Used
		// so the cigarette's tip wisp only smokes while it's over the artwork area.
		let overCanvas = false
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
			const t = e.target as HTMLElement | null
			overCanvas = !t?.closest("[data-no-swipe]")
		}
		window.addEventListener("pointermove", onMove)

		// Per-image dye texture in the fluid's own GL context.
		let currentSrc: string | null = null
		let imageTex: ImageTex | null = null
		let imageAspect = 1
		let loadToken = 0
		// Reused buffer for uploading the burn seeds to the smoke emitter.
		const seedBuf = new Float32Array(MAX_SEEDS * 3)

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
					imageAspect = m.width / m.height
				})
				.catch(() => {})
		}

		let raf = 0
		const loop = () => {
			raf = requestAnimationFrame(loop)
			const st = useVaporStore.getState()
			const s = st.settings
			const cigMode = s.effect === "cigarette"
			const dt = 0.016

			// Cigarette smoke is plain grey — kill the bloom glow so overlapping
			// smoke doesn't light up. Vapor mode keeps the reference's glow.
			sim.setBloom(!cigMode)

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
				if (cigMode) {
					// Don't stir the fluid at the cursor — stirring drags the smoke
					// along with the cigarette. We only record the cursor velocity so
					// the wisp can trail the opposite way (see the tip splat below).
					velX = curDX
					velY = curDY
				} else {
					const splatDye = s.cursorSmoke ? dye : undefined
					sim.splat(curX * dpr, curY * dpr, curDX * REF_FORCE, curDY * REF_FORCE, splatDye)
				}
				moved = false
			}
			// Relax the wake toward zero so a stationary cigarette smokes straight up.
			velX *= 0.8
			velY *= 0.8

			// Continuous grey wisp off the lit cigarette tip: a thin column that rises
			// straight up (no glow, minimal swirl) and gets blown to the side opposite
			// the cigarette's motion — like real smoke left behind as you move it.
			if (cigMode && hasCursor && overCanvas) {
				const jx = (Math.random() - 0.5) * TIP_SMOKE_JITTER
				sim.splat(
					(curX + TIP_OFFSET_X) * dpr,
					(curY + TIP_OFFSET_Y) * dpr,
					jx - velX * TIP_SMOKE_WAKE,
					-TIP_SMOKE_RISE - velY * TIP_SMOKE_WAKE,
					TIP_SMOKE_COLOR,
					TIP_SMOKE_RADIUS
				)
			}

			// Emit smoke from the dissolving image. Only runs during an active burn/
			// vaporize; when idle the sim behaves exactly like the reference.
			if (cur && cur.status !== "idle") {
				if (cigMode) {
					// Faint grey smoke rising from the ragged, spreading burn front.
					const count = packBurnSeeds(cur.src, seedBuf)
					if (count > 0) {
						sim.emitBurn(
							st.imageRect,
							seedBuf,
							count,
							burnNow(),
							imageAspect,
							BURN_SPREAD_BASE * s.speed,
							BURN_SMOKE_FRONT,
							BURN_RAGGED,
							BURN_NOISE_SCALE,
							BURN_SMOKE_COLOR,
							BURN_SMOKE_AMOUNT,
							BURN_SMOKE_RISE,
							BURN_SMOKE_JITTER
						)
					}
				} else if (imageTex) {
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
