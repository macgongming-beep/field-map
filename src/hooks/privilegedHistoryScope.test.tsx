import { renderHook } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { privilegedHistoryScope, VisitRecencyContext, useVisitRecency } from './privilegedHistoryScope'

afterEach(() => vi.unstubAllEnvs())
test.each(['admin', 'leader'] as const)('%s uses dates only on audited routes', role => {
  vi.stubEnv('VITE_PRIVILEGED_HISTORY_DEMAND_ENABLED', 'true')
  for (const path of ['/', '/home', '/calendar', '/zone']) expect(privilegedHistoryScope(role, path, '', false)).toBe('summary')
  for (const path of ['/map', '/territory', '/stats', '/service-logs', '/settings/service-logs', '/unknown']) {
    expect(privilegedHistoryScope(role, path, '', false)).toBe('full')
  }
  expect(privilegedHistoryScope(role, '/zone', '', true)).toBe('full')
  expect(privilegedHistoryScope(role, '/zone', '?view=map', false)).toBe('full')
})
test.each(['user', 'developer'] as const)('%s never uses privileged summary', role => {
  vi.stubEnv('VITE_PRIVILEGED_HISTORY_DEMAND_ENABLED', 'true')
  expect(privilegedHistoryScope(role, '/', '', false)).toBeUndefined()
})
test.each([
  ['false', undefined, false], ['false', 'true', true], ['true', undefined, true], ['true', 'false', false],
] as const)('opt-in demo=%s flag=%s', (demo, flag, enabled) => {
  vi.stubEnv('VITE_DEMO_MODE', demo)
  vi.stubEnv('VITE_PRIVILEGED_HISTORY_DEMAND_ENABLED', flag)
  expect(privilegedHistoryScope('admin', '/', '', false)).toBe(enabled ? 'summary' : undefined)
})
test('date consumers use separate context, never fabricated full histories', () => {
  const dates = [{ id: 9, unitId: 2, visitedAt: '2026-11-12', createdAt: '2026-11-12T00:00:00Z' }]
  const { result } = renderHook(() => useVisitRecency([]), {
    wrapper: ({ children }) => <VisitRecencyContext.Provider value={dates}>{children}</VisitRecencyContext.Provider>,
  })
  expect(result.current).toBe(dates)
})
