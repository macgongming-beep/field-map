import { beforeEach, describe, expect, test, vi } from 'vitest'

const state = vi.hoisted(() => ({
  rpc: vi.fn(),
  toast: vi.fn(),
  error: vi.fn(),
  fetchAll: vi.fn(),
}))

vi.mock('../../lib/authToken', () => ({
  getAuthToken: () => '00000000-0000-0000-0000-000000000008',
}))
vi.mock('../../lib/confirm', () => ({ promptDialog: vi.fn() }))
vi.mock('./shared', () => ({
  supabase: { rpc: state.rpc },
  showToast: state.toast,
  reportMutationError: state.error,
  ensureAffectedRows: vi.fn(),
}))
vi.mock('./serviceLog', () => ({ logServiceAction: vi.fn() }))

const { makeBuildingMutations } = await import('./buildings')

function mutations() {
  return makeBuildingMutations({
    role: 'user',
    fetchAll: state.fetchAll,
    buildings: [{ id: 7, name: '기존 건물', address: '언동로 213', units: [] } as never],
    cards: [{ id: 3, name: '기흥구 구갈동 1' } as never],
    appendUnits: vi.fn(),
    removeUnit: vi.fn(),
  })
}

const input = {
  cardId: 3,
  name: '언동로 213',
  address: '경기도 용인시 기흥구 언동로 213',
  type: '주택' as const,
  lat: 37.1,
  lng: 127.1,
}

describe('건물 등록 RPC', () => {
  beforeEach(() => {
    state.rpc.mockReset()
    state.toast.mockReset()
    state.error.mockReset()
    state.fetchAll.mockReset()
  })

  test('PC와 모바일이 쓰는 생성 함수는 직접 insert 대신 RPC를 호출한다', async () => {
    state.rpc.mockResolvedValue({ data: { ok: true, action: 'created', building_id: 91 }, error: null })
    await expect(mutations().createBuilding(input)).resolves.toBe(true)
    expect(state.rpc).toHaveBeenCalledWith('create_building_tx', expect.objectContaining({
      p_card_id: 3,
      p_address: input.address,
      p_lat: input.lat,
      p_lng: input.lng,
    }))
    expect(state.fetchAll).toHaveBeenCalledTimes(1)
  })

  test('후보 한 개면 새 건물 성공으로 처리하지 않는다', async () => {
    state.rpc.mockResolvedValue({ data: { ok: true, action: 'existing', building_id: 7 }, error: null })
    await expect(mutations().createBuilding(input)).resolves.toBe(false)
    expect(state.fetchAll).not.toHaveBeenCalled()
    expect(state.toast).toHaveBeenCalledWith('이미 등록된 건물입니다: 기존 건물', 'info')
  })

  test('후보 여러 개면 선택 안내를 하고 생성하지 않는다', async () => {
    state.rpc.mockResolvedValue({ data: { ok: false, action: 'ambiguous', candidate_ids: [7, 8] }, error: null })
    await expect(mutations().createBuilding(input)).resolves.toBe(false)
    expect(state.toast).toHaveBeenCalledWith('같은 주소의 건물이 여러 개입니다. 기존 건물을 선택해 주세요.', 'error')
  })
})
