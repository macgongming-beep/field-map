import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { useStore } from './useStore'
import { testBuilding } from '../test/territoryFixture'

const state = vi.hoisted(() => ({ changed: vi.fn(), clock: vi.fn(), reads: [] as string[], block: null as null | Promise<void> }))
vi.mock('./territorySync', () => ({ fetchChangedBuildings: state.changed, fetchTerritoryClock: state.clock }))
vi.mock('../lib/supabase', () => ({ supabase: {
  rpc: () => Promise.resolve({ error: null }),
  from: (table: string) => {
    const chain: Record<string, unknown> = {}
    let lookup = false
    for (const name of ['select', 'order', 'range', 'eq', 'in', 'is', 'gte', 'lte', 'neq']) chain[name] = () => chain
    chain.limit = () => { lookup = true; return chain }
    chain.then = async (resolve: (r: unknown) => void) => {
      state.reads.push(table)
      if (table === 'buildings') await state.block
      return resolve({ data: lookup ? [{ id: 1 }] : [], error: null })
    }
    return chain
  },
} }))
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.unstubAllEnvs(); state.reads = []; state.block = null })

test('publishes the server read-start baseline only after the full snapshot succeeds', async () => {
  vi.stubEnv('VITE_TERRITORY_REALTIME_ENABLED', 'true')
  state.clock.mockResolvedValue('2026-09-30T12:00:00Z')
  let release!: () => void
  state.block = new Promise<void>((resolve) => { release = resolve })
  const { result } = renderHook(() => useStore(true))
  await waitFor(() => expect(state.reads).toContain('buildings'))
  expect(result.current.territoryRealtime.checkpoint.baseline).toBeNull()
  expect(state.clock).toHaveBeenCalledTimes(1)
  await act(async () => { release() })
  await waitFor(() => expect(result.current.loading).toBe(false))
  expect(result.current.territoryRealtime.checkpoint.baseline).toBe('2026-09-30T12:00:00Z')
  state.clock.mockRejectedValueOnce(new Error('clock offline'))
  await act(async () => {
    await expect(result.current.refetchSlices(['buildings', 'visits'])).rejects.toThrow('clock offline')
  })
  expect(result.current.territoryRealtime.checkpoint.baseline).toBe('2026-09-30T12:00:00Z')
})

test('concurrent recovery requests share building reads but mutation refreshes do not', async () => {
  const { result } = renderHook(() => useStore(true))
  await waitFor(() => expect(result.current.loading).toBe(false))
  state.reads = []
  let release!: () => void
  state.block = new Promise<void>((resolve) => { release = resolve })
  let first!: Promise<void>, second!: Promise<void>, mutation!: Promise<void>
  await act(async () => {
    first = result.current.refetchSlices(['buildings'], { triggeredBy: 'realtime:place-deletion-recovery' })
    second = result.current.refetchSlices(['buildings'], { triggeredBy: 'realtime:unit-created-recovery' })
    mutation = result.current.refetchSlices(['buildings'], { triggeredBy: 'mutation:building' })
  })
  expect(state.reads.filter((table) => table === 'buildings')).toHaveLength(2)
  await act(async () => { release(); await Promise.all([first, second, mutation]) })
})

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
