import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import './groupTerritory.css'

export function MapFilterButton({ label, pressed, onClick, children }: {
  label: string; pressed: boolean; onClick: () => void; children: ReactNode
}) {
  const [hint, setHint] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const id = useId()
  const hide = () => { clearTimeout(timer.current); setHint(false) }
  const show = () => { clearTimeout(timer.current); setHint(true); timer.current = setTimeout(() => setHint(false), 1800) }
  useEffect(() => () => clearTimeout(timer.current), [])
  return <span className="map-filter-control">
    <button type="button" className="mobile-map-header-action map-filter-toggle" aria-label={label} aria-pressed={pressed}
      aria-describedby={hint ? id : undefined} onPointerEnter={event => { if (event.pointerType === 'mouse') show() }}
      onPointerLeave={hide} onFocus={show} onBlur={hide} onClick={() => { onClick(); show() }}>{children}</button>
    {hint && <span id={id} className="map-filter-hint" role="tooltip">{label}</span>}
  </span>
}
