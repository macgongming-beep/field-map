import { cleanup, renderHook } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { useSettingsCalendarScope } from './useSettingsCalendarScope'

afterEach(() => { cleanup(); vi.unstubAllEnvs() })
const home = 'window:2026-10-12:2026-11-30'
test.each([home, 'window:2026-08-01:2026-08-31', 'service:["Me","2026-10-26",null]'])('personal settings retain %s across round trips', scope => {
  vi.stubEnv('VITE_DEMO_MODE', 'true')
  const { result, rerender } = renderHook(({ requested, path }) => useSettingsCalendarScope(requested, path, '', home, true),
    { initialProps: { requested: scope, path: '/calendar' } })
  for (const path of ['/settings', '/settings/profile', '/settings/notification', '/privacy']) {
    rerender({ requested: 'full', path })
    expect(result.current).toBe(scope)
  }
  rerender({ requested: scope, path: '/calendar' })
  expect(result.current).toBe(scope)
  rerender({ requested: 'full', path: '/stats' })
  expect(result.current).toBe('full')
})
test('direct settings entry is bounded; editor/deep links remain full', () => {
  vi.stubEnv('VITE_DEMO_MODE', 'true')
  const { result, rerender } = renderHook(({ path, search }) => useSettingsCalendarScope('full', path, search, home, true),
    { initialProps: { path: '/settings', search: '' } })
  expect(result.current).toBe(home)
  rerender({ path: '/settings', search: '?openEvent=9' })
  expect(result.current).toBe('full')
  rerender({ path: '/settings/users', search: '' })
  expect(result.current).toBe('full')
})
test.each([
  ['true', 'false', true], ['false', undefined, true], ['true', 'true', false],
] as const)('disabled gates keep old settings reads (%s %s %s)', (demo, flag, windowed) => {
  vi.stubEnv('VITE_DEMO_MODE', demo)
  vi.stubEnv('VITE_SETTINGS_CALENDAR_RETENTION_ENABLED', flag)
  expect(renderHook(() => useSettingsCalendarScope('full', '/settings', '', home, windowed)).result.current).toBe('full')
})
