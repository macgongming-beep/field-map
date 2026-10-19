import { beforeEach, expect, test, vi } from 'vitest'
import { makeBuildingMutations } from './buildings'

const state = vi.hoisted(() => ({ error: null as unknown }))
vi.mock('../../lib/authToken', () => ({ getAuthToken: () => 'test-token' }))
vi.mock('./serviceLog', () => ({ logServiceAction: vi.fn() }))
vi.mock('./shared', () => ({
  supabase: {
    from: () => ({ update: () => ({ eq: () => ({
      select: async () => ({ data: [{ id: 7 }], error: state.error }),
      then: (resolve: (v: unknown) => void) => resolve({ error: state.error }),
    }) }) }),
    rpc: async () => ({ data: { ok: true }, error: state.error }),
  },
  ensureAffectedRows: (rows: unknown[]) => rows.length > 0,
  showToast: vi.fn(), reportMutationError: vi.fn(),
}))
beforeEach(() => { state.error = null })

const actions = ['info', 'access', 'surveyed'] as const
function setup() {
  const fetchAll = vi.fn().mockResolvedValue(undefined)
  const refreshBuilding = vi.fn().mockResolvedValue(undefined)
  const mutations = makeBuildingMutations({ role: 'admin', fetchAll, refreshBuilding,
    buildings: [], cards: [], appendUnits: vi.fn(), removeUnit: vi.fn() })
  const run = (action: typeof actions[number]) => action === 'info'
    ? mutations.updateBuilding(7, 'name', 'address', undefined, undefined, undefined, 'memo')
    : action === 'access' ? mutations.setBuildingAccess(7, true) : mutations.setUnitsSurveyed(7, true)
  return { fetchAll, refreshBuilding, run }
}
test.each(actions)('%s refreshes only the changed building', async (action) => {
  const { fetchAll, refreshBuilding, run } = setup()
  await expect(run(action)).resolves.toBe(true)
  expect(refreshBuilding).toHaveBeenCalledExactlyOnceWith(7)
  expect(fetchAll).not.toHaveBeenCalled()
})
test.each(actions)('%s recovers with the existing list read if targeted refresh fails', async (action) => {
  const { fetchAll, refreshBuilding, run } = setup()
  refreshBuilding.mockRejectedValueOnce(new Error('offline'))
  await expect(run(action)).resolves.toBe(true)
  expect(refreshBuilding).toHaveBeenCalledExactlyOnceWith(7)
  expect(fetchAll).toHaveBeenCalledOnce()
})
test.each(actions)('%s does not refresh after a failed write', async (action) => {
  const { fetchAll, refreshBuilding, run } = setup()
  state.error = new Error('offline')
  await expect(run(action)).resolves.toBe(false)
  expect(refreshBuilding).not.toHaveBeenCalled()
  expect(fetchAll).not.toHaveBeenCalled()
})
