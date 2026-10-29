import { beforeEach, expect, test, vi } from 'vitest'
import { readCalendarParticipants } from './calendarParticipants'

const state = vi.hoisted(() => ({ rows: [] as unknown[], error: null as unknown, batches: [] as number[][], columns: [] as string[] }))
vi.mock('../lib/supabase', () => ({ supabase: { from: () => {
  const q = {
    select: (columns: string) => { state.columns.push(columns); return q },
    in: (_key: string, ids: number[]) => { state.batches.push(ids); return q },
    order: () => q,
    range: () => Promise.resolve({ data: state.rows, error: state.error }),
  }
  return q
} } }))
beforeEach(() => { state.rows = []; state.error = null; state.batches = []; state.columns = [] })
test('membership projection preserves applicants, assigned members and guests only', async () => {
  state.rows = [{ id: 7, event_participants: [{ user_name: 'A', role: '입명' }, { user_name: 'B', role: '게스트' }, { user_name: 'C', role: '신청' }] }]
  expect((await readCalendarParticipants([7, 7])).get(7)).toEqual({ applicants: ['A', 'B', 'C'], assigned: ['A'], guests: ['B'] })
  expect(state.batches).toEqual([[7]])
  expect(state.columns).toEqual(['id,event_participants(user_name,role)'])
})
test.each([
  [{ id: 8, event_participants: [] }],
  [{ id: 7, event_participants: null }],
  [{ id: 7, event_participants: [{ user_name: 'A' }] }],
])('rejects foreign or malformed membership: %j', async rows => {
  state.rows = rows
  await expect(readCalendarParticipants([7])).rejects.toThrow('Invalid calendar participants response')
})
test('empty input makes no request; large input is bounded; errors stay errors', async () => {
  expect((await readCalendarParticipants([])).size).toBe(0)
  expect(state.batches).toEqual([])
  await readCalendarParticipants(Array.from({ length: 201 }, (_, i) => i + 1))
  expect(state.batches.map(batch => batch.length)).toEqual([100, 100, 1])
  state.error = new Error('offline')
  await expect(readCalendarParticipants([7])).rejects.toThrow('offline')
  await expect(readCalendarParticipants([NaN])).rejects.toThrow('Invalid participant event id')
})
