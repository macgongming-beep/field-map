import { beforeEach, expect, test, vi } from 'vitest'
import { fetchChangedBuildings, fetchTerritorySignals } from './territorySync'
const mock = vi.hoisted(() => ({ calls: [] as unknown[][], units: [] as unknown[] }))
vi.mock('../lib/supabase', () => ({ supabase: { from: (table: string) => {
  const q: Record<string, unknown> = {}
  let start = 0
  for (const key of ['select', 'in', 'order', 'is', 'gte']) q[key] = (...args: unknown[]) => { mock.calls.push([table, key, ...args]); return q }
  q.range = (from: number) => { start = from; mock.calls.push([table, 'range', from]); return q }
  q.then = (resolve: (r: unknown) => void) => Promise.resolve({ error: null, data: table === 'buildings'
    ? [{ id: 7, card_id: 1, name: 'test', address: '', type: '주택', lat: 37, lng: 127, warning: false, memo: null }]
    : table === 'units' ? mock.units.slice(start, start + 1000) : [] }).then(resolve)
  return q
} } }))
beforeEach(() => { mock.calls.length = 0; mock.units = [] })
test('recovery query always restricts both cards and server timestamp', async () => {
  await fetchTerritorySignals([1, 2], '2026-09-30T12:00:00Z')
  expect(mock.calls).toContainEqual(['territory_change_signals', 'in', 'card_id', [1, 2]])
  expect(mock.calls).toContainEqual(['territory_change_signals', 'gte', 'changed_at', '2026-09-30T12:00:00Z'])
  await expect(fetchTerritorySignals([1], '')).rejects.toThrow('watermark')
})
test('fetches only requested buildings/units/history and includes an empty building', async () => {
  const data = await fetchChangedBuildings([7])
  expect(data.buildings[0].units).toEqual([])
  expect(mock.calls).toContainEqual(['buildings', 'in', 'id', [7]])
  expect(mock.calls).toContainEqual(['units', 'in', 'building_id', [7]])
  expect(mock.calls).toContainEqual(['visit_histories', 'in', 'units.building_id', [7]])
  expect(mock.calls).toContainEqual(['visit_histories', 'is', 'invalidated_at', null])
})
test('does not silently truncate large buildings at the PostgREST row limit', async () => {
  mock.units = Array.from({ length: 1001 }, (_, id) => ({ id: id + 1, building_id: 7, number: String(id + 1), status: '미방문', is_chinese: false, memo: null, regular_visits: [] }))
  const data = await fetchChangedBuildings([7])
  expect(data.buildings[0].units).toHaveLength(1001)
  expect(mock.calls).toContainEqual(['units', 'range', 1000])
})
