import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CalendarEvent } from '../types'
import type { CardSummary } from '../lib/cardSummaries'
import type { RecipientCardDetails } from '../lib/recipientCardPrefetch'
import { RecipientPreview } from './RecipientPreview'

const mocks = vi.hoisted(() => ({ assignments: vi.fn(), prefetch: vi.fn(), dispose: vi.fn() }))
vi.mock('../lib/recipientPreview', () => ({ createRecipientPreview: () => ({ assignments: mocks.assignments, reader: { prefetch: mocks.prefetch }, dispose: mocks.dispose }) }))
vi.mock('./MapCanvas', () => ({ MapCanvas: ({ buildings, cards }: { buildings: { id: number }[]; cards: { id: number }[] }) =>
  <div data-testid="preview-map">{JSON.stringify({ buildings: buildings.map((b) => b.id), cards: cards.map((c) => c.id) })}</div> }))

const event = { id: 10, date: '2026-10-05', time: '10:00', title: 'Service', cardAssignments: [{ userName: 'Volunteer', assignedCardIds: [1, 2], cardScope: '상가' }] } as CalendarEvent
const summaries = [1, 2].map((id) => ({ id, name: `Card ${id}`, buildings: 1, units: 6, completed: 0, progress: 0, houseUnits: 2, shopUnits: 4, houseBuildings: 1, shopBuildings: 1, houseCompleted: 0, shopCompleted: 0 })) as CardSummary[]
const details = { buildings: [1, 2].map((id) => ({ id: id + 10, card_id: id, name: `Building ${id}`, address: '', type: '상가', lat: 37, lng: 127, units: [] })), histories: [], boundaries: [], baseline: null } as unknown as RecipientCardDetails

beforeEach(() => {
  vi.clearAllMocks()
  mocks.assignments.mockResolvedValue([event])
  mocks.prefetch.mockReturnValue({ summaries: Promise.resolve(summaries), details: Promise.resolve(details) })
})
const open = () => render(<MemoryRouter><RecipientPreview userName="Volunteer" /></MemoryRouter>)

describe('read-only recipient demo', () => {
  it('shows scoped summaries before details finish, then uses the same prefetch on both map entries', async () => {
    let resolveDetails!: (data: RecipientCardDetails) => void
    mocks.prefetch.mockReturnValue({ summaries: Promise.resolve(summaries), details: new Promise((resolve) => { resolveDetails = resolve }) })
    open()
    await screen.findByText('Card 1')
    expect(screen.getAllByText(/4세대/)).toHaveLength(2)
    expect(screen.queryByText(/6세대/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '배정 구역 전체 지도' }))
    expect(screen.queryByTestId('preview-map')).toBeNull()
    await act(async () => resolveDetails(details))
    expect(screen.getByTestId('preview-map').textContent).toBe('{"buildings":[11,12],"cards":[1,2]}')
    fireEvent.click(screen.getByRole('button', { name: '목록' }))
    fireEvent.click(screen.getByText('Card 2'))
    expect(screen.getByTestId('preview-map').textContent).toBe('{"buildings":[12],"cards":[2]}')
    expect(mocks.prefetch).toHaveBeenCalledTimes(1)
    expect(mocks.prefetch).toHaveBeenCalledWith([1, 2])
  })

  it('does not read buildings when no card is assigned', async () => {
    mocks.assignments.mockResolvedValue([])
    open()
    await screen.findByText('배정된 구역이 없습니다.')
    expect(mocks.prefetch).not.toHaveBeenCalled()
  })

  it('keeps failed loading separate from an empty assignment and retries explicitly', async () => {
    mocks.assignments.mockRejectedValueOnce(new Error('Network unavailable'))
    open()
    await screen.findByRole('alert')
    expect(screen.queryByText('배정된 구역이 없습니다.')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '새로고침' }))
    await screen.findByText('Card 1')
    expect(mocks.assignments).toHaveBeenCalledTimes(2)
  })

  it('disposes cached data and ignores late work when the screen closes', async () => {
    let resolveDetails!: (data: RecipientCardDetails) => void
    mocks.prefetch.mockReturnValue({ summaries: Promise.resolve(summaries), details: new Promise((resolve) => { resolveDetails = resolve }) })
    const view = open()
    await screen.findByText('Card 1')
    view.unmount()
    expect(mocks.dispose).toHaveBeenCalledTimes(2)
    await act(async () => resolveDetails(details))
  })

  it('shows detail failure instead of an empty map', async () => {
    mocks.prefetch.mockImplementation(() => ({ summaries: Promise.resolve(summaries), details: Promise.reject(new Error('Network unavailable')) }))
    open()
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy())
    expect(screen.queryByTestId('preview-map')).toBeNull()
  })
})
