import { afterEach, expect, test, vi } from 'vitest'
import { teamServiceEnabled } from './teamService'
afterEach(() => vi.unstubAllEnvs())
test('production can enable team assignments without demo mode', () => {
  vi.stubEnv('VITE_DEMO_MODE', 'false')
  vi.stubEnv('VITE_TEAM_SERVICE_ENABLED', 'true')
  expect(teamServiceEnabled()).toBe(true)
  expect(import.meta.env.VITE_DEMO_MODE).toBe('false')
})
test('disabled production stays on legacy behaviour', () => {
  vi.stubEnv('VITE_DEMO_MODE', 'false')
  vi.stubEnv('VITE_TEAM_SERVICE_ENABLED', 'false')
  expect(teamServiceEnabled()).toBe(false)
})
test('demo retains team assignment testing', () => {
  vi.stubEnv('VITE_DEMO_MODE', 'true')
  vi.stubEnv('VITE_TEAM_SERVICE_ENABLED', 'false')
  expect(teamServiceEnabled()).toBe(true)
})
