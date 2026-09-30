import { useContext, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { TerritoryRealtimeContext } from './territoryRealtimeContext'
import { fetchTerritorySignalIds } from './territorySync'

/** One channel per visible map; no polling, and no background downloads. */
export function useTerritoryRealtime(cardIds: number[]) {
  const sync = useContext(TerritoryRealtimeContext)
  const syncRef = useRef(sync)
  useEffect(() => { syncRef.current = sync }, [sync])
  const [visible, setVisible] = useState(!document.hidden)
  useEffect(() => {
    const change = () => setVisible(!document.hidden)
    document.addEventListener('visibilitychange', change)
    return () => document.removeEventListener('visibilitychange', change)
  }, [])
  const key = [...new Set(cardIds.filter((id) => Number.isInteger(id) && id > 0))].sort((a, b) => a - b).join(',')
  const enabled = Boolean(sync) && import.meta.env.VITE_TERRITORY_REALTIME_ENABLED === 'true'
  useEffect(() => {
    if (!enabled || !visible || !key) return
    const ids = key.split(',').map(Number)
    const allowed = new Set(ids)
    const pending = new Set<number>()
    let stopped = false
    let running = false
    let retries = 0
    let timer: ReturnType<typeof setTimeout> | undefined
    let recoveryTimer: ReturnType<typeof setTimeout> | undefined
    const schedule = (delay = 350) => {
      if (!stopped && !timer && !running) timer = setTimeout(() => { timer = undefined; void flush() }, delay)
    }
    const flush = async () => {
      if (stopped || running || !pending.size) return
      const batch = [...pending].slice(0, 20)
      batch.forEach((id) => pending.delete(id))
      running = true
      try {
        await syncRef.current?.(batch)
        retries = 0
      } catch (error) {
        batch.forEach((id) => pending.add(id))
        retries++
        console.warn('[territory realtime] sync failed:', error)
      } finally {
        running = false
        if (pending.size && retries < 3) schedule(retries ? 2000 : 350)
      }
    }
    const queue = (payload: { new: unknown }) => {
      const row = payload.new as { building_id?: number; card_id?: number }
      if (!allowed.has(Number(row.card_id)) || !Number.isInteger(row.building_id) || Number(row.building_id) <= 0) return
      pending.add(Number(row.building_id))
      retries = 0
      schedule()
    }
    const recover = async (attempt = 0) => {
      try {
        // Snapshot AFTER subscribing closes the initial-load/reconnect gap.
        for (let offset = 0; offset < ids.length && !stopped; offset += 100) {
          const changed = await fetchTerritorySignalIds(ids.slice(offset, offset + 100))
          if (stopped) return
          changed.forEach((id) => pending.add(id))
        }
        retries = 0
        schedule()
      } catch (error) {
        console.warn('[territory realtime] recovery failed:', error)
        if (!stopped && attempt < 2) recoveryTimer = setTimeout(() => { void recover(attempt + 1) }, 2000)
      }
    }
    const channel = supabase.channel(`territory_sync:${crypto.randomUUID()}`)
    // Postgres IN subscriptions accept at most 100 values per filter.
    for (let offset = 0; offset < ids.length; offset += 100) {
      const filter = `card_id=in.(${ids.slice(offset, offset + 100).join(',')})`
      for (const event of ['INSERT', 'UPDATE'] as const) {
        channel.on('postgres_changes', { event, schema: 'public', table: 'territory_change_signals', filter }, queue)
      }
    }
    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        if (recoveryTimer) clearTimeout(recoveryTimer)
        void recover()
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        console.warn('[territory realtime] channel:', status)
      }
    })
    return () => {
      stopped = true
      if (timer) clearTimeout(timer)
      if (recoveryTimer) clearTimeout(recoveryTimer)
      void supabase.removeChannel(channel)
    }
  }, [key, enabled, visible])
}
