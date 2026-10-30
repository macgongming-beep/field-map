import { useEffect } from 'react'
import { act, cleanup, render, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { useStore } from './useStore'
import { SupersededReadError } from './supersededRead'
import { calendarReadScope } from './calendarReadScope'
import { useCalendarRealtime } from './useCalendarRealtime'

const state = vi.hoisted(() => ({ probe: vi.fn(), callbacks: new Map<string, (payload?: unknown) => void>(), participants: vi.fn(), scoped: vi.fn(), reads: [] as string[], events: [] as unknown[], assignments: [] as unknown[], failure: '', pendingFull: null as Promise<unknown> | null, pendingResource: null as Promise<unknown> | null }))
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
    let projection = '', id: unknown
    for (const key of ['select', 'order', 'range', 'eq', 'in', 'is', 'gte', 'lte', 'neq', 'update', 'delete', 'insert', 'upsert']) q[key] = () => q
    q.select = (value: string) => { projection = value; return q }
    q.eq = (column: string, value: unknown) => { if (column === 'id') id = value; return q }
    q.single = () => {
      state.reads.push(`${table}:probe`)
      return state.probe({ table, projection, id })
    }
    q.limit = () => { lookup = true; return q }
    q.then = (resolve: (value: unknown) => void) => {
      state.reads.push(table)
      if (table === 'informal_assets' && state.pendingResource) return state.pendingResource.then(resolve)
      if (table === 'calendar_events' && state.pendingFull) { const pending = state.pendingFull; state.pendingFull = null; return pending.then(resolve) }
      return Promise.resolve({ data: lookup || table === 'event_participants' ? [{ id: 1 }] : table === 'calendar_events' ? state.events : table === 'event_card_assignments' ? state.assignments : [], error: table === state.failure ? new Error('offline') : null }).then(resolve)
    }
    return q
  },
} }))
const old = { id: 1, event_date: '2026-08-02', title: 'Old', time: '10:00', event_participants: [{ user_name: 'A', role: '신청' }] }
beforeEach(() => { state.reads = []; state.events = [old]; state.assignments = []; state.failure = ''; state.pendingFull = null; state.pendingResource = null; state.participants.mockReset().mockResolvedValue(new Map()); state.scoped.mockReset().mockResolvedValue([]); vi.stubEnv('VITE_DEMO_MODE', 'true'); vi.stubEnv('VITE_CALENDAR_WINDOW_ENABLED', undefined) })
afterEach(() => { cleanup(); state.callbacks.clear(); vi.useRealTimers(); vi.unstubAllEnvs() })

test.each(['user', 'leader', 'admin', 'developer'] as const)('%s cached navigation never unmounts the screen or flashes previous-scope events', async role => {
  const home = 'window:2026-10-16:2026-11-30'
  const other = role === 'user' || role === 'leader' ? `service:["A","2026-10-30",null]` : 'full'
  state.scoped.mockImplementation(async scope => scope === home ? [{ id: 7, date: '2026-10-30', applicants: ['Home'], cardAssignments: [] }] : [{ id: 1, date: '2026-08-02', applicants: ['A', 'Other'], cardAssignments: [] }])
  let mounts = 0
  const frames: { scope: string; ready: boolean; ids: number[] }[] = []
  function Screen() { useEffect(() => { ++mounts }, []); return <div>screen</div> }
  function Probe({ scope }: { scope: string }) {
    const store = useStore(true, role, undefined, scope)
    frames.push({ scope, ready: store.calendarScopeReady, ids: store.calendarEvents.map(e => e.id) })
    return store.loading || !store.calendarScopeReady ? <div>loading</div> : <Screen />
  }
  const view = render(<Probe scope={home} />)
  await waitFor(() => expect(frames.at(-1)?.ready).toBe(true))
  view.rerender(<Probe scope={other} />)
  await waitFor(() => expect(frames.at(-1)?.ready).toBe(true))
  view.rerender(<Probe scope={home} />)
  await waitFor(() => expect(frames.at(-1)?.ids).toEqual([7]))
  const baseline = mounts
  state.reads = []; state.scoped.mockClear(); frames.length = 0
  for (const scope of [other, home, other, home]) view.rerender(<Probe scope={scope} />)
  expect(mounts).toBe(baseline)
  expect(frames.length).toBeGreaterThan(0)
  for (const frame of frames) {
    expect(frame.ready).toBe(true)
    expect(frame.ids).toEqual(frame.scope === home ? [7] : [1])
  }
  expect(state.reads).toEqual([])
  expect(state.scoped).not.toHaveBeenCalled()
})

test.each(['foreground', 'realtime:calendar', 'mutation:calendar', 'fetchAll'])('%s also invalidates full calendar navigation cache and preserves changed participants/teams', async triggeredBy => {
  state.assignments = [{ id: 5, event_id: 1, user_name: 'Other', assigned_card_id: 20 }]
  const { result, rerender } = renderHook(({ scope }) => useStore(true, 'admin', undefined, scope), { initialProps: { scope: 'full' } })
  await waitFor(() => expect(result.current.loading).toBe(false))
  rerender({ scope: 'window:2026-10-16:2026-11-30' })
  await waitFor(() => expect(result.current.calendarScopeReady).toBe(true))
  state.events = [{ ...old, event_participants: [] }]
  state.assignments = [{ id: 6, event_id: 1, user_name: 'Replacement', assigned_card_id: 30 }]
  await act(async () => { await result.current.refetchSlices(['calendar'], { triggeredBy }) })
  state.reads = []
  rerender({ scope: 'full' })
  await waitFor(() => expect(result.current.calendarScopeReady).toBe(true))
  expect(state.reads).toEqual(['calendar_events', 'event_card_assignments', 'event_card_assignment_cards'])
  expect(result.current.calendarEvents[0].applicants).toEqual([])
  expect(result.current.calendarEvents[0].cardAssignments).toEqual([expect.objectContaining({ userName: 'Replacement', assignedCardId: 30 })])
})

test.each([{ demo: 'false', flag: 'true' }, { demo: 'true', flag: 'false' }])('full cache stays off with demo=$demo flag=$flag', async ({ demo, flag }) => {
  vi.stubEnv('VITE_DEMO_MODE', demo)
  vi.stubEnv('VITE_CALENDAR_WINDOW_ENABLED', 'true')
  vi.stubEnv('VITE_CALENDAR_NAVIGATION_REUSE_ENABLED', 'true')
  vi.stubEnv('VITE_CALENDAR_CACHED_SCREEN_ENABLED', flag)
  const { result, rerender } = renderHook(({ scope }) => useStore(true, 'admin', undefined, scope), { initialProps: { scope: 'full' } })
  await waitFor(() => expect(result.current.loading).toBe(false))
  rerender({ scope: 'window:2026-10-16:2026-11-30' })
  await waitFor(() => expect(result.current.calendarScopeReady).toBe(true))
  state.reads = []
  rerender({ scope: 'full' })
  await waitFor(() => expect(result.current.calendarScopeReady).toBe(true))
  expect(state.reads).toEqual(['calendar_events', 'event_card_assignments', 'event_card_assignment_cards'])
})

test('participant cancellation invalidates hidden full snapshot before navigation', async () => {
  const { result, rerender } = renderHook(({ scope }) => useStore(true, 'admin', undefined, scope), { initialProps: { scope: 'full' } })
  await waitFor(() => expect(result.current.loading).toBe(false))
  rerender({ scope: 'window:2026-10-16:2026-11-30' })
  await waitFor(() => expect(result.current.calendarScopeReady).toBe(true))
  state.events = [{ ...old, event_participants: [] }]
  await act(async () => { await result.current.refreshCalendarParticipants([1]) })
  state.reads = []
  rerender({ scope: 'full' })
  expect(result.current.calendarScopeReady).toBe(false)
  await waitFor(() => expect(result.current.calendarScopeReady).toBe(true))
  expect(state.reads).toContain('calendar_events')
  expect(result.current.calendarEvents[0].applicants).toEqual([])
})

test('full snapshot expires without renewal on a cached round trip', async () => {
  let now = 1000000
  const clock = vi.spyOn(Date, 'now').mockImplementation(() => now)
  try {
    const { result, rerender } = renderHook(({ scope }) => useStore(true, 'admin', undefined, scope), { initialProps: { scope: 'full' } })
    await waitFor(() => expect(result.current.loading).toBe(false))
    const home = 'window:2026-10-16:2026-11-30'
    rerender({ scope: home })
    await waitFor(() => expect(result.current.calendarScopeReady).toBe(true))
    now += 119000
    state.reads = []
    rerender({ scope: 'full' })
    expect(result.current.calendarScopeReady).toBe(true)
    expect(state.reads).toEqual([])
    rerender({ scope: home })
    now += 1001
    rerender({ scope: 'full' })
    expect(result.current.calendarScopeReady).toBe(false)
    await waitFor(() => expect(result.current.calendarScopeReady).toBe(true))
    expect(state.reads).toContain('calendar_events')
  } finally { clock.mockRestore() }
})

test('full read invalidated while pending cannot repopulate the navigation cache', async () => {
  const home = 'window:2026-10-16:2026-11-30'
  const { result, rerender } = renderHook(({ scope }) => useStore(true, 'admin', undefined, scope), { initialProps: { scope: home } })
  await waitFor(() => expect(result.current.loading).toBe(false))
  let finish!: (value: unknown) => void
  state.pendingFull = new Promise(resolve => { finish = resolve })
  rerender({ scope: 'full' })
  await waitFor(() => expect(state.pendingFull).toBeNull())
  act(() => result.current.invalidateCalendarCache())
  await act(async () => { finish({ data: [old], error: null }) })
  await waitFor(() => expect(result.current.calendarScopeReady).toBe(true))
  rerender({ scope: home })
  await waitFor(() => expect(result.current.calendarScopeReady).toBe(true))
  state.reads = []
  rerender({ scope: 'full' })
  expect(result.current.calendarScopeReady).toBe(false)
  await waitFor(() => expect(result.current.calendarScopeReady).toBe(true))
  expect(state.reads).toContain('calendar_events')
})

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
test.each([
  ['false', undefined, false], ['false', 'true', true], ['true', 'false', false],
] as const)('store scope follows shared flag: demo=%s flag=%s', async (demo, flag, enabled) => {
  vi.stubEnv('VITE_DEMO_MODE', demo)
  vi.stubEnv('VITE_CALENDAR_WINDOW_ENABLED', flag)
  const { result } = renderHook(() => useStore(true, 'admin', undefined, 'since:2026-10-09'))
  await waitFor(() => expect(result.current.loading).toBe(false))
  expect(result.current.calendarScopeReady).toBe(true)
  expect(state.scoped).toHaveBeenCalledTimes(enabled ? 1 : 0)
  expect(state.reads.includes('calendar_events')).toBe(!enabled)
  if (!enabled) expect(result.current.calendarEvents[0].applicants).toEqual(['A'])
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
  vi.stubEnv('VITE_CALENDAR_CACHED_SCREEN_ENABLED', 'false')
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
  const now = new Date('2026-10-23T12:00:00')
  const teams = [{ id: 1, date: '2026-08-02', applicants: ['A', 'Other'], cardAssignments: [
    { userName: 'A', assignedCardId: 10 }, { userName: 'Other', assignedCardId: 20 },
  ] }]
  state.scoped.mockImplementation(async scope => scope.startsWith('service:') ? teams : [])
  const { result, rerender } = renderHook(({ route }) => useStore(true, 'leader', undefined,
    calendarReadScope(route, '', '', false, 'true', now, 'leader', 'A')), { initialProps: { route: '/' } })
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

test.each([
  ['true', undefined, true], ['false', undefined, false],
  ['true', 'false', false], ['false', 'true', true], ['false', 'false', false],
] as const)('self application gate demo=%s flag=%s narrow=%s', async (demo, flag, narrow) => {
  vi.stubEnv('VITE_DEMO_MODE', demo)
  vi.stubEnv('VITE_CALENDAR_APPLICATION_REFRESH_ENABLED', flag)
  localStorage.setItem('currentVisitor', 'New applicant')
  state.events = [{ ...old, allow_applications: true }]
  const { result } = renderHook(() => useStore(true, 'leader', undefined, 'full'))
  await waitFor(() => expect(result.current.loading).toBe(false))
  state.reads = []
  state.participants.mockResolvedValue(new Map([[1, { applicants: ['A', 'New applicant'], assigned: [], guests: [] }]]))
  try {
    await act(async () => { await result.current.applyToEvent(1) })
    if (narrow) {
      expect(state.participants).toHaveBeenCalledExactlyOnceWith([1])
      expect(state.reads).toEqual(['event_participants'])
      expect(result.current.calendarEvents[0].applicants).toContain('New applicant')
    } else {
      expect(state.participants).not.toHaveBeenCalled()
      expect(state.reads).toContain('calendar_events')
    }
  } finally { localStorage.removeItem('currentVisitor') }
})

test.each(['unassigned', 'shared', 'offline'] as const)('actual cancellation probes server and recovers %s state', async status => {
  // Enable only the new production flag: it must not depend on navigation reuse.
  vi.stubEnv('VITE_DEMO_MODE', 'false')
  vi.stubEnv('VITE_CALENDAR_APPLICATION_REFRESH_ENABLED', 'true')
  vi.stubEnv('VITE_CALENDAR_NAVIGATION_REUSE_ENABLED', 'false')
  localStorage.setItem('currentVisitor', 'A')
  state.events = [{ ...old, allow_applications: true }]
  const { result } = renderHook(() => useStore(true, 'user', undefined, 'full'))
  await waitFor(() => expect(result.current.loading).toBe(false))
  state.reads = []
  state.probe.mockReset().mockImplementation(async () => {
    expect(state.reads[0]).toBe('event_participants')
    expect(state.participants).not.toHaveBeenCalled()
    return { data: { id: 1, assignment_shared_at: status === 'shared' ? '2026-10-30T01:00:00Z' : null,
      assignment_team_informal: null, assignment_team_scopes: {} }, error: status === 'offline' ? new Error('offline') : null }
  })
  // The local snapshot is stale; the server has already removed this participant.
  state.events = [{ ...old, event_participants: [] }]
  state.participants.mockResolvedValue(new Map([[1, { applicants: [], assigned: [], guests: [] }]]))
  try {
    await act(async () => { await result.current.applyToEvent(1) })
    expect(state.probe).toHaveBeenCalledExactlyOnceWith({ table: 'calendar_events', id: 1,
      projection: 'id,assignment_shared_at,assignment_team_informal,assignment_team_scopes' })
    expect(result.current.calendarEvents[0].applicants).toEqual([])
    if (status === 'unassigned') {
      expect(state.participants).toHaveBeenCalledExactlyOnceWith([1])
      expect(state.reads).toEqual(['event_participants', 'calendar_events:probe'])
    } else {
      expect(state.participants).not.toHaveBeenCalled()
      expect(state.reads).toEqual(expect.arrayContaining(['calendar_events', 'event_card_assignments',
        'event_card_assignment_cards', 'visit_histories', 'service_sessions']))
    }
  } finally { localStorage.removeItem('currentVisitor') }
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

test('background participant failure does not poison loading an uncached month', async () => {
  const { result, rerender } = renderHook(({ scope }) => useStore(true, 'leader', undefined, scope), { initialProps: { scope: 'full' } })
  await waitFor(() => expect(result.current.loading).toBe(false))
  state.participants.mockRejectedValueOnce(new Error('offline'))
  await act(async () => { await expect(result.current.refreshCalendarParticipants([1])).rejects.toThrow('offline') })
  expect(result.current.calendarReadError).toBe(false)
  expect(result.current.calendarEvents[0].applicants).toEqual(['A'])
  let release!: (value: unknown[]) => void
  state.scoped.mockImplementationOnce(() => new Promise(resolve => { release = resolve }))
  rerender({ scope: 'window:2026-11-01:2026-11-30' })
  await waitFor(() => expect(state.scoped).toHaveBeenCalled())
  expect(result.current.calendarScopeReady).toBe(false)
  expect(result.current.calendarReadError).toBe(false)
  await act(async () => { release([]) })
  await waitFor(() => expect(result.current.calendarScopeReady).toBe(true))
})

test('a foreground calendar failure still shows error and retry clears it before completion', async () => {
  const { result } = renderHook(() => useStore(true, 'leader', undefined, 'full'))
  await waitFor(() => expect(result.current.loading).toBe(false))
  state.failure = 'calendar_events'
  await act(async () => { await expect(result.current.refetchSlices(['calendar'])).rejects.toThrow() })
  expect(result.current.calendarReadError).toBe(true)
  state.failure = ''
  let release!: (value: unknown) => void
  state.pendingFull = new Promise(resolve => { release = resolve })
  let retry!: Promise<void>
  act(() => { retry = result.current.refetchSlices(['calendar']) })
  await waitFor(() => expect(result.current.calendarReadError).toBe(false))
  await act(async () => { release({ data: [old], error: null }); await retry })
  expect(result.current.calendarEvents[0].applicants).toEqual(['A'])
})

test('resource invalidation retries dirty participants without another realtime signal', async () => {
  const { result } = renderHook(() => useStore(true, 'leader', undefined, 'full'))
  await waitFor(() => expect(result.current.loading).toBe(false))
  state.reads = []
  let release!: (value: unknown) => void
  state.participants.mockImplementationOnce(() => new Promise(resolve => { release = resolve }))
  let patch!: Promise<void>
  act(() => { patch = result.current.refreshCalendarParticipants([1]) })
  await waitFor(() => expect(state.participants).toHaveBeenCalledTimes(1))
  await act(async () => { await result.current.refetchSlices(['resources']) })
  state.participants.mockResolvedValue(new Map([[1, { applicants: ['Fresh'], assigned: [], guests: [] }]]))
  await act(async () => { release(new Map([[1, { applicants: ['Stale'] }]])); await patch })
  expect(state.participants).toHaveBeenCalledTimes(2)
  expect(state.participants).toHaveBeenLastCalledWith([1])
  expect(result.current.calendarEvents[0].applicants).toEqual(['Fresh'])
  expect(state.reads).not.toContain('calendar_events')
  expect(state.reads).not.toContain('buildings')
})

test('unmount discards invalidated participant response without retry', async () => {
  const { result, unmount } = renderHook(() => useStore(true, 'leader', undefined, 'full'))
  await waitFor(() => expect(result.current.loading).toBe(false))
  let release!: (value: unknown) => void
  state.participants.mockImplementationOnce(() => new Promise(resolve => { release = resolve }))
  let patch!: Promise<void>
  act(() => { patch = result.current.refreshCalendarParticipants([1]) })
  await waitFor(() => expect(state.participants).toHaveBeenCalledTimes(1))
  // Without lifecycle cleanup, this invalidation would retry after unmount.
  act(() => { result.current.invalidateCalendarCache() })
  unmount()
  await act(async () => { release(new Map()); await patch })
  expect(state.participants).toHaveBeenCalledTimes(1)
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
