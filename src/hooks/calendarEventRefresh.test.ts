import { afterEach, beforeEach, expect, test, vi } from 'vitest'

const state = vi.hoisted(() => ({ query: vi.fn(), select: vi.fn(), eq: vi.fn(), order: vi.fn(), range: vi.fn(), from: vi.fn() }))
vi.mock('../lib/supabase', () => ({ supabase: { from: (table: string) => {
  state.from(table)
  const chain = {
    select: (columns: string) => { state.select(table, columns); return chain },
    eq: (key: string, value: number) => { state.eq(table, key, value); return chain },
    order: (key: string) => { state.order(table, key); return chain },
    range: (from: number, to: number) => { state.range(table, from, to); return state.query(table, from) },
    single: () => state.query(table),
  }
  return chain
} } }))
const event = {
  id: 7, event_date: '2026-10-20', time: '10:00', title: 'Updated', leader_name: 'A',
  series_id: 'series', assignment_team_scopes: { team: '주택' },
  event_participants: [{ user_name: 'A', role: '입명' }, { user_name: 'Guest', role: '게스트' }],
  event_cart_applications: [{ user_id: 3, is_team_lead: true, created_at: '2026-10-20', user: { name: 'Cart' } }],
}
const assignment = { id: 1, event_id: 7, user_name: 'A', assigned_card_id: 10, team_key: 'team' }
const card = { id: 2, event_id: 7, user_name: 'A', card_id: 11 }
beforeEach(() => {
  vi.clearAllMocks()
  state.query.mockReset().mockImplementation(async (table) => ({
    data: table === 'calendar_events' ? event : table === 'event_card_assignments' ? [assignment] : [card],
    error: null,
  }))
})
afterEach(() => { vi.unstubAllEnvs(); vi.resetModules() })

test.each(['true', 'false'])('uses the shared projection and existing complete transform (cart=%s)', async (cartEnabled) => {
  vi.stubEnv('VITE_CART_APPLICATIONS_ENABLED', cartEnabled)
  const { fetchUpdatedCalendarEvent, CALENDAR_EVENT_COLUMNS } = await import('./calendarEventRefresh')
  const result = await fetchUpdatedCalendarEvent(7)
  expect(CALENDAR_EVENT_COLUMNS).toBe(cartEnabled === 'true'
    ? '*, event_participants(*), event_cart_applications(user_id,is_team_lead,created_at,user:app_users!event_cart_applications_user_id_fkey(name))'
    : '*, event_participants(*)')
  expect(state.select).toHaveBeenCalledWith('calendar_events', CALENDAR_EVENT_COLUMNS)
  expect(state.eq.mock.calls).toEqual([
    ['calendar_events', 'id', 7], ['event_card_assignments', 'event_id', 7], ['event_card_assignment_cards', 'event_id', 7],
  ])
  expect(result).toMatchObject({ id: 7, title: 'Updated', seriesId: 'series', applicants: ['A', 'Guest'], assigned: ['A'], guests: ['Guest'],
    cartApplicants: [{ userId: 3, name: 'Cart', isTeamLead: true }],
    cardAssignments: [{ assignedCardId: 11, assignedCardIds: [11], cardScope: '주택' }],
  })
})

test.each(['event_card_assignments', 'event_card_assignment_cards'])('paginates %s completely with stable order', async (table) => {
  const original = state.query.getMockImplementation()!
  state.query.mockImplementation((name, from) => name === table
    ? Promise.resolve({ data: from === 0 ? Array.from({ length: 1000 }, (_, i) => ({ ...(table === 'event_card_assignments' ? assignment : card), id: i + 1 }))
      : [{ ...(table === 'event_card_assignments' ? assignment : card), id: 1001 }], error: null })
    : original(name, from))
  const { fetchUpdatedCalendarEvent } = await import('./calendarEventRefresh')
  const result = await fetchUpdatedCalendarEvent(7)
  expect(state.range).toHaveBeenCalledWith(table, 1000, 1999)
  expect(state.order).toHaveBeenCalledWith(table, 'id')
  expect(result.cardAssignments).toHaveLength(table === 'event_card_assignments' ? 1001 : 1)
})

test.each(['calendar_events', 'event_card_assignments', 'event_card_assignment_cards'])('rejects errors and foreign IDs from %s', async (table) => {
  const original = state.query.getMockImplementation()!
  const { fetchUpdatedCalendarEvent } = await import('./calendarEventRefresh')
  state.query.mockImplementation((name, from) => name === table
    ? Promise.resolve({ data: null, error: new Error('offline') }) : original(name, from))
  await expect(fetchUpdatedCalendarEvent(7)).rejects.toThrow('offline')
  state.query.mockImplementation((name, from) => name === table
    ? Promise.resolve({ data: table === 'calendar_events' ? { ...event, id: 8 } : [{ event_id: 8 }], error: null }) : original(name, from))
  await expect(fetchUpdatedCalendarEvent(7)).rejects.toThrow('Unexpected')
})

test('missing event rejects instead of fabricating an empty event', async () => {
  state.query.mockImplementation(async (table) => ({ data: table === 'calendar_events' ? null : [], error: null }))
  const { fetchUpdatedCalendarEvent } = await import('./calendarEventRefresh')
  await expect(fetchUpdatedCalendarEvent(7)).rejects.toThrow('Unexpected calendar event')
})

test('failed later page never returns a partial event', async () => {
  const original = state.query.getMockImplementation()!
  state.query.mockImplementation((name, from) => name === 'event_card_assignments'
    ? Promise.resolve(from === 0 ? { data: Array.from({ length: 1000 }, () => assignment), error: null }
      : { data: null, error: new Error('page failed') }) : original(name, from))
  const { fetchUpdatedCalendarEvent } = await import('./calendarEventRefresh')
  await expect(fetchUpdatedCalendarEvent(7)).rejects.toThrow('page failed')
})

test.each([0, -1, 1.5, NaN])('invalid target %s makes no requests', async (id) => {
  const { fetchUpdatedCalendarEvent } = await import('./calendarEventRefresh')
  await expect(fetchUpdatedCalendarEvent(id)).rejects.toThrow('Invalid')
  expect(state.from).not.toHaveBeenCalled()
})
