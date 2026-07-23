"use client"

import { Lock, LockOpen } from "lucide-react"
import { useVaporStore } from "@/lib/store"

/**
 * Mobile-only swipe lock. Dragging a finger across the canvas is both how you
 * play with the effect and how you navigate between images — so on phones those
 * gestures clash. This toggle disables swipe navigation (see VaporApp) so you
 * can stir the smoke freely without flipping to the next image. Tapping the
 * page dots still switches images while locked.
 */
export default function SwipeLock() {
	const images = useVaporStore((s) => s.images)
	const locked = useVaporStore((s) => s.swipeLocked)
	const setLocked = useVaporStore((s) => s.setSwipeLocked)

	if (images.length < 2) return null

	return (
		<button
			data-no-swipe
			onClick={() => setLocked(!locked)}
			aria-pressed={locked}
			className={`md:hidden absolute right-2.5 top-[60px] z-30 flex items-center gap-1.5 rounded-full border bg-black/40 px-3 py-1.5 text-xs font-medium backdrop-blur pointer-events-auto transition-colors ${
				locked ? "border-white/25 text-text" : "border-white/10 text-text-faint"
			}`}
		>
			{locked ? <Lock size={13} /> : <LockOpen size={13} />}
			{locked ? "Swipe locked" : "Lock swipe"}
		</button>
	)
}
