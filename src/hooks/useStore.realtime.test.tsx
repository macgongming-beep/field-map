import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { useStore } from './useStore'
import { testBuilding } from '../test/territoryFixture'

const state = vi.hoisted(() => ({ changed: vi.fn() }))
vi.mock('./territorySync', () => ({ fetchChangedBuildings: state.changed }))
vi.mock('../lib/supabase', () => ({ supabase: {
  rpc: () => Promise.resolve({ error: null }),
  from: () => {
    const chain: Record<string, unknown> = {}
    let lookup = false
    for (const name of ['select', 'order', 'range', 'eq', 'in', 'is', 'gte', 'lte', 'neq']) chain[name] = () => chain
    chain.limit = () => { lookup = true; return chain }
    chain.then = (resolve: (r: unknown) => void) => Promise.resolve({ data: lookup ? [{ id: 1 }] : [], error: null }).then(resolve)
    return chain
  },
} }))
afterEach(() => { cleanup(); vi.clearAllMocks() })

test('sync inserts empty buildings, replaces remote status and histories, and preserves unrelated buildings', async () => {
  const { result } = renderHook(() => useStore(true))
  await waitFor(() => expect(result.current.loading).toBe(false))
  const one = testBuilding(1, 1, 'first')
  const two = testBuilding(2, 2, 'other')
  const visit = { id: 10, buildingId: 1, unitId: one.units[0].id, visitor: 'peer', result: '부재', timeSlot: '오전', visitedAt: '2026-09-30', createdAt: '2026-09-30T10:00:00Z' }
  state.changed.mockResolvedValueOnce({ buildings: [one, two], histories: [] })
  await act(async () => { await result.current.syncChangedBuildings([1, 2]) })
  const updated = { ...one, units: one.units.map((u) => ({ ...u, status: '부재' })) }
  state.changed.mockResolvedValueOnce({ buildings: [updated], histories: [visit] })
  await act(async () => { await result.current.syncChangedBuildings([1]) })
  expect(result.current.buildings.find((b) => b.id === 1)?.units[0].status).toBe('부재')
  expect(result.current.buildings.find((b) => b.id === 2)).toEqual(two)
  expect(result.current.buildings.map((b) => b.id)).toEqual([1, 2])
  expect(result.current.visitHistories).toEqual([visit])
  state.changed.mockResolvedValueOnce({ buildings: [one], histories: [] })
  await act(async () => { await result.current.syncChangedBuildings([1]) })
  expect(result.current.visitHistories).toEqual([])
  expect(result.current.buildings.find((b) => b.id === 1)?.units[0].status).toBe(one.units[0].status)
  state.changed.mockResolvedValueOnce({ buildings: [testBuilding(3, 1, 'empty', [])], histories: [] })
  await act(async () => { await result.current.syncChangedBuildings([3]) })
  expect(result.current.buildings.find((b) => b.id === 3)?.units).toEqual([])
  expect(result.current.buildings).toHaveLength(3)
})

test('a failed targeted fetch does not erase existing data', async () => {
  const { result } = renderHook(() => useStore(true))
  await waitFor(() => expect(result.current.loading).toBe(false))
  state.changed.mockResolvedValueOnce({ buildings: [testBuilding(1, 1, 'kept')], histories: [] })
  await act(async () => { await result.current.syncChangedBuildings([1]) })
  state.changed.mockRejectedValueOnce(new Error('offline'))
  await act(async () => { await expect(result.current.syncChangedBuildings([1])).rejects.toThrow('offline') })
  expect(result.current.buildings[0].name).toBe('kept')
})

test('an older map response cannot overwrite a newer response for the same building', async () => {
  const { result } = renderHook(() => useStore(true))
  await waitFor(() => expect(result.current.loading).toBe(false))
  let finish!: (data: unknown) => void
  state.changed.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
    .mockResolvedValueOnce({ buildings: [testBuilding(1, 1, 'new')], histories: [] })
  let old!: Promise<void>
  await act(async () => {
    old = result.current.syncChangedBuildings([1])
    await result.current.syncChangedBuildings([1])
  })
  await act(async () => { finish({ buildings: [testBuilding(1, 1, 'old')], histories: [] }); await old })
  expect(result.current.buildings[0].name).toBe('new')
})
