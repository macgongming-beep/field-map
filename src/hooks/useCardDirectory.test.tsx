import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import type { ReactNode } from 'react'
import type { CalendarEvent } from '../types'
import { ScopedCardContext, useSharedCardNames, useRestaurantCardDirectory } from './useCardDirectory'

const read = vi.hoisted(() => vi.fn())
vi.mock('../lib/cardDirectory', () => ({ readCardDirectory: read }))
const wrapper = ({ children }: { children: ReactNode }) => <ScopedCardContext.Provider value>{children}</ScopedCardContext.Provider>
const event = (id: number, cards: number[], shared = true) => ({ id, assignmentStatus: shared ? 'shared' : 'draft',
  cardAssignments: cards.map(assignedCardId => ({ userName: `person${assignedCardId}`, assignedCardId })) }) as CalendarEvent
afterEach(() => { cleanup(); read.mockReset() })
test('only the opened shared event missing names are read; old responses cannot replace the next event', async () => {
  let resolve!: (rows: { id: number; name: string }[]) => void
  read.mockImplementationOnce(() => new Promise(r => { resolve = r })).mockResolvedValueOnce([{ id: 3, name: 'Next event' }])
  const own = [{ id: 1, name: 'Mine' }]
  const { result, rerender } = renderHook(({ value }) => useSharedCardNames(value, own), { initialProps: { value: event(10, [1, 2]) }, wrapper })
  expect(read).toHaveBeenCalledWith([2])
  rerender({ value: event(11, [1, 3]) })
  await waitFor(() => expect(result.current.cards).toContainEqual({ id: 3, name: 'Next event' }))
  await act(async () => resolve([{ id: 2, name: 'Old event' }]))
  expect(result.current.cards.some(card => card.id === 2)).toBe(false)
  expect(read.mock.calls).toEqual([[[2]], [[3]]])
})
test('draft, full-store, and already-known names do not read extra cards', () => {
  renderHook(() => useSharedCardNames(event(1, [2], false), []), { wrapper })
  renderHook(() => useSharedCardNames(event(1, [2]), []))
  renderHook(() => useSharedCardNames(event(1, [2]), [{ id: 2, name: 'Known' }]), { wrapper })
  expect(read).not.toHaveBeenCalled()
})
test('failed name lookup retains assigned ids and retries without showing unassigned', async () => {
  read.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce([{ id: 2, name: 'Recovered' }])
  const { result } = renderHook(() => useSharedCardNames(event(1, [2]), []), { wrapper })
  await waitFor(() => expect(result.current.error).toBe(true))
  expect(result.current.cards).toEqual([{ id: 2, name: '#2' }])
  act(() => result.current.retry())
  await waitFor(() => expect(result.current.cards).toEqual([{ id: 2, name: 'Recovered' }]))
})
test('restaurant directory keeps regions outside my assignment when opened', async () => {
  read.mockResolvedValue([{ id: 2, name: 'Outside', region: 'Other gu', area: 'Other dong' }])
  const { result } = renderHook(() => useRestaurantCardDirectory([]), { wrapper })
  await waitFor(() => expect(result.current.cards[0]?.region).toBe('Other gu'))
  expect(read).toHaveBeenCalledWith()
})
