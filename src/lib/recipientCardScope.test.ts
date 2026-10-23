import { afterEach, expect, test, vi } from 'vitest'
import { recipientCardScopeEnabled } from './recipientCardScope'
afterEach(() => vi.unstubAllEnvs())
test.each(['true', 'false', undefined])('requires demo and explicit opt-in (%s)', demo => {
  vi.stubEnv('VITE_DEMO_MODE', demo)
  vi.stubEnv('VITE_RECIPIENT_CARD_SCOPE_ENABLED', 'true')
  expect(recipientCardScopeEnabled('user', true)).toBe(demo === 'true')
  for (const role of ['leader', 'admin', 'developer']) expect(recipientCardScopeEnabled(role, true)).toBe(false)
  expect(recipientCardScopeEnabled('user', false)).toBe(false)
  vi.stubEnv('VITE_RECIPIENT_CARD_SCOPE_ENABLED', 'false')
  expect(recipientCardScopeEnabled('user', true)).toBe(false)
})
