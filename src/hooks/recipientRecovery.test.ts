import { beforeEach, expect, test, vi } from 'vitest'
import { createTerritoryCheckpoint } from './territoryRealtimeContext'
import { recoverRecipientBuildings, readRecipientBoundaries } from './recipientRecovery'

const state = vi.hoisted(() => ({ signals: vi.fn(), rows: [] as { id: number; card_id: number }[], filters: [] as number[][] }))
vi.mock('./territorySync', () => ({ fetchTerritoryClock: async () => '2026-10-06T12:00:00Z', fetchTerritorySignals: state.signals }))
vi.mock('../lib/supabase', () => ({ supabase: { from: () => {
  const q = { select: () => q, order: () => q, in: (_key: string, ids: number[]) => { state.filters.push(ids); return q },
    range: async () => ({ data: state.rows, error: null }) }
  return q
} } }))
beforeEach(() => { vi.clearAllMocks(); state.rows = [{ id: 10, card_id: 1 }]; state.filters = []; state.signals.mockResolvedValue([]) })
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
