import { beforeEach, describe, expect, test, vi } from 'vitest'

const state = vi.hoisted(() => ({
  result: { data: [] as Array<{ id: number }>, error: null as unknown },
  select: vi.fn(),
  toast: vi.fn(),
  reportError: vi.fn(),
  log: vi.fn(),
}))

vi.mock('./shared', () => ({
  supabase: {
    from: () => ({
      update: () => ({
        eq: () => ({ select: state.select }),
      }),
    }),
  },
  showToast: state.toast,
  reportMutationError: state.reportError,
  ensureAffectedRows: (data: unknown[] | null | undefined, message: string) => {
    if (Array.isArray(data) && data.length > 0) return true
    state.reportError(message, expect.anything())
    return false
  },
}))
vi.mock('./serviceLog', () => ({ logServiceAction: state.log }))

const { makeBuildingMutations } = await import('./buildings')

function mutations() {
  return makeBuildingMutations({
    role: 'admin',
    fetchAll: vi.fn().mockResolvedValue(undefined),
    buildings: [],
    cards: [],
    appendUnits: vi.fn(),
    removeUnit: vi.fn(),
  })
}

describe('건물 수정 결과 계약', () => {
  beforeEach(() => {
    state.result = { data: [], error: null }
    state.select.mockReset().mockImplementation(() => Promise.resolve(state.result))
    state.toast.mockReset()
    state.reportError.mockReset()
    state.log.mockReset()
  })

  test.each([
    ['건물 정보', (store: ReturnType<typeof mutations>) => store.updateBuilding(7, '건물', '주소')],
    ['담당 카드', (store: ReturnType<typeof mutations>) => store.moveBuildingToCard(7, 3)],
  ])('RLS가 0행을 돌려주면 %s 수정을 성공으로 보지 않는다', async (_label, update) => {
    await expect(update(mutations())).resolves.toBe(false)
    expect(state.select).toHaveBeenCalledWith('id')
    expect(state.toast).not.toHaveBeenCalled()
  })

  test.each([
    ['건물 정보', (store: ReturnType<typeof mutations>) => store.updateBuilding(7, '건물', '주소')],
    ['담당 카드', (store: ReturnType<typeof mutations>) => store.moveBuildingToCard(7, 3)],
  ])('한 행이 바뀐 때만 %s 수정 성공을 돌려준다', async (_label, update) => {
    state.result = { data: [{ id: 7 }], error: null }
    await expect(update(mutations())).resolves.toBe(true)
  })
})
