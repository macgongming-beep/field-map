import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { CalendarEvent } from '../../types'
const state = vi.hoisted(() => ({ cart: false, rpc: vi.fn(), write: vi.fn(), toast: vi.fn(), error: vi.fn() }))
vi.mock('../../config/features', () => ({ get CART_APPLICATIONS_ENABLED() { return state.cart } }))
vi.mock('./shared', () => ({ supabase: { rpc: state.rpc, from: () => {
  const q: Record<string, unknown> = {}
  for (const method of ['delete', 'eq', 'select', 'upsert']) q[method] = () => q
  q.then = (resolve: (value: unknown) => void) => state.write().then(resolve)
  return q
} }, showToast: state.toast, reportMutationError: state.error,
getCurrentVisitor: () => 'A', ensureAffectedRows: (rows: unknown[]) => rows.length > 0 }))
vi.mock('./serviceLog', () => ({ logServiceAction: vi.fn() }))
vi.mock('../../lib/authToken', () => ({ getAuthToken: () => 'token' }))
import { makeCalendarMutations } from './calendar'
beforeEach(() => {
  vi.clearAllMocks(); state.cart = false; vi.stubEnv('VITE_DEMO_MODE', 'true')
  state.write.mockResolvedValue({ data: [{ id: 1 }], error: null })
  state.rpc.mockResolvedValue({ data: { ok: true, state: 'applied' }, error: null })
})
afterEach(() => vi.unstubAllEnvs())
function setup(cancelled = false, team = false) {
  const fetchAll = vi.fn().mockResolvedValue(undefined), removal = vi.fn().mockResolvedValue(undefined)
  const refreshApplication = vi.fn().mockResolvedValue(undefined)
  const event = { id: 1, applicants: cancelled ? ['A'] : [], allowApplications: true,
    assignmentTeamInformal: team ? { team: [2] } : null } as unknown as CalendarEvent
  const deps = { fetchAll, refreshApplication, refetchAfterParticipantRemoval: removal, calendarEvents: [event] }
  return { deps, fetchAll, removal, refreshApplication, mutations: makeCalendarMutations(deps) }
}
test.each([false, true])('legacy application cancelled=%s uses participant refresh', async cancelled => {
  const s = setup(cancelled); await s.mutations.applyToEvent(1)
  expect(s.refreshApplication).toHaveBeenCalledWith(1, cancelled)
  expect(s.fetchAll).not.toHaveBeenCalled(); expect(s.removal).not.toHaveBeenCalled()
})
test.each(['applied', 'cancelled', 'switched', 'unknown'])('RPC state %s preserves switching recovery', async status => {
  state.cart = true; state.rpc.mockResolvedValue({ data: { ok: true, state: status }, error: null })
  const s = setup(status === 'cancelled'); await s.mutations.applyToEvent(1)
  if (status === 'applied' || status === 'cancelled') expect(s.refreshApplication).toHaveBeenCalledWith(1, status === 'cancelled')
  else { expect(s.fetchAll).toHaveBeenCalledOnce(); expect(s.refreshApplication).not.toHaveBeenCalled() }
})
test('team cancellation keeps atomic removal and broad history recovery', async () => {
  const s = setup(true, true); await s.mutations.applyToEvent(1)
  expect(state.rpc).toHaveBeenCalledWith('remove_team_event_participant_tx', expect.anything())
  expect(s.removal).toHaveBeenCalledOnce(); expect(s.refreshApplication).not.toHaveBeenCalled()
})
test.each([false, true])('narrow read failure cancelled=%s preserves fallback', async cancelled => {
  const s = setup(cancelled); s.refreshApplication.mockRejectedValue(new Error('offline'))
  await s.mutations.applyToEvent(1)
  expect(cancelled ? s.removal : s.fetchAll).toHaveBeenCalledOnce()
})
test('fallback failure propagates without a success toast', async () => {
  const s = setup(true); s.refreshApplication.mockRejectedValue(new Error('offline')); s.removal.mockRejectedValue(new Error('recovery failed'))
  await expect(s.mutations.applyToEvent(1)).rejects.toThrow('recovery failed')
  expect(state.toast).not.toHaveBeenCalled()
})
test('no callback preserves existing refresh', async () => {
  const s = setup(); await makeCalendarMutations({ ...s.deps, refreshApplication: undefined }).applyToEvent(1)
  expect(s.fetchAll).toHaveBeenCalledOnce()
})
test('failed writes never refresh or claim success', async () => {
  const s = setup(); state.write.mockResolvedValue({ data: null, error: new Error('offline') })
  await s.mutations.applyToEvent(1)
  expect(s.refreshApplication).not.toHaveBeenCalled(); expect(s.fetchAll).not.toHaveBeenCalled(); expect(state.toast).not.toHaveBeenCalled()
})
