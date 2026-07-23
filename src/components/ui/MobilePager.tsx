"use client"

import { useVaporStore } from "@/lib/store"

/**
 * Mobile-only pagination indicator. The left rail (thumbnails) and the header
 * counter are both hidden below `md`, so on phones a single image fills the
 * screen with no hint that more are loaded. These dots show the count + current
 * position and let you tap to jump between images. Falls back to a compact
 * "n / total" pill when there are too many images to dot cleanly.
 */
export default function MobilePager() {
	const images = useVaporStore((s) => s.images)
	const currentIndex = useVaporStore((s) => s.currentIndex)
	const setCurrent = useVaporStore((s) => s.setCurrent)

	if (images.length < 2) return null

	return (
		<div
			data-no-swipe
			className='md:hidden bottom-24 z-20 absolute inset-x-0 flex justify-center px-4 pointer-events-none'
		>
			{images.length <= 8 ? (
				<div className='flex items-center gap-2 bg-black/40 backdrop-blur px-3 py-2 rounded-full pointer-events-auto'>
					{images.map((img, i) => (
						<button
							key={img.id}
							onClick={() => setCurrent(i)}
							aria-label={`Go to image ${i + 1}`}
							className={`h-1.5 rounded-full transition-all cursor-pointer ${
								i === currentIndex ? "w-3.5 bg-white" : "w-1.5 bg-white/40"
							}`}
						/>
					))}
				</div>
			) : (
				<div className='bg-black/40 backdrop-blur px-3 py-1 rounded-full font-mono tabular-nums text-text-dim text-xs pointer-events-auto'>
					{currentIndex + 1} / {images.length}
				</div>
			)}
		</div>
	)
}
