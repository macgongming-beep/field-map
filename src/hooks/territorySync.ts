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
  const oneYearAgo = new Date()
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1)
  const histories = await pages<RawVisitHistory>((from, to) => supabase.from('visit_histories')
    .select(`${HISTORY_PROJECTION}, units!inner(building_id)`)
    .in('units.building_id', ids).is('invalidated_at', null)
    .gte('created_at', oneYearAgo.toISOString()).order('id').range(from, to))
  return {
    buildings: buildings.map((building) => toBuilding({ ...building, units: units.filter((u) => u.building_id === building.id) })),
    histories: histories.map(toVisitHistory),
  }
}

export async function fetchTerritorySignalIds(cardIds: number[]): Promise<number[]> {
  const rows = await pages<{ building_id: number }>((from, to) => supabase.from('territory_change_signals')
    .select('building_id').in('card_id', cardIds).order('building_id').order('card_id').range(from, to))
  return rows.map((row) => row.building_id)
}
