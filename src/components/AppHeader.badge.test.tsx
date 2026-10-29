import { cleanup, render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, expect, test, vi } from 'vitest'
import { AppHeaderActionButtons } from './AppHeader'

const chats = vi.hoisted(() => vi.fn(() => ({ totalUnread: 3, markChatReadLocally: vi.fn() })))
const notifications = vi.hoisted(() => vi.fn(() => ({ notifications: [], markRead: vi.fn(), markAllRead: vi.fn(), clearReadNotifications: vi.fn() })))
vi.mock('../hooks/useUserChats', () => ({ useUserChats: chats }))
vi.mock('../hooks/useNotifications', () => ({
  useNotifications: notifications,
}))
vi.mock('./GlobalChatModal', () => ({ GlobalChatModal: () => null }))
vi.mock('./NotificationCenter', () => ({ NotificationCenter: () => null }))

afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
  vi.clearAllMocks()
})

test.each([
  ['true', undefined, undefined, true, true],
  ['false', undefined, undefined, false, false],
  [undefined, undefined, undefined, false, false],
  [undefined, 'true', 'false', true, false],
  [undefined, 'false', 'true', false, true],
  ['false', 'true', 'true', true, true],
  ['true', 'false', undefined, false, true],
  ['true', undefined, 'false', true, false],
  ['true', 'false', 'false', false, false],
] as const)('independent header opt-ins: demo=%s notifications=%s chat=%s', (demo, notificationFlag, chatFlag, notificationBadge, chatBadge) => {
  vi.stubEnv('VITE_DEMO_MODE', demo)
  vi.stubEnv('VITE_NOTIFICATION_BADGE_ONLY_ENABLED', notificationFlag)
  vi.stubEnv('VITE_CHAT_BADGE_ONLY_ENABLED', chatFlag)
  render(<MemoryRouter><AppHeaderActionButtons userId={10} userName="test-user" /></MemoryRouter>)
  expect(chats).toHaveBeenCalledWith(10, 'test-user', { badgeOnly: chatBadge })
  expect(notifications).toHaveBeenCalledWith(10, { badgeOnly: notificationBadge })
})
