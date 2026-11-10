import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { NOTIFICATION_BADGE_COLUMNS, useNotifications } from './useNotifications'

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), token: 'token-a' }))
vi.mock('../lib/supabase', () => ({ supabase: { rpc: mocks.rpc } }))
vi.mock('../lib/authToken', () => ({ getAuthToken: () => mocks.token }))
vi.mock('../lib/activeChat', () => ({ isActiveChatLink: () => false }))
const row = { id: 1, user_id: 10, type: 'mention', title: 'Mention', body: 'Comment mention', link: '/calendar?openEvent=7', related_id: 7, is_read: false, created_at: '2026-11-10' }
type Reply = { data: typeof row[] | null; error: unknown }
function query(promise = Promise.resolve<Reply>({ data: [row], error: null })) {
  return Object.assign(promise, { select: vi.fn(() => promise) })
}
beforeEach(() => {
  mocks.token = 'token-a'
  mocks.rpc.mockReset().mockReturnValue(query())
  vi.stubEnv('VITE_NOTIFICATION_COMMENT_SKIP_ENABLED', 'true')
  vi.stubEnv('VITE_DEMO_MODE', 'false')
})
afterEach(() => { cleanup(); vi.unstubAllEnvs(); vi.useRealTimers(); vi.restoreAllMocks() })

test.each([
  [undefined, 'false', false], [undefined, 'true', true],
  ['true', 'false', true], ['false', 'true', false], ['false', 'false', false],
] as const)('flag=%s demo=%s selects filtered reader=%s', async (flag, demo, enabled) => {
  vi.stubEnv('VITE_NOTIFICATION_COMMENT_SKIP_ENABLED', flag)
  vi.stubEnv('VITE_DEMO_MODE', demo)
  renderHook(() => useNotifications(10))
  await act(async () => {})
  expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith(enabled ? 'get_my_notification_feed' : 'get_my_notifications', { p_token: 'token-a', p_limit: 50 })
})

test('badge, minute polling and full panel all use the filtered RPC; mention content survives', async () => {
  vi.useFakeTimers()
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false)
  const reply = query()
  mocks.rpc.mockReturnValue(reply)
  const { result, rerender } = renderHook(({ badgeOnly }) => useNotifications(10, { badgeOnly }), { initialProps: { badgeOnly: true } })
  await act(async () => {})
  expect(reply.select).toHaveBeenCalledWith(NOTIFICATION_BADGE_COLUMNS)
  await act(async () => { await vi.advanceTimersByTimeAsync(60_000) })
  rerender({ badgeOnly: false })
  await act(async () => {})
  expect(mocks.rpc.mock.calls.map(([name]) => name)).toEqual(Array(3).fill('get_my_notification_feed'))
  expect(reply.select).toHaveBeenCalledTimes(2)
  expect(result.current.detailsReady).toBe(true)
  expect(result.current.notifications[0].body).toBe('Comment mention')
  expect(result.current.unreadCount).toBe(1)
})

test('new RPC failure is retryable and never silently falls back to the unfiltered reader', async () => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  mocks.rpc.mockReturnValueOnce(query(Promise.resolve({ data: null, error: new Error('offline') })))
  const { result } = renderHook(() => useNotifications(10))
  await act(async () => {})
  expect(result.current.error).toBe(true)
  expect(result.current.detailsReady).toBe(false)
  await act(async () => { await result.current.refetch() })
  expect(result.current.error).toBe(false)
  expect(mocks.rpc.mock.calls.map(([name]) => name)).toEqual(['get_my_notification_feed', 'get_my_notification_feed'])
})

test('changing read mode hides old rows immediately and rejects its in-flight response', async () => {
  let resolve!: (value: Reply) => void
  const pending = new Promise<Reply>(done => { resolve = done })
  const { result, rerender } = renderHook(() => useNotifications(10))
  await act(async () => {})
  mocks.rpc.mockReturnValueOnce(query(pending))
  act(() => { void result.current.refetch() })
  vi.stubEnv('VITE_NOTIFICATION_COMMENT_SKIP_ENABLED', 'false')
  rerender()
  expect(result.current.notifications).toEqual([])
  await act(async () => {})
  await act(async () => { resolve({ data: [{ ...row, id: 99 }], error: null }) })
  expect(result.current.notifications.map(n => n.id)).toEqual([1])
  expect(mocks.rpc).toHaveBeenLastCalledWith('get_my_notifications', { p_token: 'token-a', p_limit: 50 })
})

test('read and clear actions retain existing write RPCs with the filtered feed enabled', async () => {
  const { result } = renderHook(() => useNotifications(10))
  await act(async () => {})
  await act(async () => { await result.current.markRead(1) })
  expect(mocks.rpc).toHaveBeenLastCalledWith('mark_notification_read', { p_token: 'token-a', p_notification_id: 1 })
  await act(async () => { await result.current.refetch() })
  await act(async () => { await result.current.markAllRead() })
  expect(mocks.rpc).toHaveBeenLastCalledWith('mark_all_notifications_read', { p_token: 'token-a' })
  await act(async () => { await result.current.clearReadNotifications() })
  expect(mocks.rpc).toHaveBeenLastCalledWith('clear_read_notifications', { p_token: 'token-a' })
})
