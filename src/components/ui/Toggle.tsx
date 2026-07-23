"use client"

/** Bare on/off switch — the interactive control, reused wherever a toggle is needed. */
export function Switch({
	checked,
	onChange,
	ariaLabel,
}: {
	checked: boolean
	onChange: (v: boolean) => void
	ariaLabel?: string
}) {
	return (
		<button
			type='button'
			role='switch'
			aria-checked={checked}
			aria-label={ariaLabel}
			onClick={() => onChange(!checked)}
			className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors ${
				checked ? "bg-white/85" : "bg-white/12"
			}`}
		>
			<span
				className={`inline-block h-4 w-4 rounded-full bg-black transition-transform ${
					checked ? "translate-x-[18px]" : "translate-x-0.5"
				}`}
			/>
		</button>
	)
}

/** Labeled toggle row (label left, switch right, optional caption below). */
export default function Toggle({
	label,
	caption,
	checked,
	onChange,
}: {
	label: string
	caption?: string
	checked: boolean
	onChange: (v: boolean) => void
}) {
	return (
		<div>
			<div className='flex justify-between items-center w-full'>
				<span className='font-medium text-sm tracking-wide'>{label}</span>
				<Switch checked={checked} onChange={onChange} ariaLabel={label} />
			</div>
			{caption ? <p className='mt-1.5 text-[10.5px] text-text-faint leading-snug'>{caption}</p> : null}
		</div>
	)
}
