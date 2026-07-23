"use client"
import { RotateCcw, X } from "lucide-react"
import { useVaporStore } from "@/lib/store"
import Button from "./Button"
import Slider from "./Slider"
import Toggle from "./Toggle"

export default function Sidebar() {
	const settings = useVaporStore((s) => s.settings)
	const update = useVaporStore((s) => s.updateSetting)
	const resetSettings = useVaporStore((s) => s.resetSettings)
	const open = useVaporStore((s) => s.sidebarOpen)
	const setOpen = useVaporStore((s) => s.setSidebarOpen)

	// The cigarette burn only uses spread speed + between-image delay; the vapor
	// sweep controls (strength, turbulence, sweep line, lifetime, cursor smoke)
	// don't apply to it, so they're hidden in burn mode.
	const cig = settings.effect === "cigarette"

	return (
		<>
			{/* Mobile backdrop */}
			<div
				onClick={() => setOpen(false)}
				className={`absolute inset-0 z-30 bg-black/50 backdrop-blur-[2px] transition-opacity duration-300 lg:hidden ${
					open ? "opacity-100" : "pointer-events-none opacity-0"
				}`}
			/>

			<aside
				data-no-swipe
				style={{ top: 62, bottom: 10 }}
				className={`glass-panel absolute right-2.5 z-40 flex w-[300px] max-w-[calc(100vw-1.25rem)] flex-col rounded-2xl transition-[transform,opacity] duration-300 ease-out lg:pointer-events-auto lg:translate-x-0 lg:opacity-100 ${
					open
						? "pointer-events-auto translate-x-0 opacity-100"
						: "pointer-events-none translate-x-[112%] opacity-0 lg:pointer-events-auto"
				}`}
			>
				<div className='flex justify-between items-center px-5 pt-4 pb-3'>
					<span className='font-semibold text-text text-base'>Controls</span>
					<button
						onClick={() => setOpen(false)}
						className='lg:hidden flex justify-center items-center hover:bg-white/5 rounded-lg w-7 h-7 text-text-faint hover:text-text transition-colors cursor-pointer'
						aria-label='Close controls'
					>
						<X size={16} />
					</button>
				</div>

				<div className='flex flex-col flex-1 gap-y-6 px-5 pt-1 pb-5 overflow-y-auto thin-scroll'>
					<div className='space-y-6'>
						<Slider
							label='Speed'
							value={settings.speed}
							min={0.1}
							max={1.2}
							onChange={(v) => update("speed", v)}
							format={(v) => `${v.toFixed(2)}×`}
							caption={cig ? "How fast the fire spreads across the image" : "How fast the sweep dissolves the image"}
						/>
						{!cig && (
							<>
								<Slider
									label='Strength'
									value={settings.strength}
									min={0.1}
									max={2.5}
									onChange={(v) => update("strength", v)}
									format={(v) => v.toFixed(2)}
									caption='Force pushed into the vapor as it lifts off'
								/>
								<Toggle
									label='Cursor trail'
									checked={settings.cursorSmoke}
									onChange={(v) => update("cursorSmoke", v)}
								/>
								<Slider
									label='Turbulence'
									value={settings.turbulence}
									min={0.1}
									max={2.5}
									onChange={(v) => update("turbulence", v)}
									format={(v) => v.toFixed(2)}
									caption='Amount of swirl in the rising smoke'
								/>
							</>
						)}
					</div>

					{!cig && (
						<div className='space-y-6'>
							<Slider
								label='Sweep line width'
								value={settings.edge}
								min={0.05}
								max={0.7}
								step={0.01}
								onChange={(v) => update("edge", v)}
								format={(v) => v.toFixed(2)}
								caption='Thickness of the bright dissolve edge'
							/>
							<Slider
								label='Smoke lifetime'
								value={settings.lifetime}
								min={0.2}
								max={2}
								step={0.05}
								onChange={(v) => update("lifetime", v)}
								format={(v) => v.toFixed(2)}
								caption='How long vapor lingers before fading out'
							/>
						</div>
					)}

					<div className='space-y-6'>
						<Slider
							label='Delay between images'
							value={settings.delay}
							min={0}
							max={3}
							step={0.1}
							onChange={(v) => update("delay", v)}
							format={(v) => `${v.toFixed(1)}s`}
							caption={cig ? "Pause between images during Burn all" : "Pause between images during Vaporize all"}
						/>
					</div>

					<Button className='mt-auto' variant='ghost' fullWidth onClick={resetSettings}>
						<RotateCcw size={13} />
						Reset settings
					</Button>
				</div>
			</aside>
		</>
	)
}
