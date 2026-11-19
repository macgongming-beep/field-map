import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { useLayoutEffect } from 'react'
import { AuthContext, useSharedAuth, type SharedAuth } from './AuthContext'
import { useAuth } from './useAuth'
import { DesktopTerritory } from '../components/DesktopTerritory'
import { DevicePushToggle } from '../components/DevicePushToggle'
import { MobileUsers } from '../components/MobileUsers'
import { MobileSignupRequests } from '../components/MobileSignupRequests'
import { territoryProps } from '../test/territoryFixture'
import { authFixture } from '../test/authFixture'
import type { Role } from '../types'

const api = vi.hoisted(() => ({
  rpc: vi.fn(), from: vi.fn(), directory: vi.fn(), profile: vi.fn(), write: vi.fn(),
  subscribe: vi.fn(),
}))
vi.mock('../lib/supabase', () => ({ supabase: { rpc: api.rpc, from: api.from } }))
vi.mock('../lib/sentry', () => ({ setSentryUser: vi.fn(), clearSentryUser: vi.fn() }))
vi.mock('../lib/toast', () => ({ showToast: vi.fn() }))
vi.mock('../lib/confirm', () => ({ promptDialog: vi.fn(), confirmDialog: vi.fn(async () => true), alertDialog: vi.fn() }))
vi.mock('../lib/boundaryDeviceCache', () => ({ clearBoundaryDeviceCache: vi.fn() }))
vi.mock('../lib/userChatsCache', () => ({ clearUserChatsCache: vi.fn() }))
vi.mock('../lib/pwa', () => ({ isPWAInstalled: () => true, isIOS: () => false }))
vi.mock('../lib/push', () => ({
  isPushSupported: () => true,
  isCurrentDeviceSubscribed: async () => false,
  requestNotificationPermission: async () => 'granted',
  subscribeToPush: api.subscribe,
  unsubscribeFromPush: vi.fn(),
}))
vi.mock('../components/AppHeader', () => ({ AppHeader: () => null }))

const self = { id: 7, name: 'Owner', login_id: 'owner', role: 'admin', token: 'token-one', approval_status: 'approved' }
const pending = { id: 8, name: 'Applicant', login_id: 'applicant', role: 'user', approval_status: 'pending', created_at: '2026-01-01' }
let owner: SharedAuth
let consumer: SharedAuth

function Consumer() {
  const auth = useSharedAuth()
  useLayoutEffect(() => { consumer = auth })
  return <output data-testid="identity">{auth.user?.id}:{auth.user?.role}:{auth.allUsers.map(u => u.name).join(',')}</output>
}

type DirectoryLeaf = 'users' | 'signup' | 'territory'
function Owner({ showLeaves = true, leaf = 'all' }: { showLeaves?: boolean; leaf?: DirectoryLeaf | 'all' }) {
  const auth = useAuth()
  useLayoutEffect(() => { owner = auth })
  return <AuthContext.Provider value={auth}>
    <Consumer />
    {showLeaves && !auth.loading && auth.user && <>
      {(leaf === 'all' || leaf === 'territory') && <section data-testid="territory"><DesktopTerritory {...(territoryProps({ role: auth.user.role }) as never)} /></section>}
      <section data-testid="push"><DevicePushToggle language="en" /></section>
      {(leaf === 'all' || leaf === 'users') && <section data-testid="users"><MobileUsers isEmbedded /></section>}
      {(leaf === 'all' || leaf === 'signup') && <section data-testid="signup"><MobileSignupRequests isEmbedded /></section>}
    </>}
  </AuthContext.Provider>
}

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  vi.resetAllMocks()
  vi.stubEnv('VITE_PRIVATE_USER_READS_ENABLED', 'true')
  vi.stubGlobal('Notification', { permission: 'granted' })
  api.profile.mockResolvedValue({ data: self, error: null })
  api.directory.mockResolvedValue({ data: [pending], error: null })
  api.subscribe.mockResolvedValue({ ok: true })
  api.rpc.mockImplementation(async (name: string) => {
    if (name === 'auth_login') return { data: [self], error: null }
    if (name === 'get_user_directory') return api.directory()
    return { data: true, error: null }
  })
  api.from.mockImplementation((table: string) => {
    let updated = false
    const query = {
      select: () => query,
      eq: () => query,
      update: (value: object) => { updated = true; api.write(value); return query },
      maybeSingle: api.profile,
      single: async () => ({ data: { phone: null }, error: null }),
      order: api.directory,
      in: async () => {
        expect(table).toBe('app_settings')
        return { data: [], error: null }
      },
      then: (resolve: (value: object) => unknown) => Promise.resolve({ data: updated ? [{ id: pending.id }] : [], error: null }).then(resolve),
    }
    return query
  })
})

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals() })

function remember(role: Role = 'admin') {
  localStorage.setItem('auth_token', 'token-one')
  localStorage.setItem('auth_session', JSON.stringify({ id: self.id, name: self.name, role, authToken: 'token-one' }))
  api.profile.mockResolvedValue({ data: { ...self, role }, error: null })
}

test.each<Role>(['admin', 'developer', 'leader', 'user'])('%s mounts and remounts all four real leaves with one verification and one directory read', async role => {
  remember(role)
  const view = render(<MemoryRouter><Owner /></MemoryRouter>)
  await waitFor(() => expect(owner.loading).toBe(false))
  await waitFor(() => expect(consumer.allUsers).toHaveLength(1))
  expect(consumer).toBe(owner)
  expect(consumer.user?.role).toBe(role)
  expect(api.profile).toHaveBeenCalledTimes(1)
  expect(api.directory).toHaveBeenCalledTimes(1)
  expect(api.rpc.mock.calls.filter(([name]) => name === 'verify_session')).toHaveLength(1)
  if (role === 'admin' || role === 'developer') {
    expect(within(screen.getByTestId('signup')).getByText('Applicant')).toBeTruthy()
    expect(consumer.allUsers[0].loginId).toBe('applicant')
  } else {
    expect(within(screen.getByTestId('signup')).queryByText('Applicant')).toBeNull()
    expect(consumer.allUsers[0].loginId).toBe('')
  }
  view.rerender(<MemoryRouter><Owner showLeaves={false} /></MemoryRouter>)
  view.rerender(<MemoryRouter><Owner /></MemoryRouter>)
  await act(async () => {})
  expect(api.directory).toHaveBeenCalledTimes(1)
  expect(api.rpc.mock.calls.filter(([name]) => name === 'verify_session')).toHaveLength(1)
  fireEvent.click(within(screen.getByTestId('push')).getByRole('button'))
  await waitFor(() => expect(api.subscribe).toHaveBeenCalledExactlyOnceWith(self.id))
})

test('an empty shared directory is not retried on mount; explicit refresh still loads it', async () => {
  remember()
  api.directory.mockResolvedValue({ data: [], error: null })
  render(<MemoryRouter><Owner /></MemoryRouter>)
  await screen.findByTestId('signup')
  await act(async () => {})
  expect(api.directory).toHaveBeenCalledTimes(1)
  api.directory.mockResolvedValue({ data: [pending], error: null })
  fireEvent.click(within(screen.getByTestId('signup')).getByRole('button', { name: '\uc0c8\ub85c\uace0\uce68' }))
  await waitFor(() => expect(consumer.allUsers).toHaveLength(1))
  expect(api.directory).toHaveBeenCalledTimes(2)
})

test('consumer mounts share a pending root directory read; freshness starts at successful completion', async () => {
  remember()
  let now = 1_000
  vi.spyOn(Date, 'now').mockImplementation(() => now)
  let finish!: (value: object) => void
  api.directory.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  const view = render(<MemoryRouter><Owner showLeaves={false} /></MemoryRouter>)
  await waitFor(() => expect(api.directory).toHaveBeenCalledTimes(1))
  let first!: Promise<void>
  act(() => {
    first = consumer.ensureAllUsersFresh()
    expect(consumer.ensureAllUsersFresh()).toBe(first)
  })
  now += 120_000
  view.rerender(<MemoryRouter><Owner /></MemoryRouter>)
  await act(async () => {})
  expect(api.directory).toHaveBeenCalledTimes(1)
  await act(async () => { finish({ data: [pending], error: null }); await first })
  now += 59_999
  await act(async () => { await consumer.ensureAllUsersFresh() })
  expect(api.directory).toHaveBeenCalledTimes(1)
  expect(api.rpc.mock.calls.filter(([name]) => name === 'verify_session')).toHaveLength(1)
})

test.each<DirectoryLeaf>(['users', 'signup', 'territory'])('%s remount reuses recent success but refreshes at 60 seconds', async leaf => {
  remember()
  let now = 1_000
  vi.spyOn(Date, 'now').mockImplementation(() => now)
  const view = render(<MemoryRouter><Owner showLeaves={false} leaf={leaf} /></MemoryRouter>)
  await waitFor(() => expect(consumer.allUsers).toHaveLength(1))
  now += 59_999
  view.rerender(<MemoryRouter><Owner leaf={leaf} /></MemoryRouter>)
  await act(async () => {})
  expect(api.directory).toHaveBeenCalledTimes(1)
  view.rerender(<MemoryRouter><Owner showLeaves={false} leaf={leaf} /></MemoryRouter>)
  api.directory.mockResolvedValue({ data: [{ ...pending, name: 'Updated on another device' }], error: null })
  now += 1
  view.rerender(<MemoryRouter><Owner leaf={leaf} /></MemoryRouter>)
  await waitFor(() => expect(consumer.allUsers[0]?.name).toBe('Updated on another device'))
  expect(api.directory).toHaveBeenCalledTimes(2)
  expect(api.rpc.mock.calls.filter(([name]) => name === 'verify_session')).toHaveLength(1)
})

test.each<DirectoryLeaf>(['users', 'signup', 'territory'])('%s mount retries a failed initial directory immediately', async leaf => {
  remember()
  api.directory.mockResolvedValueOnce({ data: null, error: { message: 'offline' } })
  const view = render(<MemoryRouter><Owner showLeaves={false} leaf={leaf} /></MemoryRouter>)
  await waitFor(() => expect(api.directory).toHaveBeenCalledTimes(1))
  await act(async () => {})
  expect(consumer.allUsers).toEqual([])
  view.rerender(<MemoryRouter><Owner leaf={leaf} /></MemoryRouter>)
  await waitFor(() => expect(consumer.allUsers).toHaveLength(1))
  expect(api.directory).toHaveBeenCalledTimes(2)
})

test.each<Role>(['admin', 'user'])('%s explicit refresh failure is not cached and a rejected retry also remains retryable', async role => {
  remember(role)
  render(<MemoryRouter><Owner showLeaves={false} /></MemoryRouter>)
  await waitFor(() => expect(consumer.allUsers).toHaveLength(1))
  api.directory.mockResolvedValueOnce({ data: null, error: { message: 'offline' } })
  await act(async () => { await consumer.fetchAllUsers() })
  expect(api.directory).toHaveBeenCalledTimes(2)
  api.directory.mockRejectedValueOnce(new Error('network unavailable'))
  await act(async () => { await consumer.ensureAllUsersFresh() })
  expect(api.directory).toHaveBeenCalledTimes(3)
  api.directory.mockResolvedValue({ data: [{ ...pending, name: 'Recovered' }], error: null })
  await act(async () => { await consumer.ensureAllUsersFresh() })
  expect(api.directory).toHaveBeenCalledTimes(4)
  expect(consumer.allUsers[0]?.name).toBe('Recovered')
  await act(async () => { await consumer.ensureAllUsersFresh() })
  expect(api.directory).toHaveBeenCalledTimes(4)
})

test('local user change events bypass a recent directory and share the new pending read', async () => {
  remember()
  render(<MemoryRouter><Owner showLeaves={false} /></MemoryRouter>)
  await waitFor(() => expect(consumer.allUsers).toHaveLength(1))
  let finish!: (value: object) => void
  api.directory.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  act(() => { window.dispatchEvent(new Event('app-users-changed')) })
  let pendingRead!: Promise<void>
  act(() => { pendingRead = consumer.ensureAllUsersFresh() })
  expect(api.directory).toHaveBeenCalledTimes(2)
  await act(async () => { finish({ data: [], error: null }); await pendingRead })
  expect(consumer.allUsers).toEqual([])
})

test.each([
  { id: 7, role: 'user', token: 'token-two' },
  { id: 9, role: 'admin', token: 'token-two' },
  { id: 7, role: 'admin', token: 'token-two' },
])('directory freshness and pending reuse stay isolated across identity $id / $role / $token', async next => {
  remember()
  render(<MemoryRouter><Owner showLeaves={false} /></MemoryRouter>)
  await waitFor(() => expect(consumer.allUsers).toHaveLength(1))
  const oldEnsure = consumer.ensureAllUsersFresh
  let finish!: (value: object) => void
  api.directory.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  let stale!: Promise<void>
  act(() => { stale = consumer.fetchAllUsers() })
  const nextRow = { ...self, ...next, name: 'Next owner' }
  api.rpc.mockImplementation(async (name: string) => name === 'auth_login'
    ? { data: [nextRow], error: null }
    : name === 'get_user_directory' ? api.directory() : { data: true, error: null })
  api.directory.mockResolvedValue({ data: [{ ...pending, name: 'Next directory' }], error: null })
  await act(async () => { expect(await consumer.login('next', '0000', true)).toBe(true) })
  await waitFor(() => expect(consumer.allUsers[0]?.name).toBe('Next directory'))
  expect(api.directory).toHaveBeenCalledTimes(3)
  await act(async () => { await oldEnsure(); await consumer.ensureAllUsersFresh() })
  expect(api.directory).toHaveBeenCalledTimes(3)
  await act(async () => { finish({ data: [{ ...pending, name: 'Old directory' }], error: null }); await stale })
  expect(consumer.allUsers[0]?.name).toBe('Next directory')
  const ensureBeforeLogout = consumer.ensureAllUsersFresh
  act(() => consumer.logout())
  await act(async () => { await ensureBeforeLogout(); await consumer.ensureAllUsersFresh() })
  expect(api.directory).toHaveBeenCalledTimes(3)
  expect(consumer.allUsers).toEqual([])
})

test('approval uses the owner mutation and updates the shared directory', async () => {
  remember()
  render(<MemoryRouter><Owner /></MemoryRouter>)
  await within(await screen.findByTestId('signup')).findByText('Applicant')
  api.directory.mockResolvedValue({ data: [{ ...pending, approval_status: 'approved' }], error: null })
  fireEvent.click(within(screen.getByTestId('signup')).getByRole('button', { name: '\uc2b9\uc778', exact: true }))
  await waitFor(() => expect(consumer.allUsers[0].approvalStatus).toBe('approved'))
  expect(api.write).toHaveBeenCalledExactlyOnceWith({ approval_status: 'approved' })
  expect(within(screen.getByTestId('signup')).queryByText('Applicant')).toBeNull()
})

test.each<Role>(['user', 'leader'])('%s shared mutations retain the real admin guard', async role => {
  remember(role)
  render(<MemoryRouter><Owner /></MemoryRouter>)
  await waitFor(() => expect(consumer.allUsers).toHaveLength(1))
  await act(async () => { expect(await consumer.updateUserApprovalStatus(pending.id, 'approved')).toBe(false) })
  expect(api.write).not.toHaveBeenCalled()
  expect(consumer.allUsers[0].approvalStatus).toBe('pending')
})

test.each([
  { id: 7, role: 'user', token: 'token-two' },
  { id: 9, role: 'admin', token: 'token-two' },
  { id: 7, role: 'admin', token: 'token-two' },
])('late directory responses cannot cross identity $id / $role / $token', async next => {
  remember()
  render(<MemoryRouter><Owner showLeaves={false} /></MemoryRouter>)
  await waitFor(() => expect(consumer.allUsers).toHaveLength(1))
  let finish!: (value: object) => void
  api.directory.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  let stale!: Promise<void>
  act(() => { stale = consumer.fetchAllUsers() })
  const nextRow = { ...self, ...next, name: 'Next owner' }
  api.rpc.mockImplementation(async (name: string) => name === 'auth_login'
    ? { data: [nextRow], error: null }
    : name === 'get_user_directory' ? api.directory() : { data: true, error: null })
  api.directory.mockResolvedValue({ data: [{ ...pending, name: 'Next directory' }], error: null })
  await act(async () => { expect(await consumer.login('next', '0000', true)).toBe(true) })
  await waitFor(() => expect(consumer.allUsers[0]?.name).toBe('Next directory'))
  await act(async () => { finish({ data: [{ ...pending, name: 'Old private directory' }], error: null }); await stale })
  expect(consumer).toBe(owner)
  expect(consumer.user).toMatchObject({ id: next.id, role: next.role, authToken: next.token })
  expect(consumer.allUsers.map(u => u.name)).toEqual(['Next directory'])
  act(() => consumer.logout())
  expect(consumer.user).toBeNull()
  expect(consumer.allUsers).toEqual([])
})

test('missing provider fails closed without restoring a second session', () => {
  expect(() => renderHook(() => useSharedAuth())).toThrow('useSharedAuth requires an AuthContext provider')
  expect(api.rpc).not.toHaveBeenCalled()
  expect(api.from).not.toHaveBeenCalled()
})

test('independent providers do not share identity, directory, or mutations', () => {
  const first = authFixture()
  const second = authFixture({ user: { id: 9, name: 'Other', loginId: 'other', role: 'user' } })
  const a = renderHook(() => useSharedAuth(), { wrapper: ({ children }) => <AuthContext.Provider value={first}>{children}</AuthContext.Provider> })
  const b = renderHook(() => useSharedAuth(), { wrapper: ({ children }) => <AuthContext.Provider value={second}>{children}</AuthContext.Provider> })
  expect(a.result.current).toBe(first)
  expect(b.result.current).toBe(second)
  expect(a.result.current.deleteUser).not.toBe(b.result.current.deleteUser)
})
