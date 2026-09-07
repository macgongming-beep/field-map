import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { useStore } from './useStore'
const state = vi.hoisted(() => ({ mode: 'throw', appSettingsFailure: false }))
const toast = vi.hoisted(() => vi.fn())
vi.mock('../lib/toast', () => ({ showToast: toast }))
vi.mock('../lib/supabase', () => ({ supabase: {
  rpc: () => Promise.resolve({ error: null }),
  from: (table: string) => {
    const chain: Record<string, unknown> = {}
    let lookup = false
    for (const key of ['select', 'order', 'range', 'eq', 'limit', 'in', 'is', 'gte', 'lte', 'neq']) chain[key] = () => chain
    chain.limit = () => { lookup = true; return chain }
    chain.upsert = () => Promise.resolve(
      table === 'app_settings' && state.appSettingsFailure
        ? { error: { message: 'settings denied' } }
        : { error: null },
    )
    chain.then = (resolve: (value: unknown) => void, reject: (error: Error) => void) => {
      if (state.mode === 'throw') return Promise.reject(new Error('connection failed')).then(resolve, reject)
      if (state.mode === 'hang') return new Promise(() => {})
      if (state.mode === 'success') return Promise.resolve({ data: lookup ? [{ id: 1 }] : [], error: null }).then(resolve, reject)
      return Promise.resolve({ data: [], error: { message: 'RLS / network failed' } }).then(resolve, reject)
    }
    return chain
  },
} }))
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
  state.appSettingsFailure = false
})

test.each(['throw', 'response'])('initial %s failure leaves loading and exposes an error', async (mode) => {
  state.mode = mode
  vi.spyOn(console, 'error').mockImplementation(() => {})
  const { result } = renderHook(() => useStore(true))
  await waitFor(() => expect(result.current.loading).toBe(false))
  expect(result.current.error).toBeTruthy()
})

test('background failure keeps the usable screen and reports a toast', async () => {
  state.mode = 'success'
  vi.spyOn(console, 'error').mockImplementation(() => {})
  const { result } = renderHook(() => useStore(true))
  await waitFor(() => expect(result.current.loading).toBe(false))
  expect(result.current.error).toBeNull()
  state.mode = 'throw'
  await act(async () => {
    await expect(result.current.refetchAll()).rejects.toThrow('connection failed')
  })
  expect(result.current.error).toBeNull()
  expect(result.current.loading).toBe(false)
  expect(toast).toHaveBeenCalledWith(expect.any(String), 'error')
})

test('a request that never settles reaches a recoverable error', async () => {
  vi.useFakeTimers()
  state.mode = 'hang'
  vi.spyOn(console, 'error').mockImplementation(() => {})
  const { result } = renderHook(() => useStore(true))
  await act(() => vi.advanceTimersByTimeAsync(45_000))
  expect(result.current.loading).toBe(false)
  expect(result.current.error).toBeTruthy()
})

test('global setting save failure restores the previous value and reports it', async () => {
  state.mode = 'success'
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  const { result } = renderHook(() => useStore(true))
  await waitFor(() => expect(result.current.loading).toBe(false))

  await act(async () => {
    expect(await result.current.upsertGlobalSetting('calendar_places', 'old')).toBe(true)
  })
  expect(result.current.globalSettings.calendar_places).toBe('old')

  state.appSettingsFailure = true
  await act(async () => {
    expect(await result.current.upsertGlobalSetting('calendar_places', 'new')).toBe(false)
  })

  expect(result.current.globalSettings.calendar_places).toBe('old')
  expect(toast).toHaveBeenCalledWith(expect.any(String), 'error')
})
