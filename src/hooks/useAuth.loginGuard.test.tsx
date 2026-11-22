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

test('only five empty credential responses for the same ID show the retry hint; it never blocks login', async () => {
  const hook = renderHook(() => useAuth())
  await waitFor(() => expect(hook.result.current.loading).toBe(false))
  for (let i = 1; i <= 5; i++) {
    await act(async () => { await hook.result.current.login('member', 'wrong', true) })
    expect(hook.result.current.loginRetryHintFor).toBe(i < 5 ? null : 'member')
  }
  api.rpc.mockResolvedValue({ data: [row], error: null })
  await act(async () => { expect(await hook.result.current.login('member', 'valid', true)).toBe(true) })
  expect(hook.result.current.loginRetryHintFor).toBeNull()
})

test('failure hints do not carry across IDs or expired observation windows', async () => {
  const now = vi.spyOn(Date, 'now').mockReturnValue(100_000)
  try {
    const hook = renderHook(() => useAuth())
    for (let i = 0; i < 5; i++) await act(async () => { await hook.result.current.login('member', 'wrong', true) })
    expect(hook.result.current.loginRetryHintFor).toBe('member')
    now.mockReturnValue(1_000_001)
    await act(async () => { await hook.result.current.login('member', 'wrong', true) })
    expect(hook.result.current.loginRetryHintFor).toBeNull()
    for (let i = 0; i < 4; i++) await act(async () => { await hook.result.current.login('member', 'wrong', true) })
    expect(hook.result.current.loginRetryHintFor).toBe('member')
    await act(async () => { await hook.result.current.login('other', 'wrong', true) })
    expect(hook.result.current.loginRetryHintFor).toBeNull()
  } finally { now.mockRestore() }
})

test('network failures do not count as wrong passwords', async () => {
  const warn = vi.spyOn(console, 'error').mockImplementation(() => {})
  try {
    api.rpc.mockResolvedValue({ data: null, error: { message: 'offline' } })
    const hook = renderHook(() => useAuth())
    for (let i = 0; i < 6; i++) await act(async () => { await hook.result.current.login('member', 'valid', true) })
    expect(hook.result.current.loginRetryHintFor).toBeNull()
    api.rpc.mockResolvedValue({ data: [], error: null })
    await act(async () => { await hook.result.current.login('member', 'wrong', true) })
    expect(hook.result.current.loginRetryHintFor).toBeNull()
  } finally { warn.mockRestore() }
})

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

function rememberSession() {
  localStorage.setItem('auth_token', 'test-token')
  localStorage.setItem('auth_session', JSON.stringify({ id: 7, name: 'Stored', role: 'user', authToken: 'test-token' }))
}

test('a remembered session sends the user lookup with verification, but applies it only after the token passes', async () => {
  rememberSession()
  let releaseVerify!: () => void
  const verifyHeld = new Promise<void>(resolve => { releaseVerify = resolve })
  api.rpc.mockImplementation(async (name: string) => {
    if (name === 'verify_session') { await verifyHeld; return { data: 7, error: null } }
    return { data: [], error: null }
  })
  const single = vi.fn().mockResolvedValue({ data: row, error: null })
  api.from.mockReturnValue({ select: () => ({
    eq: () => ({ maybeSingle: single }), order: async () => ({ data: [], error: null }),
  }) })
  const hook = renderHook(() => useAuth())
  // The lookup is already in flight while verification is still pending.
  await waitFor(() => expect(single).toHaveBeenCalledTimes(1))
  expect(api.rpc).toHaveBeenCalledWith('verify_session', { p_token: 'test-token' })
  expect(hook.result.current.user).toBeNull()
  expect(hook.result.current.loading).toBe(true)
  releaseVerify()
  await waitFor(() => expect(hook.result.current.user).toMatchObject({ id: 7, name: 'Member' }))
  expect(api.rpc.mock.calls.some(([name]) => name === 'auth_login')).toBe(false)
})

test('an expired token discards a successful concurrent user lookup and shows login', async () => {
  rememberSession()
  api.rpc.mockImplementation(async (name: string) => name === 'verify_session'
    ? { data: null, error: { code: 'P0001', message: 'session expired' } }
    : { data: [], error: null })
  const single = vi.fn().mockResolvedValue({ data: row, error: null })
  api.from.mockReturnValue({ select: () => ({
    eq: () => ({ maybeSingle: single }), order: async () => ({ data: [], error: null }),
  }) })
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  try {
    const hook = renderHook(() => useAuth())
    await waitFor(() => expect(hook.result.current.loading).toBe(false))
    expect(hook.result.current.user).toBeNull()
    expect(localStorage.getItem('auth_token')).toBeNull()
  } finally { warn.mockRestore() }
})

test('a failed concurrent user lookup still restores the stored user once the token passes', async () => {
  rememberSession()
  api.rpc.mockImplementation(async (name: string) => name === 'verify_session' ? { data: 7, error: null } : { data: [], error: null })
  api.from.mockReturnValue({ select: () => ({
    eq: () => ({ maybeSingle: vi.fn().mockRejectedValue(new Error('offline')) }), order: async () => ({ data: [], error: null }),
  }) })
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  try {
    const hook = renderHook(() => useAuth())
    await waitFor(() => expect(hook.result.current.user).toMatchObject({ id: 7, name: 'Stored' }))
  } finally { warn.mockRestore() }
})
