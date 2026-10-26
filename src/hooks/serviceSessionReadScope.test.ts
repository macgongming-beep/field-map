import { expect, test } from 'vitest'
import { recentSessionScope } from './serviceSessionReadScope'

const now = new Date(2026, 9, 26, 0, 15)
test.each(['user', 'leader', 'admin'] as const)('recent personal reads for %s retain the map cutoff margin', role => {
  expect(recentSessionScope(role, 'Me', undefined, 'true', now)).toEqual({ userName: 'Me', since: '2026-10-18' })
})
test.each([
  ['false', 'true', true], ['true', undefined, true], ['true', 'false', false],
  ['false', undefined, false], [undefined, undefined, false],
] as const)('flag contract demo=%s flag=%s', (demo, flag, enabled) => {
  expect(Boolean(recentSessionScope('admin', 'Me', flag, demo, now))).toBe(enabled)
})
test('developer statistics and missing authenticated identity retain legacy reads', () => {
  expect(recentSessionScope('developer', 'Me', 'true', 'true', now)).toBeNull()
  expect(recentSessionScope('admin', undefined, 'true', 'true', now)).toBeNull()
  expect(recentSessionScope('user', '', 'true', 'true', now)).toBeNull()
})
test('cutoff is a local calendar date across month/year and DST boundaries', () => {
  expect(recentSessionScope('user', 'Me', 'true', undefined, new Date(2027, 0, 3, 0, 5))?.since).toBe('2026-12-26')
  expect(recentSessionScope('user', 'Me', 'true', undefined, new Date(2026, 2, 10, 0, 5))?.since).toBe('2026-03-02')
})
