import { afterEach, expect, test, vi } from 'vitest'
import { recipientCardScopeEnabled } from './recipientCardScope'
afterEach(() => vi.unstubAllEnvs())
test.each([
  { demo: undefined, flag: undefined, enabled: false },
  { demo: undefined, flag: 'false', enabled: false },
  { demo: undefined, flag: 'true', enabled: true },
  { demo: 'false', flag: undefined, enabled: false },
  { demo: 'false', flag: 'false', enabled: false },
  { demo: 'false', flag: 'true', enabled: true },
  { demo: 'true', flag: undefined, enabled: true },
  { demo: 'true', flag: 'false', enabled: false },
  { demo: 'true', flag: 'true', enabled: true },
])('card scope gate: demo=$demo flag=$flag', ({ demo, flag, enabled }) => {
  vi.stubEnv('VITE_DEMO_MODE', demo)
  vi.stubEnv('VITE_RECIPIENT_CARD_SCOPE_ENABLED', flag)
  expect(recipientCardScopeEnabled('user', true)).toBe(enabled)
  for (const role of ['leader', 'admin', 'developer', '']) expect(recipientCardScopeEnabled(role, true)).toBe(false)
  expect(recipientCardScopeEnabled('user', false)).toBe(false)
})
