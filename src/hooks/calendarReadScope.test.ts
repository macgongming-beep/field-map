import { beforeEach, expect, test, vi } from 'vitest'
import { calendarReadScope, readScopedCalendar } from './calendarReadScope'
import { attendanceMeetings } from '../utils/serviceAttendance'

const state = vi.hoisted(() => ({ calls: [] as { table: string; filters: [string, unknown][]; from: number }[], query: vi.fn() }))
vi.mock('../lib/supabase', () => ({ supabase: { from: (table: string) => {
  const filters: [string, unknown][] = []
  const q = {
    select: () => q, order: () => q,
    gte: (key: string, value: string) => { filters.push([key, value]); return q },
    in: (key: string, value: number[]) => { filters.push([key, value]); return q },
    range: (from: number) => { state.calls.push({ table, filters, from }); return state.query(table, from, filters) },
  }
  return q
} } }))
const event = { id: 7, event_date: '2026-08-02', time: '10:00', title: 'Old meeting', leader_name: 'A',
  event_participants: [{ user_name: 'A', role: '입명' }, { user_name: 'Guest', role: '게스트' }] }
const assignment = { id: 1, event_id: 7, user_name: 'A', assigned_card_id: 10 }
beforeEach(() => {
  state.calls = []
  state.query.mockReset().mockImplementation(async (table: string) => ({ data: table === 'calendar_events' ? [event] : table === 'event_card_assignments' ? [assignment] : [], error: null }))
})
const now = new Date('2026-10-23T12:00:00')
test('demo home uses recent and future dates; calendar expands to any old month', () => {
  expect(calendarReadScope('/', '', '', false, 'true', now)).toBe('since:2026-10-09')
  expect(calendarReadScope('/calendar', '', '2026-08', false, 'true', now)).toBe('since:2026-08-01')
  expect(calendarReadScope('/calendar', '', '2027-01', false, 'true', now)).toBe('since:2026-10-09')
})
test.each(['/stats', '/stats/attendance', '/assignment', '/territory', '/map'])('full consumer %s never loses old history', path => {
  expect(calendarReadScope(path, '', '2026-08', false, 'true', now)).toBe('full')
})
test('production, editor/export and old-event deep links retain full reads', () => {
  for (const flag of [undefined, 'false']) expect(calendarReadScope('/', '', '', false, flag, now)).toBe('full')
  expect(calendarReadScope('/calendar', '', '2026-08', true, 'true', now)).toBe('full')
  for (const query of ['?openChat=7', '?openEvent=7']) expect(calendarReadScope('/calendar', query, '', false, 'true', now)).toBe('full')
})
test('old month keeps applicants, guests, assignments and attendance counts', async () => {
  const rows = await readScopedCalendar('since:2026-08-01')
  expect(rows[0]).toMatchObject({ applicants: ['A', 'Guest'], guests: ['Guest'], cardAssignments: [{ assignedCardId: 10 }] })
  expect(attendanceMeetings(rows, '2026-08', now)[0].count).toBe(2)
  expect(state.calls[0].filters).toEqual([['event_date', '2026-08-01']])
  expect(state.calls.slice(1).every(c => JSON.stringify(c.filters) === JSON.stringify([['event_id', [7]]]))).toBe(true)
})
test('empty month does not request either entire assignment table', async () => {
  state.query.mockResolvedValue({ data: [], error: null })
  expect(await readScopedCalendar('since:2026-08-01')).toEqual([])
  expect(state.calls.map(c => c.table)).toEqual(['calendar_events'])
})
test.each(['event_card_assignments', 'event_card_assignment_cards'])('all pages of %s are read', async table => {
  const original = state.query.getMockImplementation()!
  state.query.mockImplementation((name, from, filters) => name === table
    ? Promise.resolve({ data: from === 0 ? Array.from({ length: 1000 }, (_, i) => ({ ...assignment, id: i + 1, card_id: 10 })) : [], error: null })
    : original(name, from, filters))
  await readScopedCalendar('since:2026-08-01')
  expect(state.calls.some(c => c.table === table && c.from === 1000)).toBe(true)
})
test('more than 1000 events and their participants survive paging and batching', async () => {
  state.query.mockImplementation(async (table, from) => ({ data: table === 'calendar_events'
    ? from === 0 ? Array.from({ length: 1000 }, (_, i) => ({ ...event, id: i + 1 })) : [{ ...event, id: 1001 }]
    : [], error: null }))
  const rows = await readScopedCalendar('since:2026-08-01')
  expect(rows).toHaveLength(1001)
  expect(rows[1000].applicants).toEqual(['A', 'Guest'])
  expect(state.calls.filter(c => c.table === 'event_card_assignments')).toHaveLength(11)
})
test.each(['calendar_events', 'event_card_assignments', 'event_card_assignment_cards'])('rejects failed and foreign rows from %s', async table => {
  const original = state.query.getMockImplementation()!
  state.query.mockImplementation((name, from, filters) => name === table ? Promise.resolve({ data: [], error: new Error('offline') }) : original(name, from, filters))
  await expect(readScopedCalendar('since:2026-08-01')).rejects.toThrow('offline')
  state.query.mockImplementation((name, from, filters) => name === table ? Promise.resolve({ data: [table === 'calendar_events' ? { ...event, event_date: '2020-01-01' } : { ...assignment, event_id: 999 }], error: null }) : original(name, from, filters))
  await expect(readScopedCalendar('since:2026-08-01')).rejects.toThrow('Invalid scoped')
})
