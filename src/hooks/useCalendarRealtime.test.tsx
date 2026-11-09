import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { useCalendarRealtime } from './useCalendarRealtime'

const state = vi.hoisted(() => ({ callbacks: new Map<string, (payload?: unknown) => void>(), remove: vi.fn() }))
vi.mock('../lib/supabase', () => ({ supabase: {
  channel: () => {
    const channel = {
      on: (_kind: string, filter: { table: string }, callback: () => void) => {
        state.callbacks.set(filter.table, callback)
        return channel
      },
      subscribe: vi.fn(),
    }
    return channel
  },
  removeChannel: state.remove,
} }))
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllEnvs(); state.callbacks.clear(); vi.clearAllMocks() })

test('own receipt skips early/late duplicate only; another signal and broad assignment still refresh', async () => {
  vi.stubEnv('VITE_CALENDAR_NAVIGATION_REUSE_ENABLED', 'true')
  vi.useFakeTimers()
  let covered = false
  const own = { eventType: 'DELETE', old: { id: 10 } }
  const onParticipants = vi.fn(), onChange = vi.fn(), invalidate = vi.fn()
  renderHook(() => useCalendarRealtime(onChange, { onParticipants, invalidate,
    skipParticipantSignal: signal => covered && signal === own }))
  state.callbacks.get('event_participants')!(own)
  covered = true
  await act(async () => { await vi.advanceTimersByTimeAsync(2000) })
  expect(onParticipants).not.toHaveBeenCalled()
  invalidate.mockClear()
  state.callbacks.get('event_participants')!(own)
  expect(invalidate).not.toHaveBeenCalled()
  state.callbacks.get('event_participants')!({ eventType: 'DELETE', old: { id: 11 } })
  await act(async () => { await vi.advanceTimersByTimeAsync(2000) })
  expect(onParticipants).toHaveBeenCalledExactlyOnceWith(null)
  state.callbacks.get('event_card_assignments')!()
  state.callbacks.get('event_participants')!(own)
  await act(async () => { await vi.advanceTimersByTimeAsync(2000) })
  expect(onChange).toHaveBeenCalledOnce()
})

test.each([true, false])('restaurant assignment invalidation follows navigation reuse flag=%s', async enabled => {
  vi.stubEnv('VITE_CALENDAR_NAVIGATION_REUSE_ENABLED', String(enabled))
  vi.useFakeTimers()
  const onChange = vi.fn(), onParticipants = vi.fn(), invalidate = vi.fn()
  const { unmount } = renderHook(() => useCalendarRealtime(onChange, { onParticipants, invalidate }))
  expect(state.callbacks.has('event_restaurant_assignments')).toBe(enabled)
  expect(state.callbacks.has('event_participants')).toBe(enabled)
  expect(state.callbacks.has('calendar_events')).toBe(true)
  if (enabled) {
    state.callbacks.get('event_participants')!({ new: { event_id: 7 } })
    state.callbacks.get('event_participants')!({ old: { event_id: 8 }, new: { event_id: 9 } })
    expect(invalidate).toHaveBeenCalledTimes(2)
    await act(async () => { await vi.advanceTimersByTimeAsync(2000) })
    expect(onChange).not.toHaveBeenCalled()
    expect(onParticipants).toHaveBeenCalledExactlyOnceWith([7, 9, 8])
    state.callbacks.get('event_participants')!({ old: { id: 1 } })
    await act(async () => { await vi.advanceTimersByTimeAsync(2000) })
    expect(onParticipants).toHaveBeenLastCalledWith(null)
    state.callbacks.get('event_restaurant_assignments')!()
    state.callbacks.get('event_participants')!({ new: { event_id: 7 } })
    await act(async () => { await vi.advanceTimersByTimeAsync(2000) })
    expect(onParticipants).toHaveBeenCalledTimes(2)
    expect(onChange).toHaveBeenCalledTimes(1)
  }
  unmount()
  expect(state.remove).toHaveBeenCalledTimes(1)
})
