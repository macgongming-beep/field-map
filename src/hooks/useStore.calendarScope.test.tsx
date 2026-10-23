import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { useStore } from './useStore'
import { SupersededReadError } from './supersededRead'
import { calendarReadScope } from './calendarReadScope'

const state = vi.hoisted(() => ({ scoped: vi.fn(), reads: [] as string[], events: [] as unknown[], assignments: [] as unknown[], failure: '', pendingFull: null as Promise<unknown> | null }))
vi.mock('./calendarReadScope', async importOriginal => ({ ...await importOriginal<typeof import('./calendarReadScope')>(), readScopedCalendar: state.scoped }))
vi.mock('../lib/supabase', () => ({ supabase: {
  rpc: () => Promise.resolve({ data: null, error: null }),
  from: (table: string) => {
    const q: Record<string, unknown> = {}
    let lookup = false
    for (const key of ['select', 'order', 'range', 'eq', 'in', 'is', 'gte', 'lte', 'neq', 'update', 'delete', 'insert']) q[key] = () => q
    q.limit = () => { lookup = true; return q }
    q.then = (resolve: (value: unknown) => void) => {
      state.reads.push(table)
      if (table === 'calendar_events' && state.pendingFull) { const pending = state.pendingFull; state.pendingFull = null; return pending.then(resolve) }
      return Promise.resolve({ data: lookup ? [{ id: 1 }] : table === 'calendar_events' ? state.events : table === 'event_card_assignments' ? state.assignments : [], error: table === state.failure ? new Error('offline') : null }).then(resolve)
    }
    return q
  },
} }))
const old = { id: 1, event_date: '2026-08-02', title: 'Old', time: '10:00', event_participants: [{ user_name: 'A', role: '신청' }] }
beforeEach(() => { state.reads = []; state.events = [old]; state.assignments = []; state.failure = ''; state.pendingFull = null; state.scoped.mockReset().mockResolvedValue([]); vi.stubEnv('VITE_DEMO_MODE', 'true') })
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllEnvs() })

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
