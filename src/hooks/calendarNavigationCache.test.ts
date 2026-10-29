import { afterEach, expect, test, vi } from 'vitest'
import type { CalendarEvent } from '../types'
import { calendarNavigationReuseEnabled, readCalendarNavigationCache, type CalendarSnapshot } from './calendarNavigationCache'

afterEach(() => vi.unstubAllEnvs())
const service = (user: string, date: string, target: number | null) => `service:${JSON.stringify([user, date, target])}`
const base = service('A', '2026-10-30', null)
const target = service('A', '2026-10-30', 1)
const events = [{ id: 1, date: '2026-08-02', applicants: ['A', 'Other'], cardAssignments: [
  { userName: 'A', assignedCardId: 10 }, { userName: 'Other', assignedCardId: 20 },
] }, { id: 2, date: '2027-08-01', applicants: [], cardAssignments: [] }] as CalendarEvent[]
const cache = (key = base, at = 1000) => new Map<string, CalendarSnapshot>([[key, { events, at }]])

test.each([
  [undefined, undefined, false], [undefined, 'true', true], ['true', 'false', true], ['false', 'true', false],
] as const)('navigation reuse opt-in: %s / %s', (flag, demo, expected) => {
  expect(calendarNavigationReuseEnabled(flag, demo)).toBe(expected)
})

test('base service cache preserves old/future records and all teams when target already exists', () => {
  vi.stubEnv('VITE_CALENDAR_NAVIGATION_REUSE_ENABLED', 'true')
  expect(readCalendarNavigationCache(cache(), target, 2000)).toBe(events)
})

test.each([
  service('B', '2026-10-30', 1), service('A', '2026-10-31', 1), service('A', '2026-10-30', 99),
  'full', 'service:bad', 'service:["A","2026-10-30",-1]', 'window:2026-10-01:2026-10-31',
])('cannot reuse an incompatible or absent target: %s', scope => {
  vi.stubEnv('VITE_CALENDAR_NAVIGATION_REUSE_ENABLED', 'true')
  expect(readCalendarNavigationCache(cache(), scope, 2000)).toBeUndefined()
})

test('targeted service cache does not stand in for base or another target', () => {
  vi.stubEnv('VITE_CALENDAR_NAVIGATION_REUSE_ENABLED', 'true')
  expect(readCalendarNavigationCache(cache(target), base, 2000)).toBeUndefined()
  expect(readCalendarNavigationCache(cache(target), service('A', '2026-10-30', 2), 2000)).toBeUndefined()
})

test('covering date window returns only requested dates and preserves participants/teams', () => {
  vi.stubEnv('VITE_CALENDAR_NAVIGATION_REUSE_ENABLED', 'true')
  const snapshots = cache('window:2026-08-01:2027-08-31')
  expect(readCalendarNavigationCache(snapshots, 'window:2026-08-01:2026-08-31', 2000)).toEqual([events[0]])
  expect(readCalendarNavigationCache(snapshots, 'window:2026-09-01:2026-09-30', 2000)).toEqual([])
  expect(readCalendarNavigationCache(snapshots, 'window:2026-07-01:2026-08-31', 2000)).toBeUndefined()
})

test('derived reuse never renews TTL or survives invalidation/clock reversal', () => {
  vi.stubEnv('VITE_CALENDAR_NAVIGATION_REUSE_ENABLED', 'true')
  const snapshots = cache()
  expect(readCalendarNavigationCache(snapshots, target, 120999)).toBe(events)
  expect(snapshots.size).toBe(1)
  expect(readCalendarNavigationCache(snapshots, target, 121000)).toBeUndefined()
  expect(readCalendarNavigationCache(snapshots, target, 999)).toBeUndefined()
  snapshots.clear()
  expect(readCalendarNavigationCache(snapshots, target, 2000)).toBeUndefined()
})

test('explicit false keeps exact cache reuse but disables covering reuse even on demo', () => {
  vi.stubEnv('VITE_DEMO_MODE', 'true')
  vi.stubEnv('VITE_CALENDAR_NAVIGATION_REUSE_ENABLED', 'false')
  expect(readCalendarNavigationCache(cache(), target, 2000)).toBeUndefined()
  expect(readCalendarNavigationCache(cache(), base, 2000)).toBe(events)
})
