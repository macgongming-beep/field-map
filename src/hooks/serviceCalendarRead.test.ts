import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { calendarReadScope, readScopedCalendar } from './calendarReadScope'
import { getCurrentRestaurantAssignmentsForUnit } from '../utils/restaurantAssignments'
import type { EventRestaurantAssignment } from '../types'

const state = vi.hoisted(() => ({ calls: [] as { table: string; columns: string; filters: [string, unknown][]; from: number }[], query: vi.fn() }))
vi.mock('../lib/supabase', () => ({ supabase: { from: (table: string) => {
  let columns = ''
  const filters: [string, unknown][] = []
  const q = {
    select: (value: string) => { columns = value; return q }, order: () => q,
    eq: (key: string, value: unknown) => { filters.push([key, value]); return q },
    in: (key: string, value: unknown) => { filters.push([key, value]); return q },
    gte: (key: string, value: unknown) => { filters.push([`gte:${key}`, value]); return q },
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
afterEach(() => vi.unstubAllEnvs())
// Server-side date filter as requested; without one the emulated server returns every row.
const dateFilter = (call: { filters: [string, unknown][] }) => (call.filters.find(([key]) => key === 'gte:calendar_events.event_date')?.[1] as string | undefined) ?? ''
beforeEach(() => {
  state.calls = []
  state.query.mockReset().mockImplementation(async ({ table, columns, filters }) => {
    if (columns === 'id,event_date') return { data: [{ id: 3, event_date: '2026-10-23' }], error: null }
    if (columns === 'event_id,user_name') return { data: [{ event_id: 1, user_name: 'Me' }, { event_id: 2, user_name: 'Me' }], error: null }
    if (table === 'event_restaurant_assignments') return { data: [{ event_id: 4, calendar_events: { event_date: '2027-05-01' } }], error: null }
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

test('shared team assignments start with the event bodies instead of waiting for them', async () => {
  const original = state.query.getMockImplementation()!
  let releaseEvents!: () => void
  const eventsHeld = new Promise<void>(resolve => { releaseEvents = resolve })
  state.query.mockImplementation(async call => {
    if (call.table === 'calendar_events' && call.columns !== 'id,event_date') await eventsHeld
    return original(call)
  })
  const read = readScopedCalendar(scope)
  await vi.waitFor(() => expect(state.calls.filter(call => call.columns === '*').map(call => call.table).sort())
    .toEqual(['event_card_assignment_cards', 'event_card_assignments']))
  expect(state.calls.filter(call => call.table === 'calendar_events' && call.columns !== 'id,event_date')).toHaveLength(1)
  releaseEvents()
  const rows = await read
  // Same requests and the same merged result as the serial read.
  expect(state.calls).toHaveLength(6)
  expect(rows.map(row => row.id)).toEqual([1, 3, 4, 2])
  expect(rows[0].cardAssignments).toEqual(expect.arrayContaining([
    expect.objectContaining({ userName: 'Me', assignedCardId: 10, teamKey: 'mine' }),
    expect.objectContaining({ userName: 'Other', assignedCardIds: [21], teamKey: 'other' }),
  ]))
})

test.each([
  ['calendar_events', 'event_card_assignments'],
  ['event_card_assignments', 'calendar_events'],
])('a failed %s read waits for the concurrent %s read before rejecting', async (failing, held) => {
  const original = state.query.getMockImplementation()!
  let releaseHeld!: () => void
  const heldRead = new Promise<void>(resolve => { releaseHeld = resolve })
  let heldDone = false
  state.query.mockImplementation(async call => {
    if (call.columns === 'id,event_date' || call.columns === 'event_id,user_name' || call.table === 'event_restaurant_assignments') return original(call)
    if (call.table === failing) return { data: [], error: new Error('offline') }
    if (call.table === held) { await heldRead; heldDone = true }
    return original(call)
  })
  let settled = false
  const read = readScopedCalendar(scope).finally(() => { settled = true })
  await vi.waitFor(() => expect(state.calls.some(call => call.table === held && call.columns !== 'id,event_date')).toBe(true))
  await new Promise(resolve => setTimeout(resolve, 20))
  expect(settled).toBe(false)
  releaseHeld()
  await expect(read).rejects.toThrow('offline')
  expect(heldDone).toBe(true)
})

// Both assignment tables and all three index reads must finish before a failure
// surfaces; otherwise a retry can overlap requests that are still in flight.
test.each([
  ['event_card_assignments', 'event_card_assignment_cards'],
  ['event_card_assignment_cards', 'event_card_assignments'],
  ['event_card_assignments', 'calendar_events'],
  ['event_card_assignment_cards', 'calendar_events'],
])('a failed %s read drains the held %s read first', async (failed, held) => {
  const original = state.query.getMockImplementation()!
  let release!: () => void
  const hold = new Promise<void>(resolve => { release = resolve })
  let heldDone = false
  const isBody = (call: { table: string; columns: string }) => call.table !== 'calendar_events' ? call.columns === '*' : call.columns !== 'id,event_date'
  state.query.mockImplementation(async call => {
    if (!isBody(call)) return original(call)
    if (call.table === failed) return { data: [], error: new Error('offline') }
    if (call.table === held) { await hold; heldDone = true }
    return original(call)
  })
  let settled = false
  const read = readScopedCalendar(scope).finally(() => { settled = true })
  try {
    await vi.waitFor(() => expect(state.calls.some(call => call.table === held && isBody(call))).toBe(true))
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(settled).toBe(false)
  } finally { release() }
  await expect(read).rejects.toThrow('offline')
  expect(heldDone).toBe(true)
})

test.each([
  ['id,event_date', 'event_id,user_name'],
  ['event_id,user_name', 'event_id,calendar_events!inner(event_date)'],
  ['event_id,calendar_events!inner(event_date)', 'id,event_date'],
])('a failed %s index read drains the held %s index read first', async (failed, held) => {
  const original = state.query.getMockImplementation()!
  let release!: () => void
  const hold = new Promise<void>(resolve => { release = resolve })
  let heldDone = false
  state.query.mockImplementation(async call => {
    if (call.columns === failed) return { data: [], error: new Error('offline') }
    if (call.columns === held) { await hold; heldDone = true }
    return original(call)
  })
  let settled = false
  const read = readScopedCalendar(scope).finally(() => { settled = true })
  try {
    await vi.waitFor(() => expect(state.calls.some(call => call.columns === held)).toBe(true))
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(settled).toBe(false)
  } finally { release() }
  await expect(read).rejects.toThrow('offline')
  expect(heldDone).toBe(true)
  // Nothing past the index starts once an index read has failed.
  expect(state.calls.some(call => call.columns === '*' || (call.table === 'calendar_events' && call.columns !== 'id,event_date'))).toBe(false)
})

// Usage contract. Normal paths keep the serial request count; an indexed ID with
// no event body now also pays for both assignment tables (4 -> 6 requests).
test('a deleted deep-link target returns nothing but still reads both assignment tables', async () => {
  state.query.mockResolvedValue({ data: [], error: null })
  const target = calendarReadScope('/map', '?assignmentMap=999', '', false, 'true', now, 'user', 'Me')
  expect(await readScopedCalendar(target)).toEqual([])
  expect(state.calls).toHaveLength(6)
  expect(state.calls.filter(call => call.columns === '*').map(call => call.table).sort())
    .toEqual(['event_card_assignment_cards', 'event_card_assignments'])
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
  ['event_id,calendar_events!inner(event_date)', [{ event_id: -1, calendar_events: { event_date: '2027-05-01' } }]],
  // The server must honour the date filter; a past or missing date is not trusted.
  ['event_id,calendar_events!inner(event_date)', [{ event_id: 4, calendar_events: { event_date: '2026-10-22' } }]],
  ['event_id,calendar_events!inner(event_date)', [{ event_id: 4, calendar_events: null }]],
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
  expect(state.calls).toHaveLength(6)
  expect(state.calls.some(call => call.table === 'event_restaurant_assignments')).toBe(true)
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
test('the restaurant index asks only for restaurant events dated today or later', async () => {
  await readScopedCalendar(scope)
  const index = state.calls.filter(call => call.table === 'event_restaurant_assignments')
  expect(index).toHaveLength(1)
  expect(index[0].columns).toBe('event_id,calendar_events!inner(event_date)')
  expect(index[0].filters).toEqual([['gte:calendar_events.event_date', '2026-10-23']])
})

test('a past restaurant-only event is no longer hydrated, but a past personal event still is', async () => {
  const original = state.query.getMockImplementation()!
  // The server applies the date filter: event 6 (past, restaurant only) is not returned.
  const restaurantRows = [{ event_id: 6, date: '2026-09-01' }, { event_id: 4, date: '2027-05-01' }]
  state.query.mockImplementation(call => call.table === 'event_restaurant_assignments'
    ? { data: restaurantRows.filter(row => row.date >= dateFilter(call)).map(row => ({ event_id: row.event_id, calendar_events: { event_date: row.date } })), error: null }
    : original(call))
  const rows = await readScopedCalendar(scope)
  expect(rows.map(row => row.id)).toEqual([1, 3, 4, 2])
  const bodyIds = state.calls.filter(call => call.table === 'calendar_events' && call.columns !== 'id,event_date').flatMap(call => call.filters[0][1] as number[])
  expect(bodyIds).not.toContain(6)
  expect(bodyIds).toContain(1)
})

// 0164 regression: the unit-detail consumer sees exactly what the old complete index gave it.
test('unit detail restaurant assignments are unchanged: today and future kept, past-only dropped', async () => {
  const original = state.query.getMockImplementation()!
  const restaurantEvents = [{ id: 6, date: '2026-09-01' }, { id: 3, date: '2026-10-23' }, { id: 4, date: '2027-05-01' }, { id: 1, date: '2026-08-02' }]
  const bodies = [...events, { id: 6, event_date: '2026-09-01', time: '12:00', title: 'Past restaurant only' }]
  state.query.mockImplementation(call => {
    if (call.table === 'event_restaurant_assignments') return { data: restaurantEvents.filter(row => row.date >= dateFilter(call))
      .map(row => ({ event_id: row.id, calendar_events: { event_date: row.date } })), error: null }
    if (call.table === 'calendar_events' && call.columns !== 'id,event_date') {
      const ids = call.filters[0][1] as number[]
      return { data: bodies.filter(event => ids.includes(event.id)), error: null }
    }
    return original(call)
  })
  const rows = await readScopedCalendar(scope)
  const assignments = restaurantEvents.map((row, i) => ({ id: i + 1, eventId: row.id, unitId: 100, userName: 'Other' }) as EventRestaurantAssignment)
  const shown = getCurrentRestaurantAssignmentsForUnit(assignments, rows, 100, '2026-10-23').map(a => a.eventId)
  // The old complete index hydrated event 6 too; the consumer filtered it out anyway.
  const allBodies = bodies.map(event => ({ id: event.id, date: event.event_date }))
  const before = getCurrentRestaurantAssignmentsForUnit(assignments, allBodies as never, 100, '2026-10-23').map(a => a.eventId)
  expect(shown).toEqual([3, 4])
  expect(shown).toEqual(before)
  // Past event 1 stays because it is the user's own card assignment, not because of restaurants.
  expect(rows.map(row => row.id)).toEqual([1, 3, 4, 2])
})

test('the restaurant date boundary is the scope day in local time, and a stale scope only widens it', async () => {
  const justAfterMidnight = calendarReadScope('/territory', '', '', false, 'true', new Date('2026-10-23T00:30:00'), 'user', 'Me')
  expect(justAfterMidnight).toBe(scope)
  const lastNight = calendarReadScope('/territory', '', '', false, 'true', new Date('2026-10-22T23:59:00'), 'user', 'Me')
  state.query.mockResolvedValue({ data: [], error: null })
  expect(await readScopedCalendar(lastNight)).toEqual([])
  const index = state.calls.find(call => call.table === 'event_restaurant_assignments')!
  // Opened yesterday and still showing: the filter starts a day earlier, never later.
  expect(index.filters).toEqual([['gte:calendar_events.event_date', '2026-10-22']])
})
