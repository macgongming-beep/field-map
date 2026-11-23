import { StrictMode, useEffect } from 'react'
import { act, cleanup, render, renderHook, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { useStore } from './useStore'
import type { RawBuilding } from './storeTransforms'
import { recipientStoreEnabled } from '../lib/recipientStore'
import { calendarReadScope, calendarWindowEnabled } from './calendarReadScope'
import { makeServiceSessionMutations } from './storeMutations/serviceSessions'
import { useSettingsCalendarScope } from './useSettingsCalendarScope'

const state = vi.hoisted(() => ({
  recipientDetails: null as Promise<void> | null,
  creationAction: '' as '' | 'created' | 'existing',
  returnRows: [] as Record<string, unknown>[], returnLogs: [] as Record<string, unknown>[],
  failedTable: '', proof: vi.fn(), clock: vi.fn(),
  requests: [] as Record<string, unknown>[],
  requestFilters: [] as unknown[][],
  unitParent: 20, insertError: false, unitLookupError: false,
  historyColumns: [] as string[],
  historyRows: [] as Record<string, unknown>[], historyFilters: [] as unknown[][],
  historyResponse: null as null | Promise<{ data: Record<string, unknown>[]; error: null }>,
  cardColumns: [] as string[],
  cardFilters: [] as unknown[][],
  ignoreCardFilter: false,
  missingLeaderTable: false,
  calendarFilters: [] as [string, unknown][][],
  calendarResponses: [] as Promise<{ data: Record<string, unknown>[]; error: null }>[],
  sessions: [] as Record<string, unknown>[], sessionFilters: [] as unknown[][],
  sessionCutoffs: [] as (string | undefined)[],
  failedSessionPage: -1,
  returnHold: null as Promise<void> | null,
  buildings: [] as unknown[], reads: [] as string[], allowed: [1], changed: vi.fn(), summaries: vi.fn(), cardHold: null as Promise<void> | null, refresh: vi.fn(), unchanged: vi.fn(), recover: vi.fn(), boundaries: vi.fn(),
}))
vi.mock('../lib/recipientStore', async importOriginal => ({ ...await importOriginal<typeof import('../lib/recipientStore')>(), createRecipientStoreReader: () => ({
  resume: vi.fn(), dispose: vi.fn(), refresh: state.refresh,
  unchangedScope: state.unchanged,
  validateCards: (ids: number[]) => { if (state.allowed.some((id) => !ids.includes(id))) throw new Error('A requested card is unavailable') },
  read: async () => { await state.recipientDetails; return { buildings: state.buildings, boundaries: state.allowed.map((card_id) => ({ card_id, points: [{ lat: 1, lng: 1 }, { lat: 2, lng: 1 }, { lat: 2, lng: 2 }] })) } },
  get scoped() { return true }, allowsCard: (id: number) => state.allowed.includes(id),
  cardIds: () => [...state.allowed],
}) }))
vi.mock('../lib/cardSummaries', () => ({ fetchCardSummaries: state.summaries }))
vi.mock('./recipientRecovery', () => ({ recoverRecipientBuildings: state.recover, readRecipientBoundaries: state.boundaries }))
vi.mock('./territorySync', () => ({ fetchChangedBuildings: state.changed, fetchBuildingSignalProof: state.proof, fetchTerritoryClock: state.clock }))
vi.mock('../lib/supabase', () => ({ supabase: {
  rpc: (name: string) => Promise.resolve({ data: name === 'create_building_tx' && state.creationAction
    ? { ok: true, action: state.creationAction, building_id: 11 } : { ok: true }, error: null }),
  from: (table: string) => {
    let lookup = false
    let writing = false
    let selected = ''
    let sessionCutoff: string | undefined
    let range: [number, number] = [0, 999]
    const filters: [string, unknown][] = []
    const q: Record<string, unknown> = {}
    for (const name of ['select', 'order', 'range', 'eq', 'in', 'is', 'gte', 'gt', 'lte', 'neq', 'update', 'insert']) q[name] = () => q
    q.select = (columns: string) => {
      selected = columns
      if (table === 'visit_histories') state.historyColumns.push(columns)
      if (table === 'cards') state.cardColumns.push(columns)
      return q
    }
    q.insert = () => { writing = true; return q }
    q.update = () => { writing = true; return q }
    q.single = () => {
      state.reads.push(table)
      if (table === 'calendar_events') state.calendarFilters.push([...filters])
      return Promise.resolve({ data: table === 'service_sessions' ? { id: 777 } : { id: filters.find(([key]) => key === 'id')?.[1], building_id: state.unitParent }, error: state.unitLookupError ? new Error('offline') : null })
    }
    q.eq = (key: string, value: unknown) => { filters.push([key, value]); return q }
    q.gte = (key: string, value: string) => {
      if (table === 'service_sessions' && key === 'service_date') sessionCutoff = value
      return q
    }
    q.in = (key: string, value: unknown) => { filters.push([key, value]); return q }
    q.range = (from: number, to: number) => { range = [from, to]; return q }
    q.limit = () => { lookup = true; return q }
    q.then = async (resolve: (value: unknown) => void) => {
      if (table === 'cards' && state.missingLeaderTable && selected.includes('card_leader_assignments')) {
        return resolve({ data: null, error: { message: 'card_leader_assignments missing' } })
      }
      state.reads.push(writing ? `${table}:insert` : table)
      if (table === 'service_sessions') {
        state.sessionFilters.push(filters)
        state.sessionCutoffs.push(sessionCutoff)
      }
      if (table === 'restaurant_requests' && !writing) state.requestFilters.push(filters)
      if (table === 'calendar_events' && !writing) state.calendarFilters.push([...filters])
      if (table === 'calendar_events' && !writing && state.calendarResponses.length) {
        const response = await state.calendarResponses.shift()!
        // Like PostgREST: an embedded relation is always present, as an array.
        const embeds = selected.includes('event_card_assignments(') ? ['event_card_assignments', 'event_card_assignment_cards'] : []
        return resolve(embeds.length && Array.isArray(response.data)
          ? { ...response, data: response.data.map(row => Object.fromEntries([...embeds.map(key => [key, []]), ...Object.entries(row)])) } : response)
      }
      if (table === 'return_visits' && !writing && state.returnHold) await state.returnHold
      if (table === 'cards' && !lookup) state.cardFilters.push(filters)
      if (table === 'cards' && !lookup && state.cardHold) await state.cardHold
      if (table === 'visit_histories' && !writing) {
        state.historyFilters.push([...filters])
        if (state.historyResponse) { const pending = state.historyResponse; state.historyResponse = null; return resolve(await pending) }
      }
      const data = table === 'cards' ? lookup ? [{ id: 1 }] : [1, 2].filter(id => state.ignoreCardFilter || filters.every(([key, value]) => key !== 'id' || !Array.isArray(value) || value.includes(id))).map((id) => ({ id, name: `card${id}`, card_assignments: [], type: '전체', area: '', region: '', status: '미배정' }))
        : table === 'visit_histories' ? state.historyRows.filter(row => filters.every(([key, value]) => !Array.isArray(value) || value.includes(row[key]))).slice(range[0], range[1] + 1)
        : table === 'return_visits' ? writing ? [{ id: 7 }] : state.returnRows
        : table === 'return_visit_logs' ? state.returnLogs
        : writing && table === 'buildings' ? [{ id: filters.find(([key]) => key === 'id')?.[1] }]
        : writing && (table === 'units' || table === 'informal_groups') ? [{ id: 100 }]
        : table === 'restaurant_requests' ? writing ? [{ id: 61 }] : state.requests.filter(row => filters.every(([key, value]) => row[key] === value))
        : table === 'service_sessions' ? state.sessions.filter((row) => filters.every(([key, value]) => row[key] === value)
          && (!sessionCutoff || (typeof row.service_date === 'string' && row.service_date >= sessionCutoff))).slice(range[0], range[1] + 1) : []
      return resolve({ data, error: (!writing && (table === state.failedTable || (table === 'service_sessions' && range[0] === state.failedSessionPage))) || (writing && state.insertError) ? new Error('offline') : null })
    }
    return q
  },
} }))

const building: RawBuilding = { id: 10, card_id: 1, name: 'assigned', address: 'test', type: '주택', lat: 1, lng: 1, warning: false, memo: null,
  units: [{ id: 100, building_id: 10, number: '101', status: '미방문', is_chinese: true, memo: null, regular_visits: [] }] }
beforeEach(() => {
  state.recipientDetails = null
  state.clock.mockReset().mockResolvedValue('2026-10-05T00:00:00Z')
  vi.stubEnv('VITE_RECIPIENT_DISCOVERY_REUSE_ENABLED', 'false')
  // Unrelated store fixtures use full cards; scoped-card tests opt in explicitly.
  vi.stubEnv('VITE_RECIPIENT_CARD_SCOPE_ENABLED', 'false')
  vi.stubEnv('VITE_SCOPED_VISIT_HISTORY_ENABLED', 'false')
  vi.stubEnv('VITE_SCOPED_HISTORY_RECOVERY_ENABLED', 'false')
  vi.stubEnv('VITE_VISIT_REALTIME_QUEUE_ENABLED', 'false')
  vi.stubEnv('VITE_VISIT_SIGNAL_DEDUP_ENABLED', 'false')
  state.proof.mockReset()
  state.historyRows = [{ id: 900, unit_id: 900, visitor_name: 'other', result: '부재', visited_at: '2026-10-05', created_at: '2026-10-05T00:00:00Z', visit_type: 'restaurant' }]
  state.historyFilters = []; state.historyResponse = null
  state.creationAction = ''
  state.cardColumns = []
  state.cardFilters = []; state.ignoreCardFilter = false
  state.missingLeaderTable = false
  state.returnRows = []; state.returnLogs = []; state.returnHold = null
  state.failedTable = ''
  state.requests = []
  state.requestFilters = []
  state.unitParent = 20; state.insertError = false; state.unitLookupError = false; state.historyColumns = []
  state.sessions = []; state.sessionFilters = []
  state.sessionCutoffs = []
  state.failedSessionPage = -1
  state.calendarFilters = []
  state.calendarResponses = []
  state.changed.mockReset()
  state.unchanged.mockResolvedValue(null); state.recover.mockReset(); state.boundaries.mockResolvedValue([])
  state.buildings = [building]; state.allowed = [1]; state.reads = []
  state.summaries.mockResolvedValue([{ id: 1, units: 1, completed: 0, progress: 0 }, { id: 2, units: 50, completed: 25, progress: 50 }])
})
afterEach(() => { cleanup(); vi.useRealTimers(); vi.clearAllMocks(); vi.restoreAllMocks(); vi.unstubAllEnvs(); localStorage.clear() })

const metadataEvent = { id: 7, event_date: '2026-11-18', time: '14:30', title: 'Before',
  assignment_revision: 1, event_participants: [{ user_name: 'Volunteer', role: '신청' }] }
const calendarResponse = (rows: Record<string, unknown>[]) => Promise.resolve({ data: rows, error: null })

test.each(['true', 'false', undefined])('metadata-only update refreshes calendar and retains territory only with opt-in %s', async flag => {
  enableScopedHistories()
  vi.stubEnv('VITE_CALENDAR_METADATA_REFRESH_ENABLED', flag)
  state.calendarResponses.push(calendarResponse([metadataEvent]))
  const { result } = renderHook(() => useStore(true, 'user', 'Volunteer'))
  await waitFor(() => expect(result.current.loading).toBe(false))
  const before = result.current.buildings
  state.reads = []; state.refresh.mockClear()
  state.calendarResponses.push(calendarResponse([{ ...metadataEvent, title: 'After', edit_version: 2 }]))
  await act(async () => { await result.current.refetchSlices(['calendar'], { triggeredBy: 'realtime:calendar', updatedEventIds: [7] }) })
  expect(result.current.calendarEvents[0].title).toBe('After')
  expect(result.current.buildings).toEqual(before)
  if (flag === 'true') {
    expect(result.current.buildings).toBe(before)
    expect(state.refresh).not.toHaveBeenCalled()
    expect(state.unchanged).not.toHaveBeenCalled()
    expect(state.reads).toEqual(['calendar_events', 'event_card_assignments', 'event_card_assignment_cards'])
  } else {
    expect(state.refresh).toHaveBeenCalledOnce()
    expect(state.reads).toContain('visit_histories')
  }
})

test.each([
  { label: 'assignment revision', rows: [{ ...metadataEvent, assignment_revision: 2 }], ids: [7], trigger: 'realtime:calendar' },
  { label: 'leader permissions', rows: [{ ...metadataEvent, leader_name: 'Other' }], ids: [7], trigger: 'realtime:calendar' },
  { label: 'group permissions', rows: [{ ...metadataEvent, target_groups: ['singal'] }], ids: [7], trigger: 'realtime:calendar' },
  { label: 'removed/moved event', rows: [], ids: [7], trigger: 'realtime:calendar' },
  { label: 'unknown event', rows: [metadataEvent], ids: [999], trigger: 'realtime:calendar' },
  { label: 'mixed assignment signal', rows: [metadataEvent], ids: undefined, trigger: 'realtime:calendar' },
  { label: 'manual refresh', rows: [metadataEvent], ids: [7], trigger: 'fetchAll' },
  { label: 'foreground', rows: [metadataEvent], ids: [7], trigger: 'foreground' },
])('calendar optimization preserves fresh scope and revoked card removal: $label', async ({ rows, ids, trigger }) => {
  enableScopedHistories()
  vi.stubEnv('VITE_CALENDAR_METADATA_REFRESH_ENABLED', 'true')
  state.calendarResponses.push(calendarResponse([metadataEvent]))
  const { result } = renderHook(() => useStore(true, 'user', 'Volunteer'))
  await waitFor(() => expect(result.current.loading).toBe(false))
  state.reads = []; state.refresh.mockClear()
  state.allowed = [2]; state.buildings = [{ ...building, id: 20, card_id: 2, units: [] }]
  state.calendarResponses.push(calendarResponse(rows))
  await act(async () => { await result.current.refetchSlices(['calendar'], { triggeredBy: trigger, updatedEventIds: ids }) })
  expect(state.refresh).toHaveBeenCalledOnce()
  expect(result.current.buildings.map(b => b.id)).toEqual([20])
  expect(result.current.visitHistories).toEqual([])
})

test('failed scope recovery must be repaired before a later metadata update can reuse it', async () => {
  vi.stubEnv('VITE_CALENDAR_METADATA_REFRESH_ENABLED', 'true')
  state.calendarResponses.push(calendarResponse([metadataEvent]))
  const { result } = renderHook(() => useStore(true, 'user', 'Volunteer'))
  await waitFor(() => expect(result.current.loading).toBe(false))
  const revised = { ...metadataEvent, assignment_revision: 2 }
  state.calendarResponses.push(calendarResponse([revised]))
  state.refresh.mockImplementationOnce(() => { throw new Error('scope unavailable') })
  await act(async () => { await expect(result.current.refetchSlices(['calendar'], { triggeredBy: 'realtime:calendar' })).rejects.toThrow('scope unavailable') })
  state.refresh.mockClear()
  state.calendarResponses.push(calendarResponse([{ ...revised, title: 'After' }]))
  await act(async () => { await result.current.refetchSlices(['calendar'], { triggeredBy: 'realtime:calendar', updatedEventIds: [7] }) })
  expect(state.refresh).toHaveBeenCalledOnce()
  expect(result.current.calendarEvents[0].title).toBe('After')
})

function enableScopedHistories() {
  vi.stubEnv('VITE_DEMO_MODE', 'true')
  vi.stubEnv('VITE_SCOPED_VISIT_HISTORY_ENABLED', 'true')
  state.historyRows.push({ ...state.historyRows[0], id: 901, unit_id: 100, visitor_name: 'Another visitor' })
}

test.each(['true', 'false', undefined])('initial discovery waits for its baseline and only shares it with explicit opt-in (%s)', async flag => {
  vi.stubEnv('VITE_DEMO_MODE', 'false')
  vi.stubEnv('VITE_CALENDAR_WINDOW_ENABLED', 'true')
  vi.stubEnv('VITE_RECIPIENT_INITIAL_PARALLEL_ENABLED', 'true')
  vi.stubEnv('VITE_RECIPIENT_DISCOVERY_REUSE_ENABLED', flag)
  let release!: (baseline: string) => void
  state.clock.mockImplementationOnce(() => new Promise(resolve => { release = resolve }))
  const { result } = renderHook(() => useStore(true, 'user', 'Volunteer', 'window:2026-10-01:2026-10-31'))
  await waitFor(() => expect(state.clock).toHaveBeenCalledOnce())
  expect(state.refresh).not.toHaveBeenCalled()
  expect(state.reads).toEqual([])
  await act(async () => { release('2026-10-05T00:00:00Z') })
  await waitFor(() => expect(result.current.loading).toBe(false))
  expect(result.current.error).toBeNull()
  expect(state.refresh.mock.calls).toEqual(flag === 'true' ? [[undefined, '2026-10-05T00:00:00Z']] : [[undefined]])
  state.refresh.mockClear()
  await act(async () => { await result.current.refetchSlices(['resources'], { triggeredBy: 'mutation:assignments' }) })
  expect(state.refresh).toHaveBeenCalledExactlyOnceWith(undefined)
})

test.each(['reject', 'null'])('initial discovery shares a failed clock as null (%s) without blocking loading', async failure => {
  vi.stubEnv('VITE_DEMO_MODE', 'false')
  vi.stubEnv('VITE_CALENDAR_WINDOW_ENABLED', 'true')
  vi.stubEnv('VITE_RECIPIENT_INITIAL_PARALLEL_ENABLED', 'true')
  vi.stubEnv('VITE_RECIPIENT_DISCOVERY_REUSE_ENABLED', 'true')
  if (failure === 'reject') state.clock.mockRejectedValueOnce(new Error('Clock unavailable'))
  else state.clock.mockResolvedValueOnce(null)
  const { result } = renderHook(() => useStore(true, 'user', 'Volunteer', 'window:2026-10-01:2026-10-31'))
  await waitFor(() => expect(result.current.loading).toBe(false))
  expect(state.refresh).toHaveBeenCalledExactlyOnceWith(undefined, null)
  expect(result.current.error).toBeNull()
  expect(result.current.buildings.map(row => row.id)).toEqual([10])
})

test('parallel initial home starts independent reads but gates cards and histories on fresh buildings', async () => {
  enableScopedHistories()
  vi.stubEnv('VITE_CALENDAR_WINDOW_ENABLED', 'true')
  vi.stubEnv('VITE_RECIPIENT_INITIAL_PARALLEL_ENABLED', 'true')
  let releaseBuildings!: () => void
  let releaseCalendar!: (value: { data: Record<string, unknown>[]; error: null }) => void
  state.recipientDetails = new Promise(resolve => { releaseBuildings = resolve })
  state.calendarResponses.push(new Promise(resolve => { releaseCalendar = resolve }))
  const { result } = renderHook(() => useStore(true, 'user', 'Volunteer', 'window:2026-10-01:2026-10-31'))
  await waitFor(() => expect(state.reads).toContain('app_settings'))
  expect(state.refresh).toHaveBeenCalledExactlyOnceWith(undefined)
  expect(state.reads).toContain('calendar_events')
  expect(state.reads).toContain('return_visits')
  expect(state.reads).not.toContain('cards')
  expect(state.reads).not.toContain('visit_histories')
  expect(result.current.loading).toBe(true)
  await act(async () => { releaseBuildings() })
  await waitFor(() => expect(state.reads).toContain('visit_histories'))
  expect(result.current.buildings.map(b => b.id)).toEqual([10])
  expect(result.current.visitHistories.map(h => h.id)).toEqual([901])
  expect(result.current.loading).toBe(true)
  await act(async () => { releaseCalendar({ data: [], error: null }) })
  await waitFor(() => expect(result.current.loading).toBe(false))
  expect(result.current.error).toBeNull()
  for (const table of ['visit_histories', 'service_sessions', 'app_settings', 'calendar_events']) {
    expect(state.reads.filter(name => name === table)).toHaveLength(1)
  }
  expect(state.cardFilters).toHaveLength(1)
  expect(state.summaries).toHaveBeenCalledTimes(1)
})

test('manual full refresh after initial success waits for calendar before recipient discovery', async () => {
  enableScopedHistories()
  vi.stubEnv('VITE_CALENDAR_WINDOW_ENABLED', 'true')
  vi.stubEnv('VITE_RECIPIENT_INITIAL_PARALLEL_ENABLED', 'true')
  vi.stubEnv('VITE_RECIPIENT_DISCOVERY_REUSE_ENABLED', 'true')
  const { result } = renderHook(() => useStore(true, 'user', 'Volunteer', 'window:2026-10-01:2026-10-31'))
  await waitFor(() => expect(result.current.loading).toBe(false))
  expect(result.current.error).toBeNull()
  expect(state.refresh).toHaveBeenCalledExactlyOnceWith(undefined, '2026-10-05T00:00:00Z')
  const previousBuildings = result.current.buildings
  state.refresh.mockClear()
  state.reads = []
  let release!: (value: { data: Record<string, unknown>[]; error: null }) => void
  state.calendarResponses.push(new Promise(resolve => { release = resolve }))
  state.buildings = [{ ...building, id: 20, units: [{ ...building.units[0], id: 200, building_id: 20 }] }]
  state.historyRows.push({ ...state.historyRows[0], id: 902, unit_id: 200 })
  let refresh!: Promise<void>
  act(() => { refresh = result.current.refetchAll() })
  try {
    await waitFor(() => expect(state.reads).toContain('calendar_events'))
    expect(state.refresh).not.toHaveBeenCalled()
    expect(state.reads).not.toContain('app_settings')
    expect(state.reads).not.toContain('cards')
    expect(state.reads).not.toContain('visit_histories')
    expect(result.current.buildings).toBe(previousBuildings)
  } finally {
    await act(async () => { release({ data: [], error: null }); await refresh })
  }
  expect(state.refresh).toHaveBeenCalledExactlyOnceWith(undefined)
  expect(result.current.buildings.map(b => b.id)).toEqual([20])
  expect(result.current.visitHistories.map(h => h.id)).toEqual([902])
  expect(result.current.error).toBeNull()
})

test.each(['false', undefined])('initial parallel requires explicit opt-in (%s)', async flag => {
  vi.stubEnv('VITE_DEMO_MODE', 'true')
  vi.stubEnv('VITE_RECIPIENT_INITIAL_PARALLEL_ENABLED', flag)
  let release!: (value: { data: Record<string, unknown>[]; error: null }) => void
  state.calendarResponses.push(new Promise(resolve => { release = resolve }))
  const { result } = renderHook(() => useStore(true, 'user', 'Volunteer', 'window:2026-10-01:2026-10-31'))
  await waitFor(() => expect(state.reads).toContain('calendar_events'))
  expect(state.refresh).not.toHaveBeenCalled()
  expect(state.reads).not.toContain('app_settings')
  await act(async () => { release({ data: [], error: null }) })
  await waitFor(() => expect(result.current.loading).toBe(false))
})

test('parallel initial failure drains pending reads before reporting error and retrying', async () => {
  vi.stubEnv('VITE_CALENDAR_WINDOW_ENABLED', 'true')
  vi.stubEnv('VITE_RECIPIENT_INITIAL_PARALLEL_ENABLED', 'true')
  state.failedTable = 'calendar_events'
  let release!: () => void
  state.recipientDetails = new Promise(resolve => { release = resolve })
  const { result } = renderHook(() => useStore(true, 'user', 'Volunteer', 'window:2026-10-01:2026-10-31'))
  await waitFor(() => expect(result.current.calendarReadError).toBe(true))
  expect(result.current.loading).toBe(true)
  expect(result.current.error).toBeNull()
  await act(async () => { release() })
  await waitFor(() => expect(result.current.loading).toBe(false))
  expect(result.current.error).not.toBeNull()
  state.failedTable = ''
  state.reads = []
  state.cardFilters = []
  await act(async () => { await result.current.refetchAll() })
  expect(result.current.error).toBeNull()
  expect(result.current.buildings.map(b => b.id)).toEqual([10])
  expect(state.cardFilters).toHaveLength(1)
})

test('parallel initial building failure does not publish cards or read histories', async () => {
  enableScopedHistories()
  vi.stubEnv('VITE_CALENDAR_WINDOW_ENABLED', 'true')
  vi.stubEnv('VITE_RECIPIENT_INITIAL_PARALLEL_ENABLED', 'true')
  let reject!: (error: Error) => void
  state.recipientDetails = new Promise((_, fail) => { reject = fail })
  const { result } = renderHook(() => useStore(true, 'user', 'Volunteer', 'window:2026-10-01:2026-10-31'))
  await waitFor(() => expect(state.reads).toContain('app_settings'))
  await act(async () => { reject(new Error('scope unavailable')) })
  await waitFor(() => expect(result.current.loading).toBe(false))
  expect(result.current.error).not.toBeNull()
  expect(result.current.cards).toEqual([])
  expect(state.reads).not.toContain('visit_histories')
  expect(state.summaries).not.toHaveBeenCalled()
})

test.each(['full', 'service:["Volunteer","2026-10-05",null]'])('parallel initial does not change complete-calendar reuse for %s', async scope => {
  vi.stubEnv('VITE_CALENDAR_WINDOW_ENABLED', 'true')
  vi.stubEnv('VITE_SERVICE_CALENDAR_REUSE_ENABLED', 'true')
  vi.stubEnv('VITE_RECIPIENT_INITIAL_PARALLEL_ENABLED', 'true')
  vi.stubEnv('VITE_RECIPIENT_DISCOVERY_REUSE_ENABLED', 'true')
  let release!: (value: { data: Record<string, unknown>[]; error: null }) => void
  state.calendarResponses.push(new Promise(resolve => { release = resolve }))
  const { result } = renderHook(() => useStore(true, 'user', 'Volunteer', scope))
  await waitFor(() => expect(state.reads).toContain('calendar_events'))
  expect(state.refresh).not.toHaveBeenCalled()
  expect(state.reads).not.toContain('app_settings')
  await act(async () => { release({ data: [], error: null }) })
  await waitFor(() => expect(result.current.loading).toBe(false))
  expect(state.refresh).toHaveBeenCalledExactlyOnceWith([])
})

function enableHistoryRecovery() {
  enableScopedHistories()
  vi.stubEnv('VITE_SCOPED_HISTORY_RECOVERY_ENABLED', 'true')
  vi.stubEnv('VITE_TERRITORY_REALTIME_ENABLED', 'true')
  state.unchanged.mockResolvedValue([1])
}

test('service entry reads boundaries alongside recovery but publishes only after both finish', async () => {
  enableHistoryRecovery()
  const { result } = renderHook(() => useStore(true, 'user', 'Volunteer', 'service:["Volunteer","2026-10-05",null]'))
  await waitFor(() => expect(result.current.loading).toBe(false))
  state.refresh.mockClear(); state.reads = []
  let release!: () => void
  state.recover.mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve }))
  const boundaries = [{ cardId: 1, points: [{ lat: 3, lng: 3 }, { lat: 4, lng: 3 }, { lat: 4, lng: 4 }] }]
  state.boundaries.mockResolvedValueOnce(boundaries)
  let pending!: Promise<void>
  await act(async () => { pending = result.current.refetchSlices(['calendar'], { triggeredBy: 'navigation:calendar' }) })
  await waitFor(() => expect(state.recover).toHaveBeenCalledTimes(1))
  expect(state.boundaries).toHaveBeenCalledExactlyOnceWith([1])
  expect(result.current.cardBoundaries).not.toEqual(boundaries)
  expect(state.reads).not.toContain('cards')
  await act(async () => { release(); await pending })
  expect(result.current.cardBoundaries).toEqual(boundaries)
  expect(state.reads).toContain('cards')
  expect(state.refresh).not.toHaveBeenCalled()
})

test.each(['boundaries', 'recovery'] as const)('service entry drains the other read after %s fails, then restores a scoped snapshot', async failed => {
  enableHistoryRecovery()
  const { result } = renderHook(() => useStore(true, 'user', 'Volunteer', 'service:["Volunteer","2026-10-05",null]'))
  await waitFor(() => expect(result.current.loading).toBe(false))
  state.refresh.mockClear()
  let release!: () => void
  if (failed === 'boundaries') {
    state.boundaries.mockRejectedValueOnce(new Error('offline'))
    state.recover.mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve }))
  } else {
    state.recover.mockRejectedValueOnce(new Error('offline'))
    state.boundaries.mockImplementationOnce(() => new Promise<never[]>(resolve => { release = () => resolve([]) }))
  }
  const settled = vi.fn()
  let pending!: Promise<void>
  await act(async () => { pending = result.current.refetchSlices(['calendar'], { triggeredBy: 'navigation:calendar' }).then(settled) })
  await waitFor(() => expect(state.boundaries).toHaveBeenCalledTimes(1))
  expect(state.refresh).not.toHaveBeenCalled(); expect(settled).not.toHaveBeenCalled()
  await act(async () => { release(); await pending })
  expect(state.refresh).toHaveBeenCalledTimes(1)
  expect(settled).toHaveBeenCalledTimes(1)
  expect(result.current.buildings.map(row => row.id)).toEqual([10])
  expect(result.current.visitHistories.map(row => row.id)).toEqual([901])
})

test('demo calendar navigation rechecks assignments and recovers changes without a full scoped reload', async () => {
  enableHistoryRecovery()
  const { result } = renderHook(() => useStore(true, 'user', 'Volunteer'))
  await waitFor(() => expect(result.current.loading).toBe(false))
  state.refresh.mockClear(); state.historyFilters = []
  // A cancellation by another user must be applied before the history read is skipped.
  state.changed.mockResolvedValue({ buildings: result.current.buildings, histories: [] })
  state.recover.mockImplementationOnce(async (_ids, _known, _checkpoint, sync) => { await sync([10]) })
  await act(async () => { await result.current.refetchSlices(['calendar'], { triggeredBy: 'navigation:calendar' }) })
  expect(state.unchanged).toHaveBeenCalledTimes(1)
  expect(state.recover).toHaveBeenCalledTimes(1)
  expect(state.changed).toHaveBeenCalledWith([10])
  expect(state.refresh).not.toHaveBeenCalled()
  expect(state.historyFilters).toEqual([])
  expect(result.current.visitHistories).toEqual([])
})

test('navigation shares only IDs from the just-completed window, not a complete personal scope', async () => {
  enableHistoryRecovery()
  vi.stubEnv('VITE_CALENDAR_WINDOW_ENABLED', 'true')
  vi.stubEnv('VITE_RECIPIENT_DISCOVERY_REUSE_ENABLED', 'true')
  const { result } = renderHook(() => useStore(true, 'user', 'Volunteer', 'window:2026-10-01:2026-10-31'))
  await waitFor(() => expect(result.current.loading).toBe(false))
  state.unchanged.mockClear()
  state.calendarResponses.push(Promise.resolve({ data: [{ id: 17, event_date: '2026-10-12', time: '10:00', title: 'Window event' }], error: null }))
  await act(async () => { await result.current.refetchSlices(['calendar'], { triggeredBy: 'navigation:calendar' }) })
  expect(result.current.calendarEvents.map(event => event.id)).toEqual([17])
  expect(state.unchanged).toHaveBeenCalledExactlyOnceWith(undefined, [17])
  state.unchanged.mockClear()
  await act(async () => { await result.current.refetchSlices(['buildings'], { triggeredBy: 'foreground' }) })
  expect(state.unchanged).toHaveBeenCalledExactlyOnceWith(undefined)
})

test.each(['reassigned', 'revoked', 'scope failure', 'delta failure'] as const)('demo navigation falls back safely on %s', async reason => {
  enableHistoryRecovery()
  const { result } = renderHook(() => useStore(true, 'user', 'Volunteer'))
  await waitFor(() => expect(result.current.loading).toBe(false))
  state.refresh.mockClear(); state.historyFilters = []
  if (reason === 'scope failure') state.unchanged.mockRejectedValueOnce(new Error('scope offline'))
  else if (reason === 'delta failure') state.recover.mockRejectedValueOnce(new Error('delta offline'))
  else state.unchanged.mockResolvedValueOnce(null)
  if (reason === 'reassigned') {
    state.buildings = [{ ...building, id: 20, card_id: 2, units: [{ ...building.units[0], id: 200, building_id: 20 }] }]
    state.allowed = [2]
    state.historyRows.push({ ...state.historyRows[1], id: 902, unit_id: 200 })
  } else if (reason === 'revoked') { state.buildings = []; state.allowed = [] }
  await act(async () => { await result.current.refetchSlices(['calendar'], { triggeredBy: 'navigation:calendar' }) })
  expect(state.refresh).toHaveBeenCalledTimes(1)
  expect(result.current.buildings.map(b => b.id)).toEqual(reason === 'reassigned' ? [20] : reason === 'revoked' ? [] : [10])
  expect(result.current.visitHistories.map(h => h.id)).toEqual(reason === 'reassigned' ? [902] : reason === 'revoked' ? [] : [901])
  if (reason !== 'revoked') expect(state.historyFilters).toHaveLength(1)
})

test.each(['fetchAll', 'mutation:calendar', 'mutation:application'])('demo navigation optimization does not narrow %s', async triggeredBy => {
  enableHistoryRecovery()
  const { result } = renderHook(() => useStore(true, 'user', 'Volunteer'))
  await waitFor(() => expect(result.current.loading).toBe(false))
  state.refresh.mockClear(); state.historyFilters = []
  await act(async () => { await result.current.refetchSlices(['calendar', 'visits'], { triggeredBy }) })
  expect(state.unchanged).not.toHaveBeenCalled()
  expect(state.refresh).toHaveBeenCalledTimes(1)
  expect(state.historyFilters).toHaveLength(1)
  expect(state.reads).toContain('service_sessions')
})

test.each([
  { demo: undefined, flag: undefined, recovery: 'true', realtime: 'true', enabled: false },
  { demo: 'false', flag: undefined, recovery: 'true', realtime: 'true', enabled: false },
  { demo: 'false', flag: 'true', recovery: 'true', realtime: 'true', enabled: true },
  { demo: undefined, flag: 'true', recovery: 'true', realtime: 'true', enabled: true },
  { demo: 'true', flag: undefined, recovery: 'true', realtime: 'true', enabled: true },
  { demo: 'true', flag: 'false', recovery: 'true', realtime: 'true', enabled: false },
  { demo: 'false', flag: 'false', recovery: 'true', realtime: 'true', enabled: false },
  { demo: 'false', flag: 'true', recovery: 'false', realtime: 'true', enabled: false },
  { demo: 'true', flag: 'true', recovery: 'false', realtime: 'true', enabled: false },
  { demo: 'false', flag: 'true', recovery: 'true', realtime: 'false', enabled: false },
])('navigation recovery opt-in $demo/$flag history=$recovery realtime=$realtime', async ({ demo, flag, recovery, realtime, enabled }) => {
  enableHistoryRecovery()
  vi.stubEnv('VITE_DEMO_MODE', demo)
  vi.stubEnv('VITE_CALENDAR_NAVIGATION_RECOVERY_ENABLED', flag)
  vi.stubEnv('VITE_SCOPED_HISTORY_RECOVERY_ENABLED', recovery)
  vi.stubEnv('VITE_TERRITORY_REALTIME_ENABLED', realtime)
  vi.stubEnv('VITE_LEGACY_NOTICES_SKIP_ENABLED', String(!enabled))
  const { result } = renderHook(() => useStore(true, 'user', 'Volunteer'))
  await waitFor(() => expect(result.current.loading).toBe(false))
  state.refresh.mockClear(); state.historyFilters = []
  await act(async () => { await result.current.refetchSlices(['calendar'], { triggeredBy: 'navigation:calendar' }) })
  expect(state.unchanged).toHaveBeenCalledTimes(enabled ? 1 : 0)
  expect(state.recover).toHaveBeenCalledTimes(enabled ? 1 : 0)
  expect(state.refresh).toHaveBeenCalledTimes(enabled ? 0 : 1)
  expect(state.historyFilters).toHaveLength(enabled ? 0 : 1)
})

test('demo navigation still performs the thirty minute history safety read', async () => {
  enableHistoryRecovery()
  const start = Date.now()
  const clock = vi.spyOn(Date, 'now').mockReturnValue(start)
  const { result } = renderHook(() => useStore(true, 'user', 'Volunteer'))
  await waitFor(() => expect(result.current.loading).toBe(false))
  clock.mockReturnValue(start + 30 * 60_000); state.historyFilters = []
  await act(async () => { await result.current.refetchSlices(['calendar'], { triggeredBy: 'navigation:calendar' }) })
  expect(state.historyFilters).toHaveLength(1)
})

test.each([
  [undefined, undefined, false], ['false', undefined, false], ['false', 'true', true],
  [undefined, 'true', true], ['true', undefined, true], ['true', 'false', false], ['false', 'false', false],
] as const)('legacy notices opt-in demo=%s flag=%s skipped=%s', async (demo, flag, skipped) => {
  vi.stubEnv('VITE_DEMO_MODE', demo)
  vi.stubEnv('VITE_LEGACY_NOTICES_SKIP_ENABLED', flag)
  vi.stubEnv('VITE_CALENDAR_NAVIGATION_RECOVERY_ENABLED', String(!skipped))
  const { result } = renderHook(() => useStore(true, 'admin'))
  await waitFor(() => expect(result.current.loading).toBe(false))
  expect(state.reads.includes('notices')).toBe(!skipped)
  state.reads = []
  await act(async () => { await result.current.refetchSlices(['communication'], { triggeredBy: 'foreground' }) })
  expect(state.reads.includes('notices')).toBe(!skipped)
})

test.each(['save', 'cancel'] as const)('demo queued %s waits for older realtime then reads fresh data without fallback', async operation => {
  enableHistoryRecovery()
  vi.stubEnv('VITE_VISIT_REALTIME_QUEUE_ENABLED', 'true')
  localStorage.setItem('currentVisitor', 'Volunteer')
  localStorage.setItem('auth_token', 'test-token')
  const { result } = renderHook(() => useStore(true, 'user', 'Volunteer'))
  await waitFor(() => expect(result.current.loading).toBe(false))
  const before = result.current.buildings[0]
  const history = { id: 902, unitId: 100, visitor: 'Volunteer', result: '부재', timeSlot: '오후', visitedAt: '2026-10-30', createdAt: new Date().toISOString() }
  let release!: () => void
  state.changed.mockImplementationOnce(() => new Promise(done => { release = () => done({ buildings: [before], histories: [history] }) }))
  let releaseFresh!: () => void
  state.changed.mockImplementationOnce(() => new Promise(done => { releaseFresh = () => done({ buildings: [before], histories: operation === 'save' ? [history] : [] }) }))
  let old!: Promise<void>, mutation!: Promise<void>
  act(() => { old = result.current.territoryRealtime.sync([10]) })
  await waitFor(() => expect(state.changed).toHaveBeenCalledTimes(1))
  state.reads = []; state.historyFilters = []
  act(() => { mutation = operation === 'save' ? result.current.updateUnitStatus(10, 100, '부재') : result.current.deleteVisitHistory(901, 100) })
  // Let the mutation finish its writes and enqueue; the older read is still blocked.
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)) })
  expect(state.changed).toHaveBeenCalledTimes(1)
  await act(async () => { release() })
  await waitFor(() => expect(state.changed).toHaveBeenCalledTimes(2))
  // The cancelled/pre-write response must not briefly reappear while the fresh
  // read is delayed, even though the eventual final result would be correct.
  expect(result.current.visitHistories.some(h => h.id === 902)).toBe(false)
  await act(async () => { releaseFresh(); await Promise.all([old, mutation]) })
  expect(state.changed).toHaveBeenCalledTimes(2)
  expect(result.current.visitHistories.map(h => h.id)).toEqual(operation === 'save' ? [902] : [])
  expect(state.reads).not.toContain('service_sessions')
  state.historyFilters = []
  await act(async () => { await result.current.refetchSlices(['buildings', 'visits'], { triggeredBy: 'foreground' }) })
  expect(state.historyFilters).toEqual([])
})

test.each([
  { operation: 'save', dedup: false }, { operation: 'cancel', dedup: false },
  { operation: 'save', dedup: true }, { operation: 'cancel', dedup: true },
])('foreground rereads histories while queued $operation waits between realtime batches, dedup=$dedup', async ({ operation, dedup }) => {
  enableHistoryRecovery()
  vi.stubEnv('VITE_VISIT_REALTIME_QUEUE_ENABLED', 'true')
  vi.stubEnv('VITE_VISIT_SIGNAL_DEDUP_ENABLED', String(dedup))
  state.proof.mockResolvedValue([])
  localStorage.setItem('currentVisitor', 'Volunteer')
  localStorage.setItem('auth_token', 'test-token')
  const { result } = renderHook(() => useStore(true, 'user', 'Volunteer'))
  await waitFor(() => expect(result.current.loading).toBe(false))
  const before = result.current.buildings[0]
  const history = { id: 902, unitId: 100, visitor: 'Volunteer', result: '부재', timeSlot: '오후', visitedAt: '2026-10-30', createdAt: new Date().toISOString() }
  let release!: () => void
  state.changed.mockImplementationOnce(() => new Promise(done => { release = () => done({ buildings: [before], histories: [history] }) }))
  state.changed.mockResolvedValue({ buildings: [before], histories: operation === 'save' ? [history] : [] })
  let old!: Promise<void>, mutation!: Promise<void>
  act(() => { old = result.current.territoryRealtime.sync([10]) })
  await waitFor(() => expect(state.changed).toHaveBeenCalledTimes(1))
  // Hold microtasks at the next drain: no building read is active during foreground,
  // but the post-write caller still requires a fresh read before acknowledgement.
  const drains: VoidFunction[] = []
  const schedule = vi.spyOn(globalThis, 'queueMicrotask').mockImplementation(callback => { drains.push(callback) })
  let settled = false
  act(() => {
    mutation = (operation === 'save' ? result.current.updateUnitStatus(10, 100, '부재') : result.current.deleteVisitHistory(901, 100))
      .then(() => { settled = true })
  })
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)) })
  await act(async () => { release() })
  expect(drains.length).toBeGreaterThan(0)
  expect(state.changed).toHaveBeenCalledTimes(1)
  expect(settled).toBe(false)
  expect(result.current.visitHistories.map(h => h.id)).toEqual([901])
  state.historyRows = operation === 'save'
    ? [{ id: 902, unit_id: 100, visitor_name: 'Volunteer', result: '부재', visited_at: history.visitedAt, created_at: history.createdAt }]
    : []
  state.historyFilters = []
  await act(async () => { await result.current.refetchSlices(['buildings', 'visits'], { triggeredBy: 'foreground' }) })
  const foregroundFilters = [...state.historyFilters]
  const foregroundHistories = result.current.visitHistories.map(h => h.id)
  expect(settled).toBe(false)
  schedule.mockRestore()
  await act(async () => { drains.forEach(drain => drain()); await Promise.all([old, mutation]) })
  expect(foregroundFilters).toEqual([[['unit_id', [100]]]])
  expect(foregroundHistories).toEqual(operation === 'save' ? [902] : [])
  expect(settled).toBe(true)
  expect(state.changed).toHaveBeenCalledTimes(2)
  expect(result.current.visitHistories.map(h => h.id)).toEqual(operation === 'save' ? [902] : [])
})

test.each([
  { operation: 'save', demo: 'true' }, { operation: 'cancel', demo: 'true' },
  { operation: 'save', demo: 'false' }, { operation: 'cancel', demo: 'false' },
])('dedup $operation demo=$demo waits for post-write read then skips own exact signal but keeps another user change', async ({ operation, demo }) => {
  enableHistoryRecovery()
  vi.stubEnv('VITE_DEMO_MODE', demo)
  vi.stubEnv('VITE_VISIT_REALTIME_QUEUE_ENABLED', 'true')
  vi.stubEnv('VITE_VISIT_SIGNAL_DEDUP_ENABLED', 'true')
  localStorage.setItem('currentVisitor', 'Volunteer'); localStorage.setItem('auth_token', 'test-token')
  const { result } = renderHook(() => useStore(true, 'user', 'Volunteer'))
  await waitFor(() => expect(result.current.loading).toBe(false))
  const before = result.current.buildings[0]
  const signal = { building_id: 10, card_id: 1, revision: 1, changed_at: '2026-11-09T10:00:00Z' }
  state.proof.mockResolvedValue([signal])
  const history = { id: 902, unitId: 100, visitor: 'Volunteer', result: '부재', timeSlot: '오후', visitedAt: '2026-11-09', createdAt: signal.changed_at }
  let release!: () => void
  state.changed.mockImplementationOnce(() => new Promise(done => { release = () => done({ buildings: [before], histories: operation === 'save' ? [history] : [] }) }))
  let mutation!: Promise<void>, realtime!: Promise<void>
  act(() => { mutation = operation === 'save' ? result.current.updateUnitStatus(10, 100, '부재') : result.current.deleteVisitHistory(901, 100) })
  await waitFor(() => expect(state.changed).toHaveBeenCalledTimes(1))
  expect(state.proof).toHaveBeenCalledExactlyOnceWith([10])
  expect(state.proof.mock.invocationCallOrder[0]).toBeLessThan(state.changed.mock.invocationCallOrder[0])
  let finished = false
  act(() => { realtime = result.current.territoryRealtime.syncSignals!([signal]).then(() => { finished = true }) })
  await act(async () => { await Promise.resolve() }); expect(finished).toBe(false)
  await act(async () => { release(); await Promise.all([mutation, realtime]) })
  expect(state.changed).toHaveBeenCalledTimes(1)
  expect(result.current.visitHistories.map(h => h.id)).toEqual(operation === 'save' ? [902] : [])
  state.changed.mockResolvedValue({ buildings: [before], histories: [{ ...history, id: 903, visitor: 'Other person' }] })
  await act(async () => { await result.current.territoryRealtime.syncSignals!([{ ...signal, revision: 2 }]) })
  expect(state.changed).toHaveBeenCalledTimes(2)
  expect(state.proof).toHaveBeenCalledTimes(1)
  expect(result.current.visitHistories.map(h => h.id)).toEqual([903])
})

test.each([
  { role: 'user', flag: 'true', queue: 'true', recovery: 'true', enabled: true },
  { role: 'user', flag: undefined, queue: 'true', recovery: 'true', enabled: false },
  { role: 'user', flag: 'false', queue: 'true', recovery: 'true', enabled: false },
  { role: 'user', flag: 'true', queue: 'false', recovery: 'true', enabled: false },
  { role: 'user', flag: 'true', queue: 'true', recovery: 'false', enabled: false },
  { role: 'admin', flag: 'true', queue: 'true', recovery: 'true', enabled: false },
  { role: 'leader', flag: 'true', queue: 'true', recovery: 'true', enabled: false },
  { role: 'developer', flag: 'true', queue: 'true', recovery: 'true', enabled: false },
] as const)('signal dedup opt-in $role/$flag queue=$queue recovery=$recovery', async ({ role, flag, queue, recovery, enabled }) => {
  enableHistoryRecovery()
  vi.stubEnv('VITE_VISIT_SIGNAL_DEDUP_ENABLED', flag)
  vi.stubEnv('VITE_VISIT_REALTIME_QUEUE_ENABLED', queue)
  vi.stubEnv('VITE_SCOPED_HISTORY_RECOVERY_ENABLED', recovery)
  const { result } = renderHook(() => useStore(true, role, 'Volunteer'))
  await waitFor(() => expect(result.current.loading).toBe(false))
  expect(Boolean(result.current.territoryRealtime.syncSignals)).toBe(enabled)
  expect(state.proof).not.toHaveBeenCalled()
})

test.each(['data', 'proof'])('failed queued post-save %s still falls back and repairs history', async failure => {
  enableHistoryRecovery()
  vi.stubEnv('VITE_VISIT_REALTIME_QUEUE_ENABLED', 'true')
  vi.stubEnv('VITE_VISIT_SIGNAL_DEDUP_ENABLED', String(failure === 'proof'))
  localStorage.setItem('currentVisitor', 'Volunteer')
  localStorage.setItem('auth_token', 'test-token')
  const { result } = renderHook(() => useStore(true, 'user', 'Volunteer'))
  await waitFor(() => expect(result.current.loading).toBe(false))
  if (failure === 'proof') state.proof.mockRejectedValueOnce(new Error('offline'))
  else state.changed.mockRejectedValueOnce(new Error('offline'))
  state.historyFilters = []
  await act(async () => { await result.current.updateUnitStatus(10, 100, '부재') })
  expect(state.historyFilters.some(filters => filters.some(([key]) => key === 'unit_id'))).toBe(true)
  expect(result.current.visitHistories.map(h => h.id)).toEqual([901])
})

test('realtime arriving during a post-save read waits for a fresh combined result', async () => {
  enableHistoryRecovery()
  vi.stubEnv('VITE_VISIT_REALTIME_QUEUE_ENABLED', 'true')
  localStorage.setItem('currentVisitor', 'Volunteer')
  const { result } = renderHook(() => useStore(true, 'user', 'Volunteer'))
  await waitFor(() => expect(result.current.loading).toBe(false))
  const before = result.current.buildings[0]
  let release!: () => void
  state.changed.mockImplementationOnce(() => new Promise(done => { release = () => done({ buildings: [before], histories: [] }) }))
  state.changed.mockResolvedValueOnce({ buildings: [before], histories: [] })
  let save!: Promise<void>, realtime!: Promise<void>
  act(() => { save = result.current.updateUnitStatus(10, 100, '부재') })
  await waitFor(() => expect(state.changed).toHaveBeenCalledTimes(1))
  act(() => { realtime = result.current.territoryRealtime.sync([10]) })
  expect(state.changed).toHaveBeenCalledTimes(1)
  state.reads = []
  await act(async () => { release(); await Promise.all([save, realtime]) })
  expect(state.changed).toHaveBeenCalledTimes(2)
  expect(state.reads).not.toContain('service_sessions')
  state.historyFilters = []
  await act(async () => { await result.current.refetchSlices(['buildings', 'visits'], { triggeredBy: 'foreground' }) })
  expect(state.historyFilters).toEqual([])
})

test('unmount rejects queued post-write work without starting a late full fallback', async () => {
  enableHistoryRecovery()
  vi.stubEnv('VITE_VISIT_REALTIME_QUEUE_ENABLED', 'true')
  localStorage.setItem('currentVisitor', 'Volunteer')
  const { result, unmount } = renderHook(() => useStore(true, 'user', 'Volunteer'))
  await waitFor(() => expect(result.current.loading).toBe(false))
  const before = result.current.buildings[0]
  let release!: () => void
  state.changed.mockImplementationOnce(() => new Promise(done => { release = () => done({ buildings: [before], histories: [] }) }))
  let realtime!: Promise<unknown>, save!: Promise<unknown>
  act(() => { realtime = result.current.territoryRealtime.sync([10]).catch(error => error) })
  await waitFor(() => expect(state.changed).toHaveBeenCalledTimes(1))
  act(() => { save = result.current.updateUnitStatus(10, 100, '부재').catch(error => error) })
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)) })
  state.reads = []
  unmount()
  release()
  expect(await realtime).toMatchObject({ name: 'SupersededReadError' })
  expect(await save).toMatchObject({ name: 'SupersededReadError' })
  expect(state.changed).toHaveBeenCalledTimes(1)
  expect(state.reads).toEqual([])
})

test.each([
  { demo: undefined, flag: undefined, recovery: 'true', role: 'user', serialized: false },
  { demo: 'false', flag: undefined, recovery: 'true', role: 'user', serialized: false },
  { demo: 'false', flag: 'true', recovery: 'true', role: 'user', serialized: true },
  { demo: 'false', flag: 'false', recovery: 'true', role: 'user', serialized: false },
  { demo: 'true', flag: 'false', recovery: 'true', role: 'user', serialized: false },
  { demo: 'true', flag: undefined, recovery: 'true', role: 'user', serialized: true },
  { demo: 'false', flag: 'true', recovery: 'false', role: 'user', serialized: false },
  { demo: 'false', flag: 'true', recovery: 'true', role: 'admin', serialized: false },
  { demo: 'false', flag: 'true', recovery: 'true', role: 'leader', serialized: false },
  { demo: 'false', flag: 'true', recovery: 'true', role: 'developer', serialized: false },
] as const)('visit queue opt-in $demo/$flag recovery=$recovery role=$role', async ({ demo, flag, recovery, role, serialized }) => {
  enableHistoryRecovery()
  vi.stubEnv('VITE_DEMO_MODE', demo)
  vi.stubEnv('VITE_VISIT_REALTIME_QUEUE_ENABLED', flag)
  vi.stubEnv('VITE_SCOPED_HISTORY_RECOVERY_ENABLED', recovery)
  const { result } = renderHook(() => useStore(true, role, 'Volunteer'))
  await waitFor(() => expect(result.current.loading).toBe(false))
  const before = result.current.buildings[0]
  let release!: () => void
  state.changed.mockImplementationOnce(() => new Promise(done => { release = () => done({ buildings: [before], histories: [] }) }))
  state.changed.mockResolvedValue({ buildings: [before], histories: [] })
  let first!: Promise<unknown>, second!: Promise<unknown>
  act(() => { first = result.current.territoryRealtime.sync([10]).catch(error => error) })
  await waitFor(() => expect(state.changed).toHaveBeenCalledTimes(1))
  act(() => { second = result.current.territoryRealtime.sync([10]).catch(error => error) })
  await act(async () => { await Promise.resolve() })
  const readsBeforeRelease = state.changed.mock.calls.length
  await act(async () => { release(); await Promise.all([first, second]) })
  expect(readsBeforeRelease).toBe(serialized ? 1 : 2)
})

test('complete scoped recovery skips history batches but keeps sessions and manual repair reads', async () => {
  enableHistoryRecovery()
  const { result } = renderHook(() => useStore(true, 'user', 'Volunteer'))
  await waitFor(() => expect(result.current.loading).toBe(false))
  expect(state.historyFilters).toHaveLength(1)
  state.reads = []; state.historyFilters = []
  await act(async () => { await result.current.refetchSlices(['buildings', 'visits'], { triggeredBy: 'foreground' }) })
  await act(async () => { await result.current.refetchSlices(['calendar'], { triggeredBy: 'realtime:calendar' }) })
  expect(state.recover).toHaveBeenCalledTimes(2)
  expect(state.historyFilters).toEqual([])
  expect(state.reads).toContain('service_sessions')
  expect(result.current.visitHistories.map(h => h.id)).toEqual([901])
  await act(async () => { await result.current.refetchSlices(['buildings', 'visits'], { triggeredBy: 'fetchAll' }) })
  expect(state.historyFilters).toHaveLength(1)
})

test.each([
  { demo: undefined, flag: undefined, reads: 1 },
  { demo: 'false', flag: undefined, reads: 1 },
  { demo: 'false', flag: 'true', reads: 0 },
  { demo: undefined, flag: 'true', reads: 0 },
  { demo: 'true', flag: 'false', reads: 1 },
  { demo: 'false', flag: 'false', reads: 1 },
])('history recovery opt-in controls foreground reads ($demo/$flag)', async ({ demo, flag, reads }) => {
  enableHistoryRecovery()
  vi.stubEnv('VITE_DEMO_MODE', demo)
  vi.stubEnv('VITE_SCOPED_HISTORY_RECOVERY_ENABLED', flag)
  const { result } = renderHook(() => useStore(true, 'user', 'Volunteer'))
  await waitFor(() => expect(result.current.loading).toBe(false))
  state.historyFilters = []
  await act(async () => { await result.current.refetchSlices(['buildings', 'visits'], { triggeredBy: 'foreground' }) })
  expect(state.historyFilters).toHaveLength(reads)
})

test('thirty minute history safety read is not extended by successful delta refreshes', async () => {
  enableHistoryRecovery()
  const start = Date.now()
  const clock = vi.spyOn(Date, 'now').mockReturnValue(start)
  const { result } = renderHook(() => useStore(true, 'user', 'Volunteer'))
  await waitFor(() => expect(result.current.loading).toBe(false))
  state.historyFilters = []
  clock.mockReturnValue(start + 29 * 60_000)
  await act(async () => { await result.current.refetchSlices(['buildings', 'visits'], { triggeredBy: 'foreground' }) })
  expect(state.historyFilters).toEqual([])
  clock.mockReturnValue(start + 30 * 60_000)
  await act(async () => { await result.current.refetchSlices(['buildings', 'visits'], { triggeredBy: 'foreground' }) })
  expect(state.historyFilters).toHaveLength(1)
  clock.mockReturnValue(start + 29 * 60_000)
  await act(async () => { await result.current.refetchSlices(['buildings', 'visits'], { triggeredBy: 'foreground' }) })
  expect(state.historyFilters).toHaveLength(2)
})

test('reused history prunes expired records locally without another batch', async () => {
  enableHistoryRecovery()
  const start = Date.now()
  const clock = vi.spyOn(Date, 'now').mockReturnValue(start)
  state.historyRows.push({ ...state.historyRows[1], id: 902, created_at: new Date(start - 365 * 86400_000 + 60_000).toISOString() })
  const { result } = renderHook(() => useStore(true, 'user', 'Volunteer'))
  await waitFor(() => expect(result.current.loading).toBe(false))
  expect(result.current.visitHistories.map(h => h.id)).toContain(902)
  state.historyFilters = []; clock.mockReturnValue(start + 120_000)
  await act(async () => { await result.current.refetchSlices(['calendar'], { triggeredBy: 'foreground' }) })
  expect(state.historyFilters).toEqual([])
  expect(result.current.visitHistories.map(h => h.id)).toEqual([901])
})

test('failed safety reread does not renew the complete history deadline', async () => {
  enableHistoryRecovery()
  const start = Date.now()
  const clock = vi.spyOn(Date, 'now').mockReturnValue(start)
  const { result } = renderHook(() => useStore(true, 'user', 'Volunteer'))
  await waitFor(() => expect(result.current.loading).toBe(false))
  clock.mockReturnValue(start + 30 * 60_000)
  state.failedTable = 'visit_histories'
  await act(async () => { await expect(result.current.refetchSlices(['buildings', 'visits'], { triggeredBy: 'foreground' })).rejects.toThrow() })
  state.failedTable = ''; state.historyFilters = []
  await act(async () => { await result.current.refetchSlices(['buildings', 'visits'], { triggeredBy: 'foreground' }) })
  expect(state.historyFilters).toHaveLength(1)
  expect(result.current.visitHistories.map(h => h.id)).toEqual([901])
})

test('new building snapshot followed by failed history read cannot reuse the old complete baseline', async () => {
  enableHistoryRecovery()
  const { result } = renderHook(() => useStore(true, 'user', 'Volunteer'))
  await waitFor(() => expect(result.current.loading).toBe(false))
  state.buildings = [{ ...building, units: [...building.units, { ...building.units[0], id: 101 }] }]
  state.historyRows.push({ ...state.historyRows[1], id: 902, unit_id: 101 })
  state.failedTable = 'visit_histories'
  await act(async () => { await expect(result.current.refetchSlices(['buildings', 'visits'])).rejects.toThrow() })
  state.failedTable = ''; state.historyFilters = []
  await act(async () => { await result.current.refetchSlices(['buildings', 'visits'], { triggeredBy: 'foreground' }) })
  expect(state.historyFilters).toHaveLength(1)
  expect(result.current.visitHistories.map(h => h.id).sort()).toEqual([901, 902])
})

test('failed building sync invalidates even an unchanged previously complete scope', async () => {
  enableHistoryRecovery()
  const { result } = renderHook(() => useStore(true, 'user', 'Volunteer'))
  await waitFor(() => expect(result.current.loading).toBe(false))
  state.changed.mockRejectedValueOnce(new Error('sync offline'))
  await act(async () => { await expect(result.current.syncChangedBuildings([10])).rejects.toThrow('sync offline') })
  state.historyFilters = []
  await act(async () => { await result.current.refetchSlices(['buildings', 'visits'], { triggeredBy: 'foreground' }) })
  expect(state.historyFilters).toHaveLength(1)
})

test('superseded history read preserves completeness only after an authoritative save on a complete scope', async () => {
  enableHistoryRecovery()
  const { result } = renderHook(() => useStore(true, 'user', 'Volunteer'))
  await waitFor(() => expect(result.current.loading).toBe(false))
  let release!: (value: { data: Record<string, unknown>[]; error: null }) => void
  state.historyResponse = new Promise(done => { release = done })
  let old!: Promise<unknown>
  act(() => { old = result.current.refetchSlices(['visitHistories']).catch(error => error) })
  await waitFor(() => expect(state.historyResponse).toBeNull())
  const saved = { id: 902, unitId: 100, visitor: 'Volunteer', result: '부재', timeSlot: '오전', visitedAt: '2026-10-30', createdAt: new Date().toISOString() }
  state.changed.mockResolvedValue({ buildings: result.current.buildings, histories: [saved] })
  await act(async () => { await result.current.syncChangedBuildings([10]) })
  await act(async () => { release({ data: [state.historyRows[1]], error: null }); expect(await old).toBeInstanceOf(Error) })
  state.historyFilters = []
  await act(async () => { await result.current.refetchSlices(['buildings', 'visits'], { triggeredBy: 'foreground' }) })
  expect(state.historyFilters).toEqual([])
  expect(result.current.visitHistories.map(h => h.id)).toEqual([902])
})

test('overlapping building recovery does not acknowledge a discarded response when its replacement fails', async () => {
  enableHistoryRecovery()
  const { result } = renderHook(() => useStore(true, 'user', 'Volunteer'))
  await waitFor(() => expect(result.current.loading).toBe(false))
  let release!: (value: { buildings: typeof result.current.buildings; histories: never[] }) => void
  state.changed.mockImplementationOnce(() => new Promise(done => { release = done }))
  state.recover.mockImplementationOnce(async (_ids, _known, _checkpoint, sync) => { await sync([10]) })
  state.historyFilters = []
  let recovery!: Promise<void>
  act(() => { recovery = result.current.refetchSlices(['buildings', 'visits'], { triggeredBy: 'foreground' }) })
  await waitFor(() => expect(state.changed).toHaveBeenCalledTimes(1))
  state.changed.mockRejectedValueOnce(new Error('newer sync offline'))
  await act(async () => { await expect(result.current.syncChangedBuildings([10])).rejects.toThrow('offline') })
  await act(async () => { release({ buildings: result.current.buildings, histories: [] }); await recovery })
  expect(state.historyFilters).toHaveLength(1)
  expect(result.current.visitHistories.map(h => h.id)).toEqual([901])
})

test('strict recipient sync rejects its discarded response even when called without requireFresh', async () => {
  enableHistoryRecovery()
  const { result } = renderHook(() => useStore(true, 'user', 'Volunteer'))
  await waitFor(() => expect(result.current.loading).toBe(false))
  let release!: (value: { buildings: typeof result.current.buildings; histories: never[] }) => void
  state.changed.mockImplementationOnce(() => new Promise(done => { release = done }))
  let old!: Promise<unknown>
  act(() => { old = result.current.syncChangedBuildings([10]).catch(error => error) })
  state.changed.mockRejectedValueOnce(new Error('newer sync offline'))
  await act(async () => { await expect(result.current.syncChangedBuildings([10])).rejects.toThrow('offline') })
  await act(async () => { release({ buildings: result.current.buildings, histories: [] }); expect(await old).toBeInstanceOf(Error) })
  expect(result.current.visitHistories.map(h => h.id)).toEqual([901])
})

test('a cancelled incomplete read cannot become complete from one successful building update', async () => {
  enableHistoryRecovery()
  state.failedTable = 'visit_histories'
  const { result } = renderHook(() => useStore(true, 'user', 'Volunteer'))
  await waitFor(() => expect(result.current.loading).toBe(false))
  expect(result.current.error).not.toBeNull()
  state.failedTable = ''
  let release!: (value: { data: Record<string, unknown>[]; error: null }) => void
  state.historyResponse = new Promise(done => { release = done })
  let old!: Promise<unknown>
  act(() => { old = result.current.refetchSlices(['visitHistories']).catch(error => error) })
  await waitFor(() => expect(state.historyResponse).toBeNull())
  state.changed.mockResolvedValue({ buildings: result.current.buildings, histories: [] })
  await act(async () => { await result.current.syncChangedBuildings([10]) })
  await act(async () => { release({ data: [], error: null }); expect(await old).toBeInstanceOf(Error) })
  state.historyFilters = []
  await act(async () => { await result.current.refetchSlices(['buildings', 'visits'], { triggeredBy: 'foreground' }) })
  expect(state.historyFilters).toHaveLength(1)
  expect(result.current.visitHistories.map(h => h.id)).toEqual([901])
})

test('a delta started before a full scope reload cannot restore the older building snapshot', async () => {
  enableHistoryRecovery()
  const { result } = renderHook(() => useStore(true, 'user', 'Volunteer'))
  await waitFor(() => expect(result.current.loading).toBe(false))
  const oldBuildings = result.current.buildings
  let release!: (value: { buildings: typeof oldBuildings; histories: never[] }) => void
  state.changed.mockImplementationOnce(() => new Promise(done => { release = done }))
  let old!: Promise<unknown>
  act(() => { old = result.current.syncChangedBuildings([10]).catch(error => error) })
  state.buildings = [{ ...building, name: 'New snapshot' }]
  await act(async () => { await result.current.refetchSlices(['buildings', 'visits']) })
  await act(async () => { release({ buildings: oldBuildings, histories: [] }); expect(await old).toBeInstanceOf(Error) })
  expect(result.current.buildings[0].name).toBe('New snapshot')
  expect(result.current.visitHistories.map(h => h.id)).toEqual([901])
})

test('successful changed-building recovery replaces cancelled records and new units before skipping batches', async () => {
  enableHistoryRecovery()
  const { result } = renderHook(() => useStore(true, 'user', 'Volunteer'))
  await waitFor(() => expect(result.current.loading).toBe(false))
  const next = { ...result.current.buildings[0], units: [{ ...result.current.buildings[0].units[0], id: 101 }] }
  const saved = { id: 902, unitId: 101, visitor: 'Other person', result: '부재', timeSlot: '오전', visitedAt: '2026-10-30', createdAt: new Date().toISOString() }
  state.changed.mockResolvedValue({ buildings: [next], histories: [saved] })
  state.recover.mockImplementationOnce(async (_ids, _known, _checkpoint, sync) => { await sync([10]) })
  state.historyFilters = []
  await act(async () => { await result.current.refetchSlices(['buildings', 'visits'], { triggeredBy: 'foreground' }) })
  expect(state.changed).toHaveBeenCalledWith([10])
  expect(state.historyFilters).toEqual([])
  expect(result.current.visitHistories.map(h => [h.id, h.unitId])).toEqual([[902, 101]])
  state.changed.mockResolvedValue({ buildings: [], histories: [] })
  state.recover.mockImplementationOnce(async (_ids, _known, _checkpoint, sync) => { await sync([10]) })
  await act(async () => { await result.current.refetchSlices(['buildings', 'visits'], { triggeredBy: 'foreground' }) })
  expect(result.current.buildings).toEqual([])
  expect(result.current.visitHistories).toEqual([])
  expect(state.historyFilters).toEqual([])
})

test.each(['leader', 'admin', 'developer'] as const)('history recovery never narrows %s statistics', async role => {
  enableHistoryRecovery()
  const { result } = renderHook(() => useStore(true, role))
  await waitFor(() => expect(result.current.loading).toBe(false))
  expect(state.historyFilters).toEqual([[]])
  expect(result.current.visitHistories.map(h => h.id)).toEqual([900, 901])
})

test.each([false, true])('assigned-map navigation recipient request reuse=%s without rereading buildings/cards/histories', async enabled => {
  enableScopedHistories()
  vi.stubEnv('VITE_CALENDAR_NAVIGATION_REUSE_ENABLED', String(enabled))
  const base = 'service:["Volunteer","2026-10-30",null]'
  const target = 'service:["Volunteer","2026-10-30",7]'
  // 0167: today's query carries the event body itself (no separate index read).
  state.calendarResponses.push(
    Promise.resolve({ data: [{ id: 7, event_date: '2026-10-30', time: '10:00', title: 'Shared', event_participants: [
      { user_name: 'Volunteer', role: '신청' }, { user_name: 'Other team', role: '신청' },
    ] }], error: null }),
  )
  const { result, rerender } = renderHook(({ scope }) => useStore(true, 'user', 'Volunteer', scope), { initialProps: { scope: base } })
  await waitFor(() => expect(result.current.loading).toBe(false))
  expect(result.current.calendarEvents[0].applicants).toEqual(['Volunteer', 'Other team'])
  const histories = result.current.visitHistories
  const buildings = result.current.buildings
  state.reads = []
  state.refresh.mockClear()
  rerender({ scope: target })
  await waitFor(() => expect(result.current.calendarScopeReady).toBe(true))
  if (enabled) {
    expect(state.reads).toEqual([])
    expect(state.refresh).not.toHaveBeenCalled()
    expect(result.current.calendarEvents[0].applicants).toEqual(['Volunteer', 'Other team'])
    expect(result.current.buildings).toBe(buildings)
    expect(result.current.visitHistories).toBe(histories)
  } else {
    expect(state.reads).toContain('calendar_events')
    expect(state.reads).toContain('cards')
    expect(state.reads).toContain('visit_histories')
    expect(state.refresh).toHaveBeenCalled()
  }
})

test.each(['service:["Volunteer","2026-10-30",null]', 'service:["Volunteer","2026-10-30",7]'])('fresh personal calendar %s is reused for territory scope, not reread', async scope => {
  enableScopedHistories()
  vi.stubEnv('VITE_SERVICE_CALENDAR_REUSE_ENABLED', 'true')
  // 0167: the event body comes with its query (no index read). Queries resolve in order
  // today, mine, restaurant, target; a target event is excluded from the first three.
  const shared = Promise.resolve({ data: [{ id: 7, event_date: '2026-10-30', time: '10:00', title: 'Shared' }], error: null })
  const empty = () => Promise.resolve({ data: [], error: null })
  if (scope.endsWith(',7]')) state.calendarResponses.push(empty(), empty(), empty(), shared)
  else state.calendarResponses.push(shared)
  const { result } = renderHook(() => useStore(true, 'user', 'Volunteer', scope))
  await waitFor(() => expect(result.current.loading).toBe(false))
  expect(result.current.error).toBeNull()
  expect(state.refresh).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ id: 7 })]))
  state.refresh.mockClear()
  // A later cancellation must publish a new empty scope, not retain the old event.
  await act(async () => { await result.current.refetchSlices(['calendar'], { triggeredBy: 'mutation:calendar' }) })
  expect(state.refresh).toHaveBeenCalledWith([])
  expect(result.current.calendarEvents).toEqual([])
})

test.each(['window:2026-10-01:2026-10-31', 'service:["Someone else","2026-10-30",null]'])('incomplete or foreign scope %s cannot replace recipient assignment discovery', async scope => {
  enableScopedHistories()
  vi.stubEnv('VITE_SERVICE_CALENDAR_REUSE_ENABLED', 'true')
  const { result } = renderHook(() => useStore(true, 'user', 'Volunteer', scope))
  await waitFor(() => expect(result.current.loading).toBe(false))
  expect(state.refresh).toHaveBeenCalledWith(undefined)
})

test('disabled personal read reuse retains independent recipient discovery', async () => {
  enableScopedHistories()
  vi.stubEnv('VITE_SERVICE_CALENDAR_REUSE_ENABLED', 'false')
  const { result } = renderHook(() => useStore(true, 'user', 'Volunteer', 'service:["Volunteer","2026-10-30",null]'))
  await waitFor(() => expect(result.current.loading).toBe(false))
  expect(state.refresh).toHaveBeenCalledWith(undefined)
})

test('failed fresh personal assignments never replace existing scope with partial or empty data', async () => {
  enableScopedHistories()
  vi.stubEnv('VITE_SERVICE_CALENDAR_REUSE_ENABLED', 'true')
  const { result } = renderHook(() => useStore(true, 'user', 'Volunteer', 'service:["Volunteer","2026-10-30",null]'))
  await waitFor(() => expect(result.current.loading).toBe(false))
  const buildings = result.current.buildings
  state.refresh.mockClear()
  // 0167: the personal assignment index is now part of the event queries.
  state.failedTable = 'calendar_events'
  await act(async () => {
    await expect(result.current.refetchSlices(['calendar'], { triggeredBy: 'mutation:calendar' })).rejects.toThrow()
  })
  expect(state.refresh).not.toHaveBeenCalled()
  expect(result.current.buildings).toBe(buildings)
  expect(result.current.calendarReadError).toBe(true)
})

test('queued refresh invalidation cannot be repopulated by an older recipient calendar read', async () => {
  enableScopedHistories()
  vi.stubEnv('VITE_CALENDAR_NAVIGATION_REUSE_ENABLED', 'true')
  const home = 'window:2026-10-16:2026-11-30'
  const month = 'window:2026-11-01:2026-11-30'
  const row = { id: 7, event_date: '2026-11-02', time: '10:00', title: 'Shared', event_participants: [{ user_name: 'Old', role: '신청' }] }
  state.calendarResponses.push(Promise.resolve({ data: [row], error: null }))
  const { result, rerender } = renderHook(({ scope }) => useStore(true, 'user', 'Volunteer', scope), { initialProps: { scope: home } })
  await waitFor(() => expect(result.current.loading).toBe(false))
  let release!: (value: { data: Record<string, unknown>[]; error: null }) => void
  state.calendarResponses.push(new Promise(done => { release = done }))
  let first!: Promise<void>
  act(() => { first = result.current.refetchSlices(['calendar'], { triggeredBy: 'foreground' }) })
  await waitFor(() => expect(state.calendarResponses).toHaveLength(0))
  state.calendarResponses.push(Promise.resolve({ data: [], error: new Error('offline') } as never))
  let second!: Promise<unknown>
  act(() => { second = result.current.refetchSlices(['calendar'], { triggeredBy: 'mutation:calendar' }).catch(error => error) })
  await act(async () => { release({ data: [row], error: null }); await first; expect(await second).toBeInstanceOf(Error) })
  state.calendarResponses.push(Promise.resolve({ data: [{ ...row, event_participants: [{ user_name: 'New', role: '신청' }] }], error: null }))
  state.calendarFilters = []
  rerender({ scope: month })
  await waitFor(() => expect(result.current.calendarScopeReady).toBe(true))
  expect(state.calendarFilters).toHaveLength(1)
  expect(result.current.calendarEvents[0].applicants).toEqual(['New'])
})

test('scoped history reads on initial/foreground/manual keep every visitor in loaded units only', async () => {
  enableScopedHistories()
  const { result } = renderHook(() => useStore(true, 'user', 'Volunteer'))
  await waitFor(() => expect(result.current.loading).toBe(false))
  expect(result.current.error).toBeNull()
  expect(result.current.visitHistories.map(h => h.id)).toEqual([901])
  expect(result.current.visitHistories[0].visitor).toBe('Another visitor')
  for (const triggeredBy of ['foreground', 'fetchAll']) {
    await act(async () => { await result.current.refetchSlices(['buildings', 'visits'], { triggeredBy }) })
    expect(result.current.visitHistories.map(h => h.id)).toEqual([901])
  }
  expect(state.historyFilters.every(filters => JSON.stringify(filters) === JSON.stringify([['unit_id', [100]]]))).toBe(true)
})

test('statistics route remount restores global histories; returning restores scoped snapshot', async () => {
  enableScopedHistories()
  function Session({ scoped }: { scoped: boolean }) {
    const store = useStore(true, 'user', scoped ? 'Volunteer' : undefined)
    return <output data-testid="histories">{store.loading ? 'loading' : store.visitHistories.map(h => h.id).join(',')}</output>
  }
  function Route({ path }: { path: string }) {
    const scoped = recipientStoreEnabled('user', path, '', 'true', 'true')
    return <Session key={String(scoped)} scoped={scoped} />
  }
  const { rerender } = render(<Route path="/territory" />)
  await waitFor(() => expect(screen.getByTestId('histories').textContent).toBe('901'))
  rerender(<Route path="/stats" />)
  await waitFor(() => expect(screen.getByTestId('histories').textContent).toBe('900,901'))
  expect(state.historyFilters.at(-1)).toEqual([])
  rerender(<Route path="/territory" />)
  await waitFor(() => expect(screen.getByTestId('histories').textContent).toBe('901'))
})

test.each(['leader', 'admin', 'developer'] as const)('non-recipient %s retains global histories', async role => {
  enableScopedHistories()
  const { result } = renderHook(() => useStore(true, role))
  await waitFor(() => expect(result.current.loading).toBe(false))
  expect(result.current.visitHistories.map(h => h.id)).toEqual([900, 901])
  expect(state.historyFilters).toEqual([[]])
})

test('scope-only reassignment loads new history and removes revoked history without rereading sessions', async () => {
  enableScopedHistories()
  const { result } = renderHook(() => useStore(true, 'user', 'Volunteer'))
  await waitFor(() => expect(result.current.loading).toBe(false))
  state.buildings = [{ ...building, id: 20, card_id: 2, units: [{ ...building.units[0], id: 200, building_id: 20 }] }]
  state.allowed = [2]
  state.historyRows.push({ ...state.historyRows[0], id: 902, unit_id: 200 })
  state.reads = []
  await act(async () => { await result.current.refetchSlices(['calendar']) })
  expect(result.current.visitHistories.map(h => h.id)).toEqual([902])
  expect(state.reads).not.toContain('service_sessions')
  state.allowed = []; state.buildings = []; state.historyFilters = []
  await act(async () => { await result.current.refetchSlices(['calendar']) })
  expect(result.current.visitHistories).toEqual([])
  expect(state.historyFilters).toEqual([])
})

test('scoped save/cancel updates status and records without overwriting from a late read', async () => {
  enableScopedHistories()
  localStorage.setItem('currentVisitor', 'Volunteer')
  localStorage.setItem('auth_token', 'test-token')
  const { result } = renderHook(() => useStore(true, 'user', 'Volunteer'))
  await waitFor(() => expect(result.current.loading).toBe(false))
  const before = result.current.buildings[0]
  let resolve!: (value: { data: Record<string, unknown>[]; error: null }) => void
  state.historyResponse = new Promise(done => { resolve = done })
  let old!: Promise<void>
  await act(async () => { old = result.current.refetchSlices(['visitHistories']); void old.catch(() => {}) })
  const history = { id: 902, unitId: 100, visitor: 'Volunteer', result: '부재', timeSlot: '오전', visitedAt: '2026-10-26', createdAt: '2026-10-26T00:00:00Z' }
  state.changed.mockResolvedValueOnce({ buildings: [{ ...before, units: before.units.map(u => ({ ...u, status: '부재' })) }], histories: [history] })
  await act(async () => { await result.current.updateUnitStatus(10, 100, '부재') })
  expect(result.current.visitHistories.map(h => h.id)).toEqual([902])
  await act(async () => {
    resolve({ data: [state.historyRows[1]], error: null })
    await expect(old).rejects.toThrow('Visit history read superseded')
  })
  expect(result.current.visitHistories.map(h => h.id)).toEqual([902])
  state.changed.mockResolvedValueOnce({ buildings: [before], histories: [] })
  await act(async () => { await result.current.undoLatestVisit(10, 100) })
  expect(result.current.buildings[0].units[0].status).toBe('미방문')
  expect(result.current.visitHistories).toEqual([])
})

test('late scoped read after cancellation cannot resurrect the invalidated record', async () => {
  enableScopedHistories()
  localStorage.setItem('currentVisitor', 'Volunteer')
  localStorage.setItem('auth_token', 'test-token')
  const { result } = renderHook(() => useStore(true, 'user', 'Volunteer'))
  await waitFor(() => expect(result.current.loading).toBe(false))
  const before = result.current.buildings[0]
  const history = { id: 902, unitId: 100, visitor: 'Volunteer', result: '부재', timeSlot: '오전', visitedAt: '2026-10-26', createdAt: '2026-10-26T00:00:00Z' }
  state.changed.mockResolvedValueOnce({ buildings: [{ ...before, units: before.units.map(u => ({ ...u, status: '부재' })) }], histories: [history] })
  await act(async () => { await result.current.updateUnitStatus(10, 100, '부재') })
  expect(result.current.visitHistories.map(h => h.id)).toEqual([902])

  let resolve!: (value: { data: Record<string, unknown>[]; error: null }) => void
  state.historyResponse = new Promise(done => { resolve = done })
  let pending!: Promise<void>
  await act(async () => { pending = result.current.refetchSlices(['visitHistories']); void pending.catch(() => {}) })
  state.changed.mockResolvedValueOnce({ buildings: [before], histories: [] })
  await act(async () => { await result.current.undoLatestVisit(10, 100) })
  expect(result.current.visitHistories).toEqual([])
  await act(async () => {
    resolve({ data: [{ ...state.historyRows[1], id: 902 }], error: null })
    await expect(pending).rejects.toThrow('Visit history read superseded')
  })
  expect(result.current.buildings[0].units[0].status).toBe('미방문')
  expect(result.current.visitHistories).toEqual([])
})

test('failed scoped read preserves prior history, without unfiltered fallback', async () => {
  enableScopedHistories()
  const { result } = renderHook(() => useStore(true, 'user', 'Volunteer'))
  await waitFor(() => expect(result.current.loading).toBe(false))
  const old = result.current.visitHistories
  state.failedTable = 'visit_histories'
  await act(async () => { await expect(result.current.refetchSlices(['visitHistories'])).rejects.toThrow('offline') })
  expect(result.current.visitHistories).toBe(old)
  expect(state.historyFilters.at(-1)).toEqual([['unit_id', [100]]])
})

test('personal settings round trip makes no new calendar request', async () => {
  vi.stubEnv('VITE_DEMO_MODE', 'true')
  vi.stubEnv('VITE_CALENDAR_WINDOW_ENABLED', 'true')
  const home = 'window:2026-10-12:2026-11-30'
  const { result, rerender } = renderHook(({ path }) => {
    const scope = useSettingsCalendarScope(path === '/' ? home : 'full', path, '', home, true)
    return useStore(true, 'user', 'Volunteer', scope)
  }, { initialProps: { path: '/' } })
  await waitFor(() => expect(result.current.loading).toBe(false))
  state.reads = []
  for (const path of ['/settings', '/settings/profile', '/']) await act(async () => { rerender({ path }) })
  expect(state.reads).toEqual([])
})

test.each(['user', 'leader', 'admin'] as const)('recent sessions keep today, ended and recent cards on initial/recovery/manual reads: %s', async role => {
  vi.stubEnv('VITE_DEMO_MODE', 'true')
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 9, 26, 0, 15))
  state.sessions = [
    { id: 1, user_name: 'Me', service_date: '2026-10-26', started_at: '2026-10-25T15:05:00Z', status: 'active', primary_card_id: 1 },
    { id: 2, user_name: 'Me', service_date: '2026-10-26', status: 'ended', ended_at: '2026-10-25T15:06:00Z' },
    { id: 3, user_name: 'Me', service_date: '2026-10-18', status: 'ended', assigned_card_id: 2 },
    { id: 4, user_name: 'Me', service_date: '2020-01-01', status: 'ended' },
    { id: 5, user_name: 'Other', service_date: '2026-10-26', status: 'active' },
    { id: 6, user_name: 'Me', service_date: '2026-10-28', status: 'active' },
    { id: 7, user_name: 'Me', service_date: '2026-10-26', status: 'expired' },
    { id: 8, user_name: 'Me', service_date: null, status: 'ended' },
  ]
  // No recipient reader: full-store routes and privileged roles also narrow.
  const { result } = renderHook(() => useStore(true, role, undefined, undefined, 'Me'))
  await waitFor(() => expect(result.current.loading).toBe(false))
  expect(result.current.error).toBeNull()
  expect(result.current.serviceSessions.map(s => s.id)).toEqual([1, 2, 3, 6, 7])
  expect(result.current.serviceSessions[2].assignedCardId).toBe(2)
  await act(async () => { await result.current.refetchSlices(['visits'], { triggeredBy: 'foreground' }) })
  await act(async () => { await result.current.refetchAll() })
  expect(state.sessionFilters).toEqual(Array.from({ length: 3 }, () => [['user_name', 'Me']]))
  expect(state.sessionCutoffs).toEqual(Array(3).fill('2026-10-18'))
  vi.setSystemTime(new Date(2026, 9, 27, 0, 15))
  await act(async () => { await result.current.refetchSlices(['visits'], { triggeredBy: 'foreground' }) })
  expect(state.sessionCutoffs.at(-1)).toBe('2026-10-19')
  expect(result.current.serviceSessions.map(s => s.id)).toEqual([1, 2, 6, 7])
})

test.each(['user', 'leader', 'admin'] as const)('recent session start/end refresh keeps status, time and history linkage: %s', async role => {
  vi.stubEnv('VITE_DEMO_MODE', 'true')
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 9, 26, 12))
  localStorage.setItem('currentVisitor', 'Me')
  const { result } = renderHook(() => useStore(true, role, undefined, undefined, 'Me'))
  await waitFor(() => expect(result.current.loading).toBe(false))
  const histories = result.current.visitHistories
  state.sessions = [{ id: 777, user_name: 'Me', service_date: '2026-10-26', started_at: '2026-10-26T03:00:00Z', status: 'active', primary_card_id: 1 }]
  state.reads = []
  await act(async () => { expect(await result.current.startServiceSession({ role, timeSlot: '오후', primaryCardId: 1 })).toBe(777) })
  const mutations = makeServiceSessionMutations({ fetchAll: async () => {}, buildings: [], serviceSessions: result.current.serviceSessions })
  expect(mutations.getRecordServiceSession()?.id).toBe(777)
  expect(result.current.serviceSessions[0].status).toBe('active')
  state.sessions[0] = { ...state.sessions[0], status: 'ended', ended_at: '2026-10-26T04:00:00Z' }
  await act(async () => { await result.current.endServiceSession(777) })
  expect(result.current.serviceSessions[0].endedAt).toBe('2026-10-26T04:00:00Z')
  expect(result.current.serviceSessions[0].status).toBe('ended')
  expect(result.current.visitHistories).toBe(histories)
  expect(state.reads).not.toContain('visit_histories')
  expect(state.sessionCutoffs.filter(Boolean).every(date => date === '2026-10-18')).toBe(true)
})

test.each([
  { role: 'developer' as const, demo: 'true', flag: undefined },
  { role: 'admin' as const, demo: 'false', flag: undefined },
  { role: 'admin' as const, demo: 'true', flag: 'false' },
])('developer statistics/disabled flag keep every historical page: $role $demo $flag', async ({ role, demo, flag }) => {
  vi.stubEnv('VITE_DEMO_MODE', demo)
  vi.stubEnv('VITE_RECENT_SESSIONS_ENABLED', flag)
  state.sessions = Array.from({ length: 1001 }, (_, id) => ({ id, user_name: id % 2 ? 'Me' : 'Other', service_date: '2020-01-01', started_at: '2020-01-01T00:00:00Z', ended_at: '2020-01-01T01:00:00Z', status: 'ended' }))
  const { result } = renderHook(() => useStore(true, role, undefined, undefined, 'Me'))
  await waitFor(() => expect(result.current.loading).toBe(false))
  expect(result.current.serviceSessions).toHaveLength(1001)
  expect(result.current.serviceSessions.filter(s => s.userName === 'Other')).toHaveLength(501)
  await act(async () => { await result.current.refetchSlices(['visits'], { triggeredBy: 'foreground' }) })
  expect(result.current.serviceSessions).toHaveLength(1001)
  expect(state.sessionFilters).toEqual([[], [], [], []])
  expect(state.sessionCutoffs.every(date => date === undefined)).toBe(true)
})

test('recent reads are paginated and a failure preserves the last complete snapshot until retry', async () => {
  vi.stubEnv('VITE_DEMO_MODE', 'true')
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 9, 26, 12))
  state.sessions = Array.from({ length: 1001 }, (_, id) => ({ id, user_name: 'Me', service_date: '2026-10-26', status: 'active' }))
  const { result } = renderHook(() => useStore(true, 'admin', undefined, undefined, 'Me'))
  await waitFor(() => expect(result.current.loading).toBe(false))
  expect(result.current.serviceSessions).toHaveLength(1001)
  expect(state.sessionCutoffs).toEqual(['2026-10-18', '2026-10-18'])
  const previous = result.current.serviceSessions
  const histories = result.current.visitHistories
  state.failedTable = 'service_sessions'
  await act(async () => { await expect(result.current.refetchSlices(['visits'], { triggeredBy: 'foreground' })).rejects.toThrow('Service session data load failed') })
  expect(result.current.serviceSessions).toBe(previous)
  expect(result.current.visitHistories).toBe(histories)
  state.failedTable = ''
  state.failedSessionPage = 1000
  await act(async () => { await expect(result.current.refetchSlices(['serviceSessions'])).rejects.toThrow('Service session data load failed') })
  expect(result.current.serviceSessions).toBe(previous)
  state.failedSessionPage = -1
  state.sessions[0] = { ...state.sessions[0], status: 'ended' }
  await act(async () => { await result.current.refetchSlices(['serviceSessions']) })
  expect(result.current.serviceSessions[0].status).toBe('ended')
})

test.each([
  { demo: 'true', flag: undefined, calendar: 'true' },
  { demo: 'false', flag: 'true', calendar: 'true' },
  { demo: 'false', flag: 'true', calendar: 'false' },
])('return-detail round trips retain keyed store: demo=$demo flag=$flag calendar=$calendar', async ({ demo, flag, calendar }) => {
  vi.stubEnv('VITE_DEMO_MODE', demo)
  vi.stubEnv('VITE_RETURN_DETAIL_RETENTION_ENABLED', flag)
  vi.stubEnv('VITE_CALENDAR_WINDOW_ENABLED', calendar)
  vi.stubEnv('VITE_RECIPIENT_STORE_ENABLED', 'true')
  vi.stubEnv('VITE_RECIPIENT_CARD_SCOPE_ENABLED', 'true')
  state.summaries.mockResolvedValue([{ id: 1, units: 1, completed: 0, progress: 0 }])
  const mounted = vi.fn()
  const now = new Date('2026-10-23T12:00:00')
  const scopeFor = (path: string) => calendarReadScope(path, '', '', false, calendarWindowEnabled() ? 'true' : 'false', now, 'user', 'Volunteer')
  function Session({ path, recipient }: { path: string; recipient: boolean }) {
    const store = useStore(true, 'user', recipient ? 'Volunteer' : undefined,
      scopeFor(path))
    useEffect(() => { mounted() }, [])
    return <output data-testid="store-state">{store.loading || !store.calendarScopeReady ? 'loading' : `${store.cards.length}:${store.buildings.length}`}</output>
  }
  function Route({ path }: { path: string }) {
    const recipient = recipientStoreEnabled('user', path, '', demo, 'true')
    return <Session key={`account:${recipient ? 'recipient' : 'full'}`} path={path} recipient={recipient} />
  }
  const { rerender } = render(<Route path="/territory" />)
  await waitFor(() => expect(screen.getByTestId('store-state').textContent).toBe('1:1'))
  if (calendar === 'false') {
    expect(scopeFor('/territory/regular/7')).toBe('full')
    expect(state.calendarFilters).toEqual([[]])
  } else expect(scopeFor('/territory/regular/7')).toMatch(/^service:/)
  state.reads = []
  state.cardFilters = []
  for (const path of ['/territory/regular/7', '/territory', '/territory/regular/8', '/territory']) {
    rerender(<Route path={path} />)
    await waitFor(() => expect(screen.getByTestId('store-state').textContent).toBe('1:1'))
  }
  expect(mounted).toHaveBeenCalledTimes(1)
  expect(state.reads).toEqual([])
  expect(state.cardFilters).toEqual([])
})

test.each(['true', 'false'])('focused return map retains keyed store with calendar=%s', async calendar => {
  enableScopedHistories()
  vi.stubEnv('VITE_RETURN_MAP_RETENTION_ENABLED', 'true')
  vi.stubEnv('VITE_RETURN_DETAIL_RETENTION_ENABLED', 'true')
  vi.stubEnv('VITE_CALENDAR_WINDOW_ENABLED', calendar)
  vi.stubEnv('VITE_RECIPIENT_CARD_SCOPE_ENABLED', 'true')
  state.summaries.mockResolvedValue([{ id: 1, units: 1, completed: 0, progress: 0 }])
  const mounted = vi.fn()
  const now = new Date('2026-10-31T12:00:00')
  function Session({ url, recipient }: { url: URL; recipient: boolean }) {
    const scope = calendarReadScope(url.pathname, url.search, '', false, calendar, now, 'user', 'Volunteer')
    const store = useStore(true, 'user', recipient ? 'Volunteer' : undefined, scope)
    useEffect(() => { mounted() }, [])
    return <output data-testid="return-map-store">{store.loading || !store.calendarScopeReady ? 'loading'
      : `${store.buildings.length}:${store.visitHistories.map(h => h.id).join(',')}`}</output>
  }
  function Route({ path }: { path: string }) {
    const url = new URL(path, 'https://demo.example')
    const recipient = recipientStoreEnabled('user', url.pathname, url.search, 'true', 'true')
    return <Session key={`account:${recipient ? 'recipient' : 'full'}`} url={url} recipient={recipient} />
  }
  const { rerender } = render(<Route path="/territory" />)
  await waitFor(() => expect(screen.getByTestId('return-map-store').textContent).toBe('1:901'))
  state.reads = []
  state.historyFilters = []
  for (const path of ['/territory/regular/7', '/map?scope=regularVisits&returnVisitId=7&buildingId=10',
    '/territory/regular/7', '/territory', '/territory/regular/7',
    '/map?scope=regularVisits&returnVisitId=7&buildingId=10', '/territory']) {
    rerender(<Route path={path} />)
    await waitFor(() => expect(screen.getByTestId('return-map-store').textContent).toBe('1:901'))
  }
  expect(mounted).toHaveBeenCalledTimes(1)
  expect(state.reads).toEqual([])
  expect(state.historyFilters).toEqual([])
})

test.each([
  { demo: 'true', flag: 'true', scoped: true },
  { demo: undefined, flag: 'true', scoped: true },
  { demo: 'false', flag: 'true', scoped: true },
  { demo: 'true', flag: undefined, scoped: true },
  { demo: 'true', flag: 'false', scoped: false },
  { demo: undefined, flag: undefined, scoped: false },
].flatMap(config => [false, true].map(legacy => ({ ...config, legacy }))))(
  'card scope reaches store reads: demo=$demo flag=$flag legacy=$legacy', async ({ demo, flag, scoped, legacy }) => {
  vi.stubEnv('VITE_DEMO_MODE', demo)
  vi.stubEnv('VITE_RECIPIENT_CARD_SCOPE_ENABLED', flag)
  state.missingLeaderTable = legacy
  if (scoped) state.summaries.mockResolvedValue([{ id: 1, units: 1, completed: 0, progress: 0 }])
  const { result } = renderHook(() => useStore(true, 'user', 'Volunteer'))
  await waitFor(() => expect(result.current.loading).toBe(false))
  expect(result.current.error).toBeNull()
  expect(result.current.cards.map(card => card.id)).toEqual(scoped ? [1] : [1, 2])
  expect(state.cardFilters).toEqual(scoped ? [[['id', [1]]]] : [[]])
  expect(state.summaries).toHaveBeenLastCalledWith(scoped ? [1] : [1, 2])
})

test.each([false, true])('production scoped cards retain empty assigned cards and refresh grants (legacy=%s)', async legacy => {
  vi.stubEnv('VITE_DEMO_MODE', undefined)
  vi.stubEnv('VITE_RECIPIENT_CARD_SCOPE_ENABLED', 'true')
  state.missingLeaderTable = legacy
  state.buildings = []
  state.summaries.mockResolvedValue([{ id: 1, units: 0, completed: 0, progress: 0 }])
  const { result } = renderHook(() => useStore(true, 'user', 'Volunteer'))
  await waitFor(() => expect(result.current.loading).toBe(false))
  expect(result.current.error).toBeNull()
  expect(result.current.cards.map(card => card.id)).toEqual([1])
  expect(state.cardFilters).toEqual([[['id', [1]]]])
  expect(state.summaries).toHaveBeenLastCalledWith([1])
  state.allowed = [2]
  state.summaries.mockResolvedValue([{ id: 2, units: 10, completed: 5, progress: 50 }])
  await act(async () => { await result.current.refetchSlices(['cards']) })
  expect(result.current.cards.map(card => [card.id, card.progress])).toEqual([[2, 50]])
  expect(state.summaries).toHaveBeenLastCalledWith([2])
  state.allowed = []
  state.summaries.mockResolvedValue([])
  const count = state.cardFilters.length
  await act(async () => { await result.current.refetchSlices(['cards']) })
  expect(result.current.cards).toEqual([])
  expect(state.cardFilters).toHaveLength(count)
})

test('scoped recipient summaries start together with the card read, not after it', async () => {
  vi.stubEnv('VITE_DEMO_MODE', 'true'); vi.stubEnv('VITE_RECIPIENT_CARD_SCOPE_ENABLED', 'true')
  state.summaries.mockResolvedValue([{ id: 1, units: 1, completed: 0, progress: 0 }])
  let release!: () => void
  state.cardHold = new Promise<void>(resolve => { release = resolve })
  try {
    const { result } = renderHook(() => useStore(true, 'user', 'Volunteer'))
    // The card response is still held, yet the summaries for the verified scope were requested.
    await waitFor(() => expect(state.summaries).toHaveBeenCalledWith(state.allowed))
    expect(result.current.loading).toBe(true)
    release()
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toBeNull()
    expect(state.summaries).toHaveBeenCalledTimes(1)
    expect(result.current.cards.map(card => card.id)).toEqual(state.allowed)
  } finally { release(); state.cardHold = null }
})

test('a failed early summary read fails the load and applies no cards', async () => {
  vi.stubEnv('VITE_DEMO_MODE', 'true'); vi.stubEnv('VITE_RECIPIENT_CARD_SCOPE_ENABLED', 'true')
  state.summaries.mockRejectedValue(new Error('summary offline'))
  vi.spyOn(console, 'error').mockImplementation(() => {})
  const { result } = renderHook(() => useStore(true, 'user', 'Volunteer'))
  await waitFor(() => expect(result.current.loading).toBe(false))
  expect(result.current.error).not.toBeNull()
  expect(result.current.cards).toEqual([])
})

test('a rejected card read waits for the early summary request before failing', async () => {
  vi.stubEnv('VITE_DEMO_MODE', 'true'); vi.stubEnv('VITE_RECIPIENT_CARD_SCOPE_ENABLED', 'true')
  state.ignoreCardFilter = true
  let release!: () => void
  let summaryDone = false
  state.summaries.mockImplementation(async () => {
    await new Promise<void>(resolve => { release = resolve })
    summaryDone = true
    return [{ id: 1, units: 1, completed: 0, progress: 0 }]
  })
  vi.spyOn(console, 'error').mockImplementation(() => {})
  const { result } = renderHook(() => useStore(true, 'user', 'Volunteer'))
  await waitFor(() => expect(state.summaries).toHaveBeenCalled())
  await new Promise(resolve => setTimeout(resolve, 30))
  expect(result.current.loading).toBe(true)
  release()
  await waitFor(() => expect(result.current.loading).toBe(false))
  expect(summaryDone).toBe(true)
  expect(result.current.error).not.toBeNull()
  expect(result.current.cards).toEqual([])
})

// Codex review reproduction: a missing allowed card fails in validateCards, after the
// card read itself succeeded. That exit must also settle the early summary request.
test('a missing scoped card settles the early summary request before failing', async () => {
  vi.stubEnv('VITE_DEMO_MODE', 'true'); vi.stubEnv('VITE_RECIPIENT_CARD_SCOPE_ENABLED', 'true')
  state.allowed = [1, 3]
  let release!: () => void
  const held = new Promise<void>(resolve => { release = resolve })
  state.summaries.mockImplementation(async () => {
    await held
    return [{ id: 1 }, { id: 3 }]
  })
  vi.spyOn(console, 'error').mockImplementation(() => {})
  const { result } = renderHook(() => useStore(true, 'user', 'Volunteer'))
  try {
    await waitFor(() => expect(state.summaries).toHaveBeenCalledWith([1, 3]))
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)) })
    expect(result.current.loading).toBe(true)
  } finally { release() }
  await waitFor(() => expect(result.current.loading).toBe(false))
  expect(result.current.error).not.toBeNull()
  expect(result.current.cards).toEqual([])
})

test('scoped cards reject foreign response rows rather than trusting the server filter', async () => {
  vi.stubEnv('VITE_DEMO_MODE', 'true'); vi.stubEnv('VITE_RECIPIENT_CARD_SCOPE_ENABLED', 'true')
  state.ignoreCardFilter = true
  const { result } = renderHook(() => useStore(true, 'user', 'Volunteer'))
  await waitFor(() => expect(result.current.loading).toBe(false))
  expect(result.current.error).not.toBeNull()
  expect(result.current.cards).toEqual([])
  // Summaries may start early, but only for the verified scope, and are never applied.
  for (const [ids] of state.summaries.mock.calls) expect(ids).toEqual(state.allowed)
})

test.each(['true', undefined].flatMap(demo =>
  (['user', 'leader', 'admin', 'developer'] as const).map(role => ({ demo, role }))))(
  'full store remains complete for $role with scoped flag (demo=$demo)', async ({ demo, role }) => {
  vi.stubEnv('VITE_DEMO_MODE', demo); vi.stubEnv('VITE_RECIPIENT_CARD_SCOPE_ENABLED', 'true')
  const { result } = renderHook(() => useStore(true, role))
  await waitFor(() => expect(result.current.loading).toBe(false))
  expect(result.current.cards.map(card => card.id)).toEqual([1, 2])
  expect(state.cardFilters).toEqual([[]])
})

test.each(['user', 'leader', 'admin', 'developer'] as const)('demo card reads preserve %s fields and refreshed progress', async role => {
  vi.stubEnv('VITE_DEMO_MODE', 'true')
  const { result } = renderHook(() => useStore(true, role, role === 'user' ? 'Volunteer' : undefined))
  await waitFor(() => expect(result.current.loading).toBe(false))
  const projection = state.cardColumns.find(columns => columns.includes('card_assignments'))!
  expect(projection.includes('card_leader_assignments(user_name)')).toBe(role === 'user' || role === 'leader')
  expect(projection.includes('created_at')).toBe(role === 'admin' || role === 'developer')
  if (role === 'user') {
    state.summaries.mockResolvedValue([{ id: 1, units: 1, completed: 1, progress: 100 }, { id: 2, units: 50, completed: 50, progress: 100 }])
    await act(async () => { await result.current.refetchSlices(['cards'], { triggeredBy: 'foreground' }) })
    expect(result.current.cards.map(card => card.progress)).toEqual([100, 100])
    expect(state.cardColumns.filter(columns => columns.includes('card_assignments'))).toEqual([projection, projection])
  }
})

test.each(['user', 'leader', 'admin', 'developer'] as const)('production opt-in wires %s modern and legacy reads', async role => {
  vi.stubEnv('VITE_DEMO_MODE', 'false')
  vi.stubEnv('VITE_CARD_COMPACT_READ_ENABLED', 'true')
  state.missingLeaderTable = true
  const { result } = renderHook(() => useStore(true, role))
  await waitFor(() => expect(result.current.loading).toBe(false))
  expect(result.current.error).toBeNull()
  const base = role === 'user' || role === 'leader' ? 'id,name,area,region,type,status,leader_name' : '*'
  const leaders = role === 'user' || role === 'leader' ? 'user_name' : 'user_name, created_at'
  expect(state.cardColumns.filter(c => c.includes('card_assignments'))).toEqual([
    `${base}, card_assignments(user_name), card_leader_assignments(${leaders})`,
    `${base}, card_assignments(user_name)`,
  ])
  expect(result.current.cards.map(c => c.name)).toEqual(['card1', 'card2'])
})

test.each((['true', 'false'] as const).flatMap(demo =>
  (['user', 'leader', 'admin', 'developer'] as const).flatMap(role =>
    (['approved', 'rejected'] as const).map(status => ({ demo, role, status })))))(
  'pending request query removes reviewed rows on refresh ($demo, $role, $status)', async ({ demo, role, status }) => {
  vi.stubEnv('VITE_DEMO_MODE', demo)
  state.requests = [
    { id: 61, name: 'pending', status: 'pending' },
    { id: 62, name: 'approved', status: 'approved' },
    { id: 63, name: 'rejected', status: 'rejected' },
  ]
  const { result } = renderHook(() => useStore(true, role, role === 'user' ? 'Volunteer' : undefined))
  await waitFor(() => expect(result.current.loading).toBe(false))
  expect(state.requestFilters).toEqual([[['status', 'pending']]])
  expect(result.current.restaurantRequests.map(r => r.id)).toEqual([61])
  state.requests[0] = { ...state.requests[0], status }
  await act(async () => { await result.current.refetchSlices(['restaurantRequests']) })
  expect(result.current.restaurantRequests.map(r => r.id)).toEqual([])
  expect(state.requestFilters).toEqual(Array.from({ length: 2 }, () => [['status', 'pending']]))
})

test.each((['true', 'false'] as const).flatMap(demo =>
  (['user', 'leader', 'admin', 'developer'] as const).flatMap(role =>
    (['edit', 'delete', 'request', 'memo'] as const).map(kind => ({ demo, role, kind })))))(
  'detail changes refresh authoritative state (demo=$demo, $role, $kind)', async ({ demo, role, kind }) => {
    vi.stubEnv('VITE_DEMO_MODE', demo)
    localStorage.setItem('currentVisitor', 'Volunteer')
    localStorage.setItem('auth_token', '00000000-0000-0000-0000-000000000007')
    const { result } = renderHook(() => useStore(true, role, role === 'user' ? 'Volunteer' : undefined))
    await waitFor(() => expect(result.current.loading).toBe(false))
    const buildings = result.current.buildings, histories = result.current.visitHistories
    state.returnRows = [{ id: 51, last_result: kind === 'delete' ? null : '만남' }]
    state.returnLogs = kind === 'delete' ? [] : [{ id: 52, return_visit_id: 51, result: '만남', memo: 'edited' }]
    state.requests = [{ id: 61, name: 'test', memo: 'edited', status: 'pending' }]
    state.reads = []; state.refresh.mockClear()
    await act(async () => {
      if (kind === 'edit') await result.current.updateReturnVisitLog(52, '만남', 'edited')
      else if (kind === 'delete') await result.current.deleteReturnVisitLog(52)
      else if (kind === 'memo') await result.current.updateRestaurantRequestMemo(61, 'edited')
      else expect(await result.current.submitRestaurantRequest({ name: 'test', address: 'test', memo: 'edited', isChinese: true, initialState: '미방문', regularVisitor: null })).toBe(true)
    })
    expect(state.refresh).not.toHaveBeenCalled()
    expect(state.reads).not.toContain('buildings')
    expect(state.reads).not.toContain('visit_histories')
    expect(result.current.buildings).toBe(buildings)
    expect(result.current.visitHistories).toBe(histories)
    if (kind === 'edit' || kind === 'delete') {
      expect(state.reads).toContain('return_visit_logs')
      expect(result.current.returnVisits[0].lastResult).toBe(kind === 'delete' ? null : '만남')
      expect(result.current.returnVisitLogs).toHaveLength(kind === 'delete' ? 0 : 1)
    } else {
      expect(state.reads).toContain('restaurant_requests')
      expect(result.current.restaurantRequests[0].memo).toBe('edited')
    }
  },
)

test.each((['true', 'false'] as const).flatMap(demo =>
  (['request', 'memo'] as const).map(kind => ({ demo, kind }))))('failed $kind refresh preserves the list without repeating a committed write (demo=$demo)', async ({ demo, kind }) => {
  vi.stubEnv('VITE_DEMO_MODE', demo)
  state.requests = [{ id: 61, name: 'test', memo: 'old', status: 'pending' }]
  const { result } = renderHook(() => useStore(true, 'user', 'Volunteer'))
  await waitFor(() => expect(result.current.loading).toBe(false))
  const requests = result.current.restaurantRequests
  state.failedTable = 'restaurant_requests'; state.reads = []
  await act(async () => {
    if (kind === 'memo') await expect(result.current.updateRestaurantRequestMemo(61, 'edited')).resolves.toBe(true)
    else expect(await result.current.submitRestaurantRequest({ name: 'test', address: 'test', memo: '', isChinese: true, initialState: '미방문', regularVisitor: null })).toBe(true)
  })
  expect(result.current.restaurantRequests).toBe(requests)
  expect(state.reads.filter(table => table === 'restaurant_requests:insert')).toHaveLength(1)
  expect(state.reads).not.toContain('visit_histories')
})

test.each(
  (['true', 'false'] as const).flatMap(demo =>
    (['user', 'developer'] as const).flatMap(role =>
      (['nickname', 'log'] as const).map(kind => ({ demo, role, kind })))),
)('return visit $kind refresh keeps buildings and histories (demo=$demo, $role)', async ({ demo, role, kind }) => {
  vi.stubEnv('VITE_DEMO_MODE', demo)
  localStorage.setItem('currentVisitor', 'Volunteer')
  const { result } = renderHook(() => useStore(true, role, role === 'user' ? 'Volunteer' : undefined))
  await waitFor(() => expect(result.current.loading).toBe(false))
  const buildings = result.current.buildings
  const histories = result.current.visitHistories
  state.returnRows = [{ id: 51, nickname: 'new name', last_result: '부재' }]
  state.returnLogs = [{ id: 52, return_visit_id: 51, result: '부재', memo: 'new log' }]
  state.reads = []; state.refresh.mockClear()
  await act(async () => {
    if (kind === 'nickname') await result.current.updateReturnVisitNickname(51, 'new name')
    else await result.current.addReturnVisitLog(51, '부재', 'new log')
  })
  expect(state.reads).toContain('return_visits')
  expect(state.reads).toContain('return_visit_logs')
  expect(state.reads).not.toContain('buildings')
  expect(state.reads).not.toContain('visit_histories')
  expect(state.refresh).not.toHaveBeenCalled()
  expect(result.current.buildings).toBe(buildings)
  expect(result.current.visitHistories).toBe(histories)
  expect(result.current.returnVisits[0].nickname).toBe('new name')
  expect(result.current.returnVisitLogs[0].memo).toBe('new log')
})

test.each(['true', 'false'])('failed return visit refresh preserves both snapshots (demo=%s)', async (demo) => {
  vi.stubEnv('VITE_DEMO_MODE', demo)
  state.returnRows = [{ id: 51, nickname: 'old name' }]
  state.returnLogs = [{ id: 52, return_visit_id: 51, memo: 'old log' }]
  const { result } = renderHook(() => useStore(true, 'user', 'Volunteer'))
  await waitFor(() => expect(result.current.loading).toBe(false))
  const visits = result.current.returnVisits, logs = result.current.returnVisitLogs
  state.failedTable = 'return_visit_logs'
  await act(async () => {
    await expect(result.current.updateReturnVisitNickname(51, 'new name')).rejects.toThrow('Return visit data load failed')
  })
  expect(result.current.returnVisits).toBe(visits)
  expect(result.current.returnVisitLogs).toBe(logs)
})

test.each((['true', 'false'] as const).flatMap(demo =>
  (['user', 'leader', 'admin', 'developer'] as const).map(role => ({ demo, role }))))('session end refreshes sessions without histories ($demo, $role)', async ({ demo, role }) => {
  vi.stubEnv('VITE_DEMO_MODE', demo)
  vi.stubEnv('VITE_PERSONAL_SESSIONS_ENABLED', 'true')
  localStorage.setItem('currentVisitor', 'Volunteer')
  state.sessions = Array.from({ length: 1001 }, (_, id) => ({ id, user_name: 'Volunteer', status: 'active', started_at: '2026-10-19T00:00:00Z' }))
  state.sessions.push({ id: 2000, user_name: 'other', status: 'ended' })
  const { result } = renderHook(() => useStore(true, role, role === 'user' ? 'Volunteer' : undefined))
  await waitFor(() => expect(result.current.loading).toBe(false))
  const histories = result.current.visitHistories
  state.sessions[0] = { ...state.sessions[0], status: 'ended', ended_at: '2026-10-19T01:00:00Z' }
  state.reads = []
  await act(async () => { await result.current.endServiceSession(0) })
  expect(state.reads).not.toContain('visit_histories')
  expect(result.current.visitHistories).toBe(histories)
  expect(result.current.serviceSessions).toHaveLength(role === 'user' ? 1001 : 1002)
  expect(result.current.serviceSessions.find(s => s.id === 0)?.status).toBe('ended')
  expect(result.current.serviceSessions.find(s => s.id === 0)?.endedAt).toBe('2026-10-19T01:00:00Z')
})

test.each(['true', 'false'])('session start refreshes session state without downloading histories (demo=%s)', async demo => {
  vi.stubEnv('VITE_DEMO_MODE', demo)
  localStorage.setItem('currentVisitor', 'Volunteer')
  const { result } = renderHook(() => useStore(true, 'user', 'Volunteer'))
  await waitFor(() => expect(result.current.loading).toBe(false))
  const histories = result.current.visitHistories
  state.sessions = [{ id: 777, user_name: 'Volunteer', status: 'active', primary_card_id: 1 }]
  state.reads = []
  await act(async () => {
    expect(await result.current.startServiceSession({ role: 'user', timeSlot: '오전', primaryCardId: 1 })).toBe(777)
  })
  expect(state.reads).not.toContain('visit_histories')
  expect(result.current.visitHistories).toBe(histories)
  expect(result.current.serviceSessions.map(s => [s.id, s.status])).toEqual([[777, 'active']])
})

test('session-only read failure preserves sessions and histories', async () => {
  vi.stubEnv('VITE_DEMO_MODE', 'true')
  state.sessions = [{ id: 1, user_name: 'Volunteer', status: 'active' }]
  const { result } = renderHook(() => useStore(true, 'user', 'Volunteer'))
  await waitFor(() => expect(result.current.loading).toBe(false))
  const previous = result.current.serviceSessions
  const histories = result.current.visitHistories
  state.failedTable = 'service_sessions'; state.reads = []
  await act(async () => {
    await expect(result.current.refetchSlices(['serviceSessions'])).rejects.toThrow('Service session data load failed')
  })
  expect(result.current.serviceSessions).toBe(previous)
  expect(result.current.visitHistories).toBe(histories)
  expect(state.reads).toEqual(['service_sessions'])
})

test('production session end skips histories even without personal session filtering', async () => {
  vi.stubEnv('VITE_DEMO_MODE', 'false')
  state.sessions = [{id:1,user_name:'Volunteer',status:'active',service_date:'2026-10-26',time_slot:'오후'}]
  const { result } = renderHook(() => useStore(true, 'user', 'Volunteer'))
  await waitFor(() => expect(result.current.loading).toBe(false))
  state.reads = []
  await act(async () => { await result.current.endServiceSession(1) })
  expect(state.reads).not.toContain('visit_histories')
  expect(state.reads).toContain('service_sessions')
})

test.each([
  ['true', undefined],
  [undefined, 'true'],
  ['false', 'true'],
] as const)('enabled restaurant save preserves recipient scope (%s, %s)', async (demo, enabled) => {
  vi.stubEnv('VITE_DEMO_MODE', demo)
  vi.stubEnv('VITE_RESTAURANT_VISIT_REFRESH_ENABLED', enabled)
  const { result } = renderHook(() => useStore(true, 'user', 'Volunteer'))
  await waitFor(() => expect(result.current.loading).toBe(false))
  expect(state.historyColumns[0].split(', ')).toContain('visit_type')
  expect(result.current.visitHistories[0].visitType).toBe('restaurant')
  const restaurant = { ...result.current.buildings[0], id: 20, cardId: 2,
    units: [{ ...result.current.buildings[0].units[0], id: 200 }] }
  const history = { id: 901, unitId: 200, visitor: 'Volunteer', result: '만남', timeSlot: '오전',
    visitedAt: '2026-10-19', createdAt: '2026-10-19T00:00:00Z', visitType: 'restaurant' }
  state.changed.mockResolvedValue({ buildings: [restaurant], histories: [history] })
  state.reads = []
  await act(async () => { await result.current.addRestaurantVisit(200, 'saved') })
  expect(state.changed).toHaveBeenCalledExactlyOnceWith([20])
  expect(state.reads).toEqual(['visit_histories:insert', 'units'])
  expect(result.current.buildings.map((b) => b.id)).toEqual([10])
  expect(result.current.visitHistories.map((h) => h.id)).toEqual([901, 900])
  expect(result.current.visitHistories[0].visitType).toBe('restaurant')
  expect(result.current.cards.find((card) => card.id === 2)?.units).toBe(50)
})

test.each(['parent', 'sync', 'invalid-parent'])('restaurant %s failure recovers without inserting twice', async (failure) => {
  vi.stubEnv('VITE_DEMO_MODE', 'true')
  const { result } = renderHook(() => useStore(true, 'user', 'Volunteer'))
  await waitFor(() => expect(result.current.loading).toBe(false))
  state.unitLookupError = failure === 'parent'
  if (failure === 'invalid-parent') state.unitParent = 0
  state.changed.mockRejectedValue(new Error('offline'))
  state.reads = []
  await act(async () => { await result.current.addRestaurantVisit(200, 'saved') })
  expect(state.reads.filter((name) => name === 'visit_histories:insert')).toHaveLength(1)
  expect(state.reads).toContain('visit_histories')
  expect(state.reads).toContain('restaurant_requests')
  expect(state.reads).toContain('service_sessions')
  expect(state.refresh).toHaveBeenCalled()
  expect(state.changed).toHaveBeenCalledTimes(failure === 'sync' ? 1 : 0)
})

test.each([
  [undefined, undefined],
  ['false', undefined],
  ['true', 'false'],
  [undefined, 'false'],
] as const)('disabled restaurant save retains the existing refresh (%s, %s)', async (demo, enabled) => {
  vi.stubEnv('VITE_DEMO_MODE', demo)
  vi.stubEnv('VITE_RESTAURANT_VISIT_REFRESH_ENABLED', enabled)
  const { result } = renderHook(() => useStore(true, 'user', 'Volunteer'))
  await waitFor(() => expect(result.current.loading).toBe(false))
  state.reads = []
  await act(async () => { await result.current.addRestaurantVisit(200, 'saved') })
  expect(state.changed).not.toHaveBeenCalled()
  expect(state.reads).toContain('visit_histories')
  expect(state.reads).toContain('restaurant_requests')
  expect(state.reads).toContain('service_sessions')
})

test('failed restaurant insert does not refresh or claim a successful save', async () => {
  vi.stubEnv('VITE_DEMO_MODE', 'true')
  const { result } = renderHook(() => useStore(true, 'user', 'Volunteer'))
  await waitFor(() => expect(result.current.loading).toBe(false))
  state.insertError = true; state.reads = []
  await act(async () => { await result.current.addRestaurantVisit(200, 'failed') })
  expect(state.reads).toEqual(['visit_histories:insert'])
  expect(state.changed).not.toHaveBeenCalled()
})

test.each([
  ['true', undefined],
  [undefined, 'true'],
] as const)('enabled recipient sessions stay scoped across initial, recovery and mutation reads (%s, %s)', async (demo, enabled) => {
  vi.stubEnv('VITE_DEMO_MODE', demo)
  vi.stubEnv('VITE_PERSONAL_SESSIONS_ENABLED', enabled)
  state.sessions = Array.from({ length: 1001 }, (_, id) => ({ id, user_name: 'Volunteer', service_date: '2020-01-01', status: 'ended' }))
  state.sessions.push({ id: 2000, user_name: 'other' })
  const { result } = renderHook(() => useStore(true, 'user', 'Volunteer'))
  await waitFor(() => expect(result.current.loading).toBe(false))
  for (const triggeredBy of ['foreground', 'mutation:visits']) {
    await act(async () => { await result.current.refetchSlices(['visits'], { triggeredBy }) })
  }
  expect(result.current.serviceSessions).toHaveLength(1001)
  expect(result.current.serviceSessions.every((session) => session.userName === 'Volunteer')).toBe(true)
  expect(state.sessionFilters).toHaveLength(6)
  expect(state.sessionFilters.every((filters) => JSON.stringify(filters) === JSON.stringify([['user_name', 'Volunteer']]))).toBe(true)
  expect(result.current.visitHistories.map((history) => history.id)).toContain(900)
})

test.each([
  ['false', undefined, 'user', 'Volunteer'],
  [undefined, undefined, 'user', 'Volunteer'],
  ['true', 'false', 'user', 'Volunteer'],
  [undefined, 'false', 'user', 'Volunteer'],
  ['true', 'true', 'user', undefined],
  ['true', 'true', 'user', ''],
  ['true', 'true', 'admin', 'Volunteer'],
  ['true', 'true', 'developer', 'Volunteer'],
  ['true', 'true', 'leader', 'Volunteer'],
] as const)('disabled/full/privileged sessions stay global (%s, %s, %s, %s)', async (demo, enabled, role, recipient) => {
  vi.stubEnv('VITE_DEMO_MODE', demo)
  vi.stubEnv('VITE_PERSONAL_SESSIONS_ENABLED', enabled)
  state.sessions = [{ id: 1, user_name: 'Volunteer' }, { id: 2, user_name: 'other' }]
  const { result } = renderHook(() => useStore(true, role, recipient))
  await waitFor(() => expect(result.current.loading).toBe(false))
  expect(result.current.serviceSessions.map((session) => session.userName)).toEqual(['Volunteer', 'other'])
  expect(state.sessionFilters).toEqual([[]])
})

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

test('production opt-ins serialize deferred recipient calendar refreshes and publish each scope', async () => {
  vi.stubEnv('VITE_DEMO_MODE', 'false')
  vi.stubEnv('VITE_CALENDAR_EVENT_REFRESH_ENABLED', 'true')
  vi.stubEnv('VITE_BUILDING_MOVE_REFRESH_ENABLED', 'true')
  const { result } = renderHook(() => useStore(true, 'user', 'Volunteer'))
  await waitFor(() => expect(result.current.loading).toBe(false))
  state.refresh.mockClear()
  state.calendarFilters = []
  state.reads = []
  state.refresh
    .mockImplementationOnce(calendar => {
      expect(calendar[0].title).toBe('first scope')
      state.allowed = [2]
      state.buildings = [{ ...building, id: 20, card_id: 2, units: [] }]
    })
    .mockImplementationOnce(calendar => {
      expect(calendar[0].title).toBe('revoked scope')
      state.allowed = []
      state.buildings = []
    })
  let releaseFirst!: (value: { data: Record<string, unknown>[]; error: null }) => void
  let releaseSecond!: (value: { data: Record<string, unknown>[]; error: null }) => void
  state.calendarResponses.push(
    new Promise(resolve => { releaseFirst = resolve }),
    new Promise(resolve => { releaseSecond = resolve }),
  )
  let first!: Promise<void>, second!: Promise<void>
  act(() => {
    first = result.current.refetchSlices(['calendar'])
    second = result.current.refetchSlices(['calendar'])
  })
  await waitFor(() => expect(state.calendarFilters).toHaveLength(1))
  expect(state.calendarResponses).toHaveLength(1)
  expect(state.refresh).not.toHaveBeenCalled()
  expect(result.current.buildings.map(b => b.id)).toEqual([10])
  await act(async () => {
    releaseFirst({ data: [{ id: 7, event_date: '2026-10-20', time: '10:00', title: 'first scope' }], error: null })
    await first
  })
  await waitFor(() => expect(state.calendarFilters).toHaveLength(2))
  expect(state.refresh).toHaveBeenCalledOnce()
  expect(result.current.buildings.map(b => [b.id, b.cardId])).toEqual([[20, 2]])
  expect(result.current.cardBoundaries.map(b => b.cardId)).toEqual([2])
  await act(async () => {
    releaseSecond({ data: [{ id: 7, event_date: '2026-10-20', time: '10:00', title: 'revoked scope' }], error: null })
    await second
  })
  expect(state.refresh).toHaveBeenCalledTimes(2)
  expect(state.calendarFilters).toEqual([[], []])
  expect(result.current.calendarEvents[0].title).toBe('revoked scope')
  expect(result.current.buildings).toEqual([])
  expect(result.current.cardBoundaries).toEqual([])
  expect(result.current.cards.find(c => c.id === 2)?.units).toBe(50)
  expect(state.changed).not.toHaveBeenCalled()
  expect(state.reads).not.toContain('buildings')
})

test.each(['true', 'false'])('single-event update retains broad calendar and recipient scope refresh (demo=%s)', async (demo) => {
  vi.stubEnv('VITE_DEMO_MODE', demo)
  vi.stubEnv('VITE_CALENDAR_EVENT_REFRESH_ENABLED', demo === 'true' ? undefined : 'true')
  vi.stubEnv('VITE_BUILDING_MOVE_REFRESH_ENABLED', demo === 'true' ? undefined : 'true')
  localStorage.setItem('auth_token', 'test-token')
  const { result } = renderHook(() => useStore(true, 'user', 'Volunteer'))
  await waitFor(() => expect(result.current.loading).toBe(false))
  expect(result.current.buildings.map((b) => b.id)).toEqual([10])
  state.refresh.mockClear()
  state.reads = []; state.calendarFilters = []
  state.allowed = []; state.buildings = []
  await act(async () => {
    expect(await result.current.updateCalendarEvent(7, {
      time: '10:00', title: 'Updated', place: 'Hall', leader: 'Other', memo: '',
      hasMeeting: true, allowApplications: true,
    }, false)).toBe(true)
  })
  expect(state.calendarFilters).toEqual([[]])
  expect(state.reads).toEqual(expect.arrayContaining([
    'calendar_events', 'event_card_assignments', 'event_card_assignment_cards', 'cards',
  ]))
  expect(state.refresh).toHaveBeenCalledOnce()
  expect(state.changed).not.toHaveBeenCalled()
  expect(result.current.buildings).toEqual([])
  expect(result.current.cardBoundaries).toEqual([])
  expect(result.current.cards.find((card) => card.id === 2)?.units).toBe(50)
})

test.each(['true', 'false'])('building card move retains broad scoped refresh instead of targeted sync (demo=%s)', async (demo) => {
  vi.stubEnv('VITE_DEMO_MODE', demo)
  vi.stubEnv('VITE_BUILDING_MOVE_REFRESH_ENABLED', demo === 'true' ? undefined : 'true')
  vi.stubEnv('VITE_CALENDAR_EVENT_REFRESH_ENABLED', demo === 'true' ? undefined : 'true')
  const { result } = renderHook(() => useStore(true, 'user', 'Volunteer'))
  await waitFor(() => expect(result.current.loading).toBe(false))
  expect(result.current.buildings.map((b) => b.id)).toEqual([10])
  state.refresh.mockClear()
  state.reads = []
  // The building moved to card 2, outside this recipient's card 1 snapshot.
  state.buildings = []
  state.changed.mockResolvedValue({ buildings: [{ ...result.current.buildings[0], cardId: 2 }], histories: [] })
  await act(async () => { expect(await result.current.moveBuildingToCard(10, 2)).toBe(true) })
  expect(state.reads).toContain('buildings:insert')
  expect(state.reads).toContain('cards')
  expect(state.refresh).toHaveBeenCalledOnce()
  expect(state.changed).not.toHaveBeenCalled()
  expect(state.reads).not.toContain('buildings')
  expect(result.current.buildings).toEqual([])
  expect(result.current.cardBoundaries.map((boundary) => boundary.cardId)).toEqual([1])
  expect(result.current.cards.find((card) => card.id === 2)?.units).toBe(50)
})

test('building creation refresh keeps the new point inside its assigned card', async () => {
  const { result } = renderHook(() => useStore(true, 'user', 'Volunteer'))
  await waitFor(() => expect(result.current.loading).toBe(false))
  state.buildings = [building, { ...building, id: 11, units: [] }]
  await act(async () => { await result.current.refetchSlices(['buildings', 'cards'], { triggeredBy: 'mutation:buildings' }) })
  expect(result.current.buildings.map((b) => b.id)).toEqual([10, 11])
  expect(state.reads).not.toContain('buildings')
})

test.each(['address', 'created', 'existing', 'chinese'] as const)('production opt-ins retain recipient scope refresh for %s', async (action) => {
  vi.stubEnv('VITE_DEMO_MODE', 'false')
  vi.stubEnv('VITE_RETURN_VISIT_ADDRESS_REFRESH_ENABLED', 'true')
  vi.stubEnv('VITE_BUILDING_CREATE_REFRESH_ENABLED', 'true')
  vi.stubEnv('VITE_CHINESE_FLAG_REFRESH_ENABLED', 'true')
  localStorage.setItem('auth_token', 'test-token')
  const { result } = renderHook(() => useStore(true, 'user', 'Volunteer'))
  await waitFor(() => expect(result.current.loading).toBe(false))
  state.refresh.mockClear()
  state.changed.mockResolvedValue({ buildings: [], histories: [] })
  // The mutation changes scope; no arbitrary-ID insertion may bypass this read.
  state.allowed = []; state.buildings = []
  state.creationAction = action === 'address' || action === 'chinese' ? '' : action
  await act(async () => {
    if (action === 'address') await result.current.updateReturnVisitAddress(7, 'new address')
    else if (action === 'chinese') await result.current.toggleChinese(10, 100)
    else expect(await result.current.createBuildingForPlacement({ cardId: 1, name: 'new', address: 'new', type: '주택', lat: 37, lng: 127 }))
      .toEqual({ action, buildingId: 11 })
  })
  expect(state.refresh).toHaveBeenCalled()
  expect(state.changed).not.toHaveBeenCalled()
  expect(result.current.buildings).toEqual([])
})

test('production group rename does not rebuild recipient scope', async () => {
  vi.stubEnv('VITE_DEMO_MODE', 'false')
  vi.stubEnv('VITE_INFORMAL_GROUP_REFRESH_ENABLED', 'true')
  const { result } = renderHook(() => useStore(true, 'user', 'Volunteer'))
  await waitFor(() => expect(result.current.loading).toBe(false))
  state.refresh.mockClear()
  state.reads = []
  await act(async () => { expect(await result.current.renameInformalGroup(7, 'new')).toBe(true) })
  expect(state.refresh).not.toHaveBeenCalled()
  expect(state.reads).toEqual(['informal_groups:insert', 'informal_groups'])
  expect(result.current.buildings.map(b => b.id)).toEqual([10])
})

test('recipient group rename reports failed strict recovery without losing buildings', async () => {
  vi.stubEnv('VITE_DEMO_MODE', 'false')
  vi.stubEnv('VITE_INFORMAL_GROUP_REFRESH_ENABLED', 'true')
  const { result } = renderHook(() => useStore(true, 'user', 'Volunteer'))
  await waitFor(() => expect(result.current.loading).toBe(false))
  state.failedTable = 'informal_groups'
  state.reads = []
  await act(async () => { expect(await result.current.renameInformalGroup(7, 'new')).toBe(false) })
  expect(state.reads.filter(t => t === 'informal_groups')).toHaveLength(2)
  expect(state.reads).toContain('informal_assets')
  expect(result.current.buildings.map(b => b.id)).toEqual([10])
})

test.each([[7], null] as (number[] | null)[])('participant-only recovery %j does not refresh recipient territory or histories', async ids => {
  const event = { id: 7, event_date: '2026-10-30', time: '10:00', event_participants: [{ user_name: 'Volunteer', role: '입명' }] }
  state.calendarResponses.push(Promise.resolve({ data: [event], error: null }))
  const { result } = renderHook(() => useStore(true, 'user', 'Volunteer'))
  await waitFor(() => expect(result.current.loading).toBe(false))
  expect(result.current.calendarEvents[0].applicants).toEqual(['Volunteer'])
  const buildings = result.current.buildings, histories = result.current.visitHistories, cards = result.current.cards
  state.reads = []; state.calendarFilters = []; state.refresh.mockClear(); state.unchanged.mockClear()
  state.calendarResponses.push(Promise.resolve({ data: [{ ...event, event_participants: [...event.event_participants, { user_name: 'Other', role: '게스트' }] }], error: null }))
  await act(async () => { await result.current.refreshCalendarParticipants(ids) })
  expect(state.reads).toEqual(['calendar_events'])
  expect(state.calendarFilters).toEqual([[['id', [7]]]])
  expect(state.refresh).not.toHaveBeenCalled()
  expect(state.unchanged).not.toHaveBeenCalled()
  expect(result.current.buildings).toBe(buildings)
  expect(result.current.visitHistories).toBe(histories)
  expect(result.current.cards).toBe(cards)
  expect(result.current.calendarEvents[0].applicants).toEqual(['Volunteer', 'Other'])
  expect(result.current.calendarEvents[0].assigned).toEqual(['Volunteer'])
  expect(result.current.calendarEvents[0].guests).toEqual(['Other'])
  state.reads = []
  await act(async () => { await result.current.refreshCalendarParticipants([999]) })
  expect(state.reads).toEqual([])
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

// 0173: the first snapshot lands in two parts; the base part alone opens volunteer home.
test('base part is ready before personal territory; territory readiness follows the complete snapshot', async () => {
  enableScopedHistories()
  vi.stubEnv('VITE_CALENDAR_WINDOW_ENABLED', 'true')
  vi.stubEnv('VITE_RECIPIENT_INITIAL_PARALLEL_ENABLED', 'true')
  let releaseBuildings!: () => void
  state.recipientDetails = new Promise(resolve => { releaseBuildings = resolve })
  const { result } = renderHook(() => useStore(true, 'user', 'Volunteer', 'window:2026-10-01:2026-10-31'))
  await waitFor(() => expect(result.current.recipientBaseReady).toBe(true))
  // Schedules are in, personal territory is not: consumers of buildings stay gated.
  expect(result.current.loading).toBe(true)
  expect(result.current.buildingScopeReady).toBe(false)
  expect(result.current.buildings).toEqual([])
  expect(state.reads).not.toContain('cards')
  // 나의 봉사 tools wait for personal territory; asking for it adds no read.
  expect(result.current.fullBuildingReader).toMatchObject({ ready: false, mapReady: false, error: false })
  const before = state.reads.length
  act(() => { result.current.fullBuildingReader!.request(); result.current.fullBuildingReader!.requestMap() })
  expect(state.reads).toHaveLength(before)
  await act(async () => { releaseBuildings() })
  await waitFor(() => expect(result.current.loading).toBe(false))
  expect(result.current.buildingScopeReady).toBe(true)
  expect(result.current.fullBuildingReader).toMatchObject({ ready: true, mapReady: true })
  expect(result.current.buildings.map(b => b.id)).toEqual([10])
  // A later refresh never closes the gate again.
  await act(async () => { await result.current.refetchAll() })
  expect(result.current.buildingScopeReady).toBe(true)
})

test('base part stays closed while a base slice is pending, and a disabled store resets both parts', async () => {
  enableScopedHistories()
  vi.stubEnv('VITE_CALENDAR_WINDOW_ENABLED', 'true')
  vi.stubEnv('VITE_RECIPIENT_INITIAL_PARALLEL_ENABLED', 'true')
  let releaseCalendar!: (value: { data: Record<string, unknown>[]; error: null }) => void
  state.calendarResponses.push(new Promise(resolve => { releaseCalendar = resolve }))
  const { result, rerender } = renderHook(({ enabled }) => useStore(enabled, 'user', 'Volunteer', 'window:2026-10-01:2026-10-31'), { initialProps: { enabled: true } })
  await waitFor(() => expect(state.reads).toContain('app_settings'))
  await act(async () => {})
  expect(result.current.recipientBaseReady).toBe(false)
  await act(async () => { releaseCalendar({ data: [], error: null }) })
  await waitFor(() => expect(result.current.loading).toBe(false))
  expect(result.current.recipientBaseReady).toBe(true)
  rerender({ enabled: false })
  await waitFor(() => expect(result.current.recipientBaseReady).toBe(false))
  expect(result.current.buildingScopeReady).toBe(false)
})

test('non-volunteer stores never report a base part', async () => {
  const { result } = renderHook(() => useStore(true, 'leader', undefined, 'window:2026-10-01:2026-10-31'))
  await waitFor(() => expect(result.current.loading).toBe(false))
  expect(result.current.recipientBaseReady).toBe(false)
})

test('a base part that answers after sign-out never marks the signed-out store ready', async () => {
  enableScopedHistories()
  vi.stubEnv('VITE_CALENDAR_WINDOW_ENABLED', 'true')
  vi.stubEnv('VITE_RECIPIENT_INITIAL_PARALLEL_ENABLED', 'true')
  let releaseCalendar!: (value: { data: Record<string, unknown>[]; error: null }) => void
  state.calendarResponses.push(new Promise(resolve => { releaseCalendar = resolve }))
  const { result, rerender } = renderHook(({ enabled }) => useStore(enabled, 'user', 'Volunteer', 'window:2026-10-01:2026-10-31'), { initialProps: { enabled: true } })
  await waitFor(() => expect(state.reads).toContain('app_settings'))
  rerender({ enabled: false })
  await act(async () => { releaseCalendar({ data: [], error: null }) })
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)) })
  expect(result.current.recipientBaseReady).toBe(false)
})

// 0173: a first snapshot whose discovery waits for the service calendar (나의 봉사 start)
// still starts its non-territory slices right after the calendar.
test.each([undefined, 'full'])('sequential first snapshot (scope %s) opens its base part before personal territory', async scope => {
  vi.stubEnv('VITE_RECIPIENT_INITIAL_PARALLEL_ENABLED', 'true')
  let releaseBuildings!: () => void
  state.recipientDetails = new Promise(resolve => { releaseBuildings = resolve })
  const { result } = renderHook(() => useStore(true, 'user', 'Volunteer', scope))
  await waitFor(() => expect(result.current.recipientBaseReady).toBe(true))
  expect(state.reads).toContain('return_visits')
  expect(state.reads).toContain('app_settings')
  expect(state.reads).not.toContain('cards')
  expect(result.current.loading).toBe(true)
  expect(result.current.buildingScopeReady).toBe(false)
  await act(async () => { releaseBuildings() })
  await waitFor(() => expect(result.current.loading).toBe(false))
  expect(result.current.buildingScopeReady).toBe(true)
  // Every slice is still read exactly once.
  for (const table of ['return_visits', 'app_settings', 'calendar_events']) expect(state.reads.filter(name => name === table)).toHaveLength(1)
})

test('a later full refresh keeps the old order: no base part, no early slices', async () => {
  const { result } = renderHook(() => useStore(true, 'user', 'Volunteer', 'full'))
  await waitFor(() => expect(result.current.loading).toBe(false))
  let releaseBuildings!: () => void
  state.recipientDetails = new Promise(resolve => { releaseBuildings = resolve })
  state.reads = []
  const refresh = act(async () => { await result.current.refetchAll() })
  await waitFor(() => expect(state.reads).toContain('calendar_events'))
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)) })
  expect(state.reads).not.toContain('return_visits')
  releaseBuildings()
  await refresh
  expect(state.reads).toContain('return_visits')
})

test.each([undefined, 'window:2026-10-01:2026-10-31'])('base part waits for every base slice, not only the calendar (scope %s)', async scope => {
  enableScopedHistories()
  vi.stubEnv('VITE_CALENDAR_WINDOW_ENABLED', 'true')
  vi.stubEnv('VITE_RECIPIENT_INITIAL_PARALLEL_ENABLED', 'true')
  let releaseReturns!: () => void
  state.returnHold = new Promise(resolve => { releaseReturns = resolve })
  const { result } = renderHook(() => useStore(true, 'user', 'Volunteer', scope))
  await waitFor(() => expect(state.reads).toContain('return_visits'))
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)) })
  expect(result.current.recipientBaseReady).toBe(false)
  await act(async () => { releaseReturns() })
  await waitFor(() => expect(result.current.recipientBaseReady || !result.current.loading).toBe(true))
  await waitFor(() => expect(result.current.loading).toBe(false))
})

test('the first snapshot is complete only after its early base slices, even when territory finishes first', async () => {
  let releaseReturns!: () => void
  state.returnHold = new Promise(resolve => { releaseReturns = resolve })
  const { result } = renderHook(() => useStore(true, 'user', 'Volunteer', 'full'))
  await waitFor(() => expect(state.reads).toContain('cards'))
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)) })
  expect(result.current.loading).toBe(true)
  expect(result.current.buildingScopeReady).toBe(false)
  await act(async () => { releaseReturns() })
  await waitFor(() => expect(result.current.loading).toBe(false))
  expect(result.current.buildingScopeReady).toBe(true)
})

test('a sequential base part that answers after sign-out never marks the signed-out store ready', async () => {
  let releaseReturns!: () => void
  state.returnHold = new Promise(resolve => { releaseReturns = resolve })
  const { result, rerender } = renderHook(({ enabled }) => useStore(enabled, 'user', 'Volunteer', 'full'), { initialProps: { enabled: true } })
  await waitFor(() => expect(state.reads).toContain('return_visits'))
  rerender({ enabled: false })
  await act(async () => { releaseReturns() })
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)) })
  expect(result.current.recipientBaseReady).toBe(false)
})

// Codex 0173 review: a failed first snapshot surfaces only after every read it started.
test.each([
  ['an early base slice fails while personal territory is pending', 'return_visits', 'cards'],
  ['a personal territory slice fails while an early base slice is pending', 'cards', 'return_visits'],
] as const)('sequential failure: %s', async (_label, failing, held) => {
  let release!: () => void
  const hold = new Promise<void>(resolve => { release = resolve })
  if (held === 'cards') state.cardHold = hold
  else state.returnHold = hold
  state.failedTable = failing
  const { result } = renderHook(() => useStore(true, 'user', 'Volunteer', 'full'))
  await waitFor(() => expect(state.reads).toContain(held))
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)) })
  // Still waiting for the held read: no error, no completion yet.
  expect(result.current.error).toBeNull()
  expect(result.current.loading).toBe(true)
  await act(async () => { release() })
  await waitFor(() => expect(result.current.error).not.toBeNull())
  expect(result.current.loading).toBe(false)
  expect(result.current.buildingScopeReady).toBe(false)
  state.cardHold = null
})

// Codex 0173 review: the session is taken before the first await of the snapshot.
test('a parallel snapshot whose clock answers after sign-out never marks the store ready', async () => {
  enableScopedHistories()
  vi.stubEnv('VITE_CALENDAR_WINDOW_ENABLED', 'true')
  vi.stubEnv('VITE_RECIPIENT_INITIAL_PARALLEL_ENABLED', 'true')
  let releaseClock!: (value: string) => void
  state.clock.mockReset().mockReturnValue(new Promise(resolve => { releaseClock = resolve }))
  const { result, rerender } = renderHook(({ enabled }) => useStore(enabled, 'user', 'Volunteer', 'window:2026-10-01:2026-10-31'), { initialProps: { enabled: true } })
  await waitFor(() => expect(state.clock).toHaveBeenCalled())
  rerender({ enabled: false })
  await act(async () => { releaseClock('2026-10-05T00:00:00Z') })
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)) })
  expect(result.current.recipientBaseReady).toBe(false)
  expect(result.current.buildingScopeReady).toBe(false)
})

test('a sequential snapshot whose calendar answers after sign-out never marks the store ready', async () => {
  let releaseCalendar!: (value: { data: Record<string, unknown>[]; error: null }) => void
  state.calendarResponses.push(new Promise(resolve => { releaseCalendar = resolve }))
  const { result, rerender } = renderHook(({ enabled }) => useStore(enabled, 'user', 'Volunteer', 'full'), { initialProps: { enabled: true } })
  await waitFor(() => expect(state.reads).toContain('calendar_events'))
  rerender({ enabled: false })
  await act(async () => { releaseCalendar({ data: [], error: null }) })
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)) })
  expect(result.current.recipientBaseReady).toBe(false)
  expect(result.current.buildingScopeReady).toBe(false)
})

test('personal territory that answers after sign-out never marks the store territory-ready', async () => {
  let releaseBuildings!: () => void
  state.recipientDetails = new Promise(resolve => { releaseBuildings = resolve })
  const { result, rerender } = renderHook(({ enabled }) => useStore(enabled, 'user', 'Volunteer', 'full'), { initialProps: { enabled: true } })
  await waitFor(() => expect(result.current.recipientBaseReady).toBe(true))
  rerender({ enabled: false })
  await act(async () => { releaseBuildings() })
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)) })
  expect(result.current.buildingScopeReady).toBe(false)
})
