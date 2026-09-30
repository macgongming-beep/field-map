import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { CalendarEvent } from '../../types'
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn(), toast: vi.fn(), error: vi.fn(), log: vi.fn() }))
vi.mock('./shared', () => ({ supabase: { rpc: mocks.rpc, from: mocks.from }, showToast: mocks.toast,
  reportMutationError: mocks.error, getCurrentVisitor: () => 'A', ensureAffectedRows: vi.fn() }))
vi.mock('./serviceLog', () => ({ logServiceAction: mocks.log }))
vi.mock('../../lib/authToken', () => ({ getAuthToken: () => 'token' }))
import { makeCalendarMutations } from './calendar'
const event = { id: 1, applicants: ['A'], assignmentTeamInformal: { team: [2] },
  assignmentSharedAt: '2026-09-30T00:00:00Z' } as unknown as CalendarEvent
beforeEach(() => { vi.clearAllMocks(); vi.stubEnv('VITE_DEMO_MODE', 'true'); mocks.rpc.mockResolvedValue({ data: { ok: true }, error: null }) })
afterEach(() => vi.unstubAllEnvs())
function setup() {
  const fetchAll = vi.fn(), refresh = vi.fn()
  return { fetchAll, refresh, mutations: makeCalendarMutations({ calendarEvents: [event], fetchAll, refetchAfterParticipantRemoval: refresh }) }
}
test('team admin removal uses only atomic RPC with concurrency stamp', async () => {
  const { mutations, refresh } = setup()
  await mutations.removeParticipantFromEvent(1, 'B')
  expect(mocks.rpc).toHaveBeenCalledWith('remove_team_event_participant_tx', {
    p_token: 'token', p_event_id: 1, p_user_name: 'B', p_self: false, p_expected_shared_at: event.assignmentSharedAt,
  })
  expect(mocks.from).not.toHaveBeenCalled()
  expect(refresh).toHaveBeenCalledOnce()
})
test('self cancellation uses the same atomic path', async () => {
  const { mutations } = setup()
  await mutations.applyToEvent(1)
  expect(mocks.rpc).toHaveBeenCalledWith('remove_team_event_participant_tx', expect.objectContaining({ p_self: true, p_user_name: 'A' }))
  expect(mocks.from).not.toHaveBeenCalled()
})
test('missing RPC never falls back to partial deletes', async () => {
  mocks.rpc.mockResolvedValue({ data: null, error: { code: 'PGRST202' } })
  const { mutations, refresh } = setup()
  await mutations.removeParticipantFromEvent(1, 'B')
  expect(mocks.error).toHaveBeenCalledOnce()
  expect(mocks.from).not.toHaveBeenCalled()
  expect(refresh).not.toHaveBeenCalled()
  expect(mocks.log).not.toHaveBeenCalled()
})
test('conflict refreshes without reporting success', async () => {
  mocks.rpc.mockResolvedValue({ data: { ok: false, conflict: true }, error: null })
  const { mutations, fetchAll } = setup()
  await mutations.removeParticipantFromEvent(1, 'B')
  expect(fetchAll).toHaveBeenCalledOnce()
  expect(mocks.toast).not.toHaveBeenCalled()
  expect(mocks.log).not.toHaveBeenCalled()
})
