import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { calendarReadScope, calendarWindowEnabled, readScopedCalendar } from './calendarReadScope'
import { attendanceMeetings } from '../utils/serviceAttendance'

const state = vi.hoisted(() => ({ calls: [] as { table: string; columns: string; filters: [string, unknown][]; from: number }[], query: vi.fn() }))
vi.mock('../lib/supabase', () => ({ supabase: { from: (table: string) => {
  const filters: [string, unknown][] = []
  let columns = ''
  const q = {
    select: (value: string) => { columns = value; return q }, order: () => q,
    gte: (key: string, value: string) => { filters.push([key, value]); return q },
    lte: (key: string, value: string) => { filters.push([key, value]); return q },
    in: (key: string, value: number[]) => { filters.push([key, value]); return q },
    range: (from: number) => { state.calls.push({ table, columns, filters, from }); return state.query(table, from, filters) },
  }
  return q
} } }))
const event = { id: 7, event_date: '2026-08-02', time: '10:00', title: 'Old meeting', leader_name: 'A',
  event_participants: [{ user_name: 'A', role: '입명' }, { user_name: 'Guest', role: '게스트' }] }
const assignment = { id: 1, event_id: 7, user_name: 'A', assigned_card_id: 10 }
// 0167: window reads embed every team in the event row.
const embedded = (row: Record<string, unknown>, base: unknown[] = [], cards: unknown[] = []) => ({ ...row, event_card_assignments: base, event_card_assignment_cards: cards })
beforeEach(() => {
  vi.stubEnv('VITE_ROUTE_LIGHTWEIGHT_ENABLED', undefined)
  state.calls = []
  state.query.mockReset().mockImplementation(async (table: string) => ({ data: table === 'calendar_events' ? [embedded(event, [assignment])] : table === 'event_card_assignments' ? [assignment] : [], error: null }))
})
const now = new Date('2026-10-23T12:00:00')
afterEach(() => vi.unstubAllEnvs())
test.each(['admin', 'developer'] as const)('opt-in %s management and zone share home calendar without promoting history', role => {
  vi.stubEnv('VITE_DEMO_MODE', 'false')
  vi.stubEnv('VITE_ROUTE_LIGHTWEIGHT_ENABLED', 'true')
  const home = calendarReadScope('/', '', '', false, 'true', now, role)
  const paths = ['/users', '/settings/users', '/signup-requests', '/settings/signup-requests',
    '/settings/meeting-notes', '/special-periods', '/settings/special-periods', '/suggestions', '/settings/suggestions', '/zone']
  for (const path of paths) {
    // A stale full/month request from the previous calendar is not a management consumer.
    expect(calendarReadScope(path, '', '2020-01', true, 'true', now, role)).toBe(home)
    for (const flag of [undefined, 'false']) {
      expect(calendarReadScope(path, '', '', false, flag, now, role)).toBe('full')
    }
    for (const search of ['?openEvent=7', '?openChat=7', '?unknown=1']) {
      expect(calendarReadScope(path, search, '', false, 'true', now, role)).toBe('full')
    }
    expect(calendarReadScope(path + '/edit', '', '', false, 'true', now, role)).toBe('full')
  }
  for (const search of ['?scope=all', '?scope=mine&groupCode=dongtan', '?level=cards&region=R&dong=D&scope=mine', '?tab=territory', '?tab=informal', '?tab=restaurant']) {
    expect(calendarReadScope('/zone', search, '', false, 'true', now, role)).toBe(home)
  }
  for (const search of ['?groupCode=a&groupCode=b', '?groupCode=a&openEvent=7', '?tab=unknown', '?view=map', '?tab=territory&openEvent=7', '?tab=territory&tab=unknown', '?scope=all&scope=mine']) {
    expect(calendarReadScope('/zone', search, '', false, 'true', now, role)).toBe('full')
  }
  for (const path of ['/settings/unknown', '/settings/data-management', '/settings/territory-regions',
    '/regular-visits', '/settings/regular-visits', '/place-change-requests', '/settings/place-change-requests',
    '/service-logs', '/settings/service-logs', '/stats', '/map', '/territory']) {
    expect(calendarReadScope(path, '', '', false, 'true', now, role)).toBe('full')
  }
  for (const demo of ['true', 'false', undefined]) {
    vi.stubEnv('VITE_DEMO_MODE', demo)
    for (const flag of ['true', 'false', undefined, 'TRUE', '1']) {
      vi.stubEnv('VITE_ROUTE_LIGHTWEIGHT_ENABLED', flag)
      for (const path of paths) {
        expect(calendarReadScope(path, '', '', false, 'true', now, role)).toBe(flag === 'true' ? home : 'full')
      }
    }
  }
})

test.each(['user', 'leader', undefined] as const)('opt-in management leaves non-admin %s scope unchanged', role => {
  vi.stubEnv('VITE_DEMO_MODE', 'false')
  vi.stubEnv('VITE_ROUTE_LIGHTWEIGHT_ENABLED', 'true')
  for (const path of ['/users', '/settings/users', '/settings/meeting-notes']) {
    expect(calendarReadScope(path, '', '', false, 'true', now, role, 'Me')).toBe('full')
  }
  expect(calendarReadScope('/zone', '', '', false, 'true', now, role, 'Me'))
    .toBe(role === 'leader' ? 'service:["Me","2026-10-23",null]' : 'full')
})

test.each([
  [undefined, undefined, false], [undefined, 'true', true],
  ['true', 'false', true], ['false', 'true', false], ['false', undefined, false],
] as const)('shared calendar flag %s with demo %s resolves to %s', (flag, demo, enabled) => {
  vi.stubEnv('VITE_CALENDAR_WINDOW_ENABLED', flag)
  vi.stubEnv('VITE_DEMO_MODE', demo)
  expect(calendarWindowEnabled()).toBe(enabled)
})
test('production opt-in does not enable the pending demo return-detail optimization', () => {
  vi.stubEnv('VITE_DEMO_MODE', 'false')
  expect(calendarReadScope('/territory/regular/7', '', '', false, 'true', now, 'user', 'Me')).toBe('full')
  expect(calendarReadScope('/territory', '', '', false, 'true', now, 'user', 'Me')).toMatch(/^service:/)
})

test.each([
  { demo: 'false', flag: 'true', calendar: 'true', retained: true },
  { demo: 'false', flag: 'true', calendar: 'false', retained: false },
  { demo: 'true', flag: 'false', calendar: 'true', retained: false },
  { demo: 'true', flag: undefined, calendar: 'true', retained: true },
  { demo: 'false', flag: undefined, calendar: 'true', retained: false },
])('return detail calendar gate demo=$demo flag=$flag calendar=$calendar', ({ demo, flag, calendar, retained }) => {
  vi.stubEnv('VITE_DEMO_MODE', demo)
  vi.stubEnv('VITE_RETURN_DETAIL_RETENTION_ENABLED', flag)
  const detail = calendarReadScope('/territory/regular/7', '', '', false, calendar, now, 'user', 'Me')
  expect(detail).toBe(retained ? calendarReadScope('/territory', '', '', false, calendar, now, 'user', 'Me') : 'full')
  for (const role of ['leader', 'admin', 'developer'] as const) {
    expect(calendarReadScope('/territory/regular/7', '', '', false, calendar, now, role, 'Me')).toBe('full')
  }
  for (const search of ['?openEvent=7', '?openChat=7']) {
    expect(calendarReadScope('/territory/regular/7', search, '', false, calendar, now, 'user', 'Me')).toBe('full')
  }
})
test.each(['user', 'leader', 'admin', 'developer'] as const)('home detail keeps the %s home snapshot until editing demands history', role => {
  const home = calendarReadScope('/', '', '', false, 'true', now, role, 'Me')
  expect(calendarReadScope('/', '?openEvent=17', '', false, 'true', now, role, 'Me')).toBe(home)
  expect(calendarReadScope('/', '?openEvent=17', '', true, 'true', now, role, 'Me')).toBe('full')
  for (const flag of [undefined, 'false']) expect(calendarReadScope('/', '?openEvent=17', '', false, flag, now, role, 'Me')).toBe('full')
  for (const search of ['?openEvent=0', '?openEvent=bad', '?openEvent=17&openChat=17']) {
    expect(calendarReadScope('/', search, '', false, 'true', now, role, 'Me')).toBe('full')
  }
})
test('demo user return detail shares service calendar while other roles and production stay full', () => {
  vi.stubEnv('VITE_DEMO_MODE', 'true')
  const list = calendarReadScope('/territory', '', '', false, 'true', now, 'user', 'Me')
  for (const path of ['/territory/regular/7', '/territory/regular/7/']) {
    expect(calendarReadScope(path, '', '', false, 'true', now, 'user', 'Me')).toBe(list)
    for (const role of ['leader', 'admin', 'developer'] as const) expect(calendarReadScope(path, '', '', false, 'true', now, role, 'Me')).toBe('full')
    for (const demo of [undefined, 'false']) expect(calendarReadScope(path, '', '', false, demo, now, 'user', 'Me')).toBe('full')
    for (const search of ['?openEvent=5', '?openChat=5']) expect(calendarReadScope(path, search, '', false, 'true', now, 'user', 'Me')).toBe('full')
  }
  expect(calendarReadScope('/territory/regular/0', '', '', false, 'true', now, 'user', 'Me')).toBe('full')
})
test('month bounds handle leap years and year rollover', () => {
  expect(calendarReadScope('/calendar', '', '2028-02', false, 'true', now)).toBe('window:2028-02-01:2028-02-29')
  expect(calendarReadScope('/', '', '', false, 'true', new Date('2026-12-23T12:00:00'))).toBe('window:2026-12-09:2027-01-31')
})

test('first calendar entry requests this month before the calendar mounts, without changing home or deep links', () => {
  expect(calendarReadScope('/calendar', '', '', false, 'true', now)).toBe('window:2026-10-01:2026-10-31')
  expect(calendarReadScope('/calendar', '', '', false, 'true', new Date('2028-02-20T12:00:00'))).toBe('window:2028-02-01:2028-02-29')
  expect(calendarReadScope('/calendar', '', '', false, 'true', new Date('2026-12-20T12:00:00'))).toBe('window:2026-12-01:2026-12-31')
  expect(calendarReadScope('/calendar', '', '2026-08', false, 'true', now)).toBe('window:2026-08-01:2026-08-31')
  expect(calendarReadScope('/', '', '', false, 'true', now)).toBe('window:2026-10-09:2026-11-30')
  for (const search of ['?openEvent=7&comment=9', '?openChat=7']) {
    expect(calendarReadScope('/calendar', search, '', false, 'true', now)).toBe('full')
  }
  expect(calendarReadScope('/calendar', '', '', true, 'true', now)).toBe('full')
  expect(calendarReadScope('/calendar', '', '', false, 'false', now)).toBe('full')
})
test('bounded read rejects future rows outside the requested month', async () => {
  state.query.mockResolvedValue({ data: [{ ...event, event_date: '2027-08-08' }], error: null })
  await expect(readScopedCalendar('window:2026-08-01:2026-08-31')).rejects.toThrow('Invalid scoped')
  expect(state.calls).toHaveLength(1)
})
test('demo home uses recent and future dates; calendar expands to any old month', () => {
  expect(calendarReadScope('/', '', '', false, 'true', now)).toBe('window:2026-10-09:2026-11-30')
  expect(calendarReadScope('/calendar', '', '2026-08', false, 'true', now)).toBe('window:2026-08-01:2026-08-31')
  expect(calendarReadScope('/calendar', '', '2027-01', false, 'true', now)).toBe('window:2027-01-01:2027-01-31')
})
test.each(['/stats', '/stats/attendance', '/assignment', '/territory', '/map'])('full consumer %s never loses old history', path => {
  expect(calendarReadScope(path, '', '2026-08', false, 'true', now)).toBe('full')
})
test('production, editor/export and old-event deep links retain full reads', () => {
  for (const flag of [undefined, 'false']) expect(calendarReadScope('/', '', '', false, flag, now)).toBe('full')
  expect(calendarReadScope('/calendar', '', '2026-08', true, 'true', now)).toBe('full')
  for (const query of ['?openChat=7', '?openEvent=7']) expect(calendarReadScope('/calendar', query, '', false, 'true', now)).toBe('full')
})
test.each(['admin', 'developer'] as const)('demo %s card allocation shares home scope without old calendar demand', role => {
  expect(calendarReadScope('/assignment', '', '2026-08', true, 'true', now, role))
    .toBe(calendarReadScope('/', '', '', false, 'true', now, role))
  expect(calendarReadScope('/stats', '', '2026-08', false, 'true', now, role)).toBe('full')
  for (const flag of [undefined, 'false']) expect(calendarReadScope('/assignment', '', '', false, flag, now, role)).toBe('full')
  expect(calendarReadScope('/assignment', '?openChat=7', '', false, 'true', now, role)).toBe('full')
})
test.each(['user', 'leader', undefined] as const)('non-admin %s allocation stays conservative', role => {
  expect(calendarReadScope('/assignment', '', '', false, 'true', now, role)).toBe('full')
})
test('old month keeps applicants, guests, assignments and attendance counts in one request', async () => {
  const rows = await readScopedCalendar('window:2026-08-01:2026-08-31')
  expect(rows[0]).toMatchObject({ applicants: ['A', 'Guest'], guests: ['Guest'], cardAssignments: [{ assignedCardId: 10 }] })
  expect(attendanceMeetings(rows, '2026-08', now)[0].count).toBe(2)
  expect(state.calls).toHaveLength(1)
  expect(state.calls[0].filters).toEqual([['event_date', '2026-08-01'], ['event_date', '2026-08-31']])
  expect(state.calls[0].columns).toContain('event_card_assignments(*),event_card_assignment_cards(*)')
})
test('multi-card links and other teams arrive embedded, never filtered by user', async () => {
  state.query.mockResolvedValue({ data: [embedded(event, [assignment, { id: 2, event_id: 7, user_name: 'B', assigned_card_id: 20 }],
    [{ id: 5, event_id: 7, user_name: 'B', card_id: 21 }])], error: null })
  const [row] = await readScopedCalendar('window:2026-08-01:2026-08-31')
  expect(row.cardAssignments).toEqual(expect.arrayContaining([
    expect.objectContaining({ userName: 'A', assignedCardId: 10 }),
    expect.objectContaining({ userName: 'B', assignedCardIds: [21] }),
  ]))
})
test('empty month does not request either entire assignment table', async () => {
  state.query.mockResolvedValue({ data: [], error: null })
  expect(await readScopedCalendar('since:2026-08-01')).toEqual([])
  expect(state.calls.map(c => c.table)).toEqual(['calendar_events'])
})
test.each(['event_card_assignments', 'event_card_assignment_cards'])('an embedded %s list as long as a page falls back to reading every page', async table => {
  const full = Array.from({ length: 1000 }, (_, i) => ({ ...assignment, id: i + 1, card_id: 10 }))
  state.query.mockImplementation(async (name: string, from: number) => name === 'calendar_events'
    ? { data: [embedded(event, table === 'event_card_assignments' ? full : [], table === 'event_card_assignment_cards' ? full : [])], error: null }
    : { data: name === table && from === 0 ? full : name === table ? [{ ...assignment, id: 1001, card_id: 10 }] : [], error: null })
  await readScopedCalendar('since:2026-08-01')
  expect(state.calls.some(c => c.table === table && c.from === 1000)).toBe(true)
})
test('more than 1000 events and their participants survive paging without assignment table reads', async () => {
  state.query.mockImplementation(async (table, from) => ({ data: table === 'calendar_events'
    ? from === 0 ? Array.from({ length: 1000 }, (_, i) => embedded({ ...event, id: i + 1 })) : [embedded({ ...event, id: 1001 })]
    : [], error: null }))
  const rows = await readScopedCalendar('since:2026-08-01')
  expect(rows).toHaveLength(1001)
  expect(rows[1000].applicants).toEqual(['A', 'Guest'])
  expect(state.calls.filter(c => c.table !== 'calendar_events')).toHaveLength(0)
})
test('a failed or out-of-range event read is rejected', async () => {
  state.query.mockResolvedValue({ data: [], error: new Error('offline') })
  await expect(readScopedCalendar('since:2026-08-01')).rejects.toThrow('offline')
  state.query.mockResolvedValue({ data: [embedded({ ...event, event_date: '2020-01-01' })], error: null })
  await expect(readScopedCalendar('since:2026-08-01')).rejects.toThrow('Invalid scoped')
})
test.each([
  ['a foreign assignment', embedded(event, [{ ...assignment, event_id: 999 }])],
  ['a foreign card link', embedded(event, [], [{ id: 5, event_id: 999, user_name: 'A', card_id: 1 }])],
  ['missing assignments', { ...event, event_card_assignment_cards: [] }],
  ['missing card links', { ...event, event_card_assignments: [] }],
])('rejects %s instead of showing an incomplete team', async (_label, row) => {
  state.query.mockResolvedValue({ data: [row], error: null })
  await expect(readScopedCalendar('since:2026-08-01')).rejects.toThrow('Invalid embedded calendar assignment')
})
test('a failed fallback page read is not treated as complete', async () => {
  const full = Array.from({ length: 1000 }, (_, i) => ({ ...assignment, id: i + 1 }))
  state.query.mockImplementation(async (name: string) => name === 'calendar_events'
    ? { data: [embedded(event, full)], error: null } : { data: [], error: name === 'event_card_assignments' ? new Error('offline') : null })
  await expect(readScopedCalendar('since:2026-08-01')).rejects.toThrow('offline')
})
