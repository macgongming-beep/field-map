import '@testing-library/jest-dom/vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { Building, CalendarEvent, EventRestaurantAssignment, TerritoryCard } from '../types'
import { MobileTerritory } from './MobileTerritory'

// 나의 봉사 오늘 배정: card and restaurant names come from display-only labels.
const state = vi.hoisted(() => ({ cardReads: [] as number[][], placeReads: [] as [number[], number[]][], cardResult: null as null | (() => Promise<unknown>), placeResult: null as null | (() => Promise<unknown>) }))
vi.mock('../lib/cardDirectory', () => ({ readCardDirectory: (ids: number[]) => { state.cardReads.push(ids); return state.cardResult!() } }))
vi.mock('../lib/placeLabels', () => ({ readPlaceLabels: (buildingIds: number[], unitIds: number[]) => { state.placeReads.push([buildingIds, unitIds]); return state.placeResult!() } }))

function localToday(): string {
  const date = new Date()
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
const event = (id = 394, cardIds = [20, 10]) => ({
  id, date: localToday(), time: '15:00', title: `전도${id}`, applicants: ['나', '같은팀'], assigned: [], leaders: [],
  cardAssignments: [
    { id: 1, eventId: id, userName: '나', assignedCardId: cardIds[0], assignedCardIds: cardIds, teamKey: 'team-1' },
    { id: 2, eventId: id, userName: '같은팀', assignedCardId: cardIds[0], assignedCardIds: cardIds, teamKey: 'team-1' },
  ],
}) as CalendarEvent
const card = (id: number, name: string) => ({ id, name, area: '', region: '', progress: 37, assignedUsers: [], buildings: 1, units: 1 }) as unknown as TerritoryCard
const restaurant = (unitId: number | null = 70) => ({ id: 5, eventId: 394, userName: '나', buildingId: 7, unitId }) as EventRestaurantAssignment
const placeLabel = (lat = 37.2) => [{ id: 7, cardId: 3, name: 'Noodle', address: 'Road 1', lat, lng: lat ? 127.1 : 0, units: [{ id: 70, buildingId: 7, number: '101' }] }]
const deferred = () => { let resolve!: (value: unknown) => void, reject!: (error: unknown) => void; const promise = new Promise((ok, fail) => { resolve = ok; reject = fail }); return { promise, resolve, reject } }

const props = (overrides: Record<string, unknown> = {}) => ({
  language: 'ko', buildings: [] as Building[], cards: [] as TerritoryCard[], calendarEvents: [event()], currentVisitor: '나', role: 'user',
  serviceSessions: [], onOpenMap: vi.fn(), onEndServiceSession: vi.fn(), informalAssets: [], eventInformalAssignments: [],
  eventRestaurantAssignments: [] as EventRestaurantAssignment[], ...overrides,
})
const mount = (overrides: Record<string, unknown> = {}) => {
  const view = render(<MemoryRouter><MobileTerritory {...(props(overrides) as never)} /></MemoryRouter>)
  const button = screen.getByRole('button', { name: /15:00 전도/ })
  if (!button.closest('article')?.classList.contains('open')) fireEvent.click(button)
  return { ...view, rerender: (next: Record<string, unknown>) => view.rerender(<MemoryRouter><MobileTerritory {...(props(next) as never)} /></MemoryRouter>) }
}
const article = () => screen.getByRole('button', { name: /15:00 전도/ }).closest('article')!
const rows = () => [...article().querySelectorAll('.mobile-today-card-row')]
const count = () => article().querySelector('.mobile-today-service-toggle b')!.textContent

beforeEach(() => { state.cardReads = []; state.placeReads = []; state.cardResult = null; state.placeResult = null })
afterEach(() => vi.restoreAllMocks())

test('cards not loaded yet stay as pending rows in assignment order, counted, never "no assigned card"', async () => {
  const pending = deferred(); state.cardResult = () => pending.promise
  mount()
  expect(rows()).toHaveLength(2)
  expect(rows().every(row => row.getAttribute('aria-busy') === 'true')).toBe(true)
  expect(count()).toBe('2개')
  expect(screen.queryByText('배정된 카드가 없습니다.')).not.toBeInTheDocument()
  expect(state.cardReads).toEqual([[10, 20]])
  await act(async () => { pending.resolve([{ id: 10, name: 'Ten' }, { id: 20, name: 'Twenty' }]) })
  expect(rows().map(row => row.querySelector('strong')!.textContent)).toEqual(['Twenty', 'Ten'])
})

test('store cards are reused without a label read and the progress is no longer shown', () => {
  mount({ cards: [card(10, 'Ten'), card(20, 'Twenty')] })
  expect(state.cardReads).toEqual([])
  expect(rows().map(row => row.querySelector('strong')!.textContent)).toEqual(['Twenty', 'Ten'])
  expect(article().textContent).not.toMatch(/37%|%/)
})

test('a store that fills in during the read does not restart it', async () => {
  const pending = deferred(); state.cardResult = () => pending.promise
  const view = mount()
  view.rerender({ cards: [card(10, 'Ten')] })
  expect(state.cardReads).toEqual([[10, 20]])
  expect(rows().map(row => row.getAttribute('aria-busy'))).toEqual(['true', null])
  await act(async () => { pending.resolve([{ id: 10, name: 'Ten' }, { id: 20, name: 'Twenty' }]) })
  expect(rows().map(row => row.querySelector('strong')!.textContent)).toEqual(['Twenty', 'Ten'])
  expect(state.cardReads).toHaveLength(1)
})

test('a failed label read keeps the rows with a retry, then shows the names', async () => {
  state.cardResult = () => Promise.reject(new Error('offline'))
  mount()
  await waitFor(() => expect(within(article()).getAllByRole('button', { name: '다시 시도' })).toHaveLength(2))
  expect(rows()).toHaveLength(2)
  state.cardResult = () => Promise.resolve([{ id: 10, name: 'Ten' }, { id: 20, name: 'Twenty' }])
  fireEvent.click(within(article()).getAllByRole('button', { name: '다시 시도' })[0])
  await waitFor(() => expect(rows().map(row => row.querySelector('strong')!.textContent)).toEqual(['Twenty', 'Ten']))
  expect(state.cardReads).toHaveLength(2)
})

test('a deleted card is dropped once the read completes, as before', async () => {
  state.cardResult = () => Promise.resolve([{ id: 10, name: 'Ten' }])
  mount()
  await waitFor(() => expect(rows().map(row => row.querySelector('strong')!.textContent)).toEqual(['Ten']))
  expect(count()).toBe('1개')
})

test('a late label response for an earlier assignment is ignored', async () => {
  const first = deferred(); state.cardResult = () => first.promise
  const view = mount()
  const second = deferred(); state.cardResult = () => second.promise
  view.rerender({ calendarEvents: [event(394, [30])] })
  await act(async () => { first.resolve([{ id: 10, name: 'Ten' }, { id: 20, name: 'Twenty' }]) })
  expect(rows().map(row => row.getAttribute('aria-busy'))).toEqual(['true'])
  await act(async () => { second.resolve([{ id: 30, name: 'Thirty' }]) })
  expect(rows().map(row => row.querySelector('strong')!.textContent)).toEqual(['Thirty'])
})

test.each([
  ['with coordinates, opens the external map', 37.2],
  ['without coordinates, opens the card map', 0],
])('a restaurant not in the store is read as a label and %s', async (_label, lat) => {
  state.cardResult = () => Promise.resolve([{ id: 10, name: 'Ten' }, { id: 20, name: 'Twenty' }])
  const pending = deferred(); state.placeResult = () => pending.promise
  const open = vi.spyOn(window, 'open').mockImplementation(() => null)
  const onOpenMap = vi.fn()
  mount({ eventRestaurantAssignments: [restaurant()], onOpenMap })
  expect(state.placeReads).toEqual([[[7], [70]]])
  const restaurantRow = () => rows().find(row => row.textContent?.includes('식당'))!
  expect(restaurantRow().getAttribute('aria-busy')).toBe('true')
  expect(count()).toBe('3개')
  await act(async () => { pending.resolve(placeLabel(lat)) })
  expect(restaurantRow().querySelector('strong')!.textContent).toBe('101 · Noodle')
  fireEvent.click(within(restaurantRow() as HTMLElement).getByRole('button', { name: '길찾기' }))
  if (lat) expect(open).toHaveBeenCalledWith('https://map.naver.com/p/search/Noodle', '_blank', 'noopener,noreferrer')
  else expect(onOpenMap).toHaveBeenCalledWith(3)
})

test('a restaurant in the store is not read again; a missing unit shows the building as before', () => {
  state.cardResult = () => Promise.resolve([])
  const building = { id: 7, cardId: 3, name: 'Noodle', address: 'Road 1', lat: 37.2, lng: 127.1, units: [] } as unknown as Building
  mount({ cards: [card(10, 'Ten'), card(20, 'Twenty')], buildings: [building], eventRestaurantAssignments: [restaurant()] })
  expect(state.placeReads).toEqual([])
  expect(rows().find(row => row.textContent?.includes('식당'))!.querySelector('strong')!.textContent).toBe('Noodle')
})

test('a failed restaurant label read keeps the row with a retry', async () => {
  state.cardResult = () => Promise.resolve([{ id: 10, name: 'Ten' }, { id: 20, name: 'Twenty' }])
  state.placeResult = () => Promise.reject(new Error('offline'))
  mount({ eventRestaurantAssignments: [restaurant()] })
  const restaurantRow = () => rows().find(row => row.textContent?.includes('식당'))!
  await waitFor(() => expect(within(restaurantRow() as HTMLElement).getByRole('button', { name: '다시 시도' })).toBeInTheDocument())
  state.placeResult = () => Promise.resolve(placeLabel())
  fireEvent.click(within(restaurantRow() as HTMLElement).getByRole('button', { name: '다시 시도' }))
  await waitFor(() => expect(restaurantRow().querySelector('strong')!.textContent).toBe('101 · Noodle'))
  expect(state.placeReads).toHaveLength(2)
})

test('a late restaurant label response for an earlier assignment is ignored', async () => {
  state.cardResult = () => Promise.resolve([{ id: 10, name: 'Ten' }, { id: 20, name: 'Twenty' }])
  const first = deferred(); state.placeResult = () => first.promise
  const view = mount({ eventRestaurantAssignments: [restaurant()] })
  const second = deferred(); state.placeResult = () => second.promise
  view.rerender({ eventRestaurantAssignments: [{ ...restaurant(), buildingId: 8, unitId: null }] })
  await act(async () => { first.resolve(placeLabel()) })
  const restaurantRow = () => rows().find(row => row.textContent?.includes('식당'))!
  expect(restaurantRow().getAttribute('aria-busy')).toBe('true')
  await act(async () => { second.resolve([{ id: 8, cardId: 4, name: 'Rice', address: 'Road 2', lat: 0, lng: 0, units: [] }]) })
  expect(restaurantRow().querySelector('strong')!.textContent).toBe('Rice')
  expect(state.placeReads).toEqual([[[7], [70]], [[8], []]])
})

test('a label read without the assigned unit still shows the building, as the store path does', async () => {
  state.cardResult = () => Promise.resolve([{ id: 10, name: 'Ten' }, { id: 20, name: 'Twenty' }])
  state.placeResult = () => Promise.resolve([{ ...placeLabel()[0], units: [] }])
  mount({ eventRestaurantAssignments: [restaurant()] })
  await waitFor(() => expect(rows().find(row => row.textContent?.includes('식당'))!.querySelector('strong')!.textContent).toBe('Noodle'))
})
