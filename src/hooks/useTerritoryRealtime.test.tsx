import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { ReactNode } from 'react'
import { TerritoryRealtimeContext } from './territoryRealtimeContext'
import { useTerritoryRealtime } from './useTerritoryRealtime'

const mock = vi.hoisted(() => {
  const handlers: Array<{ filter: { filter: string }; cb: (p: { new: unknown }) => void }> = []
  let status: (s: string) => void
  const channel = {
    on: vi.fn((_type, filter, cb) => { handlers.push({ filter, cb }); return channel }),
    subscribe: vi.fn((cb) => { status = cb; return channel }),
  }
  return { handlers, channel, remove: vi.fn(), snapshot: vi.fn(), status: (s: string) => status(s) }
})
vi.mock('../lib/supabase', () => ({ supabase: { channel: () => mock.channel, removeChannel: mock.remove } }))
vi.mock('./territorySync', () => ({ fetchTerritorySignalIds: mock.snapshot }))
beforeEach(() => {
  vi.useFakeTimers()
  vi.stubEnv('VITE_TERRITORY_REALTIME_ENABLED', 'true')
  vi.clearAllMocks()
  mock.handlers.length = 0
  mock.snapshot.mockResolvedValue([])
  Object.defineProperty(document, 'hidden', { configurable: true, value: false })
})
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllEnvs() })
const signal = (buildingId: number, cardId = 1) => mock.handlers[0].cb({ new: { building_id: buildingId, card_id: cardId } })
function mount(sync = vi.fn(async () => {}), ids = [1]) {
  const wrapper = ({ children }: { children: ReactNode }) => <TerritoryRealtimeContext.Provider value={sync}>{children}</TerritoryRealtimeContext.Provider>
  return { ...renderHook(({ cards }) => useTerritoryRealtime(cards), { wrapper, initialProps: { cards: ids } }), sync }
}

test('filters on server and client, batches repeated signals without resetting the timer', async () => {
  const { sync } = mount()
  expect(mock.handlers[0].filter.filter).toBe('card_id=in.(1)')
  await act(async () => {
    signal(10); signal(10); signal(11); signal(12, 2)
    await vi.advanceTimersByTimeAsync(350)
  })
  expect(sync).toHaveBeenCalledExactlyOnceWith([10, 11])
})
test('serializes reads and processes a newer signal received during a pending read', async () => {
  let finish!: () => void
  const sync = vi.fn().mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve })).mockResolvedValue(undefined)
  mount(sync)
  await act(async () => { signal(10); await vi.advanceTimersByTimeAsync(350); signal(10); await vi.advanceTimersByTimeAsync(1000) })
  expect(sync).toHaveBeenCalledTimes(1)
  await act(async () => { finish(); await vi.advanceTimersByTimeAsync(350) })
  expect(sync).toHaveBeenCalledTimes(2)
})
test('catches up after subscribe and reconnect, not by periodic whole-store polling', async () => {
  mock.snapshot.mockResolvedValue([10, 11])
  const { sync } = mount()
  await act(async () => { mock.status('SUBSCRIBED'); await vi.advanceTimersByTimeAsync(350) })
  expect(sync).toHaveBeenCalledWith([10, 11])
  await act(async () => { await vi.advanceTimersByTimeAsync(60000) })
  expect(mock.snapshot).toHaveBeenCalledTimes(1)
  await act(async () => { mock.status('SUBSCRIBED'); await vi.advanceTimersByTimeAsync(350) })
  expect(mock.snapshot).toHaveBeenCalledTimes(2)
})
test('disconnects in background and recovers on foreground; no late pending callback after unmount', async () => {
  const { sync, unmount } = mount()
  await act(async () => {
    signal(10)
    Object.defineProperty(document, 'hidden', { configurable: true, value: true })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await act(async () => { await vi.advanceTimersByTimeAsync(400) })
  expect(sync).not.toHaveBeenCalled()
  expect(mock.remove).toHaveBeenCalledTimes(1)
  await act(async () => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: false })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  expect(mock.channel.subscribe).toHaveBeenCalledTimes(2)
  signal(11); unmount()
  await act(async () => { await vi.advanceTimersByTimeAsync(400) })
  expect(sync).not.toHaveBeenCalled()
})
test('does not open for empty scope or feature disabled', () => {
  mount(vi.fn(), [])
  vi.stubEnv('VITE_TERRITORY_REALTIME_ENABLED', 'false')
  mount()
  expect(mock.channel.subscribe).not.toHaveBeenCalled()
})
test('a failed read retries the same batch without an unbounded request loop', async () => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  const sync = vi.fn().mockRejectedValue(new Error('offline'))
  mount(sync)
  await act(async () => { signal(10); await vi.advanceTimersByTimeAsync(10000) })
  expect(sync).toHaveBeenCalledTimes(3)
  expect(sync).toHaveBeenLastCalledWith([10])
  vi.restoreAllMocks()
})
