import { supabase } from '../lib/supabase'
import { fetchTerritoryClock, fetchTerritorySignals } from './territorySync'
import type { TerritoryRealtime } from './territoryRealtimeContext'
import { toCardBoundary, type RawCardBoundary } from './storeTransforms'
import type { CardBoundary } from '../types'

/** Scoped ID reconciliation must never interpret every unloaded building as new. */
export async function recoverRecipientBuildings(
  cardIds: number[], currentIds: number[], checkpoint: TerritoryRealtime['checkpoint'], sync: TerritoryRealtime['sync'],
) {
  if (!checkpoint.baseline) throw new Error('Missing recipient watermark')
  const through = await fetchTerritoryClock()
  const since = new Date(Math.max(Date.parse(checkpoint.baseline), Date.parse(checkpoint.buildingsThrough ?? checkpoint.baseline)) - 30_000).toISOString()
  const existing = new Set<number>()
  const signals: Awaited<ReturnType<typeof fetchTerritorySignals>> = []
  for (let start = 0; start < cardIds.length; start += 100) {
    const batch = cardIds.slice(start, start + 100)
    const readIndex = async () => {
      for (let offset = 0; ; offset += 1000) {
        const { data, error } = await supabase.from('buildings').select('id,card_id').in('card_id', batch).order('id').range(offset, offset + 999)
        if (error) throw error
        if (!Array.isArray(data) || data.some((row) => !batch.includes(row.card_id))) throw new Error('Invalid scoped building index')
        data.forEach((row) => existing.add(row.id))
        if (data.length < 1000) break
      }
    }
    // Neither index depends on the other. Drain both before retry/fallback can start.
    const results = await Promise.allSettled([fetchTerritorySignals(batch, since), readIndex()])
    for (const result of results) if (result.status === 'rejected') throw result.reason
    if (results[0].status === 'fulfilled') signals.push(...results[0].value)
  }
  if (signals.some((row) => !cardIds.includes(row.card_id))) throw new Error('Invalid scoped signals')
  const known = new Set(currentIds)
  const changed = signals.filter((row) => checkpoint.applied.get(`${row.card_id}:${row.building_id}`) !== `${row.revision}:${row.changed_at}`)
  const ids = [...new Set([...changed.map((row) => row.building_id), ...[...existing].filter((id) => !known.has(id)), ...currentIds.filter((id) => !existing.has(id))])]
  for (let start = 0; start < ids.length; start += 20) await sync(ids.slice(start, start + 20))
  changed.forEach((row) => checkpoint.applied.set(`${row.card_id}:${row.building_id}`, `${row.revision}:${row.changed_at}`))
  checkpoint.buildingsThrough = through
}

export async function readRecipientBoundaries(cardIds: number[]): Promise<CardBoundary[]> {
  const rows: CardBoundary[] = []
  for (let start = 0; start < cardIds.length; start += 100) {
    const batch = cardIds.slice(start, start + 100)
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await supabase.from('card_boundaries').select('card_id,points,updated_at').in('card_id', batch).order('card_id').range(offset, offset + 999)
      if (error) throw error
      if (!Array.isArray(data) || data.some((row) => !batch.includes(row.card_id))) throw new Error('Invalid scoped boundaries')
      data.forEach((raw) => { const row = toCardBoundary(raw as RawCardBoundary); if (row) rows.push(row) })
      if (data.length < 1000) break
    }
  }
  return rows
}
