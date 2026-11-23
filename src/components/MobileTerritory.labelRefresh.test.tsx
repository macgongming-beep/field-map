import '@testing-library/jest-dom/vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { Building, CalendarEvent, EventRestaurantAssignment, TerritoryCard } from '../types'
import { toCalendarBuilding, toMapBuilding, toZoneBuilding } from '../hooks/buildingDemand'
import { ServiceLabelContext, type ServiceLabelSource } from '../hooks/useServiceLabels'
import { MobileTerritory } from './MobileTerritory'

// 0170 Codex review: labels outside the store follow refreshes, and placeholder coordinates
// of calendar/zone buildings never replace a restaurant's real 길찾기 coordinates.
const state = vi.hoisted(() => ({ cardReads: 0, placeReads: 0, cardResult: null as null | (() => Promise<unknown>), placeResult: null as null | (() => Promise<unknown>) }))
vi.mock('../lib/cardDirectory', () => ({ readCardDirectory: () => { state.cardReads++; return state.cardResult!() } }))
vi.mock('../lib/placeLabels', () => ({ readPlaceLabels: () => { state.placeReads++; return state.placeResult!() } }))

function localToday(): string {
  const date = new Date()
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
const event = { id: 394, date: localToday(), time: '15:00', title: '전도394', applicants: ['나'], assigned: [], leaders: [],
  cardAssignments: [{ id: 1, eventId: 394, userName: '나', assignedCardId: 10, assignedCardIds: [10], teamKey: 'team-1' }] } as CalendarEvent
const restaurant = { id: 5, eventId: 394, userName: '나', buildingId: 7, unitId: null } as EventRestaurantAssignment
const label = (name: string, lat = 37.2) => [{ id: 7, cardId: 3, name, address: 'Road 1', lat, lng: lat ? 127.1 : 0, units: [] }]
const deferred = () => { let resolve!: (value: unknown) => void, reject!: (error: unknown) => void; const promise = new Promise((ok, fail) => { resolve = ok; reject = fail }); return { promise, resolve, reject } }

function view(source: ServiceLabelSource, extra: Record<string, unknown> = {}) {
  const props = (more: Record<string, unknown>) => ({ language: 'ko', buildings: [] as Building[], cards: [] as TerritoryCard[], calendarEvents: [event], currentVisitor: '나', role: 'leader',
    serviceSessions: [], onOpenMap: vi.fn(), onEndServiceSession: vi.fn(), informalAssets: [], eventInformalAssignments: [],
    eventRestaurantAssignments: [restaurant], ...more })
  const tree = (value: ServiceLabelSource, more: Record<string, unknown>) =>
    <MemoryRouter><ServiceLabelContext.Provider value={value}><MobileTerritory {...(props(more) as never)} /></ServiceLabelContext.Provider></MemoryRouter>
  const result = render(tree(source, extra))
  fireEvent.click(screen.getByRole('button', { name: /15:00 전도/ }))
  return { ...result, update: (value: ServiceLabelSource, more: Record<string, unknown> = extra) => result.rerender(tree(value, more)) }
}
const article = () => screen.getByRole('button', { name: /15:00 전도/ }).closest('article')!
const names = () => [...article().querySelectorAll('.mobile-today-card-row strong')].map(node => node.textContent)
const busy = () => [...article().querySelectorAll('.mobile-today-card-row')].some(row => row.getAttribute('aria-busy') === 'true')
const light = (revision = 0): ServiceLabelSource => ({ revision, storePlaces: false })

beforeEach(() => { state.cardReads = 0; state.placeReads = 0 })
afterEach(() => vi.restoreAllMocks())

test('a later refresh re-reads the same ids and shows renamed cards and moved restaurants', async () => {
  state.cardResult = () => Promise.resolve([{ id: 10, name: 'Old card' }])
  state.placeResult = () => Promise.resolve(label('Old place', 0))
  const open = vi.spyOn(window, 'open').mockImplementation(() => null)
  const page = view(light())
  await waitFor(() => expect(names()).toEqual(['Old card', 'Old place']))
  // An ordinary re-render (new arrays, same revision) never reads again.
  page.update(light(), { calendarEvents: [{ ...event }], eventRestaurantAssignments: [{ ...restaurant }] })
  expect([state.cardReads, state.placeReads]).toEqual([1, 1])
  const card = deferred(), place = deferred()
  state.cardResult = () => card.promise; state.placeResult = () => place.promise
  page.update(light(1))
  expect([state.cardReads, state.placeReads]).toEqual([2, 2])
  // The names already shown stay while the newer read is on its way.
  expect(names()).toEqual(['Old card', 'Old place'])
  expect(busy()).toBe(false)
  await act(async () => { card.resolve([{ id: 10, name: 'New card' }]); place.resolve(label('New place')) })
  expect(names()).toEqual(['New card', 'New place'])
  fireEvent.click(within(article()).getByRole('button', { name: '길찾기' }))
  expect(open).toHaveBeenCalledWith('https://map.naver.com/p/search/New%20place', '_blank', 'noopener,noreferrer')
})

test('an older refresh answering late cannot replace the newer labels', async () => {
  const first = { card: deferred(), place: deferred() }, second = { card: deferred(), place: deferred() }
  state.cardResult = () => first.card.promise; state.placeResult = () => first.place.promise
  const page = view(light())
  state.cardResult = () => second.card.promise; state.placeResult = () => second.place.promise
  page.update(light(1))
  await act(async () => { second.card.resolve([{ id: 10, name: 'New card' }]); second.place.resolve(label('New place')) })
  await act(async () => { first.card.resolve([{ id: 10, name: 'Old card' }]); first.place.resolve(label('Old place')) })
  expect(names()).toEqual(['New card', 'New place'])
})

test('a failed refresh keeps the labels already shown', async () => {
  state.cardResult = () => Promise.resolve([{ id: 10, name: 'Old card' }])
  state.placeResult = () => Promise.resolve(label('Old place'))
  const page = view(light())
  await waitFor(() => expect(names()).toEqual(['Old card', 'Old place']))
  state.cardResult = () => Promise.reject(new Error('offline')); state.placeResult = () => Promise.reject(new Error('offline'))
  page.update(light(1))
  await waitFor(() => expect([state.cardReads, state.placeReads]).toEqual([2, 2]))
  await act(async () => {})
  expect(names()).toEqual(['Old card', 'Old place'])
})

test('complete store data needs no label read, even when the revision moves', () => {
  const building = toMapBuilding({ id: 7, card_id: 3, name: 'Store place', address: 'Road 1', type: '식당', lat: 37.2, lng: 127.1, warning: false,
    access_status: null, is_restaurant: true, units_surveyed: true, building_access_events: [], units: [] } as never)
  const page = view({ revision: 0, storePlaces: true }, { cards: [{ id: 10, name: 'Store card' }], buildings: [building] })
  page.update({ revision: 1, storePlaces: true })
  expect([state.cardReads, state.placeReads]).toEqual([0, 0])
  expect(names()).toEqual(['Store card', 'Store place'])
})

const calendarBuilding = () => toCalendarBuilding({ id: 7, card_id: 3, name: 'Placeholder', address: 'Road 1', units: [] })
const zoneBuilding = () => toZoneBuilding({ id: 7, card_id: 3, name: 'Placeholder', address: 'Road 1', type: '식당', warning: false,
  access_status: null, is_restaurant: true, units_surveyed: true, units: [] } as never)
test.each([
  ['calendar', calendarBuilding, 37.2],
  ['calendar', calendarBuilding, 0],
  ['zone', zoneBuilding, 37.2],
  ['zone', zoneBuilding, 0],
])('%s placeholder buildings are not places: labels decide 길찾기 (real lat %s)', async (_tier, make, lat) => {
  expect(make()).toMatchObject({ id: 7, lat: 0, lng: 0 })
  state.cardResult = () => Promise.resolve([{ id: 10, name: 'Card' }])
  state.placeResult = () => Promise.resolve(label('Noodle', lat))
  const open = vi.spyOn(window, 'open').mockImplementation(() => null)
  const onOpenMap = vi.fn()
  view(light(), { cards: [{ id: 10, name: 'Card' }], buildings: [make()], onOpenMap })
  await waitFor(() => expect(names()).toEqual(['Card', 'Noodle']))
  expect(state.placeReads).toBe(1)
  fireEvent.click(within(article()).getByRole('button', { name: '길찾기' }))
  if (lat) { expect(open).toHaveBeenCalledWith('https://map.naver.com/p/search/Noodle', '_blank', 'noopener,noreferrer'); expect(onOpenMap).not.toHaveBeenCalled() }
  else { expect(onOpenMap).toHaveBeenCalledWith(3); expect(open).not.toHaveBeenCalled() }
})
