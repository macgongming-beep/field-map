import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { calendarReadScope, readScopedCalendar } from './calendarReadScope'
import { getCurrentRestaurantAssignmentsForUnit } from '../utils/restaurantAssignments'
import type { EventRestaurantAssignment } from '../types'

// 0167: the service read is event queries with embedded teams. A small PostgREST stand-in
// answers them from the fixture tables below, honouring filters, alias inner joins and paging.
type Row = Record<string, unknown> & { id: number }
type Call = { table: string; columns: string; filters: [string, unknown][]; from: number; to: number }
const state = vi.hoisted(() => ({ calls: [] as Call[], query: vi.fn(), db: {} as Record<string, Row[]> }))
vi.mock('../lib/supabase', () => ({ supabase: { from: (table: string) => {
  let columns = ''
  const filters: [string, unknown][] = []
  const q = {
    select: (value: string) => { columns = value; return q }, order: () => q,
    eq: (key: string, value: unknown) => { filters.push([`eq:${key}`, value]); return q },
    gte: (key: string, value: unknown) => { filters.push([`gte:${key}`, value]); return q },
    in: (key: string, value: unknown) => { filters.push([`in:${key}`, value]); return q },
    range: (from: number, to: number) => { const call = { table, columns, filters, from, to }; state.calls.push(call); return state.query(call) },
  }
  return q
} } }))

const today = '2026-10-23'
const now = new Date(`${today}T12:00:00`)
const scope = calendarReadScope('/territory', '', '', false, 'true', now, 'user', 'Me')
const children = (table: string, eventId: number) => state.db[table].filter(row => row.event_id === eventId)
function server(call: Call) {
  if (call.table !== 'calendar_events') return { data: state.db[call.table].filter(row => call.filters.every(([key, value]) => key !== 'in:event_id' || (value as number[]).includes(row.event_id as number))).slice(call.from, call.to + 1), error: null }
  const filter = (name: string) => call.filters.find(([key]) => key === name)?.[1]
  let rows = [...state.db.calendar_events].sort((a, b) => a.id - b.id)
  if (filter('eq:event_date') !== undefined) rows = rows.filter(row => row.event_date === filter('eq:event_date'))
  if (filter('gte:event_date') !== undefined) rows = rows.filter(row => (row.event_date as string) >= (filter('gte:event_date') as string))
  if (filter('eq:id') !== undefined) rows = rows.filter(row => row.id === filter('eq:id'))
  const mine = call.columns.includes('mine:event_card_assignments!inner(user_name)')
  const restaurant = call.columns.includes('restaurant:event_restaurant_assignments!inner(event_id)')
  if (mine) rows = rows.filter(row => children('event_card_assignments', row.id).some(child => child.user_name === filter('eq:mine.user_name')))
  if (restaurant) rows = rows.filter(row => children('event_restaurant_assignments', row.id).length > 0)
  const data = rows.slice(call.from, call.to + 1).map(row => ({ ...row,
    ...(call.columns.includes('event_card_assignments(*)') ? { event_card_assignments: children('event_card_assignments', row.id) } : {}),
    ...(call.columns.includes('event_card_assignment_cards(*)') ? { event_card_assignment_cards: children('event_card_assignment_cards', row.id) } : {}),
    ...(mine ? { mine: children('event_card_assignments', row.id).filter(child => child.user_name === filter('eq:mine.user_name')).map(child => ({ user_name: child.user_name })) } : {}),
    ...(restaurant ? { restaurant: children('event_restaurant_assignments', row.id).map(child => ({ event_id: child.event_id })) } : {}),
  }))
  return { data, error: null }
}
const kind = (call: Call) => call.table !== 'calendar_events' ? call.table
  : call.columns.includes('mine:') ? 'mine' : call.columns.includes('restaurant:') ? 'restaurant'
    : call.filters.some(([key]) => key === 'eq:id') ? 'target' : 'today'

afterEach(() => vi.unstubAllEnvs())
beforeEach(() => {
  state.calls = []
  state.db = {
    calendar_events: [
      { id: 1, event_date: '2026-08-02', time: '10:00', title: 'Past', event_participants: [{ user_name: 'Me', role: '신청' }] },
      { id: 2, event_date: '2027-08-08', time: '15:00', title: 'Future' },
      { id: 3, event_date: today, time: '10:00', title: 'Today' },
      { id: 4, event_date: '2027-05-01', time: '17:00', title: 'Other restaurant assignment' },
      { id: 5, event_date: '2025-01-01', time: '18:30', title: 'Explicit old target' },
      { id: 6, event_date: '2026-09-01', time: '12:00', title: 'Past restaurant only' },
    ],
    event_card_assignments: [
      { id: 1, event_id: 1, user_name: 'Me', assigned_card_id: 10, team_key: 'mine' },
      { id: 2, event_id: 1, user_name: 'Other', assigned_card_id: 20, team_key: 'other' },
      { id: 3, event_id: 2, user_name: 'Me', assigned_card_id: 30, team_key: 'future' },
    ],
    event_card_assignment_cards: [{ id: 1, event_id: 1, user_name: 'Other', card_id: 21 }],
    event_restaurant_assignments: [{ id: 1, event_id: 4 }, { id: 2, event_id: 6 }],
  }
  state.query.mockReset().mockImplementation(async (call: Call) => server(call))
})

test.each(['user', 'leader'] as const)('only eligible service roles opt in (%s); identity and target stay in the cache key', role => {
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

test('only the actual leader zone shares the service snapshot, including all-card and desktop-map views', () => {
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

test('leader zone retains complete other-team assignments and future restaurant events', async () => {
  const rows = await readScopedCalendar(calendarReadScope('/zone', '?scope=all', '', false, 'true', now, 'leader', 'Me'))
  expect(rows.map(row => row.id)).toEqual([1, 3, 4, 2])
  expect(rows[0].cardAssignments).toEqual(expect.arrayContaining([
    expect.objectContaining({ userName: 'Other', assignedCardIds: [21], teamKey: 'other' }),
  ]))
})

test.each(['user', 'leader'] as const)('%s preserves past/future personal events, all shared teams, multi-card links and other restaurant dates in one round trip', async role => {
  const rows = await readScopedCalendar(calendarReadScope('/territory', '', '', false, 'true', now, role, 'Me'))
  expect(rows.map(row => row.id)).toEqual([1, 3, 4, 2])
  expect(rows[0].applicants).toEqual(['Me'])
  expect(rows[0].cardAssignments).toEqual(expect.arrayContaining([
    expect.objectContaining({ userName: 'Me', assignedCardId: 10, teamKey: 'mine' }),
    expect.objectContaining({ userName: 'Other', assignedCardIds: [21], teamKey: 'other' }),
  ]))
  expect(rows.at(-1)?.cardAssignments[0].assignedCardId).toBe(30)
  expect(state.calls.map(kind).sort()).toEqual(['mine', 'restaurant', 'today'])
  expect(state.calls.every(call => call.columns.includes('event_card_assignments(*),event_card_assignment_cards(*)'))).toBe(true)
})

test('every query starts together: nothing waits for another response', async () => {
  let release!: () => void
  const held = new Promise<void>(resolve => { release = resolve })
  state.query.mockImplementation(async (call: Call) => { await held; return server(call) })
  const read = readScopedCalendar(calendarReadScope('/map', '?assignmentMap=5', '', false, 'true', now, 'user', 'Me'))
  await vi.waitFor(() => expect(state.calls.map(kind).sort()).toEqual(['mine', 'restaurant', 'target', 'today']))
  release()
  expect((await read).map(row => row.id)).toEqual([5, 1, 3, 4, 2])
  expect(state.calls).toHaveLength(4)
})

test.each(['user', 'leader'] as const)('%s explicit old map target is included even outside personal assignments', async role => {
  const rows = await readScopedCalendar(calendarReadScope('/map', '?assignmentMap=5', '', false, 'true', now, role, 'Me'))
  expect(rows[0].id).toBe(5)
})

test('leader without a personal card assignment keeps today meeting participants and other teams', async () => {
  state.db.calendar_events = [{ id: 3, event_date: today, time: '10:00', title: 'Today', leader_name: 'Me', event_participants: [{ user_name: 'Guest', role: '게스트' }] }]
  state.db.event_card_assignments = [{ id: 9, event_id: 3, user_name: 'Other team', assigned_card_id: 90, team_key: 'other' }]
  state.db.event_card_assignment_cards = []
  state.db.event_restaurant_assignments = []
  const rows = await readScopedCalendar(calendarReadScope('/territory', '', '', false, 'true', now, 'leader', 'Me'))
  expect(rows).toHaveLength(1)
  expect(rows[0]).toMatchObject({ leaders: ['Me'], applicants: ['Guest'], cardAssignments: [{ userName: 'Other team', assignedCardId: 90 }] })
})

test('an event in several indexes appears once with every team', async () => {
  state.db.event_card_assignments.push({ id: 7, event_id: 3, user_name: 'Me', assigned_card_id: 40 }, { id: 8, event_id: 3, user_name: 'Other', assigned_card_id: 41 })
  state.db.event_restaurant_assignments.push({ id: 3, event_id: 3 })
  const rows = await readScopedCalendar(scope)
  expect(rows.filter(row => row.id === 3)).toHaveLength(1)
  expect(rows.find(row => row.id === 3)?.cardAssignments.map(a => a.userName).sort()).toEqual(['Me', 'Other'])
  expect('mine' in rows.find(row => row.id === 3)!).toBe(false)
})

test.each([
  ['today', 'mine'], ['mine', 'restaurant'], ['restaurant', 'today'], ['target', 'mine'],
])('a failed %s query waits for the held %s query before rejecting', async (failed, held) => {
  let release!: () => void
  const hold = new Promise<void>(resolve => { release = resolve })
  let heldDone = false
  state.query.mockImplementation(async (call: Call) => {
    if (kind(call) === failed) return { data: null, error: new Error('offline') }
    if (kind(call) === held) { await hold; heldDone = true }
    return server(call)
  })
  let settled = false
  const read = readScopedCalendar(calendarReadScope('/map', '?assignmentMap=5', '', false, 'true', now, 'user', 'Me')).finally(() => { settled = true })
  try {
    await vi.waitFor(() => expect(state.calls.some(call => kind(call) === held)).toBe(true))
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(settled).toBe(false)
  } finally { release() }
  await expect(read).rejects.toThrow('offline')
  expect(heldDone).toBe(true)
})

// Usage contract: a deleted deep-link target costs its own query and nothing else.
test('a deleted deep-link target returns nothing and reads no assignment table', async () => {
  state.db.calendar_events = []
  const target = calendarReadScope('/map', '?assignmentMap=999', '', false, 'true', now, 'user', 'Me')
  expect(await readScopedCalendar(target)).toEqual([])
  expect(state.calls.map(kind).sort()).toEqual(['mine', 'restaurant', 'target', 'today'])
})

test('empty indexes never turn into an unfiltered event read', async () => {
  state.db.calendar_events = []
  expect(await readScopedCalendar(scope)).toEqual([])
  expect(state.calls).toHaveLength(3)
  expect(state.calls.every(call => call.filters.length > 0)).toBe(true)
})

test.each([
  ['today row of another day', (call: Call) => kind(call) === 'today' ? { data: [{ ...state.db.calendar_events[2], event_date: '2000-01-01', event_card_assignments: [], event_card_assignment_cards: [] }], error: null } : null, 'Invalid service calendar index'],
  ['mine row without my assignment', (call: Call) => kind(call) === 'mine' ? { data: [{ ...state.db.calendar_events[0], mine: [], event_card_assignments: [], event_card_assignment_cards: [] }], error: null } : null, 'Invalid service calendar index'],
  ['mine row of another user', (call: Call) => kind(call) === 'mine' ? { data: [{ ...state.db.calendar_events[0], mine: [{ user_name: 'Foreign' }], event_card_assignments: [], event_card_assignment_cards: [] }], error: null } : null, 'Invalid service calendar index'],
  ['past restaurant row', (call: Call) => kind(call) === 'restaurant' ? { data: [{ ...state.db.calendar_events[5], restaurant: [{ event_id: 6 }], event_card_assignments: [], event_card_assignment_cards: [] }], error: null } : null, 'Invalid service calendar index'],
  ['restaurant row without its assignment', (call: Call) => kind(call) === 'restaurant' ? { data: [{ ...state.db.calendar_events[3], restaurant: [], event_card_assignments: [], event_card_assignment_cards: [] }], error: null } : null, 'Invalid service calendar index'],
  ['restaurant link of another event', (call: Call) => kind(call) === 'restaurant' ? { data: [{ ...state.db.calendar_events[3], restaurant: [{ event_id: 99 }], event_card_assignments: [], event_card_assignment_cards: [] }], error: null } : null, 'Invalid service calendar index'],
  ['team of another event', (call: Call) => kind(call) === 'today' ? { data: [{ ...state.db.calendar_events[2], event_card_assignments: [{ id: 9, event_id: 99, user_name: 'X', assigned_card_id: 1 }], event_card_assignment_cards: [] }], error: null } : null, 'Invalid embedded calendar assignment'],
  ['missing team list', (call: Call) => kind(call) === 'today' ? { data: [{ ...state.db.calendar_events[2], event_card_assignment_cards: [] }], error: null } : null, 'Invalid embedded calendar assignment'],
  ['invalid event id', (call: Call) => kind(call) === 'today' ? { data: [{ ...state.db.calendar_events[2], id: -1, event_card_assignments: [], event_card_assignment_cards: [] }], error: null } : null, 'Invalid service calendar event id'],
])('rejects a %s', async (_label, override, message) => {
  state.query.mockImplementation(async (call: Call) => override(call) ?? server(call))
  await expect(readScopedCalendar(scope)).rejects.toThrow(message)
})

test('a target row other than the requested event is rejected', async () => {
  state.query.mockImplementation(async (call: Call) => kind(call) === 'target' ? { data: [{ ...state.db.calendar_events[0], event_card_assignments: [], event_card_assignment_cards: [] }], error: null } : server(call))
  await expect(readScopedCalendar(calendarReadScope('/map', '?assignmentMap=5', '', false, 'true', now, 'user', 'Me'))).rejects.toThrow('Invalid service calendar event')
})

test('personal events page beyond 1000', async () => {
  state.db.calendar_events = Array.from({ length: 1001 }, (_, i) => ({ id: i + 1, event_date: '2026-01-01', time: '10:00', title: `E${i + 1}` }))
  state.db.event_card_assignments = state.db.calendar_events.map(event => ({ id: event.id, event_id: event.id, user_name: 'Me', assigned_card_id: 1 }))
  state.db.event_restaurant_assignments = []
  expect(await readScopedCalendar(scope)).toHaveLength(1001)
  expect(state.calls.filter(call => kind(call) === 'mine').map(call => call.from)).toEqual([0, 1000])
})

test('an embedded team list as long as a page falls back to reading every page of that table', async () => {
  state.db.event_card_assignments = Array.from({ length: 1001 }, (_, i) => ({ id: i + 1, event_id: 3, user_name: `U${i}`, assigned_card_id: 1 }))
  state.query.mockImplementation(async (call: Call) => {
    const result = server(call)
    // A server that caps embedded lists at a page.
    if (call.table === 'calendar_events') result.data = result.data.map(row => ({ ...row, ...(Array.isArray(row.event_card_assignments) ? { event_card_assignments: (row.event_card_assignments as Row[]).slice(0, 1000) } : {}) }))
    return result
  })
  const rows = await readScopedCalendar(scope)
  expect(rows.find(row => row.id === 3)?.cardAssignments).toHaveLength(1001)
  expect(state.calls.filter(call => call.table === 'event_card_assignments').map(call => call.from)).toEqual([0, 1000])
})

test.each(['user', 'leader'] as const)('%s read reuse preserves the shared list/map scope and every personal team', async role => {
  vi.stubEnv('VITE_SERVICE_CALENDAR_REUSE_ENABLED', 'true')
  const list = calendarReadScope('/territory', '?assignmentEvent=5', '', false, 'true', now, role, 'Me')
  expect(list).toBe('service:["Me","2026-10-23",5]')
  expect(calendarReadScope('/map', '?assignmentMap=5', '', false, 'true', now, role, 'Me')).toBe(list)
  const rows = await readScopedCalendar(list)
  expect(rows.map(row => row.id)).toEqual([5, 1, 3, 4, 2])
  expect(rows.find(row => row.id === 1)?.cardAssignments).toEqual(expect.arrayContaining([
    expect.objectContaining({ userName: 'Me', assignedCardId: 10 }),
    expect.objectContaining({ userName: 'Other', assignedCardIds: [21], teamKey: 'other' }),
  ]))
  expect(state.calls).toHaveLength(4)
})

test('read reuse never narrows admin, developer, statistics or invalid deep links', () => {
  vi.stubEnv('VITE_SERVICE_CALENDAR_REUSE_ENABLED', 'true')
  for (const role of ['admin', 'developer'] as const) {
    expect(calendarReadScope('/territory', '', '', false, 'true', now, role, 'Me')).toBe('full')
  }
  for (const path of ['/stats', '/service-log']) {
    expect(calendarReadScope(path, '', '', false, 'true', now, 'user', 'Me')).toBe('full')
  }
  for (const search of ['?openEvent=7', '?assignmentEvent=nope']) {
    expect(calendarReadScope('/territory', search, '', false, 'true', now, 'user', 'Me')).toBe('full')
  }
  vi.stubEnv('VITE_SERVICE_CALENDAR_REUSE_ENABLED', 'false')
  expect(calendarReadScope('/territory', '', '', false, 'true', now, 'user', 'Me')).toBe(scope)
})

test.each(['service:["Me","2026-10-23",null,"bad"]', 'service:["Me","2026-10-23",null,"overview"]'])('unsupported service modes fail closed: %s', async invalid => {
  await expect(readScopedCalendar(invalid)).rejects.toThrow('Invalid service calendar scope')
  expect(state.calls).toEqual([])
})

// 0164: restaurant events before today are never displayed by a service screen.
test('the restaurant query asks only for restaurant events dated today or later', async () => {
  await readScopedCalendar(scope)
  const restaurant = state.calls.filter(call => kind(call) === 'restaurant')
  expect(restaurant).toHaveLength(1)
  expect(restaurant[0].columns).toContain('restaurant:event_restaurant_assignments!inner(event_id)')
  expect(restaurant[0].filters).toEqual([['gte:event_date', today]])
})

test('a past restaurant-only event is not read, but a past personal event still is', async () => {
  const rows = await readScopedCalendar(scope)
  expect(rows.map(row => row.id)).not.toContain(6)
  expect(rows.map(row => row.id)).toContain(1)
})

// 0164 regression: the unit-detail consumer sees exactly what a complete index gave it.
test('unit detail restaurant assignments are unchanged: today and future kept, past-only dropped', async () => {
  state.db.event_restaurant_assignments.push({ id: 3, event_id: 3 }, { id: 4, event_id: 1 })
  const rows = await readScopedCalendar(scope)
  const assignments = state.db.event_restaurant_assignments.map((row, i) => ({ id: i + 1, eventId: row.event_id, unitId: 100, userName: 'Other' }) as EventRestaurantAssignment)
  const shown = getCurrentRestaurantAssignmentsForUnit(assignments, rows, 100, today).map(a => a.eventId).sort()
  const all = state.db.calendar_events.map(event => ({ id: event.id, date: event.event_date }))
  const before = getCurrentRestaurantAssignmentsForUnit(assignments, all as never, 100, today).map(a => a.eventId).sort()
  expect(shown).toEqual([3, 4])
  expect(shown).toEqual(before)
  expect(rows.map(row => row.id)).toEqual([1, 3, 4, 2])
})

test('the restaurant date boundary is the scope day in local time, and a stale scope only widens it', async () => {
  const justAfterMidnight = calendarReadScope('/territory', '', '', false, 'true', new Date(`${today}T00:30:00`), 'user', 'Me')
  expect(justAfterMidnight).toBe(scope)
  const lastNight = calendarReadScope('/territory', '', '', false, 'true', new Date('2026-10-22T23:59:00'), 'user', 'Me')
  state.db.calendar_events = []
  expect(await readScopedCalendar(lastNight)).toEqual([])
  expect(state.calls.find(call => kind(call) === 'restaurant')!.filters).toEqual([['gte:event_date', '2026-10-22']])
})
