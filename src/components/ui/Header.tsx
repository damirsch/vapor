"use client"

import { Cigarette, Wind } from "lucide-react"
import { useVaporStore } from "@/lib/store"

export default function Header() {
	const images = useVaporStore((s) => s.images)
	const currentIndex = useVaporStore((s) => s.currentIndex)
	const effect = useVaporStore((s) => s.settings.effect)
	const updateSetting = useVaporStore((s) => s.updateSetting)

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

			{/* Effect mode — segmented toggle between vapor and the cigarette burn. */}
			<div className='flex items-center gap-1 bg-white/[0.03] p-1 border border-white/8 rounded-xl shrink-0'>
				<button
					onClick={() => updateSetting("effect", "vapor")}
					aria-pressed={effect === "vapor"}
					title='Vapor'
					className={`flex cursor-pointer items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] font-medium transition-colors ${
						effect === "vapor"
							? "bg-white text-black"
							: "text-text-dim hover:text-text"
					}`}
				>
					<Wind size={14} />
					<span className='hidden sm:inline'>Vapor</span>
				</button>
				<button
					onClick={() => updateSetting("effect", "cigarette")}
					aria-pressed={effect === "cigarette"}
					title='Cigarette'
					className={`flex cursor-pointer items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] font-medium transition-colors ${
						effect === "cigarette"
							? "bg-white text-black"
							: "text-text-dim hover:text-text"
					}`}
				>
					<Cigarette size={14} />
					<span className='hidden sm:inline'>Cigarette</span>
				</button>
			</div>
		</header>
	)
}
