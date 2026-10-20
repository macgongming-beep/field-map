import { cleanup, render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, expect, test, vi } from 'vitest'
import { AppHeaderActionButtons } from './AppHeader'

const chats = vi.hoisted(() => vi.fn(() => ({ totalUnread: 3, markChatReadLocally: vi.fn() })))
vi.mock('../hooks/useUserChats', () => ({ useUserChats: chats }))
vi.mock('../hooks/useNotifications', () => ({
  useNotifications: () => ({ notifications: [], markRead: vi.fn(), markAllRead: vi.fn(), clearReadNotifications: vi.fn() }),
}))
vi.mock('./GlobalChatModal', () => ({ GlobalChatModal: () => null }))
vi.mock('./NotificationCenter', () => ({ NotificationCenter: () => null }))

afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
  vi.clearAllMocks()
})

test.each(['true', 'false', undefined])('header badge mode is demo-only (%s)', (demo) => {
  vi.stubEnv('VITE_DEMO_MODE', demo)
  render(<MemoryRouter><AppHeaderActionButtons userId={10} userName="test-user" /></MemoryRouter>)
  expect(chats).toHaveBeenCalledWith(10, 'test-user', { badgeOnly: demo === 'true' })
})
