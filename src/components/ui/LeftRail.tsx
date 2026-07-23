"use client"
import { useRef } from "react"
import { Reorder } from "framer-motion"
import { Plus, X } from "lucide-react"
import { useVaporStore } from "@/lib/store"

interface LeftRailProps {
	openPicker: () => void
}

export default function LeftRail({ openPicker }: LeftRailProps) {
	const images = useVaporStore((s) => s.images)
	const currentIndex = useVaporStore((s) => s.currentIndex)
	const setCurrent = useVaporStore((s) => s.setCurrent)
	const removeImage = useVaporStore((s) => s.removeImage)
	const reorderImages = useVaporStore((s) => s.reorderImages)

	// Distinguish a reorder-drag from a plain click so dragging doesn't also
	// switch the centered image. Reset on each fresh press, set once a drag starts.
	const didDrag = useRef(false)

	return (
		<aside
			data-no-swipe
			className='hidden left-2.5 z-20 absolute md:flex flex-col gap-2.5 p-2.5 rounded-2xl w-[116px] pointer-events-auto glass-panel'
			style={{ top: 62, bottom: 10 }}
		>
			<button
				onClick={openPicker}
				className='flex flex-col justify-center items-center gap-1 bg-white/[0.02] border border-white/15 hover:border-white/30 border-dashed rounded-xl w-full aspect-square text-text-faint hover:text-text transition-colors cursor-pointer shrink-0'
				aria-label='Add new image'
			>
				<Plus size={20} />
			</button>

			<Reorder.Group
				as='div'
				axis='y'
				values={images}
				onReorder={reorderImages}
				layoutScroll
				className='flex flex-col flex-1 gap-2.5 -mx-1.5 -mt-1.5 px-1.5 pt-1.5 min-h-0 overflow-x-visible overflow-y-auto thin-scroll'
			>
				{images.map((img, i) => {
					const active = i === currentIndex
					return (
						<Reorder.Item
							key={img.id}
							value={img}
							dragListener={img.status === "idle"}
							onPointerDownCapture={() => {
								didDrag.current = false
							}}
							onDragStart={() => {
								didDrag.current = true
							}}
							className='group relative shrink-0'
						>
							<button
								onClick={() => {
									if (didDrag.current) return
									setCurrent(i)
								}}
								className={`relative block aspect-square w-full cursor-grab overflow-hidden rounded-xl border transition-colors active:cursor-grabbing ${
									active ? "border-white/60 ring-1 ring-white/25" : "border-white/10 hover:border-white/30"
								}`}
							>
								{/* eslint-disable-next-line @next/next/no-img-element */}
								<img
									src={img.src}
									alt={img.name}
									draggable={false}
									className={`h-full w-full object-contain transition-opacity ${
										img.status === "done" ? "opacity-25" : "opacity-90"
									}`}
								/>
								{img.status === "vaporizing" && (
									<span className='absolute inset-0 flex justify-center items-center bg-black/40'>
										<span className='bg-white rounded-full w-1.5 h-1.5 animate-ping' />
									</span>
								)}
							</button>
							<button
								onPointerDownCapture={(e) => e.stopPropagation()}
								onClick={() => removeImage(img.id)}
								className='-top-1.5 -right-1.5 absolute flex justify-center items-center bg-bg-1 opacity-0 group-hover:opacity-100 border border-white/15 rounded-full w-5 h-5 text-text-faint hover:text-text transition-opacity cursor-pointer'
								aria-label='Remove'
							>
								<X size={11} />
							</button>
						</Reorder.Item>
					)
				})}
			</Reorder.Group>
		</aside>
	)
}
