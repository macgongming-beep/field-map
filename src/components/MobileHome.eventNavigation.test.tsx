import type { ComponentProps } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, expect, test, vi } from 'vitest'
import { MobileHome } from './MobileHome'
import { CalendarReadContext } from '../hooks/CalendarReadContext'
import { RouteReadContext } from '../hooks/RouteReadContext'
import { GroupTerritoryContext } from '../features/groupTerritory/context'
import { testCard } from '../test/territoryFixture'

vi.mock('./AppHeader', () => ({ AppHeader: () => null }))
const attention = vi.hoisted(() => vi.fn(() => ({})))
vi.mock('../hooks/useAdminAttentionCounts', () => ({ useAdminAttentionCounts: attention }))
vi.mock('../lib/pwa', () => ({ isUpdateAvailable: () => false, onUpdateAvailable: () => () => {}, checkForUpdate: vi.fn(), applyUpdate: vi.fn(), isPWAInstalled: () => false, isMobile: () => true, isIOS: () => false, isAndroid: () => false }))
vi.mock('./UserMobileHome', () => ({ UserMobileHome: ({ onOpenEventDetail, leaderCards }: { onOpenEventDetail: (id: number) => void; leaderCards: { id: number }[] }) =>
  <><output data-testid="home-group-cards">{leaderCards.map(card => card.id).join(',')}</output><button onClick={() => onOpenEventDetail(17)}>open home event</button></> }))
vi.mock('./admin/AdminMobileHome', () => ({ AdminMobileHome: ({ onOpenEventDetail }: { onOpenEventDetail: (id: number) => void }) =>
  <button onClick={() => onOpenEventDetail(17)}>open home event</button> }))
vi.mock('./admin/AdminMobileCalendar', () => ({ AdminMobileCalendar: ({ detailOnly }: { detailOnly: boolean }) =>
  <div>{detailOnly ? 'detail only' : 'calendar grid'}</div> }))

function Location() {
  const location = useLocation()
  return <output>{location.pathname}{location.search}</output>
}

afterEach(() => { cleanup(); vi.unstubAllEnvs(); attention.mockClear() })

test('leader home passes shared own-group cards, not legacy individual ownership', () => {
  const cards = [testCard(1, 'Shared', { assignedGroupCodes: ['a', 'b'] }), testCard(2, 'Other', { assignedGroupCodes: ['b'], assignedLeader: 'Me' })]
  const props = { language: 'ko', actualRole: 'leader', viewMode: 'leader', currentVisitor: 'Me', currentUser: { id: 1, name: 'Me', role: 'leader' }, allUsers: [],
    cards, buildings: [], calendarEvents: [], serviceSessions: [], visitHistories: [], cardBoundaries: [], notices: [], territoryRegions: [], returnVisits: [] } as unknown as ComponentProps<typeof MobileHome>
  render(<MemoryRouter><GroupTerritoryContext.Provider value={{ enabled: true, canManage: false, ownCode: 'a', groups: [], save: vi.fn() }}><MobileHome {...props} /></GroupTerritoryContext.Provider></MemoryRouter>)
  expect(screen.getByTestId('home-group-cards').textContent).toBe('1')
})

test('route data waits keep the real mobile navigation usable without mounting incomplete screens', () => {
  const props = { language: 'ko', actualRole: 'admin', viewMode: 'admin', currentVisitor: 'Me', currentUser: { id: 1, name: 'Me', role: 'admin' }, allUsers: [],
    cards: [], buildings: [], calendarEvents: [], serviceSessions: [], visitHistories: [], cardBoundaries: [],
    notices: [], territoryRegions: [], returnVisits: [] } as unknown as ComponentProps<typeof MobileHome>
  const retry = vi.fn()
  const tree = (ready: boolean, error = false) => <MemoryRouter><RouteReadContext.Provider value={{ ready, error, retry }}>
    <MobileHome {...props} /><Location />
  </RouteReadContext.Provider></MemoryRouter>
  const view = render(tree(false))
  expect(screen.queryByRole('button', { name: 'open home event' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '캘린더', exact: true }))
  expect(screen.getByText('/calendar')).toBeTruthy()
  expect(screen.queryByText('calendar grid')).toBeNull()
  view.rerender(tree(false, true))
  fireEvent.click(screen.getByRole('button', { name: '다시 시도' }))
  expect(retry).toHaveBeenCalledOnce()
  expect(screen.getByRole('button', { name: '홈', exact: true })).toBeTruthy()
  view.rerender(tree(true))
  expect(screen.getByText('calendar grid')).toBeTruthy()
})

test.each(['admin', 'developer', 'leader', 'user'] as const)('%s reads management badges only on the settings screen', role => {
  const props = { language: 'ko', actualRole: role, viewMode: role, currentVisitor: 'Me', currentUser: { id: 1, name: 'Me', role }, allUsers: [],
    cards: [], buildings: [], calendarEvents: [], serviceSessions: [], visitHistories: [], cardBoundaries: [],
    notices: [], territoryRegions: [], returnVisits: [] } as unknown as ComponentProps<typeof MobileHome>
  const view = render(<MemoryRouter><MobileHome {...props} /></MemoryRouter>)
  expect(attention).toHaveBeenLastCalledWith(expect.objectContaining({ enabled: false }))
  fireEvent.click(screen.getByRole('button', { name: '설정', exact: true }))
  expect(attention).toHaveBeenLastCalledWith(expect.objectContaining({ enabled: role === 'admin' || role === 'developer' }))
  fireEvent.click(screen.getByRole('button', { name: '홈', exact: true }))
  expect(attention).toHaveBeenLastCalledWith(expect.objectContaining({ enabled: false }))
  view.unmount()
})

test.each((['user', 'leader', 'admin'] as const).flatMap(role => [
  { role, demo: 'true', flag: undefined, enabled: true },
  { role, demo: 'false', flag: 'true', enabled: true },
  { role, demo: 'true', flag: 'false', enabled: false },
  { role, demo: 'false', flag: undefined, enabled: false },
]))('$role home navigation: demo=$demo flag=$flag', ({ role, demo, flag, enabled }) => {
  vi.stubEnv('VITE_DEMO_MODE', demo)
  vi.stubEnv('VITE_CALENDAR_WINDOW_ENABLED', flag)
  const select = vi.fn()
  const props = { language: 'ko', actualRole: role, viewMode: role, currentVisitor: 'Me', currentUser: { id: 1, name: 'Me', role }, allUsers: [],
    cards: [], buildings: [], calendarEvents: [], serviceSessions: [], visitHistories: [], cardBoundaries: [],
    notices: [], territoryRegions: [] } as unknown as ComponentProps<typeof MobileHome>
  render(<MemoryRouter><CalendarReadContext.Provider value={{ month: '2026-08', full: true, ready: true, error: false, select, retry: vi.fn() }}>
    <MobileHome {...props} /><Location />
  </CalendarReadContext.Provider></MemoryRouter>)
  fireEvent.click(screen.getByRole('button', { name: 'open home event' }))
  expect(screen.getByRole('status').textContent).toBe(`${enabled ? '/' : '/calendar'}?openEvent=17`)
  expect(screen.getByText(enabled ? 'detail only' : 'calendar grid')).toBeTruthy()
  expect(screen.queryByText(enabled ? 'calendar grid' : 'detail only')).toBeNull()
  if (enabled) expect(select).toHaveBeenCalledWith('', false)
  else expect(select).not.toHaveBeenCalled()
})
