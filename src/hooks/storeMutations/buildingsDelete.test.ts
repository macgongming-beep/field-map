import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  toast: vi.fn(),
  error: vi.fn(),
  prompt: vi.fn(),
}))

vi.mock('../../lib/authToken', () => ({ getAuthToken: () => '00000000-0000-0000-0000-000000000008' }))
vi.mock('../../lib/confirm', () => ({ promptDialog: mocks.prompt }))
vi.mock('./shared', () => ({
  supabase: { rpc: mocks.rpc },
  showToast: mocks.toast,
  reportMutationError: mocks.error,
}))
vi.mock('./serviceLog', () => ({ logServiceAction: vi.fn() }))

beforeEach(() => {
  mocks.rpc.mockReset()
  mocks.toast.mockReset()
  mocks.error.mockReset()
  mocks.prompt.mockReset().mockResolvedValue('테스트 삭제 사유')
})

async function mutations() {
  const { makeBuildingMutations } = await import('./buildings')
  return makeBuildingMutations({
    fetchAll: vi.fn().mockResolvedValue(undefined),
    buildings: [],
    cards: [],
    appendUnits: vi.fn(),
    removeUnit: vi.fn(),
  })
}

describe('건물·세대 안전 삭제', () => {
  it('서버가 빈 세대를 삭제하면 화면에서도 제거한다', async () => {
    mocks.rpc.mockResolvedValue({ data: { ok: true, action: 'deleted' }, error: null })
    const store = await mutations()
    await store.deleteUnitFromBuilding(3, 7)
    expect(mocks.rpc).toHaveBeenCalledWith('delete_place_or_request_tx', expect.objectContaining({
      p_target_type: 'unit', p_target_id: 7,
    }))
    expect(mocks.toast).toHaveBeenCalledWith('호수가 삭제됐습니다')
  })

  it('연결 자료가 있으면 삭제 성공으로 말하지 않고 관리자 요청을 알린다', async () => {
    mocks.rpc.mockResolvedValue({ data: { ok: true, action: 'requested' }, error: null })
    const store = await mutations()
    await store.deleteBuilding(9)
    expect(mocks.toast).toHaveBeenCalledWith('연결된 자료가 있어 삭제 요청으로 접수했습니다')
    expect(mocks.toast).not.toHaveBeenCalledWith('건물이 삭제됐습니다')
  })

  it('일괄 삭제는 항목마다 토스트하지 않고 결과를 한 번만 알린다', async () => {
    mocks.rpc
      .mockResolvedValueOnce({ data: { ok: true, action: 'deleted' }, error: null })
      .mockResolvedValueOnce({ data: { ok: true, action: 'requested' }, error: null })
      .mockResolvedValueOnce({ data: { ok: true, action: 'deleted' }, error: null })
    const store = await mutations()
    await store.deleteBuildings([1, 2, 3])
    expect(mocks.toast).toHaveBeenCalledTimes(1)
    expect(mocks.toast).toHaveBeenCalledWith('건물 2개 삭제 · 1개 삭제 요청')
    expect(mocks.prompt).toHaveBeenCalledTimes(1)
    expect(mocks.rpc).toHaveBeenCalledTimes(3)
    for (const [, payload] of mocks.rpc.mock.calls) {
      expect(payload.p_note).toBe('테스트 삭제 사유')
    }
  })

  it('일괄 삭제 사유가 공백이면 다시 묻거나 RPC를 호출하지 않는다', async () => {
    mocks.prompt.mockResolvedValue('   ')
    const store = await mutations()
    await store.deleteBuildings([1, 2, 3])
    expect(mocks.prompt).toHaveBeenCalledTimes(1)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
})
