import { act, cleanup, render, renderHook, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { buildingDemandForRoute, BuildingDetailContext, MAP_BUILDING_COLUMNS, type BuildingDemand } from './buildingDemand'
import { BuildingDetailGate } from '../components/BuildingDetailGate'
import { toBuilding, type RawBuilding } from './storeTransforms'
import { useStore } from './useStore'

const state = vi.hoisted(() => ({
  reads: [] as { table: string; columns: string }[],
  rows: [] as RawBuilding[], changed: vi.fn(), summaries: vi.fn(), rpc: vi.fn(),
  buildingResponse: null as null | Promise<{ data: RawBuilding[]; error: unknown }>,
  cardError: false,
}))
vi.mock('../lib/cardSummaries', () => ({ fetchCardSummaries: state.summaries }))
vi.mock('./territorySync', () => ({
  fetchChangedBuildings: state.changed, fetchTerritoryClock: async () => '2026-11-13T10:00:00Z',
  fetchBuildingRecoveryIndex: async () => ({ signals: [], ids: state.rows.map(b => b.id) }),
}))
vi.mock('../lib/supabase', () => ({ supabase: {
  rpc: (...args: unknown[]) => state.rpc(...args),
  from: (table: string) => {
    const query: Record<string, unknown> = {}
    let columns = '', offset = 0, limit = 1000, writing = false, lookup = false
    for (const name of ['order', 'eq', 'in', 'is', 'gte', 'lte', 'neq']) query[name] = () => query
    query.select = (value: string) => { columns = value; return query }
    query.range = (start: number, end: number) => { offset = start; limit = end - start + 1; return query }
    query.limit = () => { lookup = true; return query }
    for (const name of ['insert', 'update', 'upsert', 'delete']) query[name] = () => { writing = true; return query }
    query.then = async (resolve: (value: unknown) => void) => {
      if (writing) return resolve({ data: [{ id: 1 }], error: null })
      state.reads.push({ table, columns })
      if (table === 'buildings' && state.buildingResponse) {
        const response = state.buildingResponse; state.buildingResponse = null
        return resolve(await response)
      }
      if (table === 'buildings') return resolve({ data: structuredClone(state.rows.slice(offset, offset + limit)), error: null })
      if (table === 'cards') return resolve({ data: [{ id: 1, name: 'card', card_assignments: [] }, { id: 2, name: 'other', card_assignments: [] }], error: state.cardError ? new Error('cards offline') : null })
      return resolve({ data: lookup ? [] : [], error: null })
    }
    return query
  },
} }))

const raw = (id = 1, cardId = 1): RawBuilding => ({
  id, card_id: cardId, name: `Building ${id}`, address: 'address', lat: 37, lng: 127,
  type: '주택', warning: false, memo: 'building private memo', units_surveyed: true,
  units: [{ id: id * 10, building_id: id, number: '101', status: '미방문', is_chinese: true,
    memo: 'saved unit memo', regular_visits: [] }],
})
const buildingReads = () => state.reads.filter(read => read.table === 'buildings')
beforeEach(() => {
  vi.stubEnv('VITE_DEMO_MODE', 'false')
  vi.stubEnv('VITE_BUILDING_DEMAND_ENABLED', 'true')
  vi.stubEnv('VITE_TERRITORY_REALTIME_ENABLED', 'true')
  localStorage.setItem('currentVisitor', 'tester')
  localStorage.setItem('auth_token', 'test')
  state.rows = [raw(), raw(2, 2)]
  state.rpc.mockResolvedValue({ data: true, error: null })
  state.summaries.mockImplementation(async (ids: number[]) => ids.map(id => ({ id, buildings: 1, units: 1, completed: 0, progress: 0, regularVisits: 0 })))
  state.changed.mockImplementation(async (ids: number[]) => ({ buildings: state.rows.filter(b => ids.includes(b.id)).map(toBuilding), histories: [] }))
})
afterEach(() => {
  cleanup(); vi.unstubAllEnvs(); vi.clearAllMocks(); localStorage.clear()
  state.reads = []; state.buildingResponse = null; state.cardError = false
})

test.each(['admin', 'leader'] as const)('%s home uses complete card summaries without a building payload or recovery baseline', async role => {
  const { result } = renderHook(() => useStore(true, role, undefined, undefined, 'tester', undefined, 'home'))
  await waitFor(() => expect(result.current.loading).toBe(false))
  expect(result.current.error).toBeNull()
  expect(result.current.buildings).toEqual([])
  expect(buildingReads()).toHaveLength(0)
  expect(result.current.cards.map(card => card.units)).toEqual([1, 1])
  expect(result.current.territoryRealtime.checkpoint.baseline).toBeNull()
  await act(async () => { await result.current.refetchSlices(['buildings', 'cards', 'visits'], { triggeredBy: 'foreground' }) })
  expect(buildingReads()).toHaveLength(0)
  expect(result.current.territoryRealtime.checkpoint.baseline).toBeNull()
})

test('home -> map -> unit detail -> home -> map preserves pins and memo cache without extra payload reads', async () => {
  const { result, rerender } = renderHook(({ mode }: { mode: BuildingDemand }) =>
    useStore(true, 'admin', undefined, undefined, 'tester', undefined, mode), { initialProps: { mode: 'home' as BuildingDemand } })
  await waitFor(() => expect(result.current.loading).toBe(false))
  rerender({ mode: 'map' })
  await waitFor(() => expect(result.current.buildingScopeReady).toBe(true))
  expect(buildingReads()).toEqual([{ table: 'buildings', columns: MAP_BUILDING_COLUMNS }])
  expect(result.current.buildings[0].units[0].status).toBe('미방문')
  expect(result.current.buildings[0].units[0].memo).toBeUndefined()
  expect(result.current.buildingDetailReader?.ready(1)).toBe(false)
  await act(async () => { await result.current.buildingDetailReader!.ensure(1) })
  expect(state.changed).toHaveBeenCalledExactlyOnceWith([1])
  expect(result.current.buildings[0].units[0].memo).toBe('saved unit memo')
  await act(async () => { await result.current.buildingDetailReader!.ensure(1) })
  rerender({ mode: 'home' }); rerender({ mode: 'map' })
  expect(result.current.buildingScopeReady).toBe(true)
  expect(buildingReads()).toHaveLength(1)
  expect(state.changed).toHaveBeenCalledTimes(1)
})

test('full consumers promote once and preserve complete memos on later home/map visits', async () => {
  const { result, rerender } = renderHook(({ mode }: { mode: BuildingDemand }) =>
    useStore(true, 'leader', undefined, undefined, 'tester', undefined, mode), { initialProps: { mode: 'home' as BuildingDemand } })
  await waitFor(() => expect(result.current.loading).toBe(false))
  rerender({ mode: 'full' })
  await waitFor(() => expect(result.current.buildingScopeReady).toBe(true))
  expect(result.current.buildings[0].units[0].memo).toBe('saved unit memo')
  expect(result.current.buildingDetailReader!.ready(2)).toBe(true)
  rerender({ mode: 'home' }); rerender({ mode: 'full' })
  expect(buildingReads()).toHaveLength(1)
})

test('failed demand blocks the new screen and explicit retry opens it', async () => {
  const { result, rerender } = renderHook(({ mode }: { mode: BuildingDemand }) =>
    useStore(true, 'admin', undefined, undefined, 'tester', undefined, mode), { initialProps: { mode: 'home' as BuildingDemand } })
  await waitFor(() => expect(result.current.loading).toBe(false))
  state.buildingResponse = Promise.resolve({ data: [], error: new Error('offline') })
  rerender({ mode: 'map' })
  await waitFor(() => expect(result.current.buildingReadError).toBe(true))
  expect(result.current.buildingScopeReady).toBe(false)
  await act(async () => { await result.current.retryBuildingRead() })
  expect(result.current.buildingScopeReady).toBe(true)
})

test('a failed card read cannot mark a new full building screen ready', async () => {
  const { result, rerender } = renderHook(({ mode }: { mode: BuildingDemand }) =>
    useStore(true, 'admin', undefined, undefined, 'tester', undefined, mode), { initialProps: { mode: 'home' as BuildingDemand } })
  await waitFor(() => expect(result.current.loading).toBe(false))
  state.cardError = true
  rerender({ mode: 'full' })
  await waitFor(() => expect(result.current.buildingReadError).toBe(true))
  expect(result.current.buildingScopeReady).toBe(false)
})

test('map reads every page before becoming ready', async () => {
  state.rows = Array.from({ length: 1001 }, (_, index) => raw(index + 1))
  const { result } = renderHook(() => useStore(true, 'admin', undefined, undefined, 'tester', undefined, 'map'))
  await waitFor(() => expect(result.current.loading).toBe(false))
  expect(result.current.buildings).toHaveLength(1001)
  expect(buildingReads()).toHaveLength(2)
})

test('save and cancel after a thin map use authoritative targeted refresh and preserve other buildings', async () => {
  const { result } = renderHook(() => useStore(true, 'admin', undefined, undefined, 'tester', undefined, 'map'))
  await waitFor(() => expect(result.current.loading).toBe(false))
  const visit = { id: 10, unitId: 10, visitor: 'tester', result: '만남' as const, timeSlot: '오전' as const, visitedAt: '2026-11-13' }
  const saved = raw(); saved.units[0].status = '만남'
  state.changed.mockResolvedValueOnce({ buildings: [toBuilding(saved)], histories: [visit] })
  await act(async () => { await result.current.updateUnitStatus(1, 10, '만남') })
  expect(result.current.cards[0].progress).toBe(100)
  expect(result.current.visitHistories).toEqual([visit])
  state.changed.mockResolvedValueOnce({ buildings: [toBuilding(raw())], histories: [] })
  await act(async () => { await result.current.undoLatestVisit(1, 10) })
  expect(result.current.visitHistories).toEqual([])
  expect(result.current.buildings[0].units[0].status).toBe('미방문')
  expect(result.current.buildings[1].id).toBe(2)
  expect(result.current.cards[0].progress).toBe(0)
  expect(buildingReads()).toHaveLength(1)
})

test('a slow old detail cannot resurrect a cancelled record or deleted unit', async () => {
  const { result } = renderHook(() => useStore(true, 'admin', undefined, undefined, 'tester', undefined, 'map'))
  await waitFor(() => expect(result.current.loading).toBe(false))
  let finish!: (value: unknown) => void
  state.changed.mockReturnValueOnce(new Promise(resolve => { finish = resolve }))
  let old!: Promise<unknown>
  act(() => { old = result.current.buildingDetailReader!.ensure(1).catch(error => error) })
  await act(async () => { await result.current.syncChangedBuildings([1]) })
  await act(async () => { finish({ buildings: [toBuilding({ ...raw(), units: [{ ...raw().units[0], status: '만남', memo: 'old' }] })], histories: [] }); await old })
  expect(result.current.buildings[0].units[0].status).toBe('미방문')
  expect(result.current.buildings[0].units[0].memo).toBe('saved unit memo')
})

test('building move recomputes both cards after a map summary', async () => {
  const { result } = renderHook(() => useStore(true, 'admin', undefined, undefined, 'tester', undefined, 'map'))
  await waitFor(() => expect(result.current.loading).toBe(false))
  state.rows[0].card_id = 2
  await act(async () => { await result.current.syncChangedBuildings([1]) })
  expect(result.current.cards.map(card => card.buildings)).toEqual([0, 2])
})

test('a new account/store cannot reuse another account memo details', async () => {
  const first = renderHook(() => useStore(true, 'admin', undefined, undefined, 'tester', undefined, 'map'))
  await waitFor(() => expect(first.result.current.loading).toBe(false))
  await act(async () => { await first.result.current.buildingDetailReader!.ensure(1) })
  first.unmount()
  const second = renderHook(() => useStore(true, 'admin', undefined, undefined, 'other', undefined, 'map'))
  await waitFor(() => expect(second.result.current.loading).toBe(false))
  expect(second.result.current.buildingDetailReader!.ready(1)).toBe(false)
  expect(second.result.current.buildings[0].units[0].memo).toBeUndefined()
})

test('a late detail from a disposed store cannot mark its cache complete', async () => {
  const { result, unmount } = renderHook(() => useStore(true, 'admin', undefined, undefined, 'tester', undefined, 'map'))
  await waitFor(() => expect(result.current.loading).toBe(false))
  let finish!: (value: unknown) => void
  state.changed.mockReturnValueOnce(new Promise(resolve => { finish = resolve }))
  let old!: Promise<unknown>
  act(() => { old = result.current.buildingDetailReader!.ensure(1).catch(error => error) })
  unmount()
  finish({ buildings: [toBuilding(raw())], histories: [] })
  expect(await old).toEqual(expect.objectContaining({ name: 'SupersededReadError' }))
})

test('explicit false restores eager full reads even in demo', async () => {
  vi.stubEnv('VITE_DEMO_MODE', 'true'); vi.stubEnv('VITE_BUILDING_DEMAND_ENABLED', 'false')
  const { result } = renderHook(() => useStore(true, 'admin', undefined, undefined, 'tester', undefined, 'home'))
  await waitFor(() => expect(result.current.loading).toBe(false))
  expect(result.current.buildings[0].memo).toBe('building private memo')
  expect(result.current.buildingDetailReader).toBeNull()
})

test('home deletion refreshes summaries without replacing their counts with an empty snapshot', async () => {
  const { result } = renderHook(() => useStore(true, 'admin', undefined, undefined, 'tester', undefined, 'home'))
  await waitFor(() => expect(result.current.loading).toBe(false))
  state.summaries.mockResolvedValueOnce([{ id: 1, units: 0 }, { id: 2, units: 1 }])
  await act(async () => { result.current.applyPlaceDeletionSignal({ id: 9, targetType: 'building', buildingId: 1, unitId: null, unitIds: [10], returnVisitIds: [] }) })
  expect(result.current.cards.map(card => card.units)).toEqual([0, 1])
  expect(buildingReads()).toHaveLength(0)
})

test('a deleted building loses its complete-detail cache', async () => {
  const { result } = renderHook(() => useStore(true, 'admin', undefined, undefined, 'tester', undefined, 'map'))
  await waitFor(() => expect(result.current.loading).toBe(false))
  await act(async () => { await result.current.buildingDetailReader!.ensure(1) })
  expect(result.current.buildingDetailReader!.ready(1)).toBe(true)
  act(() => result.current.applyPlaceDeletionSignal({ id: 9, targetType: 'building', buildingId: 1, unitId: null, unitIds: [10], returnVisitIds: [] }))
  expect(result.current.buildingDetailReader!.ready(1)).toBe(false)
  await expect(result.current.buildingDetailReader!.ensure(1)).rejects.toThrow('Building unavailable')
})

test.each(['user', 'developer'] as const)('%s ignores a home demand', async role => {
  const { result } = renderHook(() => useStore(true, role, undefined, undefined, 'tester', undefined, 'home'))
  await waitFor(() => expect(result.current.loading).toBe(false))
  expect(result.current.buildings[0].memo).toBe('building private memo')
  expect(result.current.buildingDetailReader).toBeNull()
})

test.each([
  ['false', undefined, false], ['true', undefined, true], ['false', 'true', true], ['true', 'false', false],
])('flag demo=%s override=%s', (demo, flag, enabled) => {
  vi.stubEnv('VITE_DEMO_MODE', demo); vi.stubEnv('VITE_BUILDING_DEMAND_ENABLED', flag)
  expect(buildingDemandForRoute('admin', '/', '', false)).toBe(enabled ? 'home' : undefined)
  expect(buildingDemandForRoute('leader', '/map', '', false)).toBe(enabled ? 'map' : undefined)
  expect(buildingDemandForRoute('admin', '/map', '', true)).toBe(enabled ? 'full' : undefined)
  expect(buildingDemandForRoute('admin', '/', '?homeEvent=1', false)).toBe(enabled ? 'full' : undefined)
  expect(buildingDemandForRoute('admin', '/stats', '', false)).toBe(enabled ? 'full' : undefined)
  expect(buildingDemandForRoute('user', '/', '', false)).toBeUndefined()
})

test('detail editor never mounts a blank memo while its read is pending, supports retry and then cache', async () => {
  const ensure = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined)
  let ready = false
  const reader = { ready: () => ready, ensure }
  const view = () => <BuildingDetailContext.Provider value={reader}><BuildingDetailGate buildingId={1}><input aria-label="memo editor" defaultValue="saved" /></BuildingDetailGate></BuildingDetailContext.Provider>
  const { rerender } = render(view())
  expect(screen.queryByRole('textbox')).toBeNull()
  await screen.findByRole('alert')
  act(() => { screen.getByRole('button').click() })
  await waitFor(() => expect(ensure).toHaveBeenCalledTimes(2))
  ready = true; rerender(view())
  expect(screen.getByRole('textbox').getAttribute('value')).toBe('saved')
})
