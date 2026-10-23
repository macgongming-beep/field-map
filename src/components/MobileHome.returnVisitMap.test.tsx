import type { ComponentProps } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, expect, test, vi } from 'vitest'
import { MobileHome } from './MobileHome'
import type { MobileMap } from './MobileMap'
import type { Building, ReturnVisit, TerritoryCard } from '../types'

vi.mock('./AppHeader', () => ({ AppHeader: () => null }))
vi.mock('../lib/pwa', () => ({ isUpdateAvailable: () => false, onUpdateAvailable: () => () => {}, checkForUpdate: vi.fn(), applyUpdate: vi.fn(), isPWAInstalled: () => false, isMobile: () => true, isIOS: () => false, isAndroid: () => false }))
vi.mock('../hooks/useAdminAttentionCounts', () => ({ useAdminAttentionCounts: () => ({}) }))
vi.mock('../hooks/useReturnVisitLogDetails', () => ({ useReturnVisitLogDetails: () => ({ logs: [], loading: false, error: null }) }))
vi.mock('./MobileMap', () => ({ MobileMap: (props: ComponentProps<typeof MobileMap>) =>
  <output data-testid="map-input">{JSON.stringify({ cards: props.cards.map(c => c.id),
    buildings: props.buildings.map(b => ({ id: b.id, units: b.units.map(u => u.id) })),
    focused: props.focusedBuildingId, regular: props.regularVisitScope })}</output> }))
vi.mock('./MobileTerritory', () => ({ MobileTerritory: ({ onOpenRegularVisitMap }: { onOpenRegularVisitMap: (id: number) => void }) =>
  <button onClick={() => onOpenRegularVisitMap(7)}>open list map</button> }))

afterEach(() => { cleanup(); vi.unstubAllEnvs() })

test.each((['user', 'leader'] as const).flatMap(role => [
  { role, path: '/territory/regular/7', button: 'Map' },
  { role, path: '/territory', button: 'open list map' },
]))('$role $path opens only the linked visit, without requiring a card assignment', ({ role, path, button }) => {
  vi.stubEnv('VITE_DEMO_MODE', 'true')
  const visit = { id: 7, buildingId: 10, unitId: 100, displayName: 'Linked visit', address: 'Test address',
    unitNumber: '101', assignedUserName: 'Me', createdBy: 'Me', lastVisitedAt: null, lastResult: null,
    createdAt: '2026-10-23' } as ReturnVisit
  const building = { id: 10, cardId: 3, name: 'Linked building', address: 'Test address', type: '주택',
    lat: 37, lng: 127, units: [{ id: 100, number: '101' }, { id: 101, number: '102' }] } as Building
  const props = { language: 'en', actualRole: role, viewMode: role, currentVisitor: 'Me', currentUser: { id: 1, name: 'Me', role },
    allUsers: [], cards: [{ id: 3, assignedUsers: [] }, { id: 4, assignedUsers: [] }] as TerritoryCard[],
    buildings: [building, { ...building, id: 11, cardId: 4 }],
    returnVisits: [visit, { ...visit, id: 8, unitId: 101, assignedUserName: 'Other', createdBy: 'Other' }],
    returnVisitLogs: [], calendarEvents: [], serviceSessions: [], visitHistories: [], cardBoundaries: [],
    notices: [], territoryRegions: [] } as unknown as ComponentProps<typeof MobileHome>
  render(<MemoryRouter initialEntries={[path]}><MobileHome {...props} /></MemoryRouter>)
  fireEvent.click(screen.getByRole('button', { name: button, exact: true }))
  expect(JSON.parse(screen.getByTestId('map-input').textContent!)).toEqual({
    cards: [3], buildings: [{ id: 10, units: [100] }], focused: 10, regular: true,
  })
})
