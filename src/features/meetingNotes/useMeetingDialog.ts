import { useEffect, useRef } from 'react'

export function useMeetingDialog(active: boolean, onClose: () => void) {
  const ref = useRef<HTMLElement>(null)
  const close = useRef(onClose)
  useEffect(() => { close.current = onClose }, [onClose])
  useEffect(() => {
    const dialog = ref.current
    if (!active || !dialog) return
    const previousFocus = document.activeElement as HTMLElement | null
    const previousOverflow = document.documentElement.style.overflow
    document.documentElement.style.overflow = 'hidden'
    const listener = (event: KeyboardEvent) => {
      if (dialog.parentElement?.lastElementChild !== dialog) return
      if (event.key === 'Escape') { event.preventDefault(); close.current(); return }
      if (event.key !== 'Tab') return
      const items = [...dialog.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), summary, [tabindex="0"]')].filter(el => el.getClientRects().length > 0)
      const first = items[0], last = items.at(-1)
      if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) { event.preventDefault(); first?.focus() }
    }
    document.addEventListener('keydown', listener)
    return () => { document.removeEventListener('keydown', listener); document.documentElement.style.overflow = previousOverflow; previousFocus?.focus?.() }
  }, [active])
  return ref
}
