"use client"

import { useEffect, useRef } from "react"
import { burnPointer } from "@/lib/burnState"

/**
 * A DOM cursor that replaces the pointer with a lit cigarette. The cigarette
 * graphic just follows the pointer — the smoke itself is emitted into the fluid
 * sim (see FluidLayer's tip wisp) so it reads as real, continuous curls of
 * smoke that stay behind when the cigarette moves, instead of DOM dots.
 *
 * The tip sits on the real pointer hotspot — that's the ignition point the burn
 * shader reads. Everything is hidden over UI panels ([data-no-swipe]).
 */
export default function CigaretteCursor() {
	const ref = useRef<HTMLDivElement>(null)

	useEffect(() => {
		const el = ref.current
		if (!el) return

		const overCanvas = (t: EventTarget | null) =>
			!(t as HTMLElement | null)?.closest("[data-no-swipe]")

		const place = (x: number, y: number, visible: boolean) => {
			el.style.transform = `translate3d(${x}px, ${y}px, 0)`
			el.style.opacity = visible ? "1" : "0"
		}

		const onMove = (e: PointerEvent) => {
			const visible = overCanvas(e.target)
			place(e.clientX, e.clientY, visible)
			el.classList.toggle("is-lit", burnPointer.down && visible)
		}
		const onDown = (e: PointerEvent) => {
			// Only arm the burn when the press lands on the canvas, not the UI.
			burnPointer.down = e.button === 0 && overCanvas(e.target)
			el.classList.toggle("is-lit", burnPointer.down)
		}
		const onUp = () => {
			// Defer the release by a frame so a very quick click is still seen by the
			// render loop (which samples burnPointer.down once per frame).
			requestAnimationFrame(() => {
				burnPointer.down = false
				el.classList.remove("is-lit")
			})
		}
		const onLeave = () => {
			el.style.opacity = "0"
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

	return (
		<div ref={ref} className='cig-cursor' aria-hidden>
			<div className='cig'>
				<span className='cig-filter' />
				<span className='cig-body' />
				<span className='cig-tip' />
			</div>
		</div>
	)
}
