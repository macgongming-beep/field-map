import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { readScopedVisitHistories, scopedVisitHistoryEnabled, VISIT_HISTORY_COLUMNS } from './scopedVisitHistory'

const state = vi.hoisted(() => ({ calls: [] as { ids: number[]; from: number; columns: string; since: string; nullFilter: string }[], query: vi.fn() }))
vi.mock('../lib/supabase', () => ({ supabase: { from: (table: string) => {
  expect(table).toBe('visit_histories')
  const call = { ids: [] as number[], from: 0, columns: '', since: '', nullFilter: '' }
  const q = {
    select: (columns: string) => { call.columns = columns; return q },
    in: (key: string, ids: number[]) => { expect(key).toBe('unit_id'); call.ids = ids; return q },
    is: (key: string, value: null) => { expect(value).toBeNull(); call.nullFilter = key; return q },
    gte: (key: string, value: string) => { expect(key).toBe('created_at'); call.since = value; return q },
    order: () => q,
    range: (from: number) => { call.from = from; state.calls.push(call); return state.query(call) },
  }
  return q
} } }))
const since = '2025-10-26T00:00:00Z'
beforeEach(() => { state.calls = []; state.query.mockReset().mockResolvedValue({ data: [], error: null }) })
afterEach(() => vi.unstubAllEnvs())

test('only opted-in recipient users narrow histories; statistics and privileged stores stay complete', () => {
  vi.stubEnv('VITE_DEMO_MODE', 'true')
  expect(scopedVisitHistoryEnabled('user', true)).toBe(true)
  for (const role of ['leader', 'admin', 'developer']) expect(scopedVisitHistoryEnabled(role, true)).toBe(false)
  expect(scopedVisitHistoryEnabled('user', false)).toBe(false)
  vi.stubEnv('VITE_SCOPED_VISIT_HISTORY_ENABLED', 'false')
  expect(scopedVisitHistoryEnabled('user', true)).toBe(false)
  vi.stubEnv('VITE_DEMO_MODE', 'false')
  vi.stubEnv('VITE_SCOPED_VISIT_HISTORY_ENABLED', undefined)
  expect(scopedVisitHistoryEnabled('user', true)).toBe(false)
  vi.stubEnv('VITE_SCOPED_VISIT_HISTORY_ENABLED', 'true')
  expect(scopedVisitHistoryEnabled('user', true)).toBe(true)
})
test('empty scope never issues an unfiltered query', async () => {
  expect(await readScopedVisitHistories([], since)).toEqual([])
  expect(state.calls).toEqual([])
})
test('all pages/batches retain other visitors and the full annual projection', async () => {
  state.query.mockImplementation(({ ids, from }) => ({ data: ids[0] === 1
    ? from === 0 ? Array.from({ length: 1000 }, (_, id) => ({ id: id + 1, unit_id: 1, visitor_name: 'Other', created_at: '2026-10-01' }))
      : [{ id: 1001, unit_id: 1, visitor_name: 'Me', created_at: '2026-10-02' }]
    : [{ id: 1002, unit_id: 101, visitor_name: 'Other', created_at: '2026-10-03' }], error: null }))
  const rows = await readScopedVisitHistories(Array.from({ length: 101 }, (_, i) => i + 1), since)
  expect(rows).toHaveLength(1002)
  expect(rows[0].id).toBe(1002)
  expect(rows.some(row => row.visitor_name === 'Other')).toBe(true)
  expect(state.calls.map(c => [c.ids.length, c.from])).toEqual([[100, 0], [100, 1000], [1, 0]])
  for (const call of state.calls) expect(call).toMatchObject({ since, columns: VISIT_HISTORY_COLUMNS, nullFilter: 'invalidated_at' })
})
test('foreign and duplicate rows are rejected, not silently published', async () => {
  state.query.mockResolvedValueOnce({ data: [{ id: 1, unit_id: 999 }], error: null })
  await expect(readScopedVisitHistories([1], since)).rejects.toThrow('Invalid scoped')
  state.query.mockResolvedValueOnce({ data: [{ id: 1, unit_id: 1 }, { id: 1, unit_id: 1 }], error: null })
  await expect(readScopedVisitHistories([1], since)).rejects.toThrow('Duplicate')
})
test('second page failure does not return a partial snapshot', async () => {
  state.query.mockResolvedValueOnce({ data: Array.from({ length: 1000 }, (_, id) => ({ id: id + 1, unit_id: 1 })), error: null })
    .mockResolvedValueOnce({ data: null, error: new Error('offline') })
  await expect(readScopedVisitHistories([1], since)).rejects.toThrow('offline')
})
