import { beforeEach, expect, test, vi } from 'vitest'
const state = vi.hoisted(() => ({ token: 'token', rpc: vi.fn(), from: vi.fn() }))
vi.mock('./authToken', () => ({ getAuthToken: () => state.token }))
vi.mock('./supabase', () => ({ supabase: { rpc: state.rpc, from: state.from } }))
import { createRestaurantCatalog } from './restaurantCatalog'
const query = { search: '', region: null, area: null, all: true }
const row = (id: number) => ({ building_id: id, unit_id: null, card_id: 1, name: 'Cafe', address: '', region: 'A', area: 'A1' })
beforeEach(() => { vi.clearAllMocks(); state.token = 'token' })
test('idle performs no request and lookahead is not displayed or skipped', async () => {
  const api = createRestaurantCatalog()
  expect(await api.page({ ...query, all: false })).toEqual({ items: [], more: false })
  expect(state.rpc).not.toHaveBeenCalled()
  state.rpc.mockResolvedValue({ data: Array.from({ length: 21 }, (_, i) => row(i + 1)), error: null })
  const first = await api.page(query)
  expect(first.items).toHaveLength(20); expect(first.more).toBe(true)
  state.rpc.mockResolvedValue({ data: [row(21)], error: null })
  expect((await api.page(query, first.items.at(-1))).items).toEqual([row(21)])
  expect(state.rpc.mock.calls[1][1]).toMatchObject({ p_after_building: 20, p_after_unit: 0 })
})
test('foreign region, duplicate cursor, invalid response and changed account fail closed', async () => {
  const api = createRestaurantCatalog()
  state.rpc.mockResolvedValue({ data: [row(1)], error: null })
  await expect(api.page({ ...query, region: 'B' })).rejects.toThrow('Invalid')
  await expect(api.page(query, row(1))).rejects.toThrow('Invalid')
  state.rpc.mockResolvedValue({ data: null, error: null })
  await expect(api.page(query)).rejects.toThrow('Invalid')
  state.rpc.mockImplementation(async () => { state.token = 'other'; return { data: [row(1)], error: null } })
  await expect(api.page(query)).rejects.toThrow('session changed')
})

test('selection fetches one building and its units, and refuses deleted or reclassified restaurants', async () => {
  const eq = vi.fn()
  const building = { id: 7, card_id: 1, name: 'Building', address: 'A', type: '상가', lat: 37, lng: 127, is_restaurant: false }
  const unit = { id: 10, building_id: 7, number: 'Cafe', status: '미방문', is_chinese: true, is_restaurant: true, regular_visits: [] }
  state.from.mockImplementation((table: string) => {
    const q = {
      select: () => q, eq: (...args: unknown[]) => { eq(table, ...args); return q }, order: () => q,
      single: async () => ({ data: building, error: null }),
      range: async () => ({ data: [unit], error: null }),
    }
    return q
  })
  const api = createRestaurantCatalog()
  const selected = { ...row(7), unit_id: 10 }
  const result = await api.detail(selected)
  expect(result.building.id).toBe(7)
  expect(result.unit?.id).toBe(10)
  expect(eq.mock.calls).toEqual([['buildings', 'id', 7], ['units', 'building_id', 7]])
  unit.is_restaurant = false
  await expect(api.detail(selected)).rejects.toThrow('Restaurant changed')
  building.card_id = 2
  await expect(api.detail(selected)).rejects.toThrow('Restaurant unavailable')
})
