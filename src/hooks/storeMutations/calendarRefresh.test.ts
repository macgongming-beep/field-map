import { beforeEach, expect, test, vi } from 'vitest'
import { makeCalendarMutations, type CalendarEventInput } from './calendar'

const state = vi.hoisted(() => ({ rpc: vi.fn(), toast: vi.fn(), error: vi.fn() }))
vi.mock('./shared', () => ({
  supabase: { rpc: state.rpc }, showToast: state.toast, reportMutationError: state.error,
  getCurrentVisitor: vi.fn(), ensureAffectedRows: vi.fn(),
}))
vi.mock('./serviceLog', () => ({ logServiceAction: vi.fn() }))
vi.mock('../../lib/authToken', () => ({ getAuthToken: () => 'token' }))
const input: CalendarEventInput = {
  time: '10:00', title: 'Updated', place: 'Hall', leader: 'A', memo: 'memo',
  hasMeeting: true, allowApplications: true,
}
beforeEach(() => {
  vi.clearAllMocks()
  state.rpc.mockReset().mockResolvedValue({ data: { ok: true }, error: null })
})

test('single update refreshes its target only after confirmed RPC success', async () => {
  const fetchAll = vi.fn(), refreshUpdatedEvent = vi.fn().mockResolvedValue(undefined)
  const mutations = makeCalendarMutations({ fetchAll, refreshUpdatedEvent, calendarEvents: [] })
  expect(await mutations.updateCalendarEvent(7, input, false)).toBe(true)
  expect(state.rpc).toHaveBeenCalledWith('update_calendar_event_tx', expect.objectContaining({
    p_event_id: 7, p_notify: false,
  }))
  expect(refreshUpdatedEvent).toHaveBeenCalledExactlyOnceWith(7)
  expect(fetchAll).not.toHaveBeenCalled()
  expect(state.toast).toHaveBeenCalledOnce()
})

test('without callback the existing refresh and rejection contract are retained', async () => {
  const fetchAll = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('offline'))
  const mutations = makeCalendarMutations({ fetchAll, calendarEvents: [] })
  expect(await mutations.updateCalendarEvent(7, input)).toBe(true)
  state.toast.mockClear()
  await expect(mutations.updateCalendarEvent(7, input)).rejects.toThrow('offline')
  expect(fetchAll).toHaveBeenCalledTimes(2)
  expect(state.toast).not.toHaveBeenCalled()
})

test.each([false, true])('target failure falls back without repeating write (fallbackFails=%s)', async (fails) => {
  const fetchAll = fails ? vi.fn().mockRejectedValue(new Error('fallback failed')) : vi.fn().mockResolvedValue(undefined)
  const refreshUpdatedEvent = vi.fn().mockRejectedValue(new Error('target failed'))
  const mutations = makeCalendarMutations({ fetchAll, refreshUpdatedEvent, calendarEvents: [] })
  const pending = mutations.updateCalendarEvent(7, input)
  if (fails) await expect(pending).rejects.toThrow('fallback failed')
  else expect(await pending).toBe(true)
  expect(state.rpc).toHaveBeenCalledOnce()
  expect(refreshUpdatedEvent).toHaveBeenCalledExactlyOnceWith(7)
  expect(fetchAll).toHaveBeenCalledOnce()
  expect(state.toast).toHaveBeenCalledTimes(fails ? 0 : 1)
})

test.each([
  { data: null, error: new Error('denied') },
  { data: { ok: false }, error: null },
])('failed write never refreshes', async (response) => {
  state.rpc.mockResolvedValue(response)
  const fetchAll = vi.fn(), refreshUpdatedEvent = vi.fn()
  expect(await makeCalendarMutations({ fetchAll, refreshUpdatedEvent, calendarEvents: [] })
    .updateCalendarEvent(7, input)).toBe(false)
  expect(refreshUpdatedEvent).not.toHaveBeenCalled()
  expect(fetchAll).not.toHaveBeenCalled()
})

test('series updates keep their existing refresh with the callback installed', async () => {
  const fetchAll = vi.fn(), refreshUpdatedEvent = vi.fn()
  const mutations = makeCalendarMutations({ fetchAll, refreshUpdatedEvent, calendarEvents: [] })
  expect(await mutations.updateCalendarEventSeries('series', '2026-10-20', input, false)).toBe(true)
  expect(state.rpc).toHaveBeenCalledWith('update_calendar_event_series_tx', expect.objectContaining({ p_notify: false }))
  expect(fetchAll).toHaveBeenCalledOnce()
  expect(refreshUpdatedEvent).not.toHaveBeenCalled()
})
