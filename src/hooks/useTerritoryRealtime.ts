import { useContext, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { TerritoryRealtimeContext } from './territoryRealtimeContext'
import { fetchTerritoryClock, fetchTerritorySignals, type TerritorySignal } from './territorySync'

const signalKey = (row: TerritorySignal) => `${row.card_id}:${row.building_id}`
const signalVersion = (row: TerritorySignal) => `${row.revision}:${row.changed_at}`

/** One channel per visible map; no polling, and no background downloads. */
export function useTerritoryRealtime(cardIds: number[]) {
  const context = useContext(TerritoryRealtimeContext)
  const syncRef = useRef(context?.sync)
  useEffect(() => { syncRef.current = context?.sync }, [context])
  const checkpoint = context?.checkpoint
  const [visible, setVisible] = useState(!document.hidden)
  useEffect(() => {
    const change = () => setVisible(!document.hidden)
    document.addEventListener('visibilitychange', change)
    return () => document.removeEventListener('visibilitychange', change)
  }, [])
  const key = [...new Set(cardIds.filter((id) => Number.isInteger(id) && id > 0))].sort((a, b) => a - b).join(',')
  const enabled = Boolean(context) && import.meta.env.VITE_TERRITORY_REALTIME_ENABLED === 'true'
  useEffect(() => {
    if (!enabled || !visible || !key || !checkpoint) return
    const ids = key.split(',').map(Number)
    const allowed = new Set(ids)
    const pending = new Map<string, TerritorySignal>()
    let stopped = false
    let running = false
    let retries = 0
    let timer: ReturnType<typeof setTimeout> | undefined
    let recoveryTimer: ReturnType<typeof setTimeout> | undefined
    let recovering = false
    let recoveredThrough: string | null = null
    const commitCheckpoint = () => {
      if (stopped || pending.size || running || !recoveredThrough) return
      for (const id of ids) checkpoint.cards.set(id, recoveredThrough)
      recoveredThrough = null
    }
    const schedule = (delay = 350) => {
      if (!stopped && !timer && !running) timer = setTimeout(() => { timer = undefined; void flush() }, delay)
    }
    const flush = async () => {
      if (stopped || running || !pending.size) return
      const batch = [...new Set([...pending.values()].map((row) => row.building_id))].slice(0, 20)
      const rows = [...pending.values()].filter((row) => batch.includes(row.building_id))
      rows.forEach((row) => pending.delete(signalKey(row)))
      running = true
      try {
        await syncRef.current?.(batch)
        if (!stopped) rows.forEach((row) => checkpoint.applied.set(signalKey(row), signalVersion(row)))
        retries = 0
      } catch (error) {
        rows.forEach((row) => { if (!pending.has(signalKey(row))) pending.set(signalKey(row), row) })
        retries++
        console.warn('[territory realtime] sync failed:', error)
      } finally {
        running = false
        if (pending.size && retries < 3) schedule(retries ? 2000 : 350)
        commitCheckpoint()
      }
    }
    const queue = (payload: { new: unknown }) => {
      const row = payload.new as TerritorySignal
      if (!allowed.has(Number(row.card_id)) || !Number.isInteger(row.building_id) || Number(row.building_id) <= 0) return
      if (checkpoint.applied.get(signalKey(row)) === signalVersion(row)) return
      pending.set(signalKey(row), row)
      retries = 0
      schedule()
    }
    const recover = async (attempt = 0) => {
      if (recovering || stopped) return
      recovering = true
      try {
        if (!checkpoint.baseline) throw new Error('Territory snapshot has no server watermark')
        const through = await fetchTerritoryClock()
        // Foreground/full recovery may already be downloading these buildings.
        // Wait for it and use its newer baseline instead of duplicating that read.
        await checkpoint.snapshot
        if (stopped) return
        // Use the read START as a watermark. Overlap catches transactions near the boundary;
        // revision dedup prevents that overlap from downloading the same buildings repeatedly.
        for (let offset = 0; offset < ids.length && !stopped; offset += 100) {
          const chunk = ids.slice(offset, offset + 100)
          const from = (id: number) => Math.max(Date.parse(checkpoint.baseline!), Date.parse(checkpoint.cards.get(id) ?? checkpoint.baseline!)) - 30_000
          const since = new Date(Math.min(...chunk.map(from))).toISOString()
          const changed = await fetchTerritorySignals(chunk, since)
          if (stopped) return
          changed.filter((row) => Date.parse(row.changed_at) >= from(row.card_id)).forEach((row) => queue({ new: row }))
        }
        if (stopped) return
        recoveredThrough = through
        retries = 0
        schedule()
        commitCheckpoint()
      } catch (error) {
        console.warn('[territory realtime] recovery failed:', error)
        if (!stopped && attempt < 2) recoveryTimer = setTimeout(() => { void recover(attempt + 1) }, 2000)
      } finally {
        recovering = false
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
  }, [key, enabled, visible, checkpoint])
}
