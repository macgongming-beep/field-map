import '@testing-library/jest-dom/vitest'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { FullBuildingContext, toMapBuilding, type FullBuildingReader } from '../hooks/buildingDemand'
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
const reader = (over: Partial<FullBuildingReader> = {}): FullBuildingReader => ({ ready: false, error: false, request: vi.fn(), retry: vi.fn(async () => {}), mapReady: false, requestMap: vi.fn(), ...over })
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
  ['expanded return visits', openReturnVisits, 'full'],
  ['the add sheet', openAddSheet, 'full'],
  ['the restaurant sheet', openRestaurantSheet, 'map'],
] as const)('%s asks for its tier (%s) and waits instead of rendering from partial data', (_label, open, tier) => {
  const light = reader()
  mount(light)
  expect(light.request).not.toHaveBeenCalled()
  expect(light.requestMap).not.toHaveBeenCalled()
  open()
  // 0171: the restaurant sheet asks only for the map snapshot; the editors still need full.
  expect(tier === 'map' ? light.requestMap : light.request).toHaveBeenCalled()
  expect(tier === 'map' ? light.request : light.requestMap).not.toHaveBeenCalled()
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

// 0171: a map snapshot already read for the assignment map opens the restaurant sheet without another read.
test('an existing map snapshot opens the restaurant sheet; it never opens the full-only editors', () => {
  const mapped = reader({ mapReady: true })
  mount(mapped, { buildings: [{ id: 7, cardId: 3, name: 'Noodle', address: 'Road 1', isRestaurant: true, units: [] }] })
  openRestaurantSheet()
  expect(document.querySelector('.restaurant-sheet-head')).not.toBeNull()
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
  expect(mapped.request).not.toHaveBeenCalled()
  fireEvent.click(document.querySelector('.restaurant-sheet-close')!)
  openReturnVisits()
  expect(mapped.request).toHaveBeenCalled()
  expect(screen.getByRole('status')).toHaveTextContent('불러오는 중...')
  expect(screen.queryByText('고림동 102호')).not.toBeInTheDocument()
})

// 0171: on map data alone the sheet lists, previews, starts and saves exactly as before (no DB; callbacks only).
test('map snapshot restaurant sheet: list, history preview, session payload and saved visit unit', async () => {
  const building = toMapBuilding({ id: 7, card_id: 3, name: '상가', address: '고림로 7', type: '상가', lat: 37.2, lng: 127.1, warning: false,
    access_status: null, is_restaurant: false, units_surveyed: true, building_access_events: [],
    units: [{ id: 71, building_id: 7, number: 'Noodle', status: '미방문', is_chinese: true, is_restaurant: true, usage_type: null, regular_visits: [] },
      { id: 72, building_id: 7, number: '201', status: '미방문', is_chinese: true, is_restaurant: false, usage_type: null, regular_visits: [] }] } as never)
  const onAddRestaurantVisit = vi.fn(async () => {})
  const histories = [{ id: 900, unitId: 71, visitor: '같은팀', result: '만남', visitedAt: '2026-11-01T03:00:00Z', memo: '점심 이후', visitType: 'restaurant' }]
  mount(reader({ mapReady: true }), { buildings: [building], cards: [{ id: 3, name: '카드3', region: '처인구' }], visitHistories: histories, onAddRestaurantVisit })
  openRestaurantSheet()
  fireEvent.change(document.querySelector('.restaurant-search-input')!, { target: { value: 'Noodle' } })
  const items = [...document.querySelectorAll('.restaurant-item')].filter(item => item.textContent?.includes('Noodle'))
  expect(items).toHaveLength(1)
  expect(document.body.textContent).not.toContain('201')
  fireEvent.click(items[0])
  expect(screen.getByText(/점심 이후/)).toBeInTheDocument()
  fireEvent.click(document.querySelector('.restaurant-start-btn')!)
  expect(JSON.parse(localStorage.getItem('rs:나')!)).toMatchObject({ kind: 'building', buildingId: 7, unitId: 71, name: 'Noodle', address: '고림로 7' })
  fireEvent.click(document.querySelector('.mt-rs-memo-toggle-btn')!)
  fireEvent.change(document.querySelector('.mt-rs-memo-input')!, { target: { value: '다시 방문' } })
  await act(async () => { fireEvent.click(document.querySelector('.mt-rs-save-btn')!) })
  expect(onAddRestaurantVisit).toHaveBeenCalledWith(71, '다시 방문')
  localStorage.removeItem('rs:나')
})

// 0172: an administrator viewing the volunteer screen gets the same gated tools on light data.
test('volunteer view on light data: count without buildings, tools still gated', () => {
  const light = reader()
  mount(light, { role: 'user' })
  expect(within(regularSection()).getByText('1')).toBeInTheDocument()
  expect(light.request).not.toHaveBeenCalled()
  openRestaurantSheet()
  expect(light.requestMap).toHaveBeenCalled()
  expect(screen.getByRole('status')).toHaveTextContent('불러오는 중...')
  fireEvent.click(document.querySelector('.mobile-sheet-backdrop')!)
  openReturnVisits()
  expect(light.request).toHaveBeenCalled()
  expect(screen.queryByText('고림동 102호')).not.toBeInTheDocument()
})

// Codex 0173 review: a restored restaurant session saves outside FullBuildingGate. It needs
// only the stored unit id, never buildings, so it works (and fails safely) on light data.
test.each(['saved', 'failed'] as const)('a restored restaurant session result on light data: %s', async outcome => {
  const session = { kind: 'building', buildingId: 7, unitId: 71, name: 'Noodle', address: '고림로 7', startedAt: new Date().toISOString() }
  localStorage.setItem('rs:나', JSON.stringify(session))
  const onAddRestaurantVisit = outcome === 'saved' ? vi.fn(async () => {}) : vi.fn(async () => { throw new Error('offline') })
  const light = reader()
  mount(light, { role: 'user', onAddRestaurantVisit })
  expect(document.querySelector('.mt-rs-active-card')).not.toBeNull()
  fireEvent.click(document.querySelector('.mt-rs-memo-toggle-btn')!)
  fireEvent.change(document.querySelector('.mt-rs-memo-input')!, { target: { value: '다시 방문' } })
  await act(async () => { fireEvent.click(document.querySelector('.mt-rs-save-btn')!) })
  expect(onAddRestaurantVisit).toHaveBeenCalledWith(71, '다시 방문')
  expect(light.request).not.toHaveBeenCalled()
  if (outcome === 'saved') {
    expect(localStorage.getItem('rs:나')).toBeNull()
    expect(document.querySelector('.mt-rs-active-card')).toBeNull()
  } else {
    // The draft and the session stay for another try.
    expect(JSON.parse(localStorage.getItem('rs:나')!)).toMatchObject({ unitId: 71 })
    expect((document.querySelector('.mt-rs-memo-input') as HTMLTextAreaElement).value).toBe('다시 방문')
  }
  localStorage.removeItem('rs:나')
})
