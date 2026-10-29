import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { NOTIFICATION_BADGE_COLUMNS, useNotifications } from './useNotifications'

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), token: 'token-a', active: false }))
vi.mock('../lib/supabase', () => ({ supabase: { rpc: mocks.rpc } }))
vi.mock('../lib/authToken', () => ({ getAuthToken: () => mocks.token }))
vi.mock('../lib/activeChat', () => ({ isActiveChatLink: () => mocks.active }))

const row = { id: 1, user_id: 10, type: 'assignment', title: 'Assigned', body: 'Full body', link: '/territory', related_id: 7, is_read: false, created_at: '2026-10-30' }
type Reply = { data: typeof row[] | null; error: unknown }
function deferred() {
  let resolve!: (reply: Reply) => void
  const promise = new Promise<Reply>((done) => { resolve = done })
  return { promise, resolve }
}
function query(promise = Promise.resolve<Reply>({ data: [row], error: null })) {
  const select = vi.fn(() => promise.then((reply) => ({ ...reply, data: reply.data?.map(({ title: _title, body: _body, ...meta }) => meta) })))
  return Object.assign(promise, { select })
}
beforeEach(() => { mocks.token = 'token-a'; mocks.active = false; mocks.rpc.mockReset() })
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks() })

test('badge reads exactly the same 50-row RPC with no title/body, and polls metadata', async () => {
  vi.useFakeTimers()
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false)
  const response = query()
  mocks.rpc.mockReturnValue(response)
  const { result } = renderHook(() => useNotifications(10, { badgeOnly: true }))
  await act(async () => {})
  expect(response.select).toHaveBeenCalledWith(NOTIFICATION_BADGE_COLUMNS)
  expect(NOTIFICATION_BADGE_COLUMNS.split(',')).not.toContain('body')
  expect(NOTIFICATION_BADGE_COLUMNS.split(',')).not.toContain('title')
  expect(mocks.rpc).toHaveBeenCalledWith('get_my_notifications', { p_token: 'token-a', p_limit: 50 })
  expect(result.current.unreadCount).toBe(1)
  expect(result.current.detailsReady).toBe(false)
  expect(result.current.notifications[0].body).toBeNull()
  await act(async () => { await vi.advanceTimersByTimeAsync(60_000) })
  expect(response.select).toHaveBeenCalledTimes(2)
})

test('opening loads full bodies; a late badge response cannot overwrite them', async () => {
  const old = deferred()
  const badge = query(old.promise)
  const full = query()
  mocks.rpc.mockReturnValueOnce(badge).mockReturnValueOnce(full)
  const { result, rerender } = renderHook(({ badgeOnly }) => useNotifications(10, { badgeOnly }), { initialProps: { badgeOnly: true } })
  rerender({ badgeOnly: false })
  await act(async () => {})
  expect(full.select).not.toHaveBeenCalled()
  expect(result.current.detailsReady).toBe(true)
  expect(result.current.notifications[0].body).toBe('Full body')
  await act(async () => { old.resolve({ data: [{ ...row, is_read: true }], error: null }) })
  expect(result.current.unreadCount).toBe(1)
  expect(result.current.notifications[0].body).toBe('Full body')
})

test('closing ignores a late full response and resumes metadata reads', async () => {
  const old = deferred()
  mocks.rpc.mockReturnValueOnce(query(old.promise)).mockReturnValue(query())
  const { result, rerender } = renderHook(({ badgeOnly }) => useNotifications(10, { badgeOnly }), { initialProps: { badgeOnly: false } })
  rerender({ badgeOnly: true })
  await act(async () => {})
  await act(async () => { old.resolve({ data: [row], error: null }) })
  expect(result.current.detailsReady).toBe(false)
  expect(result.current.notifications[0].body).toBeNull()
})

test('failed full read retains badge count but never exposes metadata as full content; retry works', async () => {
  mocks.rpc.mockReturnValueOnce(query()).mockReturnValueOnce(query(Promise.resolve({ data: null, error: new Error('offline') }))).mockReturnValue(query())
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  const { result, rerender } = renderHook(({ badgeOnly }) => useNotifications(10, { badgeOnly }), { initialProps: { badgeOnly: true } })
  await act(async () => {})
  rerender({ badgeOnly: false })
  await act(async () => {})
  expect(result.current.error).toBe(true)
  expect(result.current.loading).toBe(false)
  expect(result.current.unreadCount).toBe(1)
  expect(result.current.detailsReady).toBe(false)
  await act(async () => { await result.current.refetch() })
  expect(result.current.error).toBe(false)
  expect(result.current.detailsReady).toBe(true)
})

test.each(['user', 'token'])('changing %s hides previous rows and discards in-flight reads', async (kind) => {
  const old = deferred()
  const next = deferred()
  mocks.rpc.mockReturnValueOnce(query()).mockReturnValueOnce(query(old.promise)).mockReturnValueOnce(query(next.promise))
  const { result, rerender } = renderHook(({ userId }) => useNotifications(userId, { badgeOnly: true }), { initialProps: { userId: 10 } })
  await act(async () => {})
  act(() => { void result.current.refetch() })
  if (kind === 'token') mocks.token = 'token-b'
  rerender({ userId: kind === 'user' ? 20 : 10 })
  expect(result.current.notifications).toEqual([])
  await act(async () => { old.resolve({ data: [row], error: null }) })
  expect(result.current.notifications).toEqual([])
  await act(async () => { next.resolve({ data: [], error: null }) })
  expect(result.current.notifications).toEqual([])
})

test.each(['markRead', 'markAllRead', 'clearReadNotifications'] as const)('%s cannot be undone by an older read', async (action) => {
  const initial = action === 'clearReadNotifications' ? { ...row, is_read: true } : row
  const old = deferred()
  mocks.rpc.mockReturnValueOnce(query(Promise.resolve({ data: [initial], error: null }))).mockReturnValueOnce(query(old.promise)).mockResolvedValue({ data: null, error: null })
  const { result } = renderHook(() => useNotifications(10))
  await act(async () => {})
  act(() => { void result.current.refetch() })
  await act(async () => { await result.current[action](1) })
  await act(async () => { old.resolve({ data: [initial], error: null }) })
  expect(result.current.unreadCount).toBe(0)
  if (action === 'clearReadNotifications') expect(result.current.notifications).toEqual([])
  expect(result.current.loading).toBe(false)
})

test('active-chat metadata still suppresses unread and uses the captured token', async () => {
  mocks.active = true
  mocks.rpc.mockReturnValueOnce(query(Promise.resolve({ data: [{ ...row, type: 'chat', link: '/calendar?openChat=7' }], error: null }))).mockResolvedValue({ data: null, error: null })
  const { result } = renderHook(() => useNotifications(10, { badgeOnly: true }))
  await act(async () => {})
  expect(result.current.unreadCount).toBe(0)
  expect(mocks.rpc).toHaveBeenCalledWith('mark_notification_read', { p_token: 'token-a', p_notification_id: 1 })
})

test('an unmounted hook cannot accept responses or schedule another read', async () => {
  const pending = deferred()
  mocks.rpc.mockReturnValue(query(pending.promise))
  const { result, unmount } = renderHook(() => useNotifications(10, { badgeOnly: true }))
  const refetch = result.current.refetch
  unmount()
  await act(async () => { pending.resolve({ data: [row], error: null }); await refetch() })
  expect(mocks.rpc).toHaveBeenCalledTimes(1)
})

test('closing after clicking a notification waits for read acknowledgement before fetching its badge', async () => {
  const pendingWrite = deferred()
  mocks.rpc.mockReturnValueOnce(query()).mockReturnValueOnce(pendingWrite.promise)
    .mockReturnValue(query(Promise.resolve({ data: [{ ...row, is_read: true }], error: null })))
  const { result, rerender } = renderHook(({ badgeOnly }) => useNotifications(10, { badgeOnly }), { initialProps: { badgeOnly: false } })
  await act(async () => {})
  act(() => { void result.current.markRead(1) })
  rerender({ badgeOnly: true })
  await act(async () => {})
  expect(mocks.rpc).toHaveBeenCalledTimes(2)
  await act(async () => { pendingWrite.resolve({ data: null, error: null }) })
  expect(mocks.rpc).toHaveBeenCalledTimes(3)
  expect(result.current.unreadCount).toBe(0)
})
