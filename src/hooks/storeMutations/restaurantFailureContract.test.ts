import { beforeEach, expect, test, vi } from 'vitest'
import { makeRestaurantServiceMutations } from './restaurantService'

const state = vi.hoisted(() => ({ error: null as unknown, rows: [{ id: 61 }], report: vi.fn() }))
vi.mock('../../lib/authToken', () => ({ getAuthToken: () => 'test-token' }))
vi.mock('./shared', () => ({
  supabase: {
    from: () => ({ update: () => ({ eq: () => ({ select: async () => ({ data: state.rows, error: state.error }) }) }) }),
    rpc: async () => ({ data: { unit_id: 99 }, error: null }),
  },
  ensureAffectedRows: (rows: unknown[]) => rows.length > 0,
  reportMutationError: state.report, showToast: vi.fn(),
}))
beforeEach(() => { state.error = null; state.rows = [{ id: 61 }]; state.report.mockClear() })

test.each(['error', 'empty'])('memo %s result must preserve draft via false return', async (failure) => {
  if (failure === 'error') state.error = new Error('offline')
  else state.rows = []
  const refresh = vi.fn()
  const mutations = makeRestaurantServiceMutations({ fetchAll: refresh, buildings: [], cardBoundaries: [] })
  await expect(mutations.updateRestaurantRequestMemo(61, 'draft')).resolves.toBe(false)
  expect(refresh).not.toHaveBeenCalled()
})

test.each(['memo', 'approve', 'reject'])('%s distinguishes committed write from refresh failure', async (action) => {
  const refresh = vi.fn().mockRejectedValue(new Error('refresh offline'))
  const mutations = makeRestaurantServiceMutations({ fetchAll: refresh, buildings: [], cardBoundaries: [] })
  if (action === 'memo') await expect(mutations.updateRestaurantRequestMemo(61, 'draft')).resolves.toBe(true)
  if (action === 'approve') await expect(mutations.approveRestaurantRequest(61, { name: 'test', address: 'test', reviewer: 'admin', lat: 37, lng: 127 })).resolves.toBeUndefined()
  if (action === 'reject') await expect(mutations.rejectRestaurantRequest(61, 'admin')).resolves.toBeUndefined()
  expect(state.report).toHaveBeenCalledWith(expect.stringContaining('목록을 새로 불러오지 못했습니다'), expect.any(Error))
  expect(refresh).toHaveBeenCalledOnce()
})
