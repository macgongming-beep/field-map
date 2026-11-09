import { beforeEach, expect, test, vi } from 'vitest'
import { fetchBuildingRecoveryIndex, fetchBuildingSignalProof, fetchChangedBuildings, fetchTerritorySignals } from './territorySync'
const mock = vi.hoisted(() => ({ calls: [] as unknown[][], units: [] as unknown[], signals: [] as unknown[], signalError: false }))
vi.mock('../lib/supabase', () => ({ supabase: { from: (table: string) => {
  const q: Record<string, unknown> = {}
  let start = 0
  for (const key of ['select', 'in', 'order', 'is', 'gte']) q[key] = (...args: unknown[]) => { mock.calls.push([table, key, ...args]); return q }
  q.range = (from: number) => { start = from; mock.calls.push([table, 'range', from]); return q }
  q.then = (resolve: (r: unknown) => void) => Promise.resolve({ error: table === 'territory_change_signals' && mock.signalError ? new Error('offline') : null, data: table === 'buildings'
    ? [{ id: 7, card_id: 1, name: 'test', address: '', type: '주택', lat: 37, lng: 127, warning: false, memo: null }]
    : table === 'units' ? mock.units.slice(start, start + 1000) : table === 'territory_change_signals' ? mock.signals.slice(start, start + 1000) : [] }).then(resolve)
  return q
} } }))
beforeEach(() => { mock.calls.length = 0; mock.units = []; mock.signals = []; mock.signalError = false })
const proofRow = { building_id: 7, card_id: 1, revision: '12345678901234567890', changed_at: '2026-11-09T10:00:00Z' }
test('proof reads only requested building signals, paginates and preserves exact revision strings', async () => {
  mock.signals = Array.from({ length: 1001 }, (_, i) => ({ ...proofRow, card_id: i + 1 }))
  const rows = await fetchBuildingSignalProof([7])
  expect(rows).toHaveLength(1001)
  expect(rows[0]).toEqual(proofRow)
  expect(mock.calls).toContainEqual(['territory_change_signals', 'select', 'building_id,card_id,revision,changed_at'])
  expect(mock.calls).toContainEqual(['territory_change_signals', 'in', 'building_id', [7]])
  expect(mock.calls).toContainEqual(['territory_change_signals', 'range', 1000])
})
test.each([{ building_id: 8 }, { card_id: 0 }, { revision: 'bad' }, { revision: Number.MAX_SAFE_INTEGER + 1 }, { changed_at: 'bad' }])('rejects invalid signal proof %j', async patch => {
  mock.signals = [{ ...proofRow, ...patch }]
  await expect(fetchBuildingSignalProof([7])).rejects.toThrow('Invalid')
})
test('rejects duplicate proof rows and server errors; empty proof remains unproven', async () => {
  mock.signals = [proofRow, proofRow]
  await expect(fetchBuildingSignalProof([7])).rejects.toThrow('Invalid')
  mock.signalError = true
  await expect(fetchBuildingSignalProof([7])).rejects.toThrow('offline')
  mock.signalError = false; mock.signals = []
  expect(await fetchBuildingSignalProof([7])).toEqual([])
})
test('store recovery reads IDs only and time-filtered signals without a visible-card restriction', async () => {
  await fetchBuildingRecoveryIndex('2026-09-30T12:00:00Z')
  expect(mock.calls).toContainEqual(['buildings', 'select', 'id'])
  expect(mock.calls).toContainEqual(['territory_change_signals', 'gte', 'changed_at', '2026-09-30T12:00:00Z'])
  expect(mock.calls.some(([table, op]) => table === 'territory_change_signals' && op === 'in')).toBe(false)
})
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
  const projection = mock.calls.find(([table, op]) => table === 'visit_histories' && op === 'select')?.[2] as string
  expect(projection.split(', ')).toContain('visit_type')
})
test('does not silently truncate large buildings at the PostgREST row limit', async () => {
  mock.units = Array.from({ length: 1001 }, (_, id) => ({ id: id + 1, building_id: 7, number: String(id + 1), status: '미방문', is_chinese: false, memo: null, regular_visits: [] }))
  const data = await fetchChangedBuildings([7])
  expect(data.buildings[0].units).toHaveLength(1001)
  expect(mock.calls).toContainEqual(['units', 'range', 1000])
})
