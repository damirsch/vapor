"use client"

interface SliderProps {
	label: string
	value: number
	min: number
	max: number
	step?: number
	unit?: string
	format?: (v: number) => string
	/** Optional helper line shown under the slider (ref-1 style). */
	caption?: string
	onChange: (v: number) => void
}

export default function Slider({ label, value, min, max, step = 0.01, unit, format, caption, onChange }: SliderProps) {
	const pct = ((value - min) / (max - min)) * 100
	const display = format ? format(value) : `${value}${unit ?? ""}`

	return (
		<label className='block'>
			<div className='flex justify-between items-baseline gap-3 mb-1'>
				<span className='font-medium text-sm tracking-wide'>{label}</span>
				<span className='text-text text-xs'>{display}</span>
			</div>
			<input
				type='range'
				className='v-range'
				min={min}
				max={max}
				step={step}
				value={value}
				onChange={(e) => onChange(parseFloat(e.target.value))}
				style={
					{
						"--pct": `${pct}%`,
						"--fill": "var(--accent)",
					} as React.CSSProperties
				}
			/>
			{caption ? <p className='-mt-1 text-text-faint text-xs leading-snug'>{caption}</p> : null}
		</label>
	)
}
