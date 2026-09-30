import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { ReactNode } from 'react'
import { TerritoryRealtimeContext, createTerritoryCheckpoint } from './territoryRealtimeContext'
import { useTerritoryRealtime } from './useTerritoryRealtime'

const mock = vi.hoisted(() => {
  const handlers: Array<{ filter: { filter: string }; cb: (p: { new: unknown }) => void }> = []
  let status: (s: string) => void
  const channel = {
    on: vi.fn((_type, filter, cb) => { handlers.push({ filter, cb }); return channel }),
    subscribe: vi.fn((cb) => { status = cb; return channel }),
  }
  return { handlers, channel, remove: vi.fn(), snapshot: vi.fn(), clock: vi.fn(), status: (s: string) => status(s) }
})
vi.mock('../lib/supabase', () => ({ supabase: { channel: () => mock.channel, removeChannel: mock.remove } }))
vi.mock('./territorySync', () => ({ fetchTerritorySignals: mock.snapshot, fetchTerritoryClock: mock.clock }))
beforeEach(() => {
  vi.useFakeTimers()
  vi.stubEnv('VITE_TERRITORY_REALTIME_ENABLED', 'true')
  vi.clearAllMocks()
  mock.handlers.length = 0
  mock.snapshot.mockResolvedValue([])
  mock.clock.mockResolvedValue('2026-09-30T12:00:10Z')
  Object.defineProperty(document, 'hidden', { configurable: true, value: false })
})
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllEnvs() })
const row = (buildingId: number, cardId = 1, revision = 1) => ({ building_id: buildingId, card_id: cardId, revision, changed_at: '2026-09-30T12:00:05Z' })
const signal = (buildingId: number, cardId = 1) => mock.handlers[0].cb({ new: row(buildingId, cardId) })
function mount(sync = vi.fn(async () => {}), ids = [1]) {
  const checkpoint = createTerritoryCheckpoint()
  checkpoint.baseline = '2026-09-30T12:00:00Z'
  const wrapper = ({ children }: { children: ReactNode }) => <TerritoryRealtimeContext.Provider value={{sync, checkpoint}}>{children}</TerritoryRealtimeContext.Provider>
  return { ...renderHook(({ cards }) => useTerritoryRealtime(cards), { wrapper, initialProps: { cards: ids } }), sync, checkpoint }
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
  mock.snapshot.mockResolvedValue([row(10), row(11)])
  const { sync } = mount()
  await act(async () => { mock.status('SUBSCRIBED'); await vi.advanceTimersByTimeAsync(350) })
  expect(sync).toHaveBeenCalledWith([10, 11])
  await act(async () => { await vi.advanceTimersByTimeAsync(60000) })
  expect(mock.snapshot).toHaveBeenCalledTimes(1)
  await act(async () => { mock.status('SUBSCRIBED'); await vi.advanceTimersByTimeAsync(350) })
  expect(mock.snapshot).toHaveBeenCalledTimes(2)
  expect(sync).toHaveBeenCalledTimes(1)
  expect(mock.snapshot).toHaveBeenLastCalledWith([1], '2026-09-30T11:59:40.000Z')
})

test('first connection excludes old signals and card switches use their own successful watermark', async () => {
  mock.snapshot.mockResolvedValue([{ ...row(10), changed_at: '2026-09-29T12:00:00Z' }])
  const { sync, rerender, checkpoint } = mount()
  await act(async () => { mock.status('SUBSCRIBED'); await vi.advanceTimersByTimeAsync(350) })
  expect(mock.snapshot).toHaveBeenCalledWith([1], '2026-09-30T11:59:30.000Z')
  expect(sync).not.toHaveBeenCalled()
  expect(checkpoint.cards.get(1)).toBe('2026-09-30T12:00:10Z')
  rerender({ cards: [2] })
  await act(async () => { mock.status('SUBSCRIBED'); await vi.advanceTimersByTimeAsync(350) })
  expect(mock.snapshot).toHaveBeenLastCalledWith([2], '2026-09-30T11:59:30.000Z')
})

test('failed data reads never advance the recovery watermark or acknowledge the revision', async () => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  mock.snapshot.mockResolvedValue([row(10)])
  const { checkpoint } = mount(vi.fn().mockRejectedValue(new Error('offline')))
  await act(async () => { mock.status('SUBSCRIBED'); await vi.advanceTimersByTimeAsync(10000) })
  expect(checkpoint.cards.size).toBe(0)
  expect(checkpoint.applied.size).toBe(0)
  vi.restoreAllMocks()
})

test('waits for the existing full snapshot and then uses its newer baseline', async () => {
  const { checkpoint, sync } = mount()
  let finish!: () => void
  checkpoint.snapshot = new Promise<void>((resolve) => { finish = resolve })
  await act(async () => { mock.status('SUBSCRIBED'); await vi.advanceTimersByTimeAsync(500) })
  expect(mock.snapshot).not.toHaveBeenCalled()
  await act(async () => {
    checkpoint.baseline = '2026-09-30T12:00:08Z'
    finish()
    await vi.advanceTimersByTimeAsync(350)
  })
  expect(mock.snapshot).toHaveBeenCalledWith([1], '2026-09-30T11:59:38.000Z')
  expect(sync).not.toHaveBeenCalled()
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
