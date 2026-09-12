import { useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { subscribeWithRecovery } from '../lib/realtimeRecovery'

type RawUnitCreationSignal = {
  unit_id: number
}

/** 여러 호수를 일괄 추가할 때 신호를 모아 한 번만 조회한다. */
export function useUnitCreationRealtime(
  onCreate: (unitIds: number[]) => void,
  options?: { enabled?: boolean; onRecover?: () => void; debounceMs?: number },
) {
  const enabled = options?.enabled !== false
  const callbackRef = useRef(onCreate)
  const recoverRef = useRef(options?.onRecover)
  const channelIdRef = useRef<string | null>(null)

  useEffect(() => {
    callbackRef.current = onCreate
    recoverRef.current = options?.onRecover
  }, [onCreate, options?.onRecover])

  useEffect(() => {
    if (!enabled) return
    if (channelIdRef.current === null) {
      channelIdRef.current = typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`
    }

    const pending = new Set<number>()
    let timer: ReturnType<typeof setTimeout> | null = null
    const flush = () => {
      timer = null
      if (pending.size === 0) return
      const ids = Array.from(pending)
      pending.clear()
      callbackRef.current(ids)
    }
    const queue = (payload: { new: unknown }) => {
      const unitId = Number((payload.new as RawUnitCreationSignal).unit_id)
      if (Number.isFinite(unitId)) pending.add(unitId)
      if (timer) clearTimeout(timer)
      timer = setTimeout(flush, options?.debounceMs ?? 250)
    }

    const channel = supabase
      .channel(`unit_creation_sync:${channelIdRef.current}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'unit_creation_signals' }, queue)

    subscribeWithRecovery(channel, () => recoverRef.current?.())
    return () => {
      if (timer) clearTimeout(timer)
      void supabase.removeChannel(channel)
    }
  }, [enabled, options?.debounceMs])
}
