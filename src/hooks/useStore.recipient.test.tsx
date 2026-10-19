import { StrictMode } from 'react'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { useStore } from './useStore'
import type { RawBuilding } from './storeTransforms'

const state = vi.hoisted(() => ({
  returnRows: [] as Record<string, unknown>[], returnLogs: [] as Record<string, unknown>[],
  failedTable: '',
  requests: [] as Record<string, unknown>[],
  requestFilters: [] as unknown[][],
  unitParent: 20, insertError: false, unitLookupError: false,
  historyColumns: [] as string[],
  sessions: [] as Record<string, unknown>[], sessionFilters: [] as unknown[][],
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
  rpc: () => Promise.resolve({ data: { ok: true }, error: null }),
  from: (table: string) => {
    let lookup = false
    let writing = false
    let range: [number, number] = [0, 999]
    const filters: [string, unknown][] = []
    const q: Record<string, unknown> = {}
    for (const name of ['select', 'order', 'range', 'eq', 'in', 'is', 'gte', 'lte', 'neq', 'update', 'insert']) q[name] = () => q
    q.select = (columns: string) => { if (table === 'visit_histories') state.historyColumns.push(columns); return q }
    q.insert = () => { writing = true; return q }
    q.update = () => { writing = true; return q }
    q.single = () => {
      state.reads.push(table)
      return Promise.resolve({ data: table === 'service_sessions' ? { id: 777 } : { id: filters.find(([key]) => key === 'id')?.[1], building_id: state.unitParent }, error: state.unitLookupError ? new Error('offline') : null })
    }
    q.eq = (key: string, value: unknown) => { filters.push([key, value]); return q }
    q.range = (from: number, to: number) => { range = [from, to]; return q }
    q.limit = () => { lookup = true; return q }
    q.then = async (resolve: (value: unknown) => void) => {
      state.reads.push(writing ? `${table}:insert` : table)
      if (table === 'service_sessions') state.sessionFilters.push(filters)
      if (table === 'restaurant_requests' && !writing) state.requestFilters.push(filters)
      const data = table === 'cards' ? lookup ? [{ id: 1 }] : [1, 2].map((id) => ({ id, name: `card${id}`, card_assignments: [], type: '전체', area: '', region: '', status: '미배정' }))
        : table === 'visit_histories' ? [{ id: 900, unit_id: 900, visitor_name: 'other', result: '부재', visited_at: '2026-10-05', created_at: '2026-10-05T00:00:00Z', visit_type: 'restaurant' }]
        : table === 'return_visits' ? state.returnRows
        : table === 'return_visit_logs' ? state.returnLogs
        : table === 'restaurant_requests' ? writing ? [{ id: 61 }] : state.requests.filter(row => filters.every(([key, value]) => row[key] === value))
        : table === 'service_sessions' ? state.sessions.filter((row) => filters.every(([key, value]) => row[key] === value)).slice(range[0], range[1] + 1) : []
      return resolve({ data, error: (!writing && table === state.failedTable) || (writing && state.insertError) ? new Error('offline') : null })
    }
    return q
  },
} }))

const building: RawBuilding = { id: 10, card_id: 1, name: 'assigned', address: 'test', type: '주택', lat: 1, lng: 1, warning: false, memo: null,
  units: [{ id: 100, building_id: 10, number: '101', status: '미방문', is_chinese: true, memo: null, regular_visits: [] }] }
beforeEach(() => {
  state.returnRows = []; state.returnLogs = []
  state.failedTable = ''
  state.requests = []
  state.requestFilters = []
  state.unitParent = 20; state.insertError = false; state.unitLookupError = false; state.historyColumns = []
  state.sessions = []; state.sessionFilters = []
  state.changed.mockReset()
  state.unchanged.mockResolvedValue(null); state.recover.mockReset(); state.boundaries.mockResolvedValue([])
  state.buildings = [building]; state.allowed = [1]; state.reads = []
  state.summaries.mockResolvedValue([{ id: 1, units: 1, completed: 0, progress: 0 }, { id: 2, units: 50, completed: 25, progress: 50 }])
})
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.restoreAllMocks(); vi.unstubAllEnvs(); localStorage.clear() })

test.each((['true', 'false'] as const).flatMap(demo =>
  (['user', 'admin', 'developer'] as const).map(role => ({ demo, role }))))('pending request query preserves production and removes reviewed rows on refresh ($demo, $role)', async ({ demo, role }) => {
  vi.stubEnv('VITE_DEMO_MODE', demo)
  state.requests = [
    { id: 61, name: 'pending', status: 'pending' },
    { id: 62, name: 'approved', status: 'approved' },
    { id: 63, name: 'rejected', status: 'rejected' },
  ]
  const { result } = renderHook(() => useStore(true, role, role === 'user' ? 'Volunteer' : undefined))
  await waitFor(() => expect(result.current.loading).toBe(false))
  expect(state.requestFilters).toEqual([demo === 'true' ? [['status', 'pending']] : []])
  expect(result.current.restaurantRequests.map(r => r.id)).toEqual(demo === 'true' ? [61] : [61, 62, 63])
  state.requests[0] = { ...state.requests[0], status: 'rejected' }
  await act(async () => { await result.current.refetchSlices(['restaurantRequests']) })
  expect(result.current.restaurantRequests.map(r => r.id)).toEqual(demo === 'true' ? [] : [61, 62, 63])
  expect(state.requestFilters).toEqual(Array.from({ length: 2 }, () => demo === 'true' ? [['status', 'pending']] : []))
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
    if (kind === 'memo') await expect(result.current.updateRestaurantRequestMemo(61, 'edited')).resolves.toBeUndefined()
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
