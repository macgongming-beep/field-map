import { useContext, useState, type ReactNode } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import App from './App'
import { CalendarReadContext } from './hooks/CalendarReadContext'

const state = vi.hoisted(() => ({
  ready: true, scope: '',
  auth: { user: { id: 1, name: 'Admin', role: 'admin' }, allUsers: [], loading: false },
}))
vi.mock('./hooks/useAuth', () => ({ useAuth: () => state.auth }))
vi.mock('./hooks/useStore', () => ({ useStore: (_enabled: boolean, _role: string, _user: string, scope: string) => {
  state.scope = scope
  return { loading: false, error: null, calendarScopeReady: state.ready, calendarReadError: false }
} }))
vi.mock('./hooks/useCalendarRealtime', () => ({ useCalendarRealtime: () => {} }))
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
  state.ready = true
  window.localStorage.clear()
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }))
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
