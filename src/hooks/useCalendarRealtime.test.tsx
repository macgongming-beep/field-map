import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { useCalendarRealtime } from './useCalendarRealtime'

const state = vi.hoisted(() => ({ callbacks: new Map<string, () => void>(), remove: vi.fn() }))
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

test.each([true, false])('restaurant assignment invalidation follows navigation reuse flag=%s', async enabled => {
  vi.stubEnv('VITE_CALENDAR_NAVIGATION_REUSE_ENABLED', String(enabled))
  vi.useFakeTimers()
  const onChange = vi.fn()
  const { unmount } = renderHook(() => useCalendarRealtime(onChange))
  expect(state.callbacks.has('event_restaurant_assignments')).toBe(enabled)
  expect(state.callbacks.has('event_participants')).toBe(enabled)
  expect(state.callbacks.has('calendar_events')).toBe(true)
  if (enabled) {
    state.callbacks.get('event_restaurant_assignments')!()
    state.callbacks.get('event_participants')!()
    await act(async () => { await vi.advanceTimersByTimeAsync(2000) })
    expect(onChange).toHaveBeenCalledTimes(1)
  }
  unmount()
  expect(state.remove).toHaveBeenCalledTimes(1)
})
