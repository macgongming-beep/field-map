import { supabase } from './supabase'
import { getAuthToken } from './authToken'

/**
 * Display-only place labels for assigned restaurants on 나의 봉사.
 * Carries exactly what the row and its 길찾기 button use (name/address, lat/lng for the
 * external map, cardId for the in-app map), never memos or access history.
 * These are not Buildings: never put them in the shared store or treat them as complete.
 */
export type PlaceUnitLabel = { id: number; buildingId: number; number: string }
export type PlaceLabel = {
  id: number; cardId: number; name: string; address: string; lat: number; lng: number
  units: PlaceUnitLabel[]
}

const BATCH = 100
const PAGE = 1000

async function pagedIn<T>(check: () => void, query: (batch: number[], from: number, to: number) => PromiseLike<{ data: unknown; error: unknown }>, ids: number[]) {
  const rows: T[] = []
  for (let start = 0; start < ids.length; start += BATCH) {
    const batch = ids.slice(start, start + BATCH)
    for (let from = 0; ; from += PAGE) {
      check()
      const result = await query(batch, from, from + PAGE - 1)
      check()
      if (result.error) throw result.error
      if (!Array.isArray(result.data)) throw new Error('Invalid place label response')
      rows.push(...result.data as T[])
      if (result.data.length < PAGE) break
    }
  }
  return rows
}

const isId = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) > 0
const text = (value: unknown) => typeof value === 'string' ? value : ''
const coordinate = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : 0

export async function readPlaceLabels(buildingIds: number[], unitIds: number[]): Promise<PlaceLabel[]> {
  const token = getAuthToken()
  const check = () => { if (!token || getAuthToken() !== token) throw new Error('Place label session changed') }
  check()
  const buildings = [...new Set(buildingIds)].sort((a, b) => a - b)
  const units = [...new Set(unitIds)].sort((a, b) => a - b)
  if ([...buildings, ...units].some(id => !isId(id))) throw new Error('Invalid place ids')
  if (!buildings.length) return []
  // Both reads start together; a failure surfaces only after the sibling settles.
  const results = await Promise.allSettled([
    pagedIn<Record<string, unknown>>(check, (batch, from, to) => supabase.from('buildings')
      .select('id,card_id,name,address,lat,lng').in('id', batch).order('id').range(from, to), buildings),
    units.length ? pagedIn<Record<string, unknown>>(check, (batch, from, to) => supabase.from('units')
      .select('id,building_id,number').in('id', batch).order('id').range(from, to), units) : Promise.resolve([]),
  ])
  for (const result of results) if (result.status === 'rejected') throw result.reason
  const [buildingRows, unitRows] = results.map(result => (result as PromiseFulfilledResult<Record<string, unknown>[]>).value)
  if (buildingRows.some(row => !isId(row.id) || !buildings.includes(row.id as number) || !isId(row.card_id))
    || unitRows.some(row => !isId(row.id) || !units.includes(row.id as number) || !isId(row.building_id) || !buildings.includes(row.building_id as number))) {
    throw new Error('Invalid place label row')
  }
  if (new Set(buildingRows.map(row => row.id)).size !== buildingRows.length
    || new Set(unitRows.map(row => row.id)).size !== unitRows.length) throw new Error('Duplicate place label row')
  // Missing/deleted places stay missing; never invent an empty building.
  return buildingRows.map(row => ({
    id: row.id as number, cardId: row.card_id as number, name: text(row.name), address: text(row.address),
    lat: coordinate(row.lat), lng: coordinate(row.lng),
    units: unitRows.filter(unit => unit.building_id === row.id)
      .map(unit => ({ id: unit.id as number, buildingId: unit.building_id as number, number: text(unit.number) })),
  }))
}
