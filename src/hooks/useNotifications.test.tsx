import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { useNotifications } from './useNotifications'
import { useUserChats } from './useUserChats'

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), channel: vi.fn(), removeChannel: vi.fn() }))
vi.mock('../lib/supabase', () => ({ supabase: mocks }))
vi.mock('../lib/authToken', () => ({ getAuthToken: () => 'test-token' }))
vi.mock('../lib/activeChat', () => ({ isActiveChatLink: () => false }))
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.clearAllMocks() })
test('private notifications use authenticated RPC without a forbidden table subscription', async () => {
  vi.useFakeTimers()
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false)
  const notification = { id: 1, user_id: 10, type: 'notice', title: 'test', body: null, link: null, related_id: null, is_read: false, created_at: '2026-10-01' }
  mocks.rpc.mockResolvedValue({ data: [notification], error: null })
  const { result } = renderHook(() => useNotifications(10))
  await act(async () => {})
  expect(mocks.channel).not.toHaveBeenCalled()
  expect(mocks.rpc).toHaveBeenCalledWith('get_my_notifications', { p_token: 'test-token', p_limit: 50 })
  expect(result.current.unreadCount).toBe(1)
  mocks.rpc.mockResolvedValue({ data: [{ ...notification, is_read: true }], error: null })
  await act(async () => { await vi.advanceTimersByTimeAsync(60_000) })
  expect(result.current.unreadCount).toBe(0)
  expect(mocks.rpc).toHaveBeenCalledTimes(2)
})

test('chat keeps public message signals without subscribing to private read receipts', async () => {
  const channel = { on: vi.fn(), subscribe: vi.fn(), unsubscribe: vi.fn() }
  channel.on.mockReturnValue(channel)
  mocks.channel.mockReturnValue(channel)
  // The list RPC path may be unavailable here; subscription wiring is independent.
  mocks.rpc.mockResolvedValue({ data: [], error: null })
  renderHook(() => useUserChats(10, 'test'))
  await act(async () => {})
  const tables = channel.on.mock.calls.map((call) => call[1].table)
  expect(tables).toContain('chat_message_signals')
  expect(tables).not.toContain('chat_read_status')
})
