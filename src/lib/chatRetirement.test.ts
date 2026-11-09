import { afterEach, expect, test, vi } from 'vitest'
import { chatDisabled, isRetiredChatNotification } from './chatRetirement'
import { normalizeAppLink } from '../utils/appNavigation'

afterEach(() => vi.unstubAllEnvs())
test.each([
  [undefined, undefined, false], ['true', undefined, true], ['false', 'true', false], [undefined, 'true', true],
])('chat retirement flag %s demo %s = %s', (flag, demo, result) => {
  expect(chatDisabled(flag, demo)).toBe(result)
})
test.each(['/calendar?openChat=17', '/calendar/events/17/chat', '/calendar/events/17'])('old route goes to event detail when retired: %s', (link) => {
  vi.stubEnv('VITE_CHAT_DISABLED', 'true')
  expect(normalizeAppLink(link)).toBe('/calendar?openEvent=17')
  vi.stubEnv('VITE_CHAT_DISABLED', 'false')
  expect(normalizeAppLink(link)).toBe('/calendar?openChat=17')
})
test('cleanup preserves comments and event changes even when a legacy chat link is present', () => {
  expect(isRetiredChatNotification({ type: 'chat', link: null })).toBe(true)
  expect(isRetiredChatNotification({ type: 'mention', link: '/calendar?openChat=17' })).toBe(true)
  for (const row of [
    { type: 'comment', link: '/calendar?openEvent=17' },
    { type: 'mention', link: '/calendar?openEvent=17' },
    { type: 'event_change', link: '/calendar?openChat=17' },
    { type: 'mention', link: '/calendar?openChat=17oops' },
  ]) expect(isRetiredChatNotification(row)).toBe(false)
})
