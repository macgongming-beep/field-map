import { act, cleanup, render, renderHook, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { buildingDemandForRoute, BuildingDetailContext, CALENDAR_BUILDING_COLUMNS, ZONE_BUILDING_COLUMNS, MAP_BUILDING_COLUMNS, toZoneBuilding, type BuildingDemand } from './buildingDemand'
import { buildSharedAssignmentTeams } from '../components/admin/sharedAssignmentTeams'
import { getBuildingStatus } from '../utils/mapUtils'
import { buildingHasUsage, scopeBuildingToUsage } from '../utils/unitUsage'
import type { CalendarEvent, EventRestaurantAssignment } from '../types'
import { BuildingDetailGate } from '../components/BuildingDetailGate'
import { toBuilding, type RawBuilding } from './storeTransforms'
import { useStore } from './useStore'

const state = vi.hoisted(() => ({
  reads: [] as { table: string; columns: string }[],
  rows: [] as RawBuilding[], changed: vi.fn(), summaries: vi.fn(), rpc: vi.fn(),
  buildingResponse: null as null | Promise<{ data: RawBuilding[]; error: unknown }>,
  cardError: false,
  historyResponse: null as null | Promise<{ data: unknown[]; error: unknown }>,
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
      if (table === 'visit_histories' && state.historyResponse) {
        const response = state.historyResponse; state.historyResponse = null
        return resolve(await response)
      }
      if (table === 'buildings' && state.buildingResponse) {
        const response = state.buildingResponse; state.buildingResponse = null
        return resolve(await response)
      }
      if (table === 'buildings') return resolve({ data: structuredClone(state.rows.slice(offset, offset + limit)), error: null })
      if (table === 'units') return resolve({ data: state.rows.flatMap(b => b.units), error: null })
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
  vi.stubEnv('VITE_CALENDAR_ZONE_BUILDING_DEMAND_ENABLED', 'true')
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
  state.reads = []; state.buildingResponse = null; state.historyResponse = null; state.cardError = false
})

test.each(['admin', 'leader'] as const)('%s calendar preserves all team restaurant names and server progress without full details', async role => {
  const { result } = renderHook(() => useStore(true, role, undefined, undefined, 'tester', undefined, 'calendar'))
  await waitFor(() => expect(result.current.loading).toBe(false))
  expect(buildingReads()).toEqual([{ table: 'buildings', columns: CALENDAR_BUILDING_COLUMNS }])
  expect(CALENDAR_BUILDING_COLUMNS).toBe('id, card_id, name, address, units(id, building_id, number)')
  expect(result.current.cards.map(card => card.units)).toEqual([1, 1])
  expect(result.current.buildings[0].memo).toBeUndefined()
  expect(result.current.buildingDetailReader!.ready(1)).toBe(false)
  expect(result.current.territoryRealtime.checkpoint.baseline).toBeNull()
  const event = { id: 9, cardAssignments: [
    { userName: 'self', teamKey: 'a', assignedCardIds: [] },
    { userName: 'other', teamKey: 'b', assignedCardIds: [] },
  ] } as unknown as CalendarEvent
  const restaurants = [
    { eventId: 9, userName: 'self', buildingId: 1, unitId: 10 },
    { eventId: 9, userName: 'other', buildingId: 2, unitId: null },
    { eventId: 8, userName: 'other', buildingId: 1, unitId: 10 },
  ] as EventRestaurantAssignment[]
  const names = () => buildSharedAssignmentTeams(event, [], [], [], result.current.buildings, restaurants)
  expect(names().map(team => team.cardNames)).toEqual([['101'], ['Building 2']])
  state.rows[1].name = 'Renamed restaurant'
  await act(async () => { await result.current.syncChangedBuildings([2]) })
  expect(names()[1].cardNames).toEqual(['Renamed restaurant'])
  expect(result.current.cards.map(card => card.units)).toEqual([1, 1])
  act(() => result.current.applyPlaceDeletionSignal({ id: 99, targetType: 'building', buildingId: 2, unitId: null, unitIds: [20], returnVisitIds: [] }))
  expect(names()[1].cardNames).toEqual([])
})

test('home calendar zone home calendar reuse the richer status snapshot without another building read', async () => {
  const { result, rerender } = renderHook(({ mode }: { mode: BuildingDemand }) =>
    useStore(true, 'leader', undefined, undefined, 'tester', undefined, mode), { initialProps: { mode: 'home' as BuildingDemand } })
  await waitFor(() => expect(result.current.loading).toBe(false))
  for (const mode of ['calendar', 'zone', 'home', 'calendar', 'zone'] as BuildingDemand[]) {
    rerender({ mode })
    await waitFor(() => expect(result.current.buildingScopeReady).toBe(true))
  }
  expect(buildingReads().map(read => read.columns)).toEqual([CALENDAR_BUILDING_COLUMNS, ZONE_BUILDING_COLUMNS])
  expect(result.current.buildings.map(b => b.name)).toEqual(['Building 1', 'Building 2'])
})

test('calendar receives a new unit name and authoritative card totals after another device adds it', async () => {
  const { result } = renderHook(() => useStore(true, 'admin', undefined, undefined, 'tester', undefined, 'calendar'))
  await waitFor(() => expect(result.current.loading).toBe(false))
  state.rows[0].units.push({ ...raw().units[0], id: 11, number: '102' })
  state.summaries.mockImplementation(async (ids: number[]) => ids.map(id => ({ id, buildings: 1, units: id === 1 ? 2 : 1, completed: 0, progress: 0, regularVisits: 0 })))
  await act(async () => { await result.current.syncCreatedUnits([11]) })
  expect(result.current.buildings[0].units.map(unit => unit.number)).toEqual(['101', '102'])
  expect(result.current.cards.find(card => card.id === 1)?.units).toBe(2)
})

test('zone list retains usage, forbidden, regular-visit and needs-visit counts but not coordinates/access histories/memos', () => {
  const samples = [raw(), raw(2), raw(3), raw(4)]
  samples[0].units[0].usage_type = '상가'; samples[0].units[0].is_restaurant = true
  samples[1].access_status = 'blocked'
  samples[2].units[0].regular_visits = [{ visitor_name: 'other', registered_at: '2026-01-01' }]
  samples[3].units[0].status = '만남'
  const shape = (b: ReturnType<typeof toBuilding>) => ({
    status: getBuildingStatus(b), house: buildingHasUsage(b, '주택'), shop: buildingHasUsage(b, '상가'),
    houseStatus: getBuildingStatus(scopeBuildingToUsage(b, '주택')),
    shopStatus: getBuildingStatus(scopeBuildingToUsage(b, '상가')),
    restaurant: b.units.filter(u => u.isRestaurant).length,
  })
  expect(samples.map(toZoneBuilding).map(shape)).toEqual(samples.map(toBuilding).map(shape))
  for (const field of ['card_id', 'type', 'warning', 'access_status', 'is_restaurant', 'units_surveyed', 'status', 'is_chinese', 'usage_type', 'regular_visits(visitor_name, registered_at)']) expect(ZONE_BUILDING_COLUMNS).toContain(field)
  for (const field of ['memo', 'lat', 'lng', 'building_access_events']) expect(ZONE_BUILDING_COLUMNS.split(/[, ()]+/)).not.toContain(field)
})

test.each(['calendar', 'zone'] as BuildingDemand[])('%s pagination reads all 1001 buildings', async mode => {
  state.rows = Array.from({ length: 1001 }, (_, i) => raw(i + 1))
  const { result } = renderHook(() => useStore(true, 'admin', undefined, undefined, 'tester', undefined, mode))
  await waitFor(() => expect(result.current.loading).toBe(false))
  expect(result.current.buildings).toHaveLength(1001)
  expect(buildingReads()).toHaveLength(2)
})

test('editor promotion waits for complete cards and buildings without unmounting its calendar; failure can retry', async () => {
  const { result } = renderHook(() => useStore(true, 'admin', undefined, undefined, 'tester', undefined, 'calendar'))
  await waitFor(() => expect(result.current.loading).toBe(false))
  state.cardError = true
  act(() => result.current.fullBuildingReader!.request())
  await waitFor(() => expect(result.current.buildingReadError).toBe(true))
  expect(result.current.buildingScopeReady).toBe(true)
  expect(result.current.fullBuildingReader!.ready).toBe(false)
  state.cardError = false
  await act(async () => { await result.current.fullBuildingReader!.retry() })
  expect(result.current.fullBuildingReader!.ready).toBe(true)
  expect(result.current.buildings[0].units[0].memo).toBe('saved unit memo')
  const count = buildingReads().length
  act(() => result.current.fullBuildingReader!.request())
  expect(buildingReads()).toHaveLength(count)
})

test('late calendar names cannot replace a map snapshot or its coordinates', async () => {
  const { result, rerender } = renderHook(({ mode }: { mode: BuildingDemand }) =>
    useStore(true, 'admin', undefined, undefined, 'tester', undefined, mode), { initialProps: { mode: 'calendar' as BuildingDemand } })
  await waitFor(() => expect(result.current.loading).toBe(false))
  let finish!: (value: { data: RawBuilding[]; error: null }) => void
  state.buildingResponse = new Promise(resolve => { finish = resolve })
  let old!: Promise<unknown>
  act(() => { old = result.current.refetchSlices(['buildings', 'cards']).catch(e => e) })
  await waitFor(() => expect(state.buildingResponse).toBeNull())
  rerender({ mode: 'map' })
  await waitFor(() => expect(result.current.buildingScopeReady).toBe(true))
  await act(async () => { finish({ data: [raw()], error: null }); await old })
  expect(result.current.buildings).toHaveLength(2)
  expect(result.current.buildings[0].lat).toBe(37)
})

test('full history response cannot resurrect a targeted cancel even with separate history-demand disabled', async () => {
  vi.stubEnv('VITE_PRIVILEGED_HISTORY_DEMAND_ENABLED', 'false')
  const { result } = renderHook(() => useStore(true, 'admin', undefined, undefined, 'tester', undefined, 'zone'))
  await waitFor(() => expect(result.current.loading).toBe(false))
  state.changed.mockResolvedValueOnce({ buildings: [toBuilding(raw())], histories: [{ id: 99, unitId: 10, visitor: 'tester', result: '만남', visitedAt: '2026-11-13' }] })
  await act(async () => { await result.current.syncChangedBuildings([1]) })
  let finish!: (value: { data: unknown[]; error: null }) => void
  state.historyResponse = new Promise(resolve => { finish = resolve })
  let old!: Promise<unknown>
  act(() => { old = result.current.refetchSlices(['visitHistories']).catch(e => e) })
  await waitFor(() => expect(state.historyResponse).toBeNull())
  await act(async () => { await result.current.undoLatestVisit(1, 10) })
  await act(async () => { finish({ data: [{ id: 99, unit_id: 10, result: '만남', visited_at: '2026-11-13', created_at: '2026-11-13T00:00:00Z' }], error: null }); await old })
  expect(result.current.visitHistories).toEqual([])
  expect(state.rpc).toHaveBeenCalledWith('invalidate_visit_history_tx', expect.objectContaining({ p_history_id: 99 }))
})

test.each(['calendar', 'zone'] as BuildingDemand[])('store itself restores full %s reads when the new flag is explicitly false', async mode => {
  vi.stubEnv('VITE_DEMO_MODE', 'true'); vi.stubEnv('VITE_CALENDAR_ZONE_BUILDING_DEMAND_ENABLED', 'false')
  const { result } = renderHook(() => useStore(true, 'admin', undefined, undefined, 'tester', undefined, mode))
  await waitFor(() => expect(result.current.loading).toBe(false))
  expect(result.current.buildings[0].units[0].memo).toBe('saved unit memo')
  expect(result.current.fullBuildingReader?.ready).toBe(true)
})

test.each([['false', undefined, false], ['true', undefined, true], ['false', 'true', true], ['true', 'false', false]] as const)(
  'calendar/zone opt-in demo=%s flag=%s', (demo, flag, enabled) => {
    vi.stubEnv('VITE_DEMO_MODE', demo); vi.stubEnv('VITE_CALENDAR_ZONE_BUILDING_DEMAND_ENABLED', flag)
    for (const role of ['admin', 'leader'] as const) {
      for (const desktop of [false, true]) expect(buildingDemandForRoute(role, '/calendar', '?openEvent=9', desktop)).toBe(enabled ? 'calendar' : 'full')
      expect(buildingDemandForRoute(role, '/zone', '?level=cards&region=R&dong=D&scope=mine', false)).toBe(enabled ? 'zone' : 'full')
      expect(buildingDemandForRoute(role, '/zone', '?tab=informal', false)).toBe(enabled ? 'zone' : 'full')
      for (const search of ['?tab=restaurant', '?view=map', '?unknown=1']) expect(buildingDemandForRoute(role, '/zone', search, false)).toBe('full')
      expect(buildingDemandForRoute(role, '/zone', '', true)).toBe('full')
    }
    for (const role of ['user', 'developer'] as const) expect(buildingDemandForRoute(role, '/calendar', '', false)).toBeUndefined()
    vi.stubEnv('VITE_BUILDING_DEMAND_ENABLED', 'false')
    expect(buildingDemandForRoute('admin', '/calendar', '', false)).toBeUndefined()
  },
)

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
