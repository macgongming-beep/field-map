import { afterEach, beforeEach, expect, test, vi } from 'vitest'
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
afterEach(()=>vi.unstubAllEnvs())
test('demo participant-only recovery preserves return visit type and rejects unknown values',async()=>{
  vi.stubEnv('VITE_DEMO_MODE','true');vi.stubEnv('VITE_GROUP_SERVICE_ENABLED','true');vi.stubEnv('VITE_SUPABASE_URL','https://itjlykpjmlcvanqpmkmc.supabase.co')
  state.rows=[{id:7,assignment_revision:12,event_participants:[{id:1,user_name:'A',role:'신청',service_activity:'return_visit'}]}]
  expect((await readCalendarParticipants([7])).get(7)).toMatchObject({applicants:['A'],returnVisitApplicants:['A'],assignmentRevision:'12'})
  expect(state.columns).toEqual(['id,assignment_revision,event_participants(user_name,role,service_activity)'])
  state.rows=[{id:7,event_participants:[{id:1,user_name:'A',role:'신청',service_activity:'invalid'}]}]
  await expect(readCalendarParticipants([7])).rejects.toThrow('Invalid calendar participants response')
})
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

test('proof IDs are opt-in and are published only after a valid complete read', async () => {
  const callback = vi.fn()
  state.rows = [{ id: 7, event_participants: [{ id: 20, user_name: 'A', role: '신청' }] }]
  await readCalendarParticipants([7], callback)
  expect(state.columns).toEqual(['id,event_participants(id,user_name,role)'])
  expect(callback).toHaveBeenCalledWith(new Map([[7, [{ id: 20, user_name: 'A', role: '신청' }]]]))
  callback.mockClear()
  state.rows = [{ id: 7, event_participants: [{ user_name: 'A', role: '신청' }] }]
  await expect(readCalendarParticipants([7], callback)).rejects.toThrow('Invalid participant proof rows')
  expect(callback).not.toHaveBeenCalled()
})
