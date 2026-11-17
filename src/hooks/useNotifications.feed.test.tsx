import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { NOTIFICATION_BADGE_COLUMNS, useNotifications } from './useNotifications'

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('../lib/supabase', () => ({ supabase: { rpc: mocks.rpc } }))
vi.mock('../lib/authToken', () => ({ getAuthToken: () => 'token' }))
vi.mock('../lib/activeChat', () => ({ isActiveChatLink: () => false }))
const mention = { id: 1, user_id: 10, type: 'mention', title: 'Mention', body: 'Hello', link: '/calendar?openEvent=7&comment=3', related_id: 3, is_read: false, created_at: '2026-11-17' }
afterEach(() => { cleanup(); vi.unstubAllEnvs(); vi.useRealTimers(); vi.restoreAllMocks(); mocks.rpc.mockReset() })

test.each(['false', 'true'])('badge and full feed use agreed filtering with group/revision flags=%s', async enabled => {
  vi.stubEnv('VITE_DEMO_MODE', 'false')
  vi.stubEnv('VITE_GROUP_SERVICE_ENABLED', enabled)
  vi.stubEnv('VITE_ASSIGNMENT_REVISION_ENABLED', enabled)
  vi.useFakeTimers()
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false)
  const select = vi.fn()
  mocks.rpc.mockImplementation((name: string) => {
    const data = name === 'get_my_notification_feed' ? [mention] : [mention, {...mention, id: 2, type: 'comment'}]
    const response = Promise.resolve({data, error: null})
    return Object.assign(response, {select: (columns: string) => { select(columns); return response }})
  })
  const { result, rerender } = renderHook(({badgeOnly}) => useNotifications(10, {badgeOnly}), {initialProps: {badgeOnly: true}})
  await act(async () => {})
  expect(result.current.unreadCount).toBe(1)
  expect(select).toHaveBeenCalledWith(NOTIFICATION_BADGE_COLUMNS)
  await act(async () => { await vi.advanceTimersByTimeAsync(60_000) })
  rerender({badgeOnly: false})
  await act(async () => {})
  expect(mocks.rpc.mock.calls.map(([name]) => name)).toEqual(Array(3).fill('get_my_notification_feed'))
  expect(result.current.notifications.map(row => row.type)).toEqual(['mention'])
  expect(result.current.notifications[0].link).toBe(mention.link)
  expect(result.current.detailsReady).toBe(true)
  expect(result.current.unreadCount).toBe(1)
})

test('missing feed reports failure without falling back to general comment notifications', async () => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  mocks.rpc.mockResolvedValue({data: null, error: {code: 'PGRST202', message: 'function missing'}})
  const { result } = renderHook(() => useNotifications(10))
  await act(async () => {})
  expect(result.current.error).toBe(true)
  expect(result.current.detailsReady).toBe(false)
  expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('get_my_notification_feed', {p_token: 'token', p_limit: 50})
})
