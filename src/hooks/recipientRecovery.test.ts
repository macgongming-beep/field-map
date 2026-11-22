import { beforeEach, expect, test, vi } from 'vitest'
import { createTerritoryCheckpoint } from './territoryRealtimeContext'
import { recoverRecipientBuildings, readRecipientBoundaries } from './recipientRecovery'

const state = vi.hoisted(() => ({ clock: vi.fn(), index: vi.fn(), signals: vi.fn(), rows: [] as { id: number; card_id: number }[], filters: [] as number[][] }))
vi.mock('./territorySync', () => ({ fetchTerritoryClock: state.clock, fetchTerritorySignals: state.signals }))
vi.mock('../lib/supabase', () => ({ supabase: { from: () => {
  const q = { select: () => q, order: () => q, in: (_key: string, ids: number[]) => { state.filters.push(ids); return q },
    range: state.index }
  return q
} } }))
beforeEach(() => {
  vi.resetAllMocks(); state.rows = [{ id: 10, card_id: 1 }]; state.filters = []
  state.clock.mockResolvedValue('2026-10-06T12:00:00Z')
  state.index.mockImplementation(async () => ({ data: state.rows, error: null }))
  state.signals.mockResolvedValue([])
})
const checkpoint = () => ({ ...createTerritoryCheckpoint(), baseline: '2026-10-06T10:00:00Z' })

test('unchanged scope reads only scoped indexes and no building bodies', async () => {
  const sync = vi.fn()
  await recoverRecipientBuildings([1], [10], checkpoint(), sync)
  expect(sync).not.toHaveBeenCalled()
  expect(state.filters).toEqual([[1]])
  expect(state.signals).toHaveBeenCalledWith([1], '2026-10-06T09:59:30.000Z')
})
test('changes, new buildings and deletions are reconciled then unchanged signals are deduplicated', async () => {
  const cp = checkpoint(), sync = vi.fn().mockResolvedValue(undefined)
  state.rows = [{ id: 10, card_id: 1 }, { id: 11, card_id: 1 }]
  state.signals.mockResolvedValue([{ building_id: 10, card_id: 1, revision: 2, changed_at: '2026-10-06T11:00:00Z' }])
  await recoverRecipientBuildings([1], [10, 12], cp, sync)
  expect(sync).toHaveBeenCalledExactlyOnceWith([10, 11, 12])
  sync.mockClear()
  await recoverRecipientBuildings([1], [10, 11], cp, sync)
  expect(sync).not.toHaveBeenCalled()
})
test('failed sync does not advance watermark or acknowledge signals', async () => {
  const cp = checkpoint()
  state.signals.mockResolvedValue([{ building_id: 10, card_id: 1, revision: 2, changed_at: '2026-10-06T11:00:00Z' }])
  await expect(recoverRecipientBuildings([1], [10], cp, vi.fn().mockRejectedValue(new Error('offline')))).rejects.toThrow('offline')
  expect(cp.buildingsThrough).toBeNull()
  expect(cp.applied.size).toBe(0)
})
test('foreign index rows are rejected before sync and foreign boundaries are rejected', async () => {
  state.rows = [{ id: 99, card_id: 99 }]
  const sync = vi.fn()
  await expect(recoverRecipientBuildings([1], [10], checkpoint(), sync)).rejects.toThrow('Invalid scoped')
  expect(sync).not.toHaveBeenCalled()
  await expect(readRecipientBoundaries([1])).rejects.toThrow('Invalid scoped')
})

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

test('clock precedes parallel indexes and neither partial result can start sync', async () => {
  const clock = deferred<string>(), signal = deferred<unknown[]>(), index = deferred<{ data: { id: number; card_id: number }[]; error: null }>()
  state.clock.mockReturnValue(clock.promise); state.signals.mockReturnValue(signal.promise); state.index.mockReturnValue(index.promise)
  const cp = checkpoint(), sync = vi.fn(), pending = recoverRecipientBuildings([1], [10], cp, sync)
  await Promise.resolve()
  expect(state.signals).not.toHaveBeenCalled(); expect(state.index).not.toHaveBeenCalled()
  clock.resolve('2026-10-06T12:00:00Z')
  await vi.waitFor(() => expect(state.index).toHaveBeenCalledTimes(1))
  expect(state.signals).toHaveBeenCalledTimes(1)
  index.resolve({ data: [{ id: 11, card_id: 1 }], error: null })
  await Promise.resolve()
  expect(sync).not.toHaveBeenCalled(); expect(cp.buildingsThrough).toBeNull()
  signal.resolve([])
  await pending
  expect(sync).toHaveBeenCalledExactlyOnceWith([11, 10])
  expect(cp.buildingsThrough).toBe('2026-10-06T12:00:00Z')
})

test.each(['signals', 'index'] as const)('failed %s waits for its sibling before falling back', async failed => {
  const signal = deferred<unknown[]>(), index = deferred<{ data: { id: number; card_id: number }[]; error: null }>()
  state.signals.mockReturnValue(signal.promise); state.index.mockReturnValue(index.promise)
  const cp = checkpoint(), sync = vi.fn(), settled = vi.fn()
  const pending = recoverRecipientBuildings([1], [10], cp, sync).then(settled, error => settled(error.message))
  await vi.waitFor(() => expect(state.index).toHaveBeenCalledTimes(1))
  if (failed === 'signals') signal.reject(new Error('offline'))
  else index.reject(new Error('offline'))
  await new Promise(resolve => setTimeout(resolve, 0))
  expect(settled).not.toHaveBeenCalled()
  if (failed === 'signals') index.resolve({ data: state.rows, error: null })
  else signal.resolve([])
  await pending
  expect(settled).toHaveBeenCalledExactlyOnceWith('offline')
  expect(sync).not.toHaveBeenCalled(); expect(cp.buildingsThrough).toBeNull(); expect(cp.applied.size).toBe(0)
})
