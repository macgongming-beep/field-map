import { useContext, useState, type ReactNode } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import App from './App'
import { CalendarReadContext } from './hooks/CalendarReadContext'

const state = vi.hoisted(() => ({
  ready: true, scope: '', sessionUser: undefined as string | undefined, role: '', mounts: 0,
  realtime: vi.fn(), skipSignal: vi.fn(),
  historyReady: true, historyError: false, historyScope: undefined as string | undefined, retryHistory: vi.fn(async () => {}),
  buildingReady: true, buildingError: false, buildingScope: undefined as string | undefined, retryBuilding: vi.fn(async () => {}),
  auth: { user: { id: 1, name: 'Admin', role: 'admin' }, allUsers: [], loading: false },
}))
vi.mock('./hooks/useAuth', () => ({ useAuth: () => state.auth }))
vi.mock('./hooks/useStore', () => ({ useStore: (_enabled: boolean, role: string, _user: string, scope: string, sessionUser?: string, historyScope?: string, buildingScope?: string) => {
  useState(() => { state.mounts += 1; return null })
  state.scope = scope
  state.sessionUser = sessionUser
  state.role = role
  state.historyScope = historyScope
  state.buildingScope = buildingScope
  return { loading: false, error: null, calendarScopeReady: state.ready, calendarReadError: false, skipParticipantSignal: state.skipSignal,
    historyScopeReady: state.historyReady, historyReadError: state.historyError, retryHistoryRead: state.retryHistory,
    buildingScopeReady: state.buildingReady, buildingReadError: state.buildingError, retryBuildingRead: state.retryBuilding }
} }))
vi.mock('./hooks/useCalendarRealtime', () => ({ useCalendarRealtime: state.realtime }))
vi.mock('./hooks/usePlaceDeletionRealtime', () => ({ usePlaceDeletionRealtime: () => {} }))
vi.mock('./hooks/useUnitCreationRealtime', () => ({ useUnitCreationRealtime: () => {} }))
vi.mock('./components/MobileHome', () => ({ MobileHome: () => <CalendarConsumer /> }))
vi.mock('./components/Toast', () => ({ Toast: () => null }))
vi.mock('./components/ConfirmDialog', () => ({ ConfirmDialog: () => null }))
vi.mock('./components/AppUpdateNotice', () => ({ AppUpdateNotice: () => null }))
vi.mock('./components/MaintenanceNotice', () => ({ MaintenanceNotice: () => null }))
vi.mock('./components/PwaInstall', () => ({ PwaInstallBanner: () => null }))
vi.mock('./components/PullToRefresh', () => ({ PullToRefresh: () => null }))
vi.mock('./components/AppLoading', () => ({ AppLoading: () => <div>app loading</div> }))
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
  state.realtime.mockClear()
  state.ready = true
  state.historyReady = true; state.historyError = false; state.retryHistory.mockClear()
  state.buildingReady = true; state.buildingError = false; state.retryBuilding.mockClear()
  state.mounts = 0
  state.auth.user = { id: 1, name: 'Admin', role: 'admin' }
  window.localStorage.clear()
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }))
})

test.each([['/', 'home'], ['/map', 'map'], ['/stats', 'full'], ['/?openEvent=17', 'full']])('App wires building scope for %s and blocks incomplete consumers', async (path, expected) => {
  vi.stubEnv('VITE_BUILDING_DEMAND_ENABLED', 'true')
  state.buildingReady = false
  const view = render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>)
  expect(state.buildingScope).toBe(expected)
  expect(screen.getByText('app loading')).toBeTruthy()
  expect(screen.queryByText('detail mounted')).toBeNull()
  state.buildingError = true
  view.rerender(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>)
  fireEvent.click(screen.getByRole('button', { name: '다시 시도' }))
  expect(state.retryBuilding).toHaveBeenCalledTimes(1)
  state.buildingReady = true
  view.rerender(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>)
  expect(await screen.findByText('detail mounted')).toBeTruthy()
})

test.each(['/stats', '/service-logs', '/map'])('full history consumer %s stays closed on loading/failure', async path => {
  vi.stubEnv('VITE_PRIVILEGED_HISTORY_DEMAND_ENABLED', 'true')
  state.historyReady = false
  const view = render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>)
  expect(state.historyScope).toBe('full')
  expect(screen.getByText('app loading')).toBeTruthy()
  expect(screen.queryByText('detail mounted')).toBeNull()
  state.historyError = true
  view.rerender(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>)
  expect(screen.getByRole('alert')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '다시 시도' }))
  expect(state.retryHistory).toHaveBeenCalledTimes(1)
  expect(screen.queryByText('detail mounted')).toBeNull()
  state.historyReady = true
  view.rerender(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>)
  expect(await screen.findByText('detail mounted')).toBeTruthy()
})

test.each([['true', 'false', undefined], ['false', 'true', 'summary']] as const)(
  'App wires history flag demo=%s flag=%s', async (demo, flag, scope) => {
    vi.stubEnv('VITE_DEMO_MODE', demo)
    vi.stubEnv('VITE_PRIVILEGED_HISTORY_DEMAND_ENABLED', flag)
    render(<MemoryRouter initialEntries={['/']}><App /></MemoryRouter>)
    await screen.findByText('detail mounted')
    expect(state.historyScope).toBe(scope)
  },
)

test('App passes store participant receipts into the real-time hook', async () => {
  render(<MemoryRouter initialEntries={['/']}><App /></MemoryRouter>)
  await waitFor(() => expect(state.realtime).toHaveBeenCalled())
  expect(state.realtime.mock.lastCall?.[1].skipParticipantSignal).toBe(state.skipSignal)
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
  state.auth.user = { ...state.auth.user, name: 'Renamed' }
  view.rerender(<MemoryRouter initialEntries={['/settings']}><App /></MemoryRouter>)
  expect(state.sessionUser).toBe('Renamed')
  expect(state.mounts).toBe(initial + 1)
  state.auth.user = { ...state.auth.user, role: 'developer' }
  view.rerender(<MemoryRouter initialEntries={['/settings']}><App /></MemoryRouter>)
  expect(state.role).toBe('developer')
  expect(state.mounts).toBe(initial + 2)
  fireEvent.click(screen.getByRole('button', { name: 'edit' }))
  expect(state.mounts).toBe(initial + 2)
})
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })

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
