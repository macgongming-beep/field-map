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
  creationAction: '' as '' | 'created' | 'existing',
  returnRows: [] as Record<string, unknown>[], returnLogs: [] as Record<string, unknown>[],
  failedTable: '',
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
  buildings: [] as unknown[], reads: [] as string[], allowed: [1], changed: vi.fn(), summaries: vi.fn(), refresh: vi.fn(), unchanged: vi.fn(), recover: vi.fn(), boundaries: vi.fn(),
}))
vi.mock('../lib/recipientStore', async importOriginal => ({ ...await importOriginal<typeof import('../lib/recipientStore')>(), createRecipientStoreReader: () => ({
  resume: vi.fn(), dispose: vi.fn(), refresh: state.refresh,
  unchangedScope: state.unchanged,
  validateCards: (ids: number[]) => { if (state.allowed.some((id) => !ids.includes(id))) throw new Error('A requested card is unavailable') },
  read: async () => ({ buildings: state.buildings, boundaries: state.allowed.map((card_id) => ({ card_id, points: [{ lat: 1, lng: 1 }, { lat: 2, lng: 1 }, { lat: 2, lng: 2 }] })) }),
  get scoped() { return true }, allowsCard: (id: number) => state.allowed.includes(id),
  cardIds: () => [...state.allowed],
}) }))
vi.mock('../lib/cardSummaries', () => ({ fetchCardSummaries: state.summaries }))
vi.mock('./recipientRecovery', () => ({ recoverRecipientBuildings: state.recover, readRecipientBoundaries: state.boundaries }))
vi.mock('./territorySync', () => ({ fetchChangedBuildings: state.changed, fetchTerritoryClock: async () => '2026-10-05T00:00:00Z' }))
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
    for (const name of ['select', 'order', 'range', 'eq', 'in', 'is', 'gte', 'lte', 'neq', 'update', 'insert']) q[name] = () => q
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
        return resolve(await state.calendarResponses.shift())
      }
      if (table === 'cards' && !lookup) state.cardFilters.push(filters)
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
  // Unrelated store fixtures use full cards; scoped-card tests opt in explicitly.
  vi.stubEnv('VITE_RECIPIENT_CARD_SCOPE_ENABLED', 'false')
  vi.stubEnv('VITE_SCOPED_VISIT_HISTORY_ENABLED', 'false')
  state.historyRows = [{ id: 900, unit_id: 900, visitor_name: 'other', result: '부재', visited_at: '2026-10-05', created_at: '2026-10-05T00:00:00Z', visit_type: 'restaurant' }]
  state.historyFilters = []; state.historyResponse = null
  state.creationAction = ''
  state.cardColumns = []
  state.cardFilters = []; state.ignoreCardFilter = false
  state.missingLeaderTable = false
  state.returnRows = []; state.returnLogs = []
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

function enableScopedHistories() {
  vi.stubEnv('VITE_DEMO_MODE', 'true')
  vi.stubEnv('VITE_SCOPED_VISIT_HISTORY_ENABLED', 'true')
  state.historyRows.push({ ...state.historyRows[0], id: 901, unit_id: 100, visitor_name: 'Another visitor' })
}

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

test('scoped cards reject foreign response rows rather than trusting the server filter', async () => {
  vi.stubEnv('VITE_DEMO_MODE', 'true'); vi.stubEnv('VITE_RECIPIENT_CARD_SCOPE_ENABLED', 'true')
  state.ignoreCardFilter = true
  const { result } = renderHook(() => useStore(true, 'user', 'Volunteer'))
  await waitFor(() => expect(result.current.loading).toBe(false))
  expect(result.current.error).not.toBeNull()
  expect(result.current.cards).toEqual([])
  expect(state.summaries).not.toHaveBeenCalled()
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
