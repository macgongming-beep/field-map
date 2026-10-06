import { StrictMode } from 'react'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { useStore } from './useStore'
import type { RawBuilding } from './storeTransforms'

const state = vi.hoisted(() => ({
  failedTable: '',
  buildings: [] as unknown[], reads: [] as string[], allowed: [1], changed: vi.fn(), summaries: vi.fn(), refresh: vi.fn(), unchanged: vi.fn(), recover: vi.fn(), boundaries: vi.fn(),
}))
vi.mock('../lib/recipientStore', () => ({ createRecipientStoreReader: () => ({
  resume: vi.fn(), dispose: vi.fn(), refresh: state.refresh,
  unchangedScope: state.unchanged,
  validateCards: (ids: number[]) => { if (state.allowed.some((id) => !ids.includes(id))) throw new Error('A requested card is unavailable') },
  read: async () => ({ buildings: state.buildings, boundaries: state.allowed.map((card_id) => ({ card_id, points: [{ lat: 1, lng: 1 }, { lat: 2, lng: 1 }, { lat: 2, lng: 2 }] })) }),
  get scoped() { return true }, allowsCard: (id: number) => state.allowed.includes(id),
}) }))
vi.mock('../lib/cardSummaries', () => ({ fetchCardSummaries: state.summaries }))
vi.mock('./recipientRecovery', () => ({ recoverRecipientBuildings: state.recover, readRecipientBoundaries: state.boundaries }))
vi.mock('./territorySync', () => ({ fetchChangedBuildings: state.changed, fetchTerritoryClock: async () => '2026-10-05T00:00:00Z' }))
vi.mock('../lib/supabase', () => ({ supabase: {
  rpc: () => Promise.resolve({ error: null }),
  from: (table: string) => {
    let lookup = false
    const q: Record<string, unknown> = {}
    for (const name of ['select', 'order', 'range', 'eq', 'in', 'is', 'gte', 'lte', 'neq', 'update', 'insert']) q[name] = () => q
    q.limit = () => { lookup = true; return q }
    q.then = async (resolve: (value: unknown) => void) => {
      state.reads.push(table)
      const data = table === 'cards' ? lookup ? [{ id: 1 }] : [1, 2].map((id) => ({ id, name: `card${id}`, card_assignments: [], type: '전체', area: '', region: '', status: '미배정' }))
        : table === 'visit_histories' ? [{ id: 900, unit_id: 900, visitor_name: 'other', result: '부재', visited_at: '2026-10-05', created_at: '2026-10-05T00:00:00Z' }] : []
      return resolve({ data, error: table === state.failedTable ? new Error('offline') : null })
    }
    return q
  },
} }))

const building: RawBuilding = { id: 10, card_id: 1, name: 'assigned', address: 'test', type: '주택', lat: 1, lng: 1, warning: false, memo: null,
  units: [{ id: 100, building_id: 10, number: '101', status: '미방문', is_chinese: true, memo: null, regular_visits: [] }] }
beforeEach(() => {
  state.failedTable = ''
  state.changed.mockReset()
  state.unchanged.mockResolvedValue(null); state.recover.mockReset(); state.boundaries.mockResolvedValue([])
  state.buildings = [building]; state.allowed = [1]; state.reads = []
  state.summaries.mockResolvedValue([{ id: 1, units: 1, completed: 0, progress: 0 }, { id: 2, units: 50, completed: 25, progress: 50 }])
})
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.restoreAllMocks(); vi.unstubAllEnvs(); localStorage.clear() })

test('shares only a freshly completed calendar with recipient scope resolution', async () => {
  vi.stubEnv('VITE_TERRITORY_REALTIME_ENABLED', 'true')
  const { result } = renderHook(() => useStore(true, 'user', 'Volunteer'))
  await waitFor(() => expect(result.current.loading).toBe(false))
  expect(state.refresh).toHaveBeenLastCalledWith([])
  for (const table of ['calendar_events', 'event_card_assignments', 'event_card_assignment_cards']) {
    expect(state.reads.filter((name) => name === table)).toHaveLength(1)
  }
  state.unchanged.mockResolvedValue([1])
  await act(async () => { await result.current.refetchSlices(['calendar'], { triggeredBy: 'foreground' }) })
  expect(state.unchanged).toHaveBeenLastCalledWith([])
  await act(async () => { await result.current.refetchSlices(['buildings']) })
  expect(state.refresh).toHaveBeenLastCalledWith(undefined)
})

test.each(['event_card_assignments', 'event_card_assignment_cards'])('failed %s does not publish empty scope or discard existing buildings', async (table) => {
  const { result } = renderHook(() => useStore(true, 'user', 'Volunteer'))
  await waitFor(() => expect(result.current.loading).toBe(false))
  state.refresh.mockClear()
  state.failedTable = table
  await act(async () => { await expect(result.current.refetchSlices(['calendar'])).rejects.toThrow('assignments load failed') })
  expect(state.refresh).not.toHaveBeenCalled()
  expect(result.current.buildings.map((b) => b.id)).toEqual([10])
})

test('unchanged scoped recovery skips detail prefetch, keeps global histories, and falls back on failure', async () => {
  vi.stubEnv('VITE_TERRITORY_REALTIME_ENABLED', 'true')
  const { result } = renderHook(() => useStore(true, 'user', 'Volunteer'))
  await waitFor(() => expect(result.current.loading).toBe(false))
  state.unchanged.mockResolvedValue([1])
  state.refresh.mockClear(); state.reads = []
  await act(async () => { await result.current.refetchSlices(['buildings', 'cards', 'cardBoundaries', 'visits'], { triggeredBy: 'foreground' }) })
  expect(state.recover).toHaveBeenCalledTimes(1)
  expect(state.refresh).not.toHaveBeenCalled()
  expect(state.reads).toContain('visit_histories')
  expect(state.reads).toContain('service_sessions')
  expect(result.current.buildings.map((b) => b.id)).toEqual([10])
  state.recover.mockRejectedValueOnce(new Error('offline'))
  await act(async () => { await result.current.refetchSlices(['buildings', 'cards'], { triggeredBy: 'foreground' }) })
  expect(state.refresh).toHaveBeenCalledTimes(1)
  expect(state.reads).not.toContain('buildings')
  state.unchanged.mockResolvedValue(null); state.allowed = []; state.buildings = []
  await act(async () => { await result.current.refetchSlices(['calendar'], { triggeredBy: 'realtime:calendar' }) })
  expect(result.current.buildings).toEqual([])
  expect(result.current.cardBoundaries).toEqual([])
})

test('foreground refresh replaces scoped data and retains global statistics without reading all buildings', async () => {
  const { result } = renderHook(() => useStore(true, 'user', 'Volunteer'))
  await waitFor(() => expect(result.current.loading).toBe(false))
  state.allowed = [2]
  state.buildings = [{ ...building, id: 20, card_id: 2 }]
  state.reads = []
  state.refresh.mockClear()
  vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 125_000)
  await act(async () => { window.dispatchEvent(new Event('focus')) })
  await waitFor(() => expect(result.current.buildings.map((b) => b.id)).toEqual([20]))
  expect(result.current.cardBoundaries.map((b) => b.cardId)).toEqual([2])
  expect(state.refresh).toHaveBeenCalledTimes(1)
  expect(state.reads).not.toContain('buildings')
  expect(state.reads).not.toContain('card_boundaries')
  expect(state.reads).toContain('visit_histories')
  expect(state.reads).toContain('service_sessions')
  await act(async () => { window.dispatchEvent(new Event('focus')) })
  expect(state.refresh).toHaveBeenCalledTimes(1)
})

test('scoped visit save and undo refresh only that building and preserve unrelated history', async () => {
  localStorage.setItem('currentVisitor', 'Volunteer')
  localStorage.setItem('auth_token', 'test-token')
  const { result } = renderHook(() => useStore(true, 'user', 'Volunteer'))
  await waitFor(() => expect(result.current.loading).toBe(false))
  const before = result.current.buildings[0]
  const history = { id: 901, unitId: 100, visitor: 'Volunteer', result: '부재', timeSlot: '오전', visitedAt: '2026-10-06', createdAt: '2026-10-06T00:00:00Z' }
  state.changed.mockResolvedValueOnce({ buildings: [{ ...before, units: before.units.map((u) => ({ ...u, status: '부재' })) }], histories: [history] })
  state.reads = []; state.refresh.mockClear(); state.changed.mockClear()
  await act(async () => { await result.current.updateUnitStatus(10, 100, '부재') })
  expect(state.changed).toHaveBeenCalledExactlyOnceWith([10])
  expect(result.current.buildings[0].units[0].status).toBe('부재')
  expect(result.current.visitHistories.map((h) => h.id)).toEqual(expect.arrayContaining([900, 901]))
  expect(state.reads).not.toContain('service_sessions')
  expect(state.refresh).not.toHaveBeenCalled()
  state.changed.mockClear()
  state.changed.mockResolvedValueOnce({ buildings: [before], histories: [] })
  await act(async () => { await result.current.undoLatestVisit(10, 100) })
  expect(state.changed).toHaveBeenCalledExactlyOnceWith([10])
  expect(result.current.buildings[0].units[0].status).toBe('미방문')
  expect(result.current.visitHistories.map((h) => h.id)).toEqual([900])
})

test('missing assigned cards still fail instead of silently disappearing without subset summaries', async () => {
  state.allowed = [99]
  const { result } = renderHook(() => useStore(true, 'user', 'Volunteer'))
  await waitFor(() => expect(result.current.loading).toBe(false))
  expect(result.current.error).toBeTruthy()
  expect(state.summaries).not.toHaveBeenCalled()
})

test('real store uses scoped buildings and boundaries, keeps global statistics, and does not zero unloaded cards', async () => {
  const { result } = renderHook(() => useStore(true, 'user', 'Volunteer'), { wrapper: StrictMode })
  await waitFor(() => expect(result.current.loading).toBe(false))
  expect(result.current.error).toBeNull()
  expect(result.current.buildings.map((b) => b.id)).toEqual([10])
  expect(result.current.cardBoundaries.map((b) => b.cardId)).toEqual([1])
  expect(state.reads).not.toContain('buildings')
  expect(state.reads).not.toContain('card_boundaries')
  expect(state.reads).toContain('visit_histories')
  expect(state.reads).toContain('service_sessions')
  expect(result.current.cards.find((card) => card.id === 2)?.units).toBe(50)
  expect(result.current.territoryRealtime.checkpoint.baseline).toBe('2026-10-05T00:00:00Z')
})

test('calendar refresh revokes the final card and removes its buildings and boundaries', async () => {
  const { result } = renderHook(() => useStore(true, 'user', 'Volunteer'))
  await waitFor(() => expect(result.current.loading).toBe(false))
  state.allowed = []; state.buildings = []
  await act(async () => { await result.current.refetchSlices(['calendar'], { triggeredBy: 'realtime:calendar' }) })
  expect(result.current.buildings).toEqual([])
  expect(result.current.cardBoundaries).toEqual([])
  expect(state.refresh).toHaveBeenCalled()
})

test('building creation refresh keeps the new point inside its assigned card', async () => {
  const { result } = renderHook(() => useStore(true, 'user', 'Volunteer'))
  await waitFor(() => expect(result.current.loading).toBe(false))
  state.buildings = [building, { ...building, id: 11, units: [] }]
  await act(async () => { await result.current.refetchSlices(['buildings', 'cards'], { triggeredBy: 'mutation:buildings' }) })
  expect(result.current.buildings.map((b) => b.id)).toEqual([10, 11])
  expect(state.reads).not.toContain('buildings')
})

test('a moved-out building disappears without dropping its globally retained history', async () => {
  const { result } = renderHook(() => useStore(true, 'user', 'Volunteer'))
  await waitFor(() => expect(result.current.loading).toBe(false))
  const moved = { ...result.current.buildings[0], cardId: 2 }
  const history = { id: 1, unitId: 100, visitor: 'me', result: '부재', timeSlot: '오전', visitedAt: '2026-10-05', createdAt: '2026-10-05T00:00:00Z' }
  state.changed.mockResolvedValue({ buildings: [moved], histories: [history] })
  await act(async () => { await result.current.syncChangedBuildings([10]) })
  expect(result.current.buildings).toEqual([])
  expect(result.current.visitHistories.map((h) => h.id)).toEqual(expect.arrayContaining([1, 900]))
  expect(result.current.cards.find((card) => card.id === 2)?.units).toBe(50)
})
