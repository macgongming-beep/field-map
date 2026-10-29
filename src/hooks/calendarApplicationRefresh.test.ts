import { beforeEach, expect, test, vi } from 'vitest'
const state = vi.hoisted(() => ({ single: vi.fn() }))
vi.mock('../lib/supabase', () => ({ supabase: { from: () => ({ select: () => ({ eq: () => ({ single: state.single }) }) }) } }))
import { assertUnassignedCalendarEvent } from './calendarApplicationRefresh'
const row = { id: 1, assignment_shared_at: null, assignment_team_informal: null, assignment_team_scopes: {} }
beforeEach(() => state.single.mockResolvedValue({ data: row, error: null }))
test('only a confirmed unassigned event can use narrow cancellation refresh', async () => {
  await expect(assertUnassignedCalendarEvent(1)).resolves.toBeUndefined()
})
test.each([null, { ...row, id: 2 }, { ...row, assignment_shared_at: '2026-10-30T01:00:00Z' },
  { ...row, assignment_team_informal: {} }, { ...row, assignment_team_scopes: { team: '전체' } },
  { ...row, assignment_team_scopes: null }])('rejects uncertain or previously shared state %j', async data => {
  state.single.mockResolvedValue({ data, error: null })
  await expect(assertUnassignedCalendarEvent(1)).rejects.toThrow()
})
test('server failure cannot be treated as safe cancellation', async () => {
  state.single.mockResolvedValue({ data: row, error: new Error('offline') })
  await expect(assertUnassignedCalendarEvent(1)).rejects.toThrow('offline')
})
