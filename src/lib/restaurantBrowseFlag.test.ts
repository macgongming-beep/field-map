import { afterEach, expect, test, vi } from 'vitest'
import { restaurantBrowseEnabled } from './restaurantBrowseFlag'

afterEach(() => vi.unstubAllEnvs())

test.each([
  [undefined, undefined, false],
  [undefined, 'true', true],
  ['true', undefined, true],
  ['false', 'true', false],
  ['false', undefined, false],
  ['', 'true', false],
  ['TRUE', undefined, false],
])('catalog opt-in %s with demo %s resolves to %s', (enabled, demo, expected) => {
  vi.stubEnv('VITE_RESTAURANT_BROWSE_ENABLED', enabled)
  vi.stubEnv('VITE_DEMO_MODE', demo)
  expect(restaurantBrowseEnabled()).toBe(expected)
})
