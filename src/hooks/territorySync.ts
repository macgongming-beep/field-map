import { supabase } from '../lib/supabase'
import { toBuilding, toVisitHistory, type RawBuilding, type RawUnit, type RawVisitHistory } from './storeTransforms'

export const BUILDING_PROJECTION = 'id, card_id, name, address, type, lat, lng, warning, access_status, memo, is_restaurant, units_surveyed, building_access_events(id, action, visitor_name, visited_at, time_slot, memo, created_at)'
const UNIT_PROJECTION = 'id, building_id, number, status, is_chinese, is_restaurant, usage_type, memo, regular_visits(visitor_name, registered_at)'
const HISTORY_PROJECTION = 'id, unit_id, visitor_name, result, time_slot, memo, visited_at, service_session_id, special_period_id, invitation_left, created_at, created_by_user_id'

async function pages<T>(query: (from: number, to: number) => PromiseLike<{ data: unknown; error: unknown }>): Promise<T[]> {
  const rows: T[] = []
  for (let from = 0; ; from += 1000) {
    const result = await query(from, from + 999)
    if (result.error) throw result.error
    const page = (result.data ?? []) as T[]
    rows.push(...page)
    if (page.length < 1000) return rows
  }
}

// Only the affected buildings, including empty ones; never reload all territory data.
export async function fetchChangedBuildings(ids: number[]) {
  const buildings = await pages<RawBuilding>((from, to) => supabase.from('buildings')
    .select(BUILDING_PROJECTION).in('id', ids).order('id').range(from, to))
  const units = await pages<RawUnit>((from, to) => supabase.from('units')
    .select(UNIT_PROJECTION).in('building_id', ids).order('id').range(from, to))
  const oneYearAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000)
  const histories = await pages<RawVisitHistory>((from, to) => supabase.from('visit_histories')
    .select(`${HISTORY_PROJECTION}, units!inner(building_id)`)
    .in('units.building_id', ids).is('invalidated_at', null)
    .gte('created_at', oneYearAgo.toISOString()).order('id').range(from, to))
  return {
    buildings: buildings.map((building) => toBuilding({ ...building, units: units.filter((u) => u.building_id === building.id) })),
    histories: histories.map(toVisitHistory),
  }
}

export type TerritorySignal = { building_id: number; card_id: number; revision: number | string; changed_at: string }

export async function fetchTerritoryClock(): Promise<string> {
  const { data, error } = await supabase.rpc('territory_sync_clock')
  if (error) throw error
  if (typeof data !== 'string' || !Number.isFinite(Date.parse(data))) throw new Error('Invalid territory clock')
  return data
}

export async function fetchTerritorySignals(cardIds: number[], since: string): Promise<TerritorySignal[]> {
  if (!Number.isFinite(Date.parse(since))) throw new Error('A recovery watermark is required')
  return pages<TerritorySignal>((from, to) => supabase.from('territory_change_signals')
    .select('building_id,card_id,revision,changed_at').in('card_id', cardIds)
    .gte('changed_at', since).order('building_id').order('card_id').range(from, to))
}

// Recovery covers the store, not only cards currently visible on a map. New cards
// and deletions must be found even when their former card is no longer displayed.
export async function fetchBuildingRecoveryIndex(since: string) {
  if (!Number.isFinite(Date.parse(since))) throw new Error('A recovery watermark is required')
  const signals = await pages<TerritorySignal>((from, to) => supabase.from('territory_change_signals')
    .select('building_id,card_id,revision,changed_at').gte('changed_at', since)
    .order('building_id').order('card_id').range(from, to))
  const buildings = await pages<{ id: number }>((from, to) => supabase.from('buildings')
    .select('id').order('id').range(from, to))
  return { signals, ids: buildings.map((b) => b.id) }
}
