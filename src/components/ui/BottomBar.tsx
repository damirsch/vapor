"use client"
import { motion } from "framer-motion"
import { Flame, ImagePlus, RotateCcw, SlidersHorizontal, Wind } from "lucide-react"
import { useVaporStore } from "@/lib/store"
import Button from "./Button"

interface BottomBarProps {
	openPicker: () => void
}

export default function BottomBar({ openPicker }: BottomBarProps) {
	const images = useVaporStore((s) => s.images)
	const currentIndex = useVaporStore((s) => s.currentIndex)
	const mode = useVaporStore((s) => s.mode)
	const effect = useVaporStore((s) => s.settings.effect)
	const vaporizeCurrent = useVaporStore((s) => s.vaporizeCurrent)
	const vaporizeAll = useVaporStore((s) => s.vaporizeAll)
	const reset = useVaporStore((s) => s.reset)
	const sidebarOpen = useVaporStore((s) => s.sidebarOpen)
	const setSidebarOpen = useVaporStore((s) => s.setSidebarOpen)

	if (images.length === 0) return null

	const current = images[currentIndex]
	const isPlaying = mode !== "idle"
	const anyIdle = images.some((i) => i.status === "idle")
	const anyTouched = images.some((i) => i.status !== "idle")
	const canVaporize = !isPlaying && current?.status === "idle"

	const cig = effect === "cigarette"
	const oneLabel = cig ? "Burn" : "Vaporize"
	const allLabel = cig ? "Burn all" : "Vaporize all"

	return (
		<motion.div
			initial={{ opacity: 0, y: 24 }}
			animate={{ opacity: 1, y: 0 }}
			transition={{ type: "spring", stiffness: 240, damping: 28 }}
			data-no-swipe
			className='bottom-4 z-20 absolute inset-x-0 flex justify-center items-center gap-2 px-4 lg:pr-[328px] md:pl-[140px] pointer-events-none'
		>
			{/* Below desktop: settings in its own pill, sitting left of the main bar.
			<div className='lg:hidden p-3 rounded-2xl pointer-events-auto glass-panel'>
				<Button variant='ghost' iconOnly onClick={() => setSidebarOpen(!sidebarOpen)} aria-label='Toggle controls'>
					<SlidersHorizontal size={16} />
				</Button>
			</div> */}

			<div className='flex items-center gap-2 px-3 py-3 rounded-2xl pointer-events-auto glass-panel'>
				{/* Mobile-only: add image (left rail is hidden on small screens) */}
				<Button variant='ghost' iconOnly onClick={openPicker} aria-label='Add image' className='md:hidden'>
					<ImagePlus size={17} />
				</Button>

				<Button variant='primary' onClick={vaporizeCurrent} disabled={!canVaporize} className='font-semibold'>
					{/* Icon on desktop only; on mobile the label stands alone. */}
					<span className='hidden sm:inline-flex'>{cig ? <Flame size={16} /> : <Wind size={16} />}</span>
					<span>{oneLabel}</span>
				</Button>

				{images.length > 1 && (
					<Button variant='secondary' onClick={vaporizeAll} disabled={isPlaying || !anyIdle}>
						{allLabel}
					</Button>
				)}

				<Button variant='secondary' iconOnly onClick={reset} disabled={!anyTouched} aria-label='Reset' title='Reset'>
					<RotateCcw size={16} />
				</Button>
			</div>
		</motion.div>
	)
}
