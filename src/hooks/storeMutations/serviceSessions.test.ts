import { afterEach, expect, test, vi } from 'vitest'
import { makeServiceSessionMutations } from './serviceSessions'
import type { ServiceSession } from '../../types'

const state = vi.hoisted(() => ({
  metadata: { id: 42, calendar_event_id: 7, primary_card_id: 9, time_slot: '오전' },
  error: null as Error | null, reads: vi.fn(), writes: vi.fn(), log: vi.fn(), report: vi.fn(),
  updateError: null as Error | null, tables: vi.fn(), readIds: vi.fn(), writeIds: vi.fn(),
}))
vi.mock('./serviceLog', () => ({ logServiceAction: state.log }))
vi.mock('./shared', () => ({
  showToast: vi.fn(), reportMutationError: state.report,
  getLocalDateString: () => '2026-10-26', getCurrentVisitor: () => 'Me',
  supabase: { from: (table: string) => {
    state.tables(table)
    const q = {
      select: (columns: string) => { state.reads(columns); return q },
      eq: (column: string, value: unknown) => { state.readIds(column, value); return q },
      single: async () => ({ data: state.metadata, error: state.error }),
      update: (payload: unknown) => { state.writes(payload); return { eq: async (column: string, value: unknown) => {
        state.writeIds(column, value); return { error: state.updateError }
      } } },
    }
    return q
  } },
}))
afterEach(() => { state.error = null; state.updateError = null; state.metadata.id = 42; vi.clearAllMocks() })

test('ending an older session outside the read window retains its event/card log metadata', async () => {
  const refresh = vi.fn()
  const mutations = makeServiceSessionMutations({ fetchAll: refresh, serviceSessions: [], buildings: [], narrowSessionRead: true })
  await mutations.endServiceSession(42)
  expect(state.reads).toHaveBeenCalledWith('id, calendar_event_id, primary_card_id, time_slot')
  expect(state.writes).toHaveBeenCalledTimes(1)
  expect(state.tables.mock.calls).toEqual([['service_sessions'], ['service_sessions']])
  expect(state.readIds.mock.calls).toEqual([['id', 42]])
  expect(state.writeIds.mock.calls).toEqual([['id', 42]])
  expect(state.log).toHaveBeenCalledWith({ sessionId: 42, eventId: 7, cardId: 9, action: 'session_ended', details: { time_slot: '오전' } })
  expect(refresh).toHaveBeenCalledTimes(1)
})

test.each(['error', 'wrong id'])('missing metadata %s does not end a session with misleading log details', async failure => {
  if (failure === 'error') state.error = new Error('offline')
  else state.metadata.id = 99
  const mutations = makeServiceSessionMutations({ fetchAll: vi.fn(), serviceSessions: [], buildings: [], narrowSessionRead: true })
  await mutations.endServiceSession(42)
  expect(state.writes).not.toHaveBeenCalled()
  expect(state.log).not.toHaveBeenCalled()
  expect(state.report).toHaveBeenCalledTimes(1)
})

test('disabled feature keeps the old missing-session behavior without another read', async () => {
  const mutations = makeServiceSessionMutations({ fetchAll: vi.fn(), serviceSessions: [], buildings: [] })
  await mutations.endServiceSession(42)
  expect(state.reads).not.toHaveBeenCalled()
  expect(state.writes).toHaveBeenCalledTimes(1)
})

test('cached metadata avoids another read and a failed update does not log or refresh', async () => {
  state.updateError = new Error('offline')
  const refresh = vi.fn()
  const session = { id: 42, calendarEventId: 7, primaryCardId: 9, timeSlot: '오전' } as ServiceSession
  await makeServiceSessionMutations({ fetchAll: refresh, serviceSessions: [session], buildings: [], narrowSessionRead: true }).endServiceSession(42)
  expect(state.reads).not.toHaveBeenCalled()
  expect(state.writeIds.mock.calls).toEqual([['id', 42]])
  expect(state.log).not.toHaveBeenCalled()
  expect(refresh).not.toHaveBeenCalled()
  expect(state.report).toHaveBeenCalledTimes(1)
})
