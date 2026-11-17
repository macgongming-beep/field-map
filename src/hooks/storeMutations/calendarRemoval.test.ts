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

test('versioned self cancellation does not require a loaded revision', async () => {
  vi.stubEnv('VITE_SUPABASE_URL','https://itjlykpjmlcvanqpmkmc.supabase.co')
  vi.stubEnv('VITE_GROUP_SERVICE_ENABLED','true')
  const {mutations}=setup()
  await mutations.applyToEvent(1)
  expect(mocks.rpc).toHaveBeenCalledWith('manage_event_participant_versioned_tx',expect.objectContaining({p_action:'remove',p_user_name:'A',p_expected_revision:null}))
  expect(mocks.from).not.toHaveBeenCalled()
})
test('other participant removal requires revision and conflicts refresh only the event', async () => {
  vi.stubEnv('VITE_SUPABASE_URL','https://itjlykpjmlcvanqpmkmc.supabase.co')
  vi.stubEnv('VITE_GROUP_SERVICE_ENABLED','true')
  await setup().mutations.removeParticipantFromEvent(1,'B')
  expect(mocks.rpc).not.toHaveBeenCalled()
  const refreshUpdatedEvent=vi.fn(),fetchAll=vi.fn()
  mocks.rpc.mockResolvedValue({data:{ok:false,conflict:true},error:null})
  await makeCalendarMutations({calendarEvents:[{...event,assignmentRevision:'8'}],fetchAll,refreshUpdatedEvent}).removeParticipantFromEvent(1,'B')
  expect(mocks.rpc).toHaveBeenCalledWith('manage_event_participant_versioned_tx',expect.objectContaining({p_expected_revision:'8'}))
  expect(refreshUpdatedEvent).toHaveBeenCalledExactlyOnceWith(1)
  expect(fetchAll).not.toHaveBeenCalled()
})
