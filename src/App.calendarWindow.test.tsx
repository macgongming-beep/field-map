import "@testing-library/jest-dom/vitest"
import { useContext, useState, type ReactNode } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import App from './App'
import { CalendarReadContext } from './hooks/CalendarReadContext'
import { RouteReadGate, TerritoryReadGate } from './hooks/RouteReadGate'
import { routeSkipsTerritory } from './hooks/RouteReadContext'

const state = vi.hoisted(() => ({
  ready: true, scope: '', sessionUser: undefined as string | undefined, role: '', mounts: 0, shellMounts: 0, noticeMounts: 0,
  moduleRequests: 0, moduleReady: 0, moduleReject: false, storeLoading: false, recipientBaseReady: false,
  buildingReady: true, buildingError: false, buildingScope: undefined as string | undefined, retryBuilding: vi.fn(async () => {}),
  auth: { user: { id: 1, name: 'Admin', role: 'admin' } as { id: number; name: string; role: string } | null, allUsers: [], loading: false },
}))
vi.mock('./lib/sharedModuleLoader', async importOriginal => {
  const { createSharedModuleLoader } = await importOriginal<typeof import('./lib/sharedModuleLoader')>()
  return { createSharedModuleLoader: <T,>(importModule: () => Promise<T>) => {
    const load = createSharedModuleLoader(importModule)
    return () => {
      state.moduleRequests++
      return state.moduleReject ? Promise.reject(new Error('code unavailable')) : load().then(module => { state.moduleReady++; return module })
    }
  } }
})
vi.mock('./hooks/useAuth', () => ({ useAuth: () => state.auth }))
vi.mock('./hooks/useStore', () => ({ useStore: (_enabled: boolean, role: string, _user: string, scope: string, sessionUser?: string, buildingScope?: string) => {
  useState(() => { state.mounts += 1; return null })
  state.scope = scope
  state.sessionUser = sessionUser
  state.role = role
  state.buildingScope = buildingScope
  return { loading: state.storeLoading, error: null, calendarScopeReady: state.ready, calendarReadError: false,
    buildingScopeReady: state.buildingReady, buildingReadError: state.buildingError, retryBuildingRead: state.retryBuilding,
    recipientBaseReady: state.recipientBaseReady }
} }))
vi.mock('./hooks/useCalendarRealtime', () => ({ useCalendarRealtime: () => {} }))
vi.mock('./hooks/usePlaceDeletionRealtime', () => ({ usePlaceDeletionRealtime: () => {} }))
vi.mock('./hooks/useUnitCreationRealtime', () => ({ useUnitCreationRealtime: () => {} }))
vi.mock('./lib/pwa', () => ({ applyUpdate: vi.fn() }))
vi.mock('./components/MobileHome', () => ({ MobileHome: ({ onChangeViewMode }: { onChangeViewMode?: (role: string) => void }) => {
  useState(() => { state.shellMounts++; return null })
  // Like the real calendar: territory consumers live inside the route.
  return <><button>navigation</button>
    {['admin', 'leader', 'user'].map(view => <button key={view} onClick={() => onChangeViewMode?.(view)}>{`view:${view}`}</button>)}<RouteReadGate><CalendarConsumer /><TerritoryReadGate><div>territory detail</div></TerritoryReadGate></RouteReadGate></>
} }))
vi.mock('./components/Login', () => ({ Login: () => <div>login screen</div> }))
vi.mock('./components/DesktopApp', () => ({ DesktopApp: () => <div>desktop shell</div> }))
vi.mock('./components/Toast', () => ({ Toast: () => null }))
vi.mock('./components/ConfirmDialog', () => ({ ConfirmDialog: () => null }))
vi.mock('./components/AppUpdateNotice', () => ({ AppUpdateNotice: () => null }))
vi.mock('./components/MaintenanceNotice', () => ({ MaintenanceNotice: () => {
  useState(() => { state.noticeMounts++; return null })
  return null
} }))
vi.mock('./components/PwaInstall', () => ({ PwaInstallBanner: () => null }))
vi.mock('./components/PullToRefresh', () => ({ PullToRefresh: () => null }))
vi.mock('./components/AppLoading', async importOriginal => ({
  ...await importOriginal<typeof import('./components/AppLoading')>(),
  AppLoading: ({ startup }: { startup?: boolean }) => <div data-startup={String(Boolean(startup))}>app loading</div>,
}))
vi.mock('./features/meetingNotes/MeetingProvider', () => ({ MeetingProvider: ({ children }: { children: ReactNode }) => children }))

function CalendarConsumer() {
  const context = useContext(CalendarReadContext)
  const [editing, setEditing] = useState(false)
  return <>
    <div>{context ? 'window context' : 'no context'}</div>
    <div>{editing ? 'editor mounted' : 'detail mounted'}</div>
    <button onClick={() => { setEditing(true); context?.select('', true) }}>edit</button>
  </>
}
beforeEach(() => {
  state.ready = true
  state.moduleRequests = 0; state.moduleReady = 0; state.moduleReject = false; state.storeLoading = false; state.recipientBaseReady = false
  state.buildingReady = true; state.buildingError = false; state.retryBuilding.mockClear()
  state.mounts = 0
  state.shellMounts = 0; state.noticeMounts = 0
  state.auth.user = { id: 1, name: 'Admin', role: 'admin' }
  state.auth.loading = false
  window.localStorage.clear()
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }))
})

test('mobile volunteer code starts during data loading, without mounting the home or its providers', async () => {
  state.auth.user = { id: 2, name: 'Volunteer', role: 'user' }
  state.storeLoading = true
  const view = render(<MemoryRouter><App /></MemoryRouter>)
  await waitFor(() => expect(state.moduleReady).toBe(1))
  expect(state.moduleRequests).toBe(1)
  expect(screen.getByText('app loading')).toBeTruthy()
  expect(state.shellMounts).toBe(0)
  expect(state.noticeMounts).toBe(0)
  state.storeLoading = false
  view.rerender(<MemoryRouter><App /></MemoryRouter>)
  expect(screen.getByText('detail mounted')).toBeTruthy()
  expect(screen.queryByText('app loading')).toBeNull()
  expect(state.shellMounts).toBe(1)
})

test.each([
  { role: 'user', path: '/', desktop: true, authLoading: false, signedIn: true },
  { role: 'leader', path: '/', desktop: false, authLoading: false, signedIn: true },
  { role: 'admin', path: '/', desktop: false, authLoading: false, signedIn: true },
  { role: 'developer', path: '/', desktop: false, authLoading: false, signedIn: true },
  { role: 'user', path: '/calendar', desktop: false, authLoading: false, signedIn: true },
  { role: 'user', path: '/', desktop: false, authLoading: true, signedIn: true },
  { role: 'user', path: '/', desktop: false, authLoading: true, signedIn: false },
])('does not preload outside the authenticated mobile volunteer home: %j', async ({ role, path, desktop, authLoading, signedIn }) => {
  state.auth.user = signedIn ? { id: 2, name: 'Visitor', role } : null
  state.auth.loading = authLoading
  state.storeLoading = true
  vi.stubGlobal('matchMedia', () => ({ matches: desktop, addEventListener: vi.fn(), removeEventListener: vi.fn() }))
  render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>)
  expect(screen.getByText('app loading')).toBeTruthy()
  expect(state.moduleRequests).toBe(0)
  expect(state.shellMounts).toBe(0)
})

test('failed speculative code loading does not replace the data gate or expose an unhandled rejection', async () => {
  state.auth.user = { id: 2, name: 'Volunteer', role: 'user' }
  state.storeLoading = true; state.moduleReject = true
  const view = render(<MemoryRouter><App /></MemoryRouter>)
  await waitFor(() => expect(state.moduleRequests).toBe(1))
  expect(screen.getByText('app loading')).toBeTruthy()
  expect(state.shellMounts).toBe(0)
  state.moduleReject = false; state.storeLoading = false
  view.rerender(<MemoryRouter><App /></MemoryRouter>)
  expect(await screen.findByText('detail mounted')).toBeTruthy()
})

test.each([['/', 'home'], ['/map', 'map'], ['/stats', 'full'], ['/?openEvent=17', 'calendar'], ['/calendar', 'calendar'], ['/zone', 'zone'], ['/zone?tab=restaurant', 'full']])('App wires building scope for %s and blocks incomplete consumers', async (path, expected) => {
  vi.stubEnv('VITE_BUILDING_DEMAND_ENABLED', 'true')
  vi.stubEnv('VITE_CALENDAR_ZONE_BUILDING_DEMAND_ENABLED', 'true')
  state.buildingReady = false
  const view = render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>)
  expect(state.buildingScope).toBe(expected)
  expect(screen.getByText('app loading')).toBeTruthy()
  expect(screen.queryByText('detail mounted')).toBeNull()
  state.buildingError = true
  view.rerender(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>)
  fireEvent.click(await screen.findByRole('button', { name: '다시 시도' }))
  expect(state.retryBuilding).toHaveBeenCalledTimes(1)
  state.buildingReady = true
  view.rerender(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>)
  expect(await screen.findByText('detail mounted')).toBeTruthy()
})

test.each(['user', 'leader', 'admin', 'developer'])('session reads get authenticated identity and actual %s role on a full-store route', async role => {
  state.auth.user = { id: 1, name: 'Authenticated', role }
  localStorage.setItem('currentVisitor', 'Stale cached name')
  render(<MemoryRouter initialEntries={['/settings']}><App /></MemoryRouter>)
  await waitFor(() => expect(state.sessionUser).toBe('Authenticated'))
  expect(state.role).toBe(role)
})

test('recent session identity changes replace the store, while navigation retains it', async () => {
  vi.stubEnv('VITE_DEMO_MODE', 'true')
  const view = render(<MemoryRouter initialEntries={['/settings']}><App /></MemoryRouter>)
  await screen.findByText('window context')
  const initial = state.mounts
  state.auth.user = { ...state.auth.user!, name: 'Renamed' }
  view.rerender(<MemoryRouter initialEntries={['/settings']}><App /></MemoryRouter>)
  expect(state.sessionUser).toBe('Renamed')
  expect(state.mounts).toBe(initial + 1)
  state.auth.user = { ...state.auth.user!, role: 'developer' }
  view.rerender(<MemoryRouter initialEntries={['/settings']}><App /></MemoryRouter>)
  expect(state.role).toBe('developer')
  expect(state.mounts).toBe(initial + 2)
  fireEvent.click(screen.getByRole('button', { name: 'edit' }))
  expect(state.mounts).toBe(initial + 2)
})
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })

test('startup lasts through auth and data gates but never replays on navigation or session replacement', async () => {
  state.auth.loading = true
  state.buildingReady = false
  const view = render(<MemoryRouter><App /></MemoryRouter>)
  expect(screen.getByText('app loading').getAttribute('data-startup')).toBe('true')
  state.auth.loading = false
  view.rerender(<MemoryRouter><App /></MemoryRouter>)
  expect(screen.getByText('app loading').getAttribute('data-startup')).toBe('true')
  state.buildingReady = true
  view.rerender(<MemoryRouter><App /></MemoryRouter>)
  await screen.findByText('detail mounted')
  state.buildingReady = false
  view.rerender(<MemoryRouter><App /></MemoryRouter>)
  expect(screen.getByText('데이터 불러오는 중...')).toBeTruthy()
  expect(screen.queryByText('app loading')).toBeNull()
  state.auth.user = { id: 2, name: 'Other', role: 'leader' }
  view.rerender(<MemoryRouter><App /></MemoryRouter>)
  expect(screen.getByText('데이터 불러오는 중...')).toBeTruthy()
})

test('showing login finishes startup before signing in or logging out again', async () => {
  state.auth.user = null
  const view = render(<MemoryRouter><App /></MemoryRouter>)
  await screen.findByText('login screen')
  state.auth.user = { id: 1, name: 'Admin', role: 'admin' }
  state.buildingReady = false
  view.rerender(<MemoryRouter><App /></MemoryRouter>)
  expect(screen.getByText('데이터 불러오는 중...')).toBeTruthy()
  state.buildingReady = true
  view.rerender(<MemoryRouter><App /></MemoryRouter>)
  await screen.findByText('detail mounted')
  state.auth.user = null
  view.rerender(<MemoryRouter><App /></MemoryRouter>)
  await screen.findByText('login screen')
  state.auth.loading = true
  view.rerender(<MemoryRouter><App /></MemoryRouter>)
  expect(screen.getByText('app loading').getAttribute('data-startup')).toBe('false')
})

test('later route reads keep navigation and common providers mounted but never expose incomplete data', async () => {
  const view = render(<MemoryRouter><App /></MemoryRouter>)
  await screen.findByText('detail mounted')
  expect(state.shellMounts).toBe(1)
  expect(state.noticeMounts).toBe(1)
  state.buildingReady = false
  view.rerender(<MemoryRouter><App /></MemoryRouter>)
  expect(screen.getByRole('button', { name: 'navigation' })).toBeTruthy()
  expect(screen.getByText('데이터 불러오는 중...')).toBeTruthy()
  expect(screen.queryByText('detail mounted')).toBeNull()
  expect(state.shellMounts).toBe(1)
  expect(state.noticeMounts).toBe(1)
  state.buildingError = true
  view.rerender(<MemoryRouter><App /></MemoryRouter>)
  fireEvent.click(screen.getByRole('button', { name: '다시 시도' }))
  expect(state.retryBuilding).toHaveBeenCalledTimes(1)
  expect(screen.queryByText('detail mounted')).toBeNull()
  state.buildingReady = true
  view.rerender(<MemoryRouter><App /></MemoryRouter>)
  expect(await screen.findByText('detail mounted')).toBeTruthy()
  expect(state.shellMounts).toBe(1)
  expect(state.noticeMounts).toBe(1)
})

test.each([
  ['false', 'true', true], ['true', undefined, true], ['true', 'false', false], ['false', undefined, false],
] as const)('App provider and scope follow demo=%s flag=%s', async (demo, flag, enabled) => {
  vi.stubEnv('VITE_DEMO_MODE', demo)
  vi.stubEnv('VITE_CALENDAR_WINDOW_ENABLED', flag)
  render(<MemoryRouter initialEntries={['/?openEvent=17']}><App /></MemoryRouter>)
  expect(await screen.findByText(enabled ? 'window context' : 'no context')).toBeTruthy()
  expect(state.scope.startsWith('window:')).toBe(enabled)
  if (!enabled) expect(state.scope).toBe('full')
})

test('production home detail keeps its editor mounted while complete history loads', async () => {
  vi.stubEnv('VITE_DEMO_MODE', 'false')
  vi.stubEnv('VITE_CALENDAR_WINDOW_ENABLED', 'true')
  const view = render(<MemoryRouter initialEntries={['/?openEvent=17']}><App /></MemoryRouter>)
  await screen.findByText('window context')
  fireEvent.click(screen.getByRole('button', { name: 'edit' }))
  expect(state.scope).toBe('full')
  state.ready = false
  view.rerender(<MemoryRouter initialEntries={['/?openEvent=17']}><App /></MemoryRouter>)
  expect(screen.getByText('editor mounted')).toBeTruthy()
  expect(screen.queryByText('app loading')).toBeNull()
  state.ready = true
  view.rerender(<MemoryRouter initialEntries={['/?openEvent=17']}><App /></MemoryRouter>)
  expect(screen.getByText('editor mounted')).toBeTruthy()
})

test('mobile calendar month renders while territory data loads; only territory consumers wait', async () => {
  const view = render(<MemoryRouter initialEntries={['/calendar']}><App /></MemoryRouter>)
  await screen.findByText('territory detail')
  state.buildingReady = false
  view.rerender(<MemoryRouter initialEntries={['/calendar']}><App /></MemoryRouter>)
  expect(screen.getByText('detail mounted')).toBeTruthy()
  expect(screen.queryByText('territory detail')).toBeNull()
  expect(screen.getByText('데이터 불러오는 중...')).toBeTruthy()
  state.buildingError = true
  view.rerender(<MemoryRouter initialEntries={['/calendar']}><App /></MemoryRouter>)
  expect(screen.getByText('detail mounted')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '다시 시도' }))
  expect(state.retryBuilding).toHaveBeenCalledTimes(1)
  expect(screen.queryByText('territory detail')).toBeNull()
  state.buildingError = false
  state.buildingReady = true
  view.rerender(<MemoryRouter initialEntries={['/calendar']}><App /></MemoryRouter>)
  expect(await screen.findByText('territory detail')).toBeTruthy()
})

test.each(['/', '/zone', '/map'])('%s still blocks the whole route while territory data loads', async path => {
  const view = render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>)
  await screen.findByText('territory detail')
  state.buildingReady = false
  view.rerender(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>)
  expect(screen.queryByText('detail mounted')).toBeNull()
  expect(screen.queryByText('territory detail')).toBeNull()
})

test('only the mobile month calendar skips the whole-route territory gate', () => {
  expect(routeSkipsTerritory(false, '/calendar')).toBe(true)
  for (const [desktop, path] of [[true, '/calendar'], [false, '/'], [false, '/zone'], [false, '/map'], [false, '/territory'], [false, '/calendarx']] as const) {
    expect(routeSkipsTerritory(desktop, path)).toBe(false)
  }
})

test('calendar requests its initial month even while buildings block the calendar component', () => {
  vi.stubEnv('VITE_CALENDAR_WINDOW_ENABLED', 'true')
  state.buildingReady = false
  render(<MemoryRouter initialEntries={['/calendar']}><App /></MemoryRouter>)
  const now = new Date(), pad = (n: number) => String(n).padStart(2, '0')
  const month = `${now.getFullYear()}-${pad(now.getMonth() + 1)}`
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
  expect(state.scope).toBe(`window:${month}-01:${month}-${lastDay}`)
  expect(screen.queryByText('detail mounted')).toBeNull()
  expect(screen.getByText('app loading')).toBeTruthy()
})

test.each([['false', 'true', true], ['true', 'false', false]] as const)(
  'full consumers loading gate follows demo=%s flag=%s', async (demo, flag, enabled) => {
    vi.stubEnv('VITE_DEMO_MODE', demo)
    vi.stubEnv('VITE_CALENDAR_WINDOW_ENABLED', flag)
    state.ready = false
    render(<MemoryRouter initialEntries={['/stats']}><App /></MemoryRouter>)
    expect(state.scope).toBe('full')
    if (enabled) {
      await waitFor(() => expect(screen.getByText('app loading')).toBeTruthy())
      expect(screen.queryByText('detail mounted')).toBeNull()
    } else expect(await screen.findByText('detail mounted')).toBeTruthy()
  },
)

// 0172 (ported from the Codex review copy): the saved mobile view reaches building demand,
// while authority (store role, session user) stays the administrator's.
test.each(['leader', 'user'])('admin saved %s view reaches the building demand without changing authority', async view => {
  vi.stubEnv('VITE_BUILDING_DEMAND_ENABLED', 'true')
  vi.stubEnv('VITE_ROUTE_LIGHTWEIGHT_ENABLED', 'true')
  window.localStorage.setItem('chsViewMode:1', view)
  render(<MemoryRouter initialEntries={['/territory']}><App /></MemoryRouter>)
  await waitFor(() => expect(state.buildingScope).toBe('landing'))
  expect(state.role).toBe('admin')
  expect(state.sessionUser).toBe('Admin')
})

test('switching the view in the app moves 나의 봉사 demand and switching back restores the admin full read', async () => {
  vi.stubEnv('VITE_BUILDING_DEMAND_ENABLED', 'true')
  vi.stubEnv('VITE_ROUTE_LIGHTWEIGHT_ENABLED', 'true')
  render(<MemoryRouter initialEntries={['/territory']}><App /></MemoryRouter>)
  await waitFor(() => expect(state.buildingScope).toBe('full'))
  fireEvent.click(await screen.findByRole('button', { name: 'view:leader' }))
  await waitFor(() => expect(state.buildingScope).toBe('landing'))
  expect(window.localStorage.getItem('chsViewMode:1')).toBe('leader')
  fireEvent.click(screen.getByRole('button', { name: 'view:user' }))
  await waitFor(() => expect(state.buildingScope).toBe('landing'))
  fireEvent.click(screen.getByRole('button', { name: 'view:admin' }))
  await waitFor(() => expect(state.buildingScope).toBe('full'))
  expect(state.role).toBe('admin')
  expect(state.sessionUser).toBe('Admin')
})

// 0173: a volunteer's mobile home and month view open on the base part of the first snapshot.
const volunteerBase = () => {
  vi.stubEnv('VITE_RECIPIENT_STORE_ENABLED', 'true')
  state.auth.user = { id: 7, name: 'Volunteer', role: 'user' }
  state.storeLoading = true; state.recipientBaseReady = true; state.buildingReady = false
}
test.each(['/', '/calendar', '/territory'])('volunteer %s opens on the base part while territory details stay gated', async path => {
  volunteerBase()
  render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>)
  expect(await screen.findByRole('button', { name: 'navigation' })).toBeInTheDocument()
  expect(state.sessionUser).toBe('Volunteer')
  expect(screen.queryByText('app loading')).not.toBeInTheDocument()
  // The route itself renders; only the territory consumer inside it waits.
  expect(screen.getByText('detail mounted')).toBeInTheDocument()
  expect(screen.queryByText('territory detail')).not.toBeInTheDocument()
  expect(screen.getByText('데이터 불러오는 중...')).toBeInTheDocument()
})
test.each(['/territory?assignmentEvent=3', '/map', '/?openEvent=5', '/settings'])('volunteer %s keeps the full first wait', async path => {
  volunteerBase()
  render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>)
  expect(await screen.findByText('app loading')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'navigation' })).not.toBeInTheDocument()
})
test('volunteer home waits until the base part is in, and desktop keeps the full wait', async () => {
  volunteerBase(); state.recipientBaseReady = false
  const first = render(<MemoryRouter initialEntries={['/']}><App /></MemoryRouter>)
  expect(await screen.findByText('app loading')).toBeInTheDocument()
  first.unmount()
  volunteerBase()
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }))
  render(<MemoryRouter initialEntries={['/']}><App /></MemoryRouter>)
  expect(await screen.findByText('app loading')).toBeInTheDocument()
  // Not a lazy-screen fallback: the desktop shell (about 0.5s to load here) must not arrive either.
  await new Promise(resolve => setTimeout(resolve, 1500))
  expect(screen.queryByText('desktop shell')).not.toBeInTheDocument()
  expect(screen.getByText('app loading')).toBeInTheDocument()
}, 10000)

test('control: a loaded desktop volunteer does reach the desktop shell in this harness', async () => {
  vi.stubEnv('VITE_RECIPIENT_STORE_ENABLED', 'true')
  state.auth.user = { id: 7, name: 'Volunteer', role: 'user' }
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }))
  render(<MemoryRouter initialEntries={['/']}><App /></MemoryRouter>)
  expect(await screen.findByText('desktop shell', undefined, { timeout: 3000 })).toBeInTheDocument()
})
test('leaders and administrators never take the volunteer early screen', async () => {
  vi.stubEnv('VITE_RECIPIENT_STORE_ENABLED', 'true')
  for (const role of ['leader', 'admin']) {
    state.auth.user = { id: 8, name: 'Other', role }
    state.storeLoading = true; state.recipientBaseReady = true
    const view = render(<MemoryRouter initialEntries={['/']}><App /></MemoryRouter>)
    expect(await screen.findByText('app loading')).toBeInTheDocument()
    view.unmount()
  }
})
