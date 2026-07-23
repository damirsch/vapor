/**
 * Shared, imperative burn state for the cigarette effect.
 *
 * Burning is modelled as a union of "seeds" — ignition points dropped where the
 * cigarette tip touches the image — each expanding over time into a ragged,
 * noise-perturbed circle. Both rendering contexts consume the exact same seeds:
 *   • three.js image plane → paper shader (embers → char → hole)
 *   • FluidSim overlay      → faint grey smoke emitted along the burn front
 *
 * Keeping this as a tiny mutable module (mirroring the cursor-trail pattern)
 * avoids per-frame React re-renders and, crucially, avoids sharing GL textures
 * across the two independent WebGL contexts.
 */

export interface BurnSeed {
	/** Ignition point in image UV space (0..1, v up). */
	u: number
	v: number
	/** Birth time in seconds (shared clock, see burnNow). */
	t: number
}

/** Must match the `MAX_SEEDS` #define in the burn shaders. */
export const MAX_SEEDS = 64

/**
 * Base front growth speed in image-UV height units per second (before the
 * user's speed multiplier). Shared by the paper shader (three) and the smoke
 * emitter (FluidSim) so both burn at exactly the same rate.
 */
export const BURN_SPREAD_BASE = 0.15

/**
 * Whether the pointer is currently pressed over the canvas. The cigarette only
 * ignites on hover *and* press (set by CigaretteCursor) so a stray hover can't
 * accidentally start a burn.
 */
export const burnPointer = { down: false }

/** Width of the ragged front's noise displacement (shared by both contexts). */
export const BURN_RAGGED = 0.05
/** Spatial frequency of the front noise (shared by both contexts). */
export const BURN_NOISE_SCALE = 5.0

/** Minimum UV travel between consecutive seeds so a drag lays a clean trail. */
const MIN_SEED_DIST = 0.02

const start = performance.now()

/** Seconds since module load — a single clock shared by both GL contexts. */
export function burnNow(): number {
	return (performance.now() - start) / 1000
}

const bySrc = new Map<string, BurnSeed[]>()

export function getBurnSeeds(src: string): BurnSeed[] {
	return bySrc.get(src) ?? []
}

/** Drop a new ignition point for an image; returns true if one was added. */
export function addBurnSeed(src: string, u: number, v: number): boolean {
	let arr = bySrc.get(src)
	if (!arr) {
		arr = []
		bySrc.set(src, arr)
	}
	if (arr.length >= MAX_SEEDS) return false
	const last = arr[arr.length - 1]
	if (last && Math.hypot(u - last.u, v - last.v) < MIN_SEED_DIST) return false
	arr.push({ u, v, t: burnNow() })
	return true
}

export function clearBurn(src?: string) {
	if (src) bySrc.delete(src)
	else bySrc.clear()
}

/**
 * Pack an image's seeds into a flat Float32Array (vec3 per seed) for upload as a
 * shader uniform. Returns the active seed count.
 */
export function packBurnSeeds(src: string, out: Float32Array): number {
	const arr = bySrc.get(src)
	if (!arr) return 0
	const n = Math.min(arr.length, MAX_SEEDS)
	for (let i = 0; i < n; i++) {
		out[i * 3] = arr[i].u
		out[i * 3 + 1] = arr[i].v
		out[i * 3 + 2] = arr[i].t
	}
	return n
}

/** Birth time of the earliest seed (drives spread/completion), or null. */
export function firstSeedTime(src: string): number | null {
	const arr = bySrc.get(src)
	return arr && arr.length ? arr[0].t : null
}
