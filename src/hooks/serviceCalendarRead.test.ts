import { beforeEach, expect, test, vi } from 'vitest'
import { calendarReadScope, readScopedCalendar } from './calendarReadScope'

const state = vi.hoisted(() => ({ calls: [] as { table: string; columns: string; filters: [string, unknown][]; from: number }[], query: vi.fn() }))
vi.mock('../lib/supabase', () => ({ supabase: { from: (table: string) => {
  let columns = ''
  const filters: [string, unknown][] = []
  const q = {
    select: (value: string) => { columns = value; return q }, order: () => q,
    eq: (key: string, value: unknown) => { filters.push([key, value]); return q },
    in: (key: string, value: unknown) => { filters.push([key, value]); return q },
    range: (from: number) => { const call = { table, columns, filters, from }; state.calls.push(call); return state.query(call) },
  }
  return q
} } }))
const now = new Date('2026-10-23T12:00:00')
const scope = calendarReadScope('/territory', '', '', false, 'true', now, 'user', 'Me')
const events = [
  { id: 1, event_date: '2026-08-02', time: '10:00', title: 'Past', event_participants: [{ user_name: 'Me', role: '신청' }] },
  { id: 2, event_date: '2027-08-08', time: '15:00', title: 'Future' },
  { id: 3, event_date: '2026-10-23', time: '10:00', title: 'Today' },
  { id: 4, event_date: '2027-05-01', time: '17:00', title: 'Other restaurant assignment' },
  { id: 5, event_date: '2025-01-01', time: '18:30', title: 'Explicit old target' },
]
beforeEach(() => {
  state.calls = []
  state.query.mockReset().mockImplementation(async ({ table, columns, filters }) => {
    if (columns === 'id,event_date') return { data: [{ id: 3, event_date: '2026-10-23' }], error: null }
    if (columns === 'event_id,user_name') return { data: [{ event_id: 1, user_name: 'Me' }, { event_id: 2, user_name: 'Me' }], error: null }
    if (table === 'event_restaurant_assignments') return { data: [{ event_id: 4 }], error: null }
    const ids = filters[0][1] as number[]
    if (table === 'calendar_events') return { data: events.filter(event => ids.includes(event.id)), error: null }
    if (table === 'event_card_assignments') return { data: [
      { id: 1, event_id: 1, user_name: 'Me', assigned_card_id: 10, team_key: 'mine' },
      { id: 2, event_id: 1, user_name: 'Other', assigned_card_id: 20, team_key: 'other' },
      { id: 3, event_id: 2, user_name: 'Me', assigned_card_id: 30, team_key: 'future' },
    ].filter(row => ids.includes(row.event_id)), error: null }
    return { data: [{ id: 1, event_id: 1, user_name: 'Other', card_id: 21 }], error: null }
  })
})

test.each(['user', 'leader'] as const)('only demo service roles opt in (%s); identity and target stay in the cache key', role => {
  expect(scope).toBe('service:["Me","2026-10-23",null]')
  expect(calendarReadScope('/map', '?assignmentMap=5', '', false, 'true', now, 'user', 'Me')).toBe('service:["Me","2026-10-23",5]')
  expect(calendarReadScope('/territory', '?assignmentEvent=5', '', false, 'true', now, 'user', 'Me')).toBe('service:["Me","2026-10-23",5]')
  for (const path of ['/map', '/territory']) expect(calendarReadScope(path, '', '', false, 'true', now, role, 'Me')).toBe(scope)
  for (const fullRole of ['admin', 'developer'] as const) expect(calendarReadScope('/map', '', '', false, 'true', now, fullRole, 'Me')).toBe('full')
  for (const flag of [undefined, 'false']) expect(calendarReadScope('/territory', '', '', false, flag, now, role, 'Me')).toBe('full')
  for (const path of ['/stats', '/service-log']) expect(calendarReadScope(path, '', '', false, 'true', now, role, 'Me')).toBe('full')
  for (const query of ['?openChat=5', '?openEvent=5', '?assignmentMap=nope']) expect(calendarReadScope('/map', query, '', false, 'true', now, role, 'Me')).toBe('full')
  expect(calendarReadScope('/territory', '', '', false, 'true', now, 'user')).toBe('full')
  expect(calendarReadScope('/map', '?assignmentMap=nope', '', false, 'true', now, 'user', 'Me')).toBe('full')
  expect(calendarReadScope('/map', '?openChat=5', '', false, 'true', now, 'user', 'Me')).toBe('full')
  expect(calendarReadScope('/territory', '', '', false, 'true', now, 'user', 'Other')).not.toBe(scope)
})

test('only the actual demo leader zone shares the service snapshot, including all-card and desktop-map views', () => {
  for (const search of ['', '?scope=all', '?view=map', '?region=Other&dong=Other']) {
    expect(calendarReadScope('/zone', search, '', false, 'true', now, 'leader', 'Me')).toBe(scope)
  }
  for (const role of ['user', 'admin', 'developer', undefined] as const) {
    expect(calendarReadScope('/zone', '?scope=all', '', false, 'true', now, role, 'Me')).toBe('full')
  }
  for (const flag of ['false', undefined]) expect(calendarReadScope('/zone', '', '', false, flag, now, 'leader', 'Me')).toBe('full')
  expect(calendarReadScope('/zone', '', '', false, 'true', now, 'leader')).toBe('full')
  for (const search of ['?openChat=5', '?openEvent=5']) expect(calendarReadScope('/zone', search, '', false, 'true', now, 'leader', 'Me')).toBe('full')
})

test('leader zone retains complete other-team assignments and old/future restaurant events', async () => {
  const rows = await readScopedCalendar(calendarReadScope('/zone', '?scope=all', '', false, 'true', now, 'leader', 'Me'))
  expect(rows.map(row => row.id)).toEqual([1, 3, 4, 2])
  expect(rows[0].cardAssignments).toEqual(expect.arrayContaining([
    expect.objectContaining({ userName: 'Other', assignedCardIds: [21], teamKey: 'other' }),
  ]))
})

test.each(['user', 'leader'] as const)('%s preserves past/future personal events, all shared teams, multi-card links and other restaurant dates', async role => {
  const rows = await readScopedCalendar(calendarReadScope('/territory', '', '', false, 'true', now, role, 'Me'))
  expect(rows.map(row => row.id)).toEqual([1, 3, 4, 2])
  expect(rows[0].applicants).toEqual(['Me'])
  expect(rows[0].cardAssignments).toEqual(expect.arrayContaining([
    expect.objectContaining({ userName: 'Me', assignedCardId: 10, teamKey: 'mine' }),
    expect.objectContaining({ userName: 'Other', assignedCardIds: [21], teamKey: 'other' }),
  ]))
  expect(rows.at(-1)?.cardAssignments[0].assignedCardId).toBe(30)
  expect(state.calls).toHaveLength(6)
  expect(state.calls.filter(call => call.columns === '*').every(call => call.filters[0][0] === 'event_id')).toBe(true)
})

test.each(['user', 'leader'] as const)('%s explicit old map target is included even outside personal assignments', async role => {
  const rows = await readScopedCalendar(calendarReadScope('/map', '?assignmentMap=5', '', false, 'true', now, role, 'Me'))
  expect(rows[0].id).toBe(5)
})

test('leader without a personal card assignment keeps today meeting participants and other teams', async () => {
  const original = state.query.getMockImplementation()!
  state.query.mockImplementation(call => {
    if (call.columns === 'event_id,user_name' || call.table === 'event_restaurant_assignments' || call.table === 'event_card_assignment_cards') return { data: [], error: null }
    if (call.table === 'calendar_events' && call.columns !== 'id,event_date') return { data: [{ ...events[2], leader_name: 'Me', event_participants: [{ user_name: 'Guest', role: '게스트' }] }], error: null }
    if (call.table === 'event_card_assignments') return { data: [{ id: 9, event_id: 3, user_name: 'Other team', assigned_card_id: 90, team_key: 'other' }], error: null }
    return original(call)
  })
  const rows = await readScopedCalendar(calendarReadScope('/territory', '', '', false, 'true', now, 'leader', 'Me'))
  expect(rows).toHaveLength(1)
  expect(rows[0]).toMatchObject({ leaders: ['Me'], applicants: ['Guest'], cardAssignments: [{ userName: 'Other team', assignedCardId: 90 }] })
})

test('empty indexes never turn into an unfiltered event or assignment read', async () => {
  state.query.mockResolvedValue({ data: [], error: null })
  expect(await readScopedCalendar(scope)).toEqual([])
  expect(state.calls).toHaveLength(3)
})

test.each(['calendar_events', 'event_card_assignments', 'event_restaurant_assignments', 'event_card_assignment_cards'])('failed %s read is not silently treated as a complete snapshot', async table => {
  const original = state.query.getMockImplementation()!
  state.query.mockImplementation(call => call.table === table ? { data: [], error: new Error('offline') } : original(call))
  await expect(readScopedCalendar(scope)).rejects.toThrow('offline')
})

test.each([
  ['id,event_date', [{ id: 3, event_date: '2000-01-01' }]],
  ['event_id,user_name', [{ event_id: 1, user_name: 'Foreign' }]],
  ['event_id', [{ event_id: -1 }]],
])('rejects invalid index %s', async (columns, data) => {
  const original = state.query.getMockImplementation()!
  state.query.mockImplementation(call => call.columns === columns ? { data, error: null } : original(call))
  await expect(readScopedCalendar(scope)).rejects.toThrow('Invalid service calendar')
})

test('event and assignment rows outside the requested IDs are rejected', async () => {
  const original = state.query.getMockImplementation()!
  state.query.mockImplementation(call => call.table === 'calendar_events' && call.columns !== 'id,event_date'
    ? { data: [{ ...events[0], id: 999 }], error: null } : original(call))
  await expect(readScopedCalendar(scope)).rejects.toThrow('Invalid service calendar event')
  state.query.mockImplementation(call => call.table === 'event_card_assignment_cards'
    ? { data: [{ event_id: 999 }], error: null } : original(call))
  await expect(readScopedCalendar(scope)).rejects.toThrow('Invalid scoped calendar assignment')
})

test('personal indexes page beyond 1000 and event IDs are read in batches of 100', async () => {
  state.query.mockImplementation(async ({ columns, table, from, filters }) => {
    if (columns === 'event_id,user_name') return { data: from === 0
      ? Array.from({ length: 1000 }, (_, i) => ({ event_id: i + 1, user_name: 'Me' })) : [{ event_id: 1001, user_name: 'Me' }], error: null }
    if (table === 'calendar_events' && columns !== 'id,event_date') return { data: (filters[0][1] as number[]).map(id => ({ ...events[0], id })), error: null }
    return { data: [], error: null }
  })
  expect(await readScopedCalendar(scope)).toHaveLength(1001)
  expect(state.calls.filter(call => call.columns === 'event_id,user_name').map(call => call.from)).toEqual([0, 1000])
  expect(state.calls.filter(call => call.table === 'calendar_events' && call.columns !== 'id,event_date')).toHaveLength(11)
})
