import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

const api = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn(), toast: vi.fn() }))
vi.mock('../lib/supabase', () => ({ supabase: { rpc: api.rpc, from: api.from } }))
vi.mock('../lib/toast', () => ({ showToast: api.toast }))
vi.mock('../lib/sentry', () => ({ setSentryUser: vi.fn(), clearSentryUser: vi.fn() }))
vi.mock('../lib/confirm', () => ({ promptDialog: vi.fn() }))
vi.mock('../lib/boundaryDeviceCache', () => ({ clearBoundaryDeviceCache: vi.fn() }))
vi.mock('../lib/userChatsCache', () => ({ clearUserChatsCache: vi.fn() }))
vi.mock('../lib/msg', () => ({ msg: (s: string) => s }))
vi.mock('../i18n', () => ({ currentLang: () => 'ko', t: (_lang: string, key: string) => key }))
import { useAuth } from './useAuth'

const row = { id: 7, name: 'Member', login_id: 'member', role: 'user', token: 'test-token', approval_status: 'approved' }
beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  vi.clearAllMocks()
  api.rpc.mockResolvedValue({ data: [], error: null })
  api.from.mockImplementation(() => {
    expect(localStorage.getItem('auth_token') ?? sessionStorage.getItem('auth_token')).toBe('test-token')
    return { select: () => ({ order: async () => ({ data: [], error: null }) }) }
  })
})
afterEach(cleanup)

test.each([true, false])('successful login preserves role and stores the session before subsequent reads (persistent=%s)', async (persistent) => {
  api.rpc.mockResolvedValue({ data: [row], error: null })
  const hook = renderHook(() => useAuth())
  await waitFor(() => expect(hook.result.current.loading).toBe(false))
  await act(async () => { expect(await hook.result.current.login(' member ', 'valid', persistent)).toBe(true) })
  expect(hook.result.current.user).toMatchObject({ id: 7, role: 'user', authToken: 'test-token' })
  const storage = persistent ? localStorage : sessionStorage
  expect(storage.getItem('auth_token')).toBe('test-token')
  expect(JSON.parse(storage.getItem('auth_session')!)).toMatchObject({ id: 7, authToken: 'test-token' })
  expect(api.rpc).toHaveBeenCalledExactlyOnceWith('auth_login', expect.objectContaining({ p_login_id: 'member', p_pin: 'valid' }))
  expect(api.from).toHaveBeenCalledWith('app_users')
})

test.each(['wrong', 'unknown', 'locked'])('%s empty response is an ordinary failure, never retries the old RPC or stores a session', async () => {
  const hook = renderHook(() => useAuth())
  await waitFor(() => expect(hook.result.current.loading).toBe(false))
  await act(async () => { expect(await hook.result.current.login('member', 'invalid', true)).toBe(false) })
  expect(api.rpc).toHaveBeenCalledTimes(1)
  expect(hook.result.current.user).toBeNull()
  expect(localStorage.getItem('auth_token')).toBeNull()
  expect(api.toast).toHaveBeenCalledWith('아이디 또는 비밀번호가 일치하지 않습니다.', 'error')
})

test.each(['pending', 'blocked'])('%s correct-password response retains approval flow without storing token', async (status) => {
  api.rpc.mockResolvedValue({ data: [{ ...row, token: null, approval_status: status }], error: null })
  const hook = renderHook(() => useAuth())
  await waitFor(() => expect(hook.result.current.loading).toBe(false))
  await act(async () => { expect(await hook.result.current.login('member', 'valid', true)).toBe(false) })
  expect(hook.result.current.user).toBeNull()
  expect(localStorage.getItem('auth_session')).toBeNull()
})

test('a remembered live session is verified before the directory request and does not call login again', async () => {
  localStorage.setItem('auth_token', 'test-token')
  localStorage.setItem('auth_session', JSON.stringify({ id: 7, name: 'Member', role: 'user', authToken: 'test-token' }))
  api.rpc.mockResolvedValue({ data: 7, error: null })
  const single = vi.fn().mockImplementation(async () => {
    expect(api.rpc).toHaveBeenCalledWith('verify_session', { p_token: 'test-token' })
    expect(localStorage.getItem('auth_token')).toBe('test-token')
    return { data: row, error: null }
  })
  api.from.mockReturnValue({ select: () => ({
    eq: () => ({ maybeSingle: single }), order: async () => ({ data: [], error: null }),
  }) })
  const hook = renderHook(() => useAuth())
  await waitFor(() => expect(hook.result.current.user?.id).toBe(7))
  expect(single).toHaveBeenCalledTimes(1)
  expect(api.rpc.mock.calls.some(([name]) => name === 'auth_login')).toBe(false)
})
