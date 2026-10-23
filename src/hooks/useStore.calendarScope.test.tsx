import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { useStore } from './useStore'
import { SupersededReadError } from './supersededRead'
import { calendarReadScope } from './calendarReadScope'

const state = vi.hoisted(() => ({ scoped: vi.fn(), reads: [] as string[], events: [] as unknown[], failure: '', pendingFull: null as Promise<unknown> | null }))
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
      return Promise.resolve({ data: lookup ? [{ id: 1 }] : table === 'calendar_events' ? state.events : [], error: table === state.failure ? new Error('offline') : null }).then(resolve)
    }
    return q
  },
} }))
const old = { id: 1, event_date: '2026-08-02', title: 'Old', time: '10:00', event_participants: [{ user_name: 'A', role: '신청' }] }
beforeEach(() => { state.reads = []; state.events = [old]; state.failure = ''; state.pendingFull = null; state.scoped.mockReset().mockResolvedValue([]); vi.stubEnv('VITE_DEMO_MODE', 'true') })
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
  expect(state.scoped).toHaveBeenLastCalledWith('since:2026-10-09')
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
