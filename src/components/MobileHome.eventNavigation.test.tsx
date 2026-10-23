import type { ComponentProps } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, expect, test, vi } from 'vitest'
import { MobileHome } from './MobileHome'
import { CalendarReadContext } from '../hooks/CalendarReadContext'

vi.mock('./AppHeader', () => ({ AppHeader: () => null }))
vi.mock('../hooks/useAdminAttentionCounts', () => ({ useAdminAttentionCounts: () => ({}) }))
vi.mock('../lib/pwa', () => ({ isUpdateAvailable: () => false, onUpdateAvailable: () => () => {}, checkForUpdate: vi.fn(), applyUpdate: vi.fn(), isPWAInstalled: () => false, isMobile: () => true, isIOS: () => false, isAndroid: () => false }))
vi.mock('./UserMobileHome', () => ({ UserMobileHome: ({ onOpenEventDetail }: { onOpenEventDetail: (id: number) => void }) =>
  <button onClick={() => onOpenEventDetail(17)}>open home event</button> }))
vi.mock('./admin/AdminMobileHome', () => ({ AdminMobileHome: ({ onOpenEventDetail }: { onOpenEventDetail: (id: number) => void }) =>
  <button onClick={() => onOpenEventDetail(17)}>open home event</button> }))
vi.mock('./admin/AdminMobileCalendar', () => ({ AdminMobileCalendar: ({ detailOnly }: { detailOnly: boolean }) =>
  <div>{detailOnly ? 'detail only' : 'calendar grid'}</div> }))

function Location() {
  const location = useLocation()
  return <output>{location.pathname}{location.search}</output>
}

afterEach(() => vi.unstubAllEnvs())

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
