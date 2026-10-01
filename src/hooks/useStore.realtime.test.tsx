import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { useStore } from './useStore'
import { testBuilding } from '../test/territoryFixture'

const state = vi.hoisted(() => ({ changed: vi.fn(), clock: vi.fn(), index: vi.fn(), reads: [] as string[], boundaryColumns: [] as string[], block: null as null | Promise<void> }))
vi.mock('./territorySync', () => ({ fetchChangedBuildings: state.changed, fetchTerritoryClock: state.clock, fetchBuildingRecoveryIndex: state.index }))
vi.mock('../lib/supabase', () => ({ supabase: {
  rpc: () => Promise.resolve({ error: null }),
  from: (table: string) => {
    const chain: Record<string, unknown> = {}
    let lookup = false
    let writing = false
    for (const name of ['select', 'order', 'range', 'eq', 'in', 'is', 'gte', 'lte', 'neq']) chain[name] = () => chain
    for (const name of ['insert', 'update', 'upsert', 'delete']) chain[name] = () => { writing = true; return chain }
    chain.select = (columns: string) => { if (table === 'card_boundaries') state.boundaryColumns.push(columns); return chain }
    chain.limit = () => { lookup = true; return chain }
    chain.then = async (resolve: (r: unknown) => void) => {
      state.reads.push(table)
      if (table === 'buildings') await state.block
      return resolve({ data: writing && table === 'card_boundaries' ? [{ card_id: 1 }] : lookup ? [{ id: 1 }] : [], error: null })
    }
    return chain
  },
} }))
afterEach(() => { cleanup(); vi.clearAllMocks(); state.changed.mockReset(); vi.unstubAllEnvs(); localStorage.clear(); state.reads = []; state.boundaryColumns = []; state.block = null })

test('boundary save and delete use fresh manifests, not all coordinates', async () => {
  const { result } = renderHook(() => useStore(true))
  await waitFor(() => expect(result.current.loading).toBe(false))
  state.boundaryColumns = []
  await act(async () => {
    await result.current.saveCardBoundary(1, [{ lat: 1, lng: 1 }, { lat: 2, lng: 1 }, { lat: 2, lng: 2 }])
  })
  expect(state.boundaryColumns).toEqual(['card_id', 'card_id, updated_at'])
  state.boundaryColumns = []
  await act(async () => { await result.current.deleteCardBoundary(1) })
  expect(state.boundaryColumns).toEqual(['card_id', 'card_id, updated_at'])
})

test('failed post-save targeted read falls back to authoritative buildings and visits', async () => {
  const { result } = renderHook(() => useStore(true))
  await waitFor(() => expect(result.current.loading).toBe(false))
  const one = testBuilding(1, 1, 'kept')
  state.changed.mockResolvedValueOnce({ buildings: [one], histories: [] })
  await act(async () => { await result.current.syncChangedBuildings([1]) })
  state.changed.mockRejectedValueOnce(new Error('offline'))
  state.reads = []
  await act(async () => { await result.current.updateUnitFlags(one.units[0].id, { memo: 'saved' }) })
  expect(state.reads).toContain('buildings')
  expect(state.reads).toContain('visit_histories')
  expect(state.reads).toContain('service_sessions')
})

test.each(['status', 'quick', 'add', 'edit', 'delete', 'undo', 'flags', 'invitation'] as const)(
  '%s refreshes only the affected building and histories, not all service sessions', async (action) => {
    localStorage.setItem('currentVisitor', 'tester')
    localStorage.setItem('auth_token', 'test-token')
    const { result } = renderHook(() => useStore(true))
    await waitFor(() => expect(result.current.loading).toBe(false))
    const one = testBuilding(1, 1, 'changed')
    const two = testBuilding(2, 2, 'untouched')
    const unitId = one.units[0].id
    const visit = { id: 10, buildingId: 1, unitId, visitor: 'tester', result: '부재', timeSlot: '오전', visitedAt: '2026-09-30', createdAt: '2026-09-30T10:00:00Z' }
    state.changed.mockResolvedValueOnce({ buildings: [one, two], histories: [visit] })
    await act(async () => { await result.current.syncChangedBuildings([1, 2]) })
    state.changed.mockClear()
    state.changed.mockResolvedValueOnce({ buildings: [one], histories: [] })
    state.reads = []
    await act(async () => {
      const input = { result: '부재' as const, timeSlot: '오전' as const, memo: '', visitedAt: '2026-09-30' }
      if (action === 'status') await result.current.updateUnitStatus(1, unitId, '부재')
      if (action === 'quick') await result.current.quickLogVisit(1, unitId, '부재')
      if (action === 'add') await result.current.addVisitHistory(1, unitId, input)
      if (action === 'edit') await result.current.updateVisitHistory(10, unitId, input)
      if (action === 'delete') await result.current.deleteVisitHistory(10, unitId)
      if (action === 'undo') await result.current.undoLatestVisit(1, unitId)
      if (action === 'flags') await result.current.updateUnitFlags(unitId, { memo: 'changed' })
      if (action === 'invitation') await result.current.toggleInvitationLeft(1, unitId, 'door')
    })
    expect(state.changed).toHaveBeenCalledExactlyOnceWith([1])
    expect(state.reads).not.toContain('service_sessions')
    expect(state.reads).not.toContain('buildings')
    expect(result.current.buildings.find((b) => b.id === 2)).toEqual(two)
    expect(result.current.visitHistories).toEqual([])
  },
)

test('store recovery reads only boundary versions; manual refresh still reads points', async () => {
  const { result } = renderHook(() => useStore(true))
  await waitFor(() => expect(result.current.loading).toBe(false))
  expect(state.boundaryColumns).toEqual(['card_id, points, updated_at'])
  state.boundaryColumns = []
  await act(async () => { await result.current.refetchSlices(['cardBoundaries'], { triggeredBy: 'foreground' }) })
  expect(state.boundaryColumns).toEqual(['card_id, updated_at'])
  await act(async () => { await result.current.refetchSlices(['cardBoundaries'], { triggeredBy: 'mutation:boundary' }) })
  expect(state.boundaryColumns.at(-1)).toBe('card_id, points, updated_at')
})

test('foreground and delayed reconnect use delta while manual refresh stays full', async () => {
  vi.stubEnv('VITE_TERRITORY_REALTIME_ENABLED', 'true')
  state.clock.mockResolvedValue('2026-09-30T12:00:00Z')
  state.index.mockResolvedValue({ signals: [], ids: [] })
  const { result } = renderHook(() => useStore(true))
  await waitFor(() => expect(result.current.loading).toBe(false))
  state.reads = []
  const now = Date.now()
  const date = vi.spyOn(Date, 'now').mockReturnValue(now + 125_000)
  await act(async () => { window.dispatchEvent(new Event('focus')) })
  await waitFor(() => expect(state.index).toHaveBeenCalledTimes(1))
  expect(state.reads).not.toContain('buildings')
  expect(state.reads).toContain('calendar_events')
  await act(async () => { await result.current.refetchSlices(['buildings', 'cards'], { triggeredBy: 'realtime:unit-created-recovery' }) })
  expect(state.index).toHaveBeenCalledTimes(2)
  expect(state.reads).not.toContain('buildings')
  await act(async () => { await result.current.refetchAll() })
  expect(state.reads).toContain('buildings')
  date.mockRestore()
})

test('failed delta falls back to a full read without advancing its cursor', async () => {
  vi.stubEnv('VITE_TERRITORY_REALTIME_ENABLED', 'true')
  state.clock.mockResolvedValue('2026-09-30T12:00:00Z')
  state.index.mockRejectedValue(new Error('unavailable'))
  const { result } = renderHook(() => useStore(true))
  await waitFor(() => expect(result.current.loading).toBe(false))
  state.reads = []
  await act(async () => { await result.current.refetchSlices(['buildings'], { triggeredBy: 'realtime:place-deletion-recovery' }) })
  expect(state.reads).toContain('buildings')
  expect(result.current.territoryRealtime.checkpoint.buildingsThrough).toBeNull()
})

test('manual refresh does not join an in-flight delta as if it were a full snapshot', async () => {
  vi.stubEnv('VITE_TERRITORY_REALTIME_ENABLED', 'true')
  state.clock.mockResolvedValue('2026-09-30T12:00:00Z')
  let release!: (value: unknown) => void
  state.index.mockImplementationOnce(() => new Promise((resolve) => { release = resolve }))
  const { result } = renderHook(() => useStore(true))
  await waitFor(() => expect(result.current.loading).toBe(false))
  state.reads = []
  let delta!: Promise<void>
  await act(async () => {
    delta = result.current.refetchSlices(['buildings'], { triggeredBy: 'realtime:place-deletion-recovery' })
  })
  await waitFor(() => expect(state.index).toHaveBeenCalled())
  await act(async () => { await result.current.refetchAll() })
  expect(state.reads).toContain('buildings')
  await act(async () => { release({ signals: [], ids: [] }); await delta })
})

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
  state.reads = []
  await act(async () => {
    await expect(result.current.refetchSlices(['buildings', 'visits'])).resolves.toBeUndefined()
  })
  expect(state.reads).toContain('buildings')
  expect(state.reads).toContain('visit_histories')
  expect(result.current.territoryRealtime.checkpoint.baseline).toBe('2026-09-30T12:00:00Z')
})

test.each(['RPC not found in schema cache', 'network unavailable'])(
  'initial data still loads when the optional clock fails: %s', async (message) => {
    vi.stubEnv('VITE_TERRITORY_REALTIME_ENABLED', 'true')
    state.clock.mockRejectedValue(new Error(message))
    const { result } = renderHook(() => useStore(true))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toBeNull()
    expect(state.reads).toContain('buildings')
    expect(state.reads).toContain('visit_histories')
    expect(result.current.territoryRealtime.checkpoint.baseline).toBeNull()
  },
)

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
