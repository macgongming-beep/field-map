import { useEffect, useRef } from 'react'

// For private RPC-only data: no broad table grants just to enable subscriptions.
export function useVisibleRefresh(enabled: boolean, refresh: () => Promise<unknown>, intervalMs = 60_000) {
  const callback = useRef(refresh)
  useEffect(() => { callback.current = refresh }, [refresh])
  useEffect(() => {
    if (!enabled) return
    let last = Date.now()
    let pending = false
    const run = () => {
      if (document.hidden || pending || Date.now() - last < intervalMs) return
      last = Date.now()
      pending = true
      void callback.current().catch(() => {}).finally(() => { pending = false })
    }
    const timer = window.setInterval(run, intervalMs)
    window.addEventListener('focus', run)
    document.addEventListener('visibilitychange', run)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', run)
      document.removeEventListener('visibilitychange', run)
    }
  }, [enabled, intervalMs])
}
