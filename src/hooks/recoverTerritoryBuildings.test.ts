import { beforeEach, expect, test, vi } from 'vitest'
import { createTerritoryCheckpoint } from './territoryRealtimeContext'
import { recoverTerritoryBuildings } from './recoverTerritoryBuildings'

const api = vi.hoisted(() => ({ clock: vi.fn(), index: vi.fn() }))
vi.mock('./territorySync', () => ({ fetchTerritoryClock: api.clock, fetchBuildingRecoveryIndex: api.index }))
const row = { building_id: 1, card_id: 9, revision: 3, changed_at: '2026-09-30T12:00:10Z' }
beforeEach(() => {
  vi.resetAllMocks()
  api.clock.mockResolvedValue('2026-09-30T12:01:00Z')
})
const checkpoint = () => ({ ...createTerritoryCheckpoint(), baseline: '2026-09-30T12:00:00Z' })

test('unchanged recovery only reads metadata, including delayed second recovery', async () => {
  const state = checkpoint(), sync = vi.fn()
  api.index.mockResolvedValue({ signals: [], ids: [1, 2] })
  await recoverTerritoryBuildings(state, [1, 2], sync)
  api.clock.mockResolvedValue('2026-09-30T12:02:00Z')
  await recoverTerritoryBuildings(state, [1, 2], sync)
  expect(sync).not.toHaveBeenCalled()
  expect(api.index).toHaveBeenLastCalledWith('2026-09-30T12:00:30.000Z')
})

test('recovers changed, new, deleted buildings and ignores unchanged ones', async () => {
  const state = checkpoint(), sync = vi.fn()
  api.index.mockResolvedValue({ signals: [row], ids: [1, 2, 4] })
  await recoverTerritoryBuildings(state, [1, 2, 3], sync)
  expect(sync).toHaveBeenCalledExactlyOnceWith([1, 4, 3])
  expect(state.baseline).toBe('2026-09-30T12:00:00Z')
  expect(state.buildingsThrough).toBe('2026-09-30T12:01:00Z')
})

test('shared live versions prevent repeat body downloads but a new revision is fetched', async () => {
  const state = checkpoint(), sync = vi.fn()
  api.index.mockResolvedValue({ signals: [row], ids: [1] })
  await recoverTerritoryBuildings(state, [1], sync)
  await recoverTerritoryBuildings(state, [1], sync)
  expect(sync).toHaveBeenCalledTimes(1)
  api.index.mockResolvedValue({ signals: [{ ...row, revision: 4 }], ids: [1] })
  await recoverTerritoryBuildings(state, [1], sync)
  expect(sync).toHaveBeenCalledTimes(2)
})

test('partial batch failure never advances the watermark or marks signals as applied', async () => {
  const state = checkpoint(), sync = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('offline'))
  api.index.mockResolvedValue({ signals: [row], ids: Array.from({ length: 21 }, (_, i) => i + 1) })
  await expect(recoverTerritoryBuildings(state, [], sync)).rejects.toThrow('offline')
  expect(sync.mock.calls.map(([ids]) => ids.length)).toEqual([20, 1])
  expect(state.buildingsThrough).toBeNull()
  expect(state.applied.size).toBe(0)
})

test('clock/index failure cannot be interpreted as deletion', async () => {
  const state = checkpoint(), sync = vi.fn()
  api.index.mockRejectedValue(new Error('index unavailable'))
  await expect(recoverTerritoryBuildings(state, [1], sync)).rejects.toThrow()
  expect(sync).not.toHaveBeenCalled()
  expect(state.buildingsThrough).toBeNull()
})
