"use client"

import { Download } from "lucide-react"
import { useVaporStore } from "@/lib/store"
import Button from "./Button"

export default function Header() {
	const images = useVaporStore((s) => s.images)
	const currentIndex = useVaporStore((s) => s.currentIndex)

	const current = images[currentIndex]
	const hasImages = images.length > 0

	return (
		<header
			data-no-swipe
			className='top-0 z-50 absolute inset-x-0 flex justify-between items-center gap-3 px-6 h-[52px] pointer-events-auto glass-header'
		>
			{/* Brand */}
			<div className='flex items-center gap-2.5 select-none shrink-0'>
				<span className='bg-white shadow-[0_0_10px_2px_rgba(255,255,255,0.55)] rounded-full w-2 h-2' />
				<span className='font-semibold text-text text-base'>Vapor&nbsp;OS</span>
			</div>

			{/* Center title — centered within the free area between rail and panel. */}
			<div className='hidden absolute inset-x-0 md:flex justify-center items-center lg:pr-[328px] md:pl-[140px] pointer-events-none'>
				{hasImages && current ? (
					<div className='flex items-center gap-2'>
						<span className='max-w-[280px] font-medium text-sm truncate'>{current.name}</span>
						<span className='flex gap-1 bg-white/8 px-1.5 py-0.5 rounded-md font-mono tabular-nums text-text-faint text-xs'>
							<span>{currentIndex + 1}</span>/<span>{images.length}</span>
						</span>
					</div>
				) : (
					<span className='text-text-faint text-sm tracking-wide'> No image loaded</span>
				)}
			</div>

			{/* Export — disabled with a "Coming soon" tooltip on hover. */}
			<div className='group relative shrink-0'>
				<Button variant='ghost' size='sm' disabled aria-disabled='true'>
					<Download size={15} />
					<span className='hidden sm:inline'>Export</span>
				</Button>
				<span className='top-[calc(100%+8px)] right-0 z-40 absolute bg-bg-1 opacity-0 group-hover:opacity-100 shadow-lg px-2.5 py-1 border border-line rounded-lg text-[11px] text-text-dim whitespace-nowrap transition-opacity duration-150 pointer-events-none'>
					Coming soon
				</span>
			</div>
		</header>
	)
}
