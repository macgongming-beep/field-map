import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, expect, test, vi } from 'vitest'
import { VisitRecencyContext } from '../hooks/privilegedHistoryScope'
import { AdminMobileZone } from './admin/AdminMobileZone'
import { ZoneAssignScreen } from './assignment/ZoneAssignScreen'
import { RestaurantsTab } from './RestaurantsTab'
import { testBuilding, testCard, testUnit } from '../test/territoryFixture'

vi.mock('./MapCanvas', () => ({ MapCanvas: () => null }))
vi.mock('../lib/regions', async importOriginal => ({
  ...await importOriginal<typeof import('../lib/regions')>(), getRegionNames: () => ['처인구'],
}))
afterEach(() => { cleanup(); sessionStorage.clear() })
const cards = [testCard(1, '처인구 고림동 1', { units: 1, buildings: 1, assignedLeader: 'Me', assignedUsers: ['Me'] })]
const buildings = [testBuilding(1, 1, 'Demo', [testUnit(101, '101호', { isChinese: true, isRestaurant: true })])]
const dates = [{ id: 1, unitId: 101, visitedAt: '2026-11-12', createdAt: '2026-11-12T00:00:00Z' }]

test('mobile zone keeps card last-visit date with no full history', () => {
  render(<MemoryRouter initialEntries={['/zone?level=cards&region=처인구&dong=고림동&scope=all']}>
    <VisitRecencyContext.Provider value={dates}>
      <AdminMobileZone language="ko" cards={cards} buildings={buildings} currentVisitor="Me" role="admin"
        onOpenMap={vi.fn()} onOpenAssignedMap={vi.fn()} onShowMapView={vi.fn()} />
    </VisitRecencyContext.Provider>
  </MemoryRouter>)
  expect(screen.getByText(/최근 봉사.*11\/12/)).toBeInTheDocument()
})

test('calendar assignment keeps card last-visit date with no full history', () => {
  render(<VisitRecencyContext.Provider value={dates}>
    <ZoneAssignScreen teams={[{ id: 't', name: 'Team', color: 'blue', order: 0, cardIds: [], members: ['Me'] }]}
      activeTeamId="t" cards={cards} buildings={buildings} cardBoundaries={[]} canEdit dispatch={vi.fn()}
      eventId={1} currentVisitor="Me" onBack={vi.fn()} />
  </VisitRecencyContext.Provider>)
  fireEvent.click(screen.getByRole('button', { name: '목록', exact: true }))
  expect(screen.getByText(/최근 봉사.*11\/12/)).toBeInTheDocument()
})

test('restaurant list keeps unit last-visit date with no full history', () => {
  render(<VisitRecencyContext.Provider value={dates}>
    <RestaurantsTab role="admin" cards={cards} buildings={buildings} onOpenMap={vi.fn()} />
  </VisitRecencyContext.Provider>)
  fireEvent.click(screen.getByText('처인구'))
  expect(screen.getByText(/11\.12/)).toBeInTheDocument()
})
