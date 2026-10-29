import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { useStore } from './useStore'
import { SupersededReadError } from './supersededRead'
import { calendarReadScope, calendarWindowEnabled } from './calendarReadScope'
import { useCalendarRealtime } from './useCalendarRealtime'

const state = vi.hoisted(() => ({ callbacks: new Map<string, (payload?: unknown) => void>(), participants: vi.fn(), scoped: vi.fn(), reads: [] as string[], events: [] as unknown[], assignments: [] as unknown[], failure: '', pendingFull: null as Promise<unknown> | null, pendingResource: null as Promise<unknown> | null }))
vi.mock('./calendarParticipants', () => ({ readCalendarParticipants: state.participants }))
vi.mock('./calendarReadScope', async importOriginal => ({ ...await importOriginal<typeof import('./calendarReadScope')>(), readScopedCalendar: state.scoped }))
vi.mock('../lib/supabase', () => ({ supabase: {
  channel: () => {
    const channel = {
      on: (_kind: string, filter: { table: string }, callback: () => void) => { state.callbacks.set(filter.table, callback); return channel },
      subscribe: vi.fn(),
    }
    return channel
  },
  removeChannel: vi.fn(),
  rpc: () => Promise.resolve({ data: null, error: null }),
  from: (table: string) => {
    const q: Record<string, unknown> = {}
    let lookup = false
    for (const key of ['select', 'order', 'range', 'eq', 'in', 'is', 'gte', 'lte', 'neq', 'update', 'delete', 'insert']) q[key] = () => q
    q.limit = () => { lookup = true; return q }
    q.then = (resolve: (value: unknown) => void) => {
      state.reads.push(table)
      if (table === 'informal_assets' && state.pendingResource) return state.pendingResource.then(resolve)
      if (table === 'calendar_events' && state.pendingFull) { const pending = state.pendingFull; state.pendingFull = null; return pending.then(resolve) }
      return Promise.resolve({ data: lookup ? [{ id: 1 }] : table === 'calendar_events' ? state.events : table === 'event_card_assignments' ? state.assignments : [], error: table === state.failure ? new Error('offline') : null }).then(resolve)
    }
    return q
  },
} }))
const old = { id: 1, event_date: '2026-08-02', title: 'Old', time: '10:00', event_participants: [{ user_name: 'A', role: '신청' }] }
beforeEach(() => { state.reads = []; state.events = [old]; state.assignments = []; state.failure = ''; state.pendingFull = null; state.pendingResource = null; state.participants.mockReset().mockResolvedValue(new Map()); state.scoped.mockReset().mockResolvedValue([]); vi.stubEnv('VITE_DEMO_MODE', 'true'); vi.stubEnv('VITE_CALENDAR_WINDOW_ENABLED', undefined) })
afterEach(() => { cleanup(); state.callbacks.clear(); vi.useRealTimers(); vi.unstubAllEnvs() })

test('home first load and foreground keep calendar scoped; statistics route restores complete history', async () => {
  const { result, rerender } = renderHook(({ scope }) => useStore(true, 'admin', undefined, scope), { initialProps: { scope: 'since:2026-10-09' } })
  await waitFor(() => expect(result.current.loading).toBe(false))
  expect(result.current.error).toBeNull()
  expect(state.scoped).toHaveBeenCalledWith('since:2026-10-09')
  expect(state.reads).not.toContain('calendar_events')
  await act(async () => { await result.current.refetchSlices(['calendar'], { triggeredBy: 'foreground' }) })
  expect(state.scoped).toHaveBeenCalledTimes(2)
  state.reads = []
  rerender({ scope: 'full' })
  expect(result.current.calendarScopeReady).toBe(false)
  await waitFor(() => expect(result.current.calendarScopeReady).toBe(true))
  expect(result.current.calendarEvents[0].applicants).toEqual(['A'])
  expect(state.reads).toEqual(['calendar_events', 'event_card_assignments', 'event_card_assignment_cards'])
})
test('production ignores a requested date scope', async () => {
  vi.stubEnv('VITE_DEMO_MODE', 'false')
  const { result } = renderHook(() => useStore(true, 'admin', undefined, 'since:2026-10-09'))
  await waitFor(() => expect(result.current.loading).toBe(false))
  expect(state.scoped).not.toHaveBeenCalled()
  expect(result.current.calendarEvents[0].applicants).toEqual(['A'])
})
test.each([
  { flag: 'true', demo: 'false', scoped: true },
  { flag: 'false', demo: 'true', scoped: false },
])('calendar window flag $flag overrides demo $demo', async ({ flag, demo, scoped }) => {
  vi.stubEnv('VITE_CALENDAR_WINDOW_ENABLED', flag)
  vi.stubEnv('VITE_DEMO_MODE', demo)
  const { result, rerender } = renderHook(({ scope }) => useStore(true, 'admin', undefined, scope), { initialProps: { scope: 'since:2026-10-09' } })
  await waitFor(() => expect(result.current.loading).toBe(false))
  expect(state.scoped.mock.calls.length > 0).toBe(scoped)
  if (scoped) expect(state.reads).not.toContain('calendar_events')
  else expect(result.current.calendarEvents[0].applicants).toEqual(['A'])
  rerender({ scope: 'full' })
  await waitFor(() => expect(result.current.calendarScopeReady).toBe(true))
  expect(result.current.calendarEvents[0].applicants).toEqual(['A'])
})
test('admin home to allocation adds no calendar read; save refreshes cards and foreground stays scoped', async () => {
  const now = new Date('2026-10-23T12:00:00')
  const { result, rerender } = renderHook(({ path }) => useStore(true, 'admin', undefined,
    calendarReadScope(path, '', '', false, 'true', now, 'admin')), { initialProps: { path: '/' } })
  await waitFor(() => expect(result.current.loading).toBe(false))
  state.reads = []
  rerender({ path: '/assignment' })
  expect(result.current.calendarScopeReady).toBe(true)
  expect(state.scoped).toHaveBeenCalledTimes(1)
  await act(async () => { await result.current.setCardLeaders(1, ['Leader']) })
  expect(state.reads).toContain('cards')
  expect(state.reads).not.toContain('calendar_events')
  expect(state.reads).not.toContain('event_card_assignments')
  expect(state.scoped).toHaveBeenCalledTimes(1)
  await act(async () => { await result.current.refetchSlices(['calendar'], { triggeredBy: 'foreground' }) })
  expect(state.scoped).toHaveBeenLastCalledWith('window:2026-10-09:2026-11-30')
  expect(state.scoped).toHaveBeenCalledTimes(2)
  rerender({ path: '/stats' })
  await waitFor(() => expect(result.current.calendarScopeReady).toBe(true))
  expect(result.current.calendarEvents[0].applicants).toEqual(['A'])
})
test('failed old-month read remains not ready and can be retried', async () => {
  const { result, rerender } = renderHook(({ scope }) => useStore(true, 'admin', undefined, scope), { initialProps: { scope: 'since:2026-10-09' } })
  await waitFor(() => expect(result.current.loading).toBe(false))
  state.scoped.mockRejectedValueOnce(new Error('offline'))
  rerender({ scope: 'since:2026-08-01' })
  await waitFor(() => expect(result.current.calendarReadError).toBe(true))
  expect(result.current.calendarScopeReady).toBe(false)
  await act(async () => { await result.current.retryCalendarRead() })
  expect(result.current.calendarReadError).toBe(false)
  expect(result.current.calendarScopeReady).toBe(true)
})
test('late home read cannot overwrite an old-month or full-history snapshot', async () => {
  const { result, rerender } = renderHook(({ scope }) => useStore(true, 'admin', undefined, scope), { initialProps: { scope: 'since:2026-10-09' } })
  await waitFor(() => expect(result.current.loading).toBe(false))
  let release!: (value: never[]) => void
  state.scoped.mockReturnValueOnce(new Promise(resolve => { release = resolve }))
  let stale!: Promise<unknown>
  act(() => { stale = result.current.retryCalendarRead().catch(error => error) })
  rerender({ scope: 'full' })
  await waitFor(() => expect(result.current.calendarScopeReady).toBe(true))
  await act(async () => { release([]); expect(await stale).toBeInstanceOf(SupersededReadError) })
  expect(result.current.calendarEvents[0].applicants).toEqual(['A'])
})

test('scope guard remains active with targeted-edit flag explicitly disabled', async () => {
  vi.stubEnv('VITE_CALENDAR_EVENT_REFRESH_ENABLED', 'false')
  const { result, rerender } = renderHook(({ scope }) => useStore(true, 'admin', undefined, scope), { initialProps: { scope: 'full' } })
  await waitFor(() => expect(result.current.loading).toBe(false))
  let release!: (value: unknown) => void
  state.pendingFull = new Promise(resolve => { release = resolve })
  let stale!: Promise<unknown>
  act(() => { stale = result.current.retryCalendarRead().catch(error => error) })
  await waitFor(() => expect(state.pendingFull).toBeNull())
  rerender({ scope: 'since:2026-10-09' })
  await waitFor(() => expect(result.current.calendarScopeReady).toBe(true))
  await act(async () => { release({ data: [old], error: null }); expect(await stale).toBeInstanceOf(SupersededReadError) })
  expect(result.current.calendarEvents).toEqual([])
  expect(result.current.calendarScopeReady).toBe(true)
})
test.each(['event_card_assignments', 'event_card_assignment_cards'])('full read with failed %s does not unlock export/statistics gate', async table => {
  const { result, rerender } = renderHook(({ scope }) => useStore(true, 'admin', undefined, scope), { initialProps: { scope: 'since:2026-10-09' } })
  await waitFor(() => expect(result.current.loading).toBe(false))
  state.failure = table
  rerender({ scope: 'full' })
  await waitFor(() => expect(result.current.calendarReadError).toBe(true))
  expect(result.current.calendarScopeReady).toBe(false)
  state.failure = ''
  await act(async () => { await result.current.retryCalendarRead() })
  expect(result.current.calendarEvents[0].applicants).toEqual(['A'])
})
test('route change during initial read completes a replacement without permanent application error', async () => {
  let release!: (value: never[]) => void
  state.scoped.mockReturnValueOnce(new Promise(resolve => { release = resolve }))
  const { result, rerender } = renderHook(({ scope }) => useStore(true, 'admin', undefined, scope), { initialProps: { scope: 'since:2026-10-09' } })
  await waitFor(() => expect(state.scoped).toHaveBeenCalledTimes(1))
  rerender({ scope: 'full' })
  await waitFor(() => expect(result.current.calendarScopeReady).toBe(true))
  await act(async () => { release([]) })
  await waitFor(() => expect(result.current.loading).toBe(false))
  expect(result.current.error).toBeNull()
  expect(result.current.calendarEvents[0].applicants).toEqual(['A'])
})

test('stalled month transition exposes retry after the load deadline', async () => {
  const { result, rerender } = renderHook(({ scope }) => useStore(true, 'admin', undefined, scope), { initialProps: { scope: 'since:2026-10-09' } })
  await waitFor(() => expect(result.current.loading).toBe(false))
  vi.useFakeTimers()
  state.scoped.mockReturnValueOnce(new Promise(() => {}))
  rerender({ scope: 'since:2026-08-01' })
  await act(async () => { await vi.advanceTimersByTimeAsync(45_001) })
  expect(result.current.calendarReadError).toBe(true)
  expect(result.current.calendarScopeReady).toBe(false)
  await act(async () => { await result.current.retryCalendarRead() })
  expect(result.current.calendarReadError).toBe(false)
  expect(result.current.calendarScopeReady).toBe(true)
})

test('two superseded initial snapshots recover without a permanent application error', async () => {
  state.scoped.mockRejectedValueOnce(new SupersededReadError('calendar'))
    .mockRejectedValueOnce(new SupersededReadError('calendar'))
  const { result } = renderHook(() => useStore(true, 'admin', undefined, 'since:2026-10-09'))
  await waitFor(() => expect(result.current.loading).toBe(false))
  expect(state.scoped).toHaveBeenCalledTimes(3)
  expect(result.current.error).toBeNull()
  expect(result.current.calendarScopeReady).toBe(true)
})

test('returning to a recent month reuses its participants without a network wait', async () => {
  const august = 'window:2026-08-01:2026-08-31'
  const october = 'window:2026-10-01:2026-10-31'
  state.scoped.mockResolvedValueOnce([{ id: 7, applicants: ['A', 'Guest'], cardAssignments: [] }]).mockResolvedValueOnce([])
  const { result, rerender } = renderHook(({ scope }) => useStore(true, 'admin', undefined, scope), { initialProps: { scope: august } })
  await waitFor(() => expect(result.current.loading).toBe(false))
  rerender({ scope: october })
  await waitFor(() => expect(result.current.calendarScopeReady).toBe(true))
  rerender({ scope: august })
  await waitFor(() => expect(result.current.calendarScopeReady).toBe(true))
  expect(result.current.calendarEvents[0].applicants).toEqual(['A', 'Guest'])
  expect(state.scoped).toHaveBeenCalledTimes(2)
})

test.each(['foreground', 'realtime:calendar', 'mutation:calendar', 'fetchAll'])('%s invalidates other cached months', async triggeredBy => {
  const august = 'window:2026-08-01:2026-08-31'
  const october = 'window:2026-10-01:2026-10-31'
  const { result, rerender } = renderHook(({ scope }) => useStore(true, 'admin', undefined, scope), { initialProps: { scope: august } })
  await waitFor(() => expect(result.current.loading).toBe(false))
  rerender({ scope: october })
  await waitFor(() => expect(result.current.calendarScopeReady).toBe(true))
  await act(async () => { await result.current.refetchSlices(['calendar'], { triggeredBy }) })
  rerender({ scope: august })
  await waitFor(() => expect(result.current.calendarScopeReady).toBe(true))
  expect(state.scoped).toHaveBeenCalledTimes(4)
})

test('expired month is fetched again instead of displaying a stale cached snapshot', async () => {
  const clock = vi.spyOn(Date, 'now').mockReturnValue(1000000)
  try {
    const { result, rerender } = renderHook(({ scope }) => useStore(true, 'admin', undefined, scope), { initialProps: { scope: 'window:2026-08-01:2026-08-31' } })
    await waitFor(() => expect(result.current.loading).toBe(false))
    rerender({ scope: 'window:2026-10-01:2026-10-31' })
    await waitFor(() => expect(result.current.calendarScopeReady).toBe(true))
    clock.mockReturnValue(1120001)
    rerender({ scope: 'window:2026-08-01:2026-08-31' })
    await waitFor(() => expect(result.current.calendarScopeReady).toBe(true))
    expect(state.scoped).toHaveBeenCalledTimes(3)
  } finally { clock.mockRestore() }
})

test.each(['/territory', '/map'])('home round trips to %s retain old/future and other-team assignments (current full-read baseline)', async path => {
  const now = new Date('2026-10-23T12:00:00')
  state.events = [old, { ...old, id: 2, event_date: '2027-08-08' }]
  state.assignments = [
    { id: 1, event_id: 1, user_name: 'A', assigned_card_id: 10, team_key: 'mine' },
    { id: 2, event_id: 1, user_name: 'Other team', assigned_card_id: 20, team_key: 'other' },
    { id: 3, event_id: 2, user_name: 'A', assigned_card_id: 30, team_key: 'future' },
  ]
  const { result, rerender } = renderHook(({ route }) => useStore(true, 'user', undefined,
    calendarReadScope(route, route === '/map' ? '?assignmentMap=1' : '', '', false, 'true', now, 'user')),
  { initialProps: { route: '/' } })
  await waitFor(() => expect(result.current.loading).toBe(false))
  for (let trip = 0; trip < 2; trip += 1) {
    state.reads = []
    rerender({ route: path })
    await waitFor(() => expect(result.current.calendarScopeReady).toBe(true))
    expect(state.reads).toEqual(['calendar_events', 'event_card_assignments', 'event_card_assignment_cards'])
    expect(result.current.calendarEvents.map(event => event.date)).toEqual(['2026-08-02', '2027-08-08'])
    expect(result.current.calendarEvents[0].cardAssignments).toEqual(expect.arrayContaining([
      expect.objectContaining({ userName: 'A', assignedCardId: 10, teamKey: 'mine' }),
      expect.objectContaining({ userName: 'Other team', assignedCardId: 20, teamKey: 'other' }),
    ]))
    expect(result.current.calendarEvents[1].cardAssignments[0].assignedCardId).toBe(30)
    state.reads = []
    rerender({ route: '/' })
    await waitFor(() => expect(result.current.calendarScopeReady).toBe(true))
    expect(state.reads).toEqual([])
    expect(state.scoped).toHaveBeenCalledTimes(1)
  }
})

test.each([
  ['user', '/territory'], ['user', '/map'], ['leader', '/territory'], ['leader', '/map'],
] as const)('%s %s round trips reuse the complete shared event snapshot without full reads', async (role, path) => {
  const now = new Date('2026-10-23T12:00:00')
  const personal = [{ id: 1, date: '2026-08-02', applicants: ['A'], cardAssignments: [
    { userName: 'A', assignedCardId: 10 }, { userName: 'Other team', assignedCardId: 20 },
  ] }, { id: 2, date: '2027-08-08', applicants: [], cardAssignments: [{ userName: 'A', assignedCardId: 30 }] }]
  state.scoped.mockImplementation(async scope => scope.startsWith('service:') ? personal : [])
  const { result, rerender } = renderHook(({ route }) => useStore(true, role, undefined,
    calendarReadScope(route, path === '/map' && route === path ? '?assignmentMap=1' : '', '', false, 'true', now, role, 'A')),
  { initialProps: { route: '/' } })
  await waitFor(() => expect(result.current.loading).toBe(false))
  state.reads = []
  for (let trip = 0; trip < 2; trip += 1) {
    rerender({ route: path })
    await waitFor(() => expect(result.current.calendarScopeReady).toBe(true))
    expect(result.current.calendarEvents).toEqual(personal)
    rerender({ route: '/' })
    await waitFor(() => expect(result.current.calendarScopeReady).toBe(true))
  }
  expect(state.scoped).toHaveBeenCalledTimes(2)
  expect(state.reads).toEqual([])
})

test('leader home-zone-map-service round trips share one complete team snapshot without full calendar promotion', async () => {
  vi.stubEnv('VITE_DEMO_MODE', undefined)
  vi.stubEnv('VITE_CALENDAR_WINDOW_ENABLED', 'true')
  const now = new Date('2026-10-23T12:00:00')
  const teams = [{ id: 1, date: '2026-08-02', applicants: ['A', 'Other'], cardAssignments: [
    { userName: 'A', assignedCardId: 10 }, { userName: 'Other', assignedCardId: 20 },
  ] }]
  state.scoped.mockImplementation(async scope => scope.startsWith('service:') ? teams : [])
  const { result, rerender } = renderHook(({ route }) => useStore(true, 'leader', undefined,
    calendarReadScope(route, '', '', false, calendarWindowEnabled() ? 'true' : 'false', now, 'leader', 'A')), { initialProps: { route: '/' } })
  await waitFor(() => expect(result.current.loading).toBe(false))
  state.reads = []
  for (const route of ['/zone', '/map', '/territory', '/', '/zone', '/map']) {
    rerender({ route })
    await waitFor(() => expect(result.current.calendarScopeReady).toBe(true))
    if (route !== '/') expect(result.current.calendarEvents).toEqual(teams)
  }
  expect(state.scoped).toHaveBeenCalledTimes(2)
  expect(state.reads).toEqual([])
})

test.each(['foreground', 'realtime:calendar', 'mutation:calendar', 'fetchAll'])('%s invalidates the personal service cache as well as the home cache', async triggeredBy => {
  const service = 'service:["A","2026-10-23",null]'
  const home = 'window:2026-10-09:2026-11-30'
  const { result, rerender } = renderHook(({ scope }) => useStore(true, 'user', undefined, scope), { initialProps: { scope: service } })
  await waitFor(() => expect(result.current.loading).toBe(false))
  rerender({ scope: home })
  await waitFor(() => expect(result.current.calendarScopeReady).toBe(true))
  await act(async () => { await result.current.refetchSlices(['calendar'], { triggeredBy }) })
  rerender({ scope: service })
  await waitFor(() => expect(result.current.calendarScopeReady).toBe(true))
  expect(state.scoped).toHaveBeenCalledTimes(4)
})

test('changing role clears personal snapshots before returning to the same scope', async () => {
  const service = 'service:["A","2026-10-23",null]'
  const { result, rerender } = renderHook(({ role, scope }: { role: 'user' | 'leader'; scope: string }) => useStore(true, role, undefined, scope),
    { initialProps: { role: 'user', scope: service } })
  await waitFor(() => expect(result.current.loading).toBe(false))
  rerender({ role: 'leader', scope: 'full' })
  await waitFor(() => expect(result.current.calendarScopeReady).toBe(true))
  const readsBeforeReturn = state.scoped.mock.calls.length
  rerender({ role: 'user', scope: service })
  await waitFor(() => expect(result.current.calendarScopeReady).toBe(true))
  expect(state.scoped.mock.calls.length).toBeGreaterThan(readsBeforeReturn)
  expect(state.scoped).toHaveBeenLastCalledWith(service)
})

test.each((['user', 'leader', 'admin', 'developer'] as const).flatMap(role =>
  ['/map', '/territory', '/zone'].map(path => ({ role, path }))))('production calendar gate preserves role boundaries: $role $path', async ({ role, path }) => {
  vi.stubEnv('VITE_DEMO_MODE', 'false')
  vi.stubEnv('VITE_CALENDAR_WINDOW_ENABLED', 'true')
  const query = path === '/map' ? '?assignmentMap=1' : path === '/territory' ? '?assignmentEvent=1' : ''
  const scope = calendarReadScope(path, query, '', false,
    calendarWindowEnabled() ? 'true' : 'false', new Date('2026-10-23T12:00:00'), role, 'A')
  const { result } = renderHook(() => useStore(true, role, undefined, scope))
  await waitFor(() => expect(result.current.loading).toBe(false))
  if (role === 'leader' || (role === 'user' && path !== '/zone')) {
    expect(scope).toBe(`service:["A","2026-10-23",${path === '/zone' ? 'null' : '1'}]`)
    expect(state.scoped).toHaveBeenCalledWith(scope)
    expect(state.reads).not.toContain('calendar_events')
  } else {
    expect(scope).toBe('full')
    expect(state.scoped).not.toHaveBeenCalled()
    expect(result.current.calendarEvents[0].applicants).toEqual(['A'])
  }
})

test.each((['user', 'leader'] as const).flatMap(role =>
  ['/map', '/territory', '/zone'].map(path => ({ role, path }))))('production flag off restores full reads: $role $path', async ({ role, path }) => {
  vi.stubEnv('VITE_DEMO_MODE', 'false')
  vi.stubEnv('VITE_CALENDAR_WINDOW_ENABLED', 'false')
  const scope = calendarReadScope(path, '', '', false,
    calendarWindowEnabled() ? 'true' : 'false', undefined, role, 'A')
  const { result } = renderHook(() => useStore(true, role, undefined, scope))
  await waitFor(() => expect(result.current.loading).toBe(false))
  expect(scope).toBe('full')
  expect(state.scoped).not.toHaveBeenCalled()
  expect(result.current.calendarEvents[0].applicants).toEqual(['A'])
})

test.each(['user', 'leader'] as const)('%s service to assigned map reuses all teams and home round trips issue no further reads', async role => {
  vi.stubEnv('VITE_CALENDAR_NAVIGATION_REUSE_ENABLED', 'true')
  const now = new Date('2026-10-30T12:00:00')
  const teams = [{ id: 7, date: '2026-08-02', applicants: ['A', 'Other'], cardAssignments: [
    { userName: 'A', assignedCardId: 10 }, { userName: 'Other', assignedCardId: 20 },
  ] }, { id: 8, date: '2027-08-08', applicants: [], cardAssignments: [] }]
  state.scoped.mockImplementation(async scope => scope.startsWith('service:') ? teams : [])
  const { result, rerender } = renderHook(({ route, search }) => useStore(true, role, undefined,
    calendarReadScope(route, search, '', false, 'true', now, role, 'A')),
  { initialProps: { route: '/', search: '' } })
  await waitFor(() => expect(result.current.loading).toBe(false))
  rerender({ route: '/territory', search: '' })
  await waitFor(() => expect(result.current.calendarScopeReady).toBe(true))
  state.reads = []
  for (const [route, search] of [['/map', '?assignmentMap=7'], ['/territory', '?assignmentEvent=7'], ['/', ''],
    ['/territory', ''], ['/map', '?assignmentMap=8'], ...(role === 'leader' ? [['/zone', '']] : [])]) {
    rerender({ route, search })
    await waitFor(() => expect(result.current.calendarScopeReady).toBe(true))
    if (route !== '/') expect(result.current.calendarEvents).toEqual(teams)
  }
  expect(state.scoped).toHaveBeenCalledTimes(2)
  expect(state.reads).toEqual([])
})

test.each(['foreground', 'realtime:calendar', 'mutation:calendar', 'fetchAll', 'mutation:resources'])('%s prevents reusing a pre-change service snapshot for an assigned map', async triggeredBy => {
  vi.stubEnv('VITE_CALENDAR_NAVIGATION_REUSE_ENABLED', 'true')
  state.scoped.mockResolvedValue([{ id: 7, date: '2026-08-02', applicants: ['A', 'Other'], cardAssignments: [] }])
  const base = 'service:["A","2026-10-30",null]'
  const target = 'service:["A","2026-10-30",7]'
  const home = 'window:2026-10-16:2026-11-30'
  const { result, rerender } = renderHook(({ scope }) => useStore(true, 'leader', undefined, scope), { initialProps: { scope: base } })
  await waitFor(() => expect(result.current.loading).toBe(false))
  rerender({ scope: home })
  await waitFor(() => expect(result.current.calendarScopeReady).toBe(true))
  state.scoped.mockResolvedValue([{ id: 7, date: '2026-08-02', applicants: ['New'], cardAssignments: [] }])
  await act(async () => { await result.current.refetchSlices([triggeredBy === 'mutation:resources' ? 'resources' : 'calendar'], { triggeredBy }) })
  rerender({ scope: target })
  await waitFor(() => expect(result.current.calendarScopeReady).toBe(true))
  expect(state.scoped).toHaveBeenCalledTimes(triggeredBy === 'mutation:resources' ? 3 : 4)
  expect(result.current.calendarEvents[0].applicants).toEqual(['New'])
})

test.each([true, false])('home covering next-month calendar reuse follows flag=%s', async enabled => {
  vi.stubEnv('VITE_CALENDAR_NAVIGATION_REUSE_ENABLED', String(enabled))
  state.scoped.mockImplementation(async scope => scope === 'window:2026-11-01:2026-11-30'
    ? [{ id: 2, date: '2026-11-02', applicants: ['Other'], cardAssignments: [] }]
    : [{ id: 1, date: '2026-10-30', applicants: ['A'], cardAssignments: [] }, { id: 2, date: '2026-11-02', applicants: ['Other'], cardAssignments: [] }])
  const { result, rerender } = renderHook(({ scope }) => useStore(true, 'admin', undefined, scope), { initialProps: { scope: 'window:2026-10-16:2026-11-30' } })
  await waitFor(() => expect(result.current.loading).toBe(false))
  rerender({ scope: 'window:2026-11-01:2026-11-30' })
  await waitFor(() => expect(result.current.calendarScopeReady).toBe(true))
  expect(result.current.calendarEvents.map(e => e.id)).toEqual([2])
  expect(result.current.calendarEvents[0].applicants).toEqual(['Other'])
  expect(state.scoped).toHaveBeenCalledTimes(enabled ? 1 : 2)
})

test('another participant joining refreshes home coverage before next-month reuse', async () => {
  vi.stubEnv('VITE_CALENDAR_NAVIGATION_REUSE_ENABLED', 'true')
  const event = { id: 2, date: '2026-11-02', applicants: ['A'], cardAssignments: [] }
  state.scoped.mockResolvedValue([event])
  const { result, rerender } = renderHook(({ scope }) => {
    const store = useStore(true, 'leader', undefined, scope)
    useCalendarRealtime(() => { void store.refetchSlices(['calendar'], { triggeredBy: 'realtime:calendar' }) }, {
      debounceMs: 0, invalidate: store.invalidateCalendarCache,
      onParticipants: ids => { void store.refreshCalendarParticipants(ids) },
    })
    return store
  }, { initialProps: { scope: 'window:2026-10-16:2026-11-30' } })
  await waitFor(() => expect(result.current.loading).toBe(false))
  expect(state.callbacks.has('event_participants')).toBe(true)
  state.scoped.mockResolvedValue([{ ...event, applicants: ['A', 'Other team'] }])
  state.participants.mockResolvedValue(new Map([[2, { applicants: ['A', 'Other team'], assigned: [], guests: [] }]]))
  vi.useFakeTimers()
  await act(async () => {
    state.callbacks.get('event_participants')!({ new: { event_id: 2 } })
    await vi.advanceTimersByTimeAsync(1)
  })
  vi.useRealTimers()
  await waitFor(() => expect(result.current.calendarEvents[0].applicants).toEqual(['A', 'Other team']))
  expect(state.scoped).toHaveBeenCalledTimes(1)
  expect(state.participants).toHaveBeenCalledExactlyOnceWith([2])
  rerender({ scope: 'window:2026-11-01:2026-11-30' })
  await waitFor(() => expect(result.current.calendarScopeReady).toBe(true))
  expect(result.current.calendarEvents[0].applicants).toEqual(['A', 'Other team'])
  expect(state.scoped).toHaveBeenCalledTimes(2)
})

test('navigation cannot reuse a newly filled cache while resource recovery is still pending', async () => {
  vi.stubEnv('VITE_CALENDAR_NAVIGATION_REUSE_ENABLED', 'true')
  const { result, rerender } = renderHook(({ scope }) => useStore(true, 'leader', undefined, scope), {
    initialProps: { scope: 'window:2026-10-01:2026-10-31' },
  })
  await waitFor(() => expect(result.current.loading).toBe(false))
  let release!: (value: unknown) => void
  state.pendingResource = new Promise(resolve => { release = resolve })
  let pending!: Promise<void>
  act(() => { pending = result.current.refetchSlices(['resources'], { triggeredBy: 'mutation:resources' }) })
  rerender({ scope: 'window:2026-10-16:2026-11-30' })
  await waitFor(() => expect(result.current.calendarScopeReady).toBe(true))
  expect(state.scoped).toHaveBeenCalledTimes(2)
  rerender({ scope: 'window:2026-11-01:2026-11-30' })
  await waitFor(() => expect(result.current.calendarScopeReady).toBe(true))
  expect(state.scoped).toHaveBeenCalledTimes(3)
  await act(async () => { release({ data: [], error: null }); await pending })
})

test('participants wait for an older full read and never expand invisible events', async () => {
  const { result } = renderHook(() => useStore(true, 'leader', undefined, 'full'))
  await waitFor(() => expect(result.current.loading).toBe(false))
  let release!: (value: unknown) => void
  state.pendingFull = new Promise(resolve => { release = resolve })
  let full!: Promise<void>, patch!: Promise<void>
  act(() => { full = result.current.refetchSlices(['calendar']); patch = result.current.refreshCalendarParticipants([1]) })
  expect(state.participants).not.toHaveBeenCalled()
  state.participants.mockResolvedValue(new Map([[1, { applicants: ['New'], assigned: [], guests: [] }]]))
  await act(async () => { release({ data: [old], error: null }); await full; await patch })
  expect(result.current.calendarEvents[0].applicants).toEqual(['New'])
  state.participants.mockClear()
  await act(async () => { await result.current.refreshCalendarParticipants([999]) })
  expect(state.participants).not.toHaveBeenCalled()
})

test('a second participant signal retains first dirty event when an old response is discarded', async () => {
  state.scoped.mockResolvedValue([1, 2].map(id => ({ id, date: '2026-10-30', applicants: ['Old'], cardAssignments: [] })))
  const { result } = renderHook(() => useStore(true, 'leader', undefined, 'window:2026-10-01:2026-10-31'))
  await waitFor(() => expect(result.current.loading).toBe(false))
  let release!: (value: unknown) => void
  state.participants.mockImplementationOnce(() => new Promise(resolve => { release = resolve }))
  let first!: Promise<void>, second!: Promise<void>
  act(() => { first = result.current.refreshCalendarParticipants([1]) })
  await waitFor(() => expect(state.participants).toHaveBeenCalledTimes(1))
  act(() => { second = result.current.refreshCalendarParticipants([2]) })
  state.participants.mockResolvedValue(new Map([1, 2].map(id => [id, { applicants: ['New'], assigned: [], guests: [] }])))
  await act(async () => { release(new Map([[1, { applicants: ['Stale'] }]])); await first; await second })
  expect(state.participants).toHaveBeenLastCalledWith([1, 2])
  expect(result.current.calendarEvents.map(event => event.applicants)).toEqual([['New'], ['New']])
})
