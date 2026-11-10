import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
const api = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn(), toast: vi.fn(), writes: [] as object[], projections: [] as string[] }))
vi.mock('../lib/supabase', () => ({ supabase: { rpc: api.rpc, from: api.from } }))
vi.mock('../lib/toast', () => ({ showToast: api.toast }))
vi.mock('../lib/sentry', () => ({ setSentryUser: vi.fn(), clearSentryUser: vi.fn() }))
vi.mock('../lib/confirm', () => ({ promptDialog: vi.fn() }))
vi.mock('../lib/boundaryDeviceCache', () => ({ clearBoundaryDeviceCache: vi.fn() }))
vi.mock('../lib/userChatsCache', () => ({ clearUserChatsCache: vi.fn() }))
vi.mock('../lib/msg', () => ({ msg: (s: string) => s }))
vi.mock('../i18n', () => ({ currentLang: () => 'ko', t: (_lang: string, key: string) => key }))
import { useAuth } from './useAuth'
const self = { id: 1, name: 'Member', login_id: 'private-login', role: 'user', token: 'token-one', approval_status: 'approved' }
const directory = [{ id: 1, name: 'Member', role: 'user', created_at: '2026-01-01' }, { id: 2, name: 'Leader', role: 'leader', created_at: '2026-01-01' }]
beforeEach(() => {
  localStorage.clear(); sessionStorage.clear(); vi.resetAllMocks(); api.writes = []; api.projections = []
  vi.stubEnv('VITE_PRIVATE_USER_READS_ENABLED', 'true')
  api.rpc.mockImplementation(async (name: string) => ({ data: name === 'auth_login' ? [self] : name === 'get_user_directory' ? directory : true, error: null }))
  api.from.mockImplementation(() => {
    let updated = false
    const q = {
      select: (s: string) => { api.projections.push(s); return q },
      update: (value: object) => { updated = true; api.writes.push(value); return q },
      eq: () => q, neq: () => q,
      single: async () => ({ data: { phone: '010-own' }, error: null }),
      maybeSingle: async () => ({ data: null, error: null }),
      order: async () => ({ data: [{ ...directory[0], login_id: 'private-login', phone: '010-own' }, { ...directory[1], login_id: 'leader-login', phone: '010-leader' }], error: null }),
      then: (resolve: (x: object) => unknown) => Promise.resolve({ data: updated ? [{ id: 1 }] : null, error: null }).then(resolve),
    }
    return q
  })
})
afterEach(() => { cleanup(); vi.unstubAllEnvs() })
async function login(role = 'user') {
  api.rpc.mockImplementation(async (name: string) => ({ data: name === 'auth_login' ? [{ ...self, role }] : name === 'get_user_directory' ? directory : true, error: null }))
  const h = renderHook(() => useAuth())
  await waitFor(() => expect(h.result.current.loading).toBe(false))
  await act(async () => { expect(await h.result.current.login('private-login', '0000', true)).toBe(true) })
  await waitFor(() => expect(h.result.current.allUsers).toHaveLength(2))
  return h
}
test.each(['user', 'leader'])('%s uses safe directory while own profile retains ID and phone, duplicate names and writes work', async role => {
  const h = await login(role)
  expect(api.rpc).toHaveBeenCalledWith('get_user_directory')
  expect(api.projections).toEqual(['phone'])
  expect(h.result.current.allUsers.every(u => u.phone === null && u.loginId === '')).toBe(true)
  expect(h.result.current.user).toMatchObject({ loginId: 'private-login', phone: '010-own' })
  await act(async () => { expect(await h.result.current.updateMyProfile({ name: 'Leader', phone: 'changed' })).toBe(false) })
  expect(api.writes).toEqual([])
  await act(async () => { expect(await h.result.current.updateMyProfile({ name: 'Member', phone: '010-new' })).toBe(true) })
  expect(h.result.current.user?.phone).toBe('010-new')
  expect(api.writes).toEqual([{ name: 'Member', phone: '010-new' }])
})
test.each(['admin', 'developer'])('%s keeps full user management, login ID edits and PIN reset', async role => {
  const h = await login(role)
  expect(api.rpc.mock.calls.some(([name]) => name === 'get_user_directory')).toBe(false)
  expect(h.result.current.allUsers[1]).toMatchObject({ loginId: 'leader-login', phone: '010-leader' })
  await act(async () => { expect(await h.result.current.updateUserIdentity(2, 'leader-new', 'Leader')).toBe(true) })
  await act(async () => { expect(await h.result.current.resetUserPin(2, '1234')).toBe(true) })
  expect(api.writes).toContainEqual({ login_id: 'leader-new', name: 'Leader' })
  expect(api.writes).toContainEqual({ pin: '1234' })
})
test('directory failure never falls back to private table and late response after logout is discarded', async () => {
  const h = await login()
  api.rpc.mockResolvedValueOnce({ data: null, error: { message: 'permission denied' } })
  await act(async () => { await h.result.current.fetchAllUsers() })
  expect(h.result.current.allUsers).toEqual([])
  expect(api.projections).toEqual(['phone'])
  let finish!: (value: object) => void
  api.rpc.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  let request!: Promise<void>
  act(() => { request = h.result.current.fetchAllUsers() })
  act(() => h.result.current.logout())
  await act(async () => { finish({ data: directory, error: null }); await request })
  expect(h.result.current.allUsers).toEqual([])
})
test('explicit false in demo retains existing full directory', async () => {
  vi.stubEnv('VITE_DEMO_MODE', 'true'); vi.stubEnv('VITE_PRIVATE_USER_READS_ENABLED', 'false')
  const h = await login()
  expect(h.result.current.allUsers[1].loginId).toBe('leader-login')
  expect(api.rpc.mock.calls.some(([name]) => name === 'get_user_directory')).toBe(false)
})
