"use client"

import { useEffect, useRef } from "react"
import { Cigarette } from "lucide-react"
import { useVaporStore } from "@/lib/store"
import { burnPointer } from "@/lib/burnState"
import { Switch } from "./Toggle"
import CigaretteGraphic from "./CigaretteGraphic"

export default function Header() {
	const images = useVaporStore((s) => s.images)
	const currentIndex = useVaporStore((s) => s.currentIndex)
	const effect = useVaporStore((s) => s.settings.effect)
	const updateSetting = useVaporStore((s) => s.updateSetting)

	const current = images[currentIndex]
	const hasImages = images.length > 0
	const on = effect === "cigarette"

	const cigRef = useRef<HTMLDivElement>(null)
	const liveRef = useRef(false)
	const pointer = useRef({ x: 0, y: 0, inside: false, target: null as EventTarget | null })

	const overCanvas = (t: EventTarget | null) => !(t as HTMLElement | null)?.closest("[data-no-swipe]")

	// Live cursor: while cigarette mode is on, the cigarette tracks the pointer
	// and lights up on press.
	useEffect(() => {
		let raf = 0
		const loop = () => {
			const el = cigRef.current
			if (el && liveRef.current) {
				const p = pointer.current
				const vis = p.inside && overCanvas(p.target)
				el.style.transform = `translate3d(${p.x}px, ${p.y}px, 0)`
				el.style.opacity = vis ? "1" : "0"
				el.classList.toggle("is-lit", burnPointer.down && vis)
			}
			raf = requestAnimationFrame(loop)
		}
		raf = requestAnimationFrame(loop)
		return () => cancelAnimationFrame(raf)
	}, [])

	// Pointer tracking + burn arming (only armed while the cursor is live).
	useEffect(() => {
		const onMove = (e: PointerEvent) => {
			pointer.current.x = e.clientX
			pointer.current.y = e.clientY
			pointer.current.inside = true
			pointer.current.target = e.target
		}
		const onDown = (e: PointerEvent) => {
			if (!liveRef.current) return
			burnPointer.down = e.button === 0 && overCanvas(e.target)
			cigRef.current?.classList.toggle("is-lit", burnPointer.down)
		}
		const onUp = () => {
			requestAnimationFrame(() => {
				burnPointer.down = false
				cigRef.current?.classList.remove("is-lit")
			})
		}
		const onLeave = () => {
			pointer.current.inside = false
		}
		window.addEventListener("pointermove", onMove)
		window.addEventListener("pointerdown", onDown)
		window.addEventListener("pointerup", onUp)
		window.addEventListener("pointercancel", onUp)
		document.addEventListener("mouseleave", onLeave)
		return () => {
			burnPointer.down = false
			window.removeEventListener("pointermove", onMove)
			window.removeEventListener("pointerdown", onDown)
			window.removeEventListener("pointerup", onUp)
			window.removeEventListener("pointercancel", onUp)
			document.removeEventListener("mouseleave", onLeave)
		}
	}, [])

	// Toggle the live cursor with the mode; hide it when switching back to vapor.
	useEffect(() => {
		liveRef.current = on
		if (!on) {
			const el = cigRef.current
			if (el) {
				el.style.opacity = "0"
				el.classList.remove("is-lit")
			}
			burnPointer.down = false
		}
	}, [on])

	return (
		<>
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

				{/* Cigarette edition toggle */}
				<div className='flex items-center gap-2 shrink-0'>
					<Cigarette size={15} className='text-text-dim' />
					<span className='font-medium text-text-dim text-[13px] whitespace-nowrap'>Cigarette edition</span>
					<Switch
						checked={on}
						onChange={(v) => updateSetting("effect", v ? "cigarette" : "vapor")}
						ariaLabel='Cigarette edition'
					/>
				</div>
			</header>

			{/* Live cigarette cursor (fixed to the viewport). */}
			<div ref={cigRef} className='cig-cursor' aria-hidden>
				<CigaretteGraphic />
			</div>
		</>
	)
}
