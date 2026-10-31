import { useEffect, useState } from 'react'
import { geocodeQuery, isNaverMapsReady } from '../lib/naverGeocode'
import type { GeoPoint } from '../types'

type PinState = { address: string; status: 'idle' | 'loading' | 'ready' | 'error'; point: GeoPoint | null }

export function useAddressMapPin(value: string | null) {
  const address = value?.trim() ?? ''
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<PinState>({ address: '', status: 'idle', point: null })
  if (state.address !== address) {
    setState({ address, status: address ? 'loading' : 'idle', point: null })
  }
  useEffect(() => {
    if (!address) return
    let active = true
    let waiting: ReturnType<typeof setTimeout> | undefined
    const fail = () => {
      if (!active) return
      active = false
      clearTimeout(waiting)
      setState({ address, status: 'error', point: null })
    }
    // A missing SDK or callback must not leave the map searching indefinitely.
    const deadline = setTimeout(fail, 15_000)
    const search = async () => {
      if (!active) return
      if (!isNaverMapsReady()) {
        waiting = setTimeout(() => { void search() }, 250)
        return
      }
      try {
        // Do not fall back to a bare road name: it can resolve in another city.
        const point = await geocodeQuery(address)
        if (!active) return
        if (point) {
          active = false
          clearTimeout(deadline)
          setState({ address, status: 'ready', point })
          return
        }
      } catch { /* Show the same retryable state for SDK failures. */ }
      clearTimeout(deadline)
      fail()
    }
    void search()
    return () => { active = false; clearTimeout(waiting); clearTimeout(deadline) }
  }, [address, attempt])
  // Never display the previous address's pin while the next effect is pending.
  const current: PinState = !address ? { address, status: 'idle', point: null }
    : state.address === address ? state : { address, status: 'loading', point: null }
  return { ...current, retry: () => {
    setState({ address, status: 'loading', point: null })
    setAttempt(n => n + 1)
  } }
}
