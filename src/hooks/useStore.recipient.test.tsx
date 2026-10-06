import { StrictMode } from 'react'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { useStore } from './useStore'
import type { RawBuilding } from './storeTransforms'

const state = vi.hoisted(() => ({
  buildings: [] as unknown[], reads: [] as string[], allowed: [1], changed: vi.fn(), summaries: vi.fn(), refresh: vi.fn(),
}))
vi.mock('../lib/recipientStore', () => ({ createRecipientStoreReader: () => ({
  resume: vi.fn(), dispose: vi.fn(), refresh: state.refresh,
  validateCards: (ids: number[]) => { if (state.allowed.some((id) => !ids.includes(id))) throw new Error('A requested card is unavailable') },
  read: async () => ({ buildings: state.buildings, boundaries: state.allowed.map((card_id) => ({ card_id, points: [{ lat: 1, lng: 1 }, { lat: 2, lng: 1 }, { lat: 2, lng: 2 }] })) }),
  get scoped() { return true }, allowsCard: (id: number) => state.allowed.includes(id),
}) }))
vi.mock('../lib/cardSummaries', () => ({ fetchCardSummaries: state.summaries }))
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
      return resolve({ data, error: null })
    }
    return q
  },
} }))

const building: RawBuilding = { id: 10, card_id: 1, name: 'assigned', address: 'test', type: '주택', lat: 1, lng: 1, warning: false, memo: null,
  units: [{ id: 100, building_id: 10, number: '101', status: '미방문', is_chinese: true, memo: null, regular_visits: [] }] }
beforeEach(() => {
  state.buildings = [building]; state.allowed = [1]; state.reads = []
  state.summaries.mockResolvedValue([{ id: 1, units: 1, completed: 0, progress: 0 }, { id: 2, units: 50, completed: 25, progress: 50 }])
})
afterEach(() => { cleanup(); vi.clearAllMocks() })

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
