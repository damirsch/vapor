/**
 * The cigarette graphic, drawn with its burning tip at the container origin
 * (0,0) so it can be pinned to a pointer hotspot or a header slot. Shared by the
 * header emblem (extinguished, via `cig-out`) and the live cursor.
 */
export default function CigaretteGraphic({ className = "" }: { className?: string }) {
	return (
		<div className={`cig ${className}`.trim()}>
			<span className='cig-filter' />
			<span className='cig-body' />
			<span className='cig-tip' />
		</div>
	)
}
