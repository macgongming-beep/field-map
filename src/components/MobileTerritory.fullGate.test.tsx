import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { FullBuildingContext, type FullBuildingReader } from '../hooks/buildingDemand'
import type { ReturnVisit } from '../types'
import { MobileTerritory } from './MobileTerritory'

// 0170: a light 나의 봉사 opens each tool that needs complete buildings only after asking for them.
const visit = { id: 11, unitId: 100, buildingId: 10, displayName: '고림동 102호', nickname: '', address: '고림로 1', unitNumber: '102',
  assignedUserName: '나', createdBy: '나', lastVisitedAt: null, lastResult: null, createdAt: '2026-11-01T00:00:00Z' } as ReturnVisit

// The return-visit section is behind its own device feature switch.
beforeEach(() => localStorage.setItem('feat_returnVisit', '1'))
afterEach(() => localStorage.removeItem('feat_returnVisit'))

function mount(reader: FullBuildingReader | null, extra: Record<string, unknown> = {}) {
  const props = { language: 'ko', buildings: [], cards: [], calendarEvents: [], currentVisitor: '나', role: 'leader', serviceSessions: [],
    onOpenMap: vi.fn(), onEndServiceSession: vi.fn(), informalAssets: [], eventInformalAssignments: [], eventRestaurantAssignments: [],
    returnVisits: [visit], restaurantRequests: [], visitHistories: [], onSubmitRestaurantRequest: vi.fn(), onAddRestaurantVisit: vi.fn(), ...extra }
  return render(<MemoryRouter><FullBuildingContext.Provider value={reader}><MobileTerritory {...(props as never)} /></FullBuildingContext.Provider></MemoryRouter>)
}
const reader = (over: Partial<FullBuildingReader> = {}): FullBuildingReader => ({ ready: false, error: false, request: vi.fn(), retry: vi.fn(async () => {}), ...over })
const regularSection = () => screen.getByRole('region', { name: '정기 방문' })
const openReturnVisits = () => fireEvent.click(within(regularSection()).getByRole('button', { name: /정기 방문/ }))
const openAddSheet = () => { fireEvent.click(regularSection().querySelector('.mt-main-menu-btn')!); fireEvent.click(screen.getByRole('button', { name: /정기 방문 추가/ })) }
const openRestaurantSheet = () => fireEvent.click(document.querySelector('.mt-restaurant-btn')!)

test('the return-visit count comes from return_visits and needs no buildings', () => {
  const light = reader()
  mount(light)
  expect(within(regularSection()).getByText('1')).toBeInTheDocument()
  expect(light.request).not.toHaveBeenCalled()
})

test.each([
  ['expanded return visits', openReturnVisits],
  ['the add sheet', openAddSheet],
  ['the restaurant sheet', openRestaurantSheet],
])('%s asks for full buildings and waits instead of rendering from partial data', (_label, open) => {
  const light = reader()
  mount(light)
  expect(light.request).not.toHaveBeenCalled()
  open()
  expect(light.request).toHaveBeenCalled()
  expect(screen.getByRole('status')).toHaveTextContent('불러오는 중...')
  expect(screen.queryByText('고림동 102호')).not.toBeInTheDocument()
  expect(document.querySelector('.rv-add-sheet, .rs-sheet, .restaurant-service-sheet')).toBeNull()
})

test.each([
  ['expanded return visits', openReturnVisits],
  ['the add sheet', openAddSheet],
  ['the restaurant sheet', openRestaurantSheet],
])('a failed full read for %s offers a retry', (_label, open) => {
  const failed = reader({ error: true })
  mount(failed)
  open()
  fireEvent.click(within(screen.getByRole('alert')).getByRole('button', { name: '다시 시도' }))
  expect(failed.retry).toHaveBeenCalled()
})

test('once full buildings are ready the tools render as before; without a reader nothing changes', () => {
  const ready = reader({ ready: true })
  const view = mount(ready)
  openReturnVisits()
  expect(screen.getByText('고림동 102호')).toBeInTheDocument()
  openAddSheet()
  expect(document.querySelector('.rv-add-sheet')).not.toBeNull()
  view.unmount()
  mount(null)
  openReturnVisits()
  expect(screen.getByText('고림동 102호')).toBeInTheDocument()
})
