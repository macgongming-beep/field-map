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
        eq: () => Object.assign(Promise.resolve(state.result), { select: state.select }),
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

function mutations(overrides: Partial<Parameters<typeof makeBuildingMutations>[0]> = {}) {
  return makeBuildingMutations({
    role: 'admin',
    fetchAll: vi.fn().mockResolvedValue(undefined),
    buildings: [],
    cards: [],
    appendUnits: vi.fn(),
    removeUnit: vi.fn(),
    ...overrides,
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

  test.each(['absent', 'narrow', 'fallback'])('single card move refresh: %s', async (mode) => {
    state.result = { data: [{ id: 7 }], error: null }
    const fetchAll = vi.fn().mockResolvedValue(undefined)
    const refreshMovedBuilding = mode === 'absent' ? undefined : mode === 'narrow'
      ? vi.fn().mockResolvedValue(undefined) : vi.fn().mockRejectedValue(new Error('offline'))
    expect(await mutations({ fetchAll, refreshMovedBuilding }).moveBuildingToCard(7, 3)).toBe(true)
    if (refreshMovedBuilding) expect(refreshMovedBuilding).toHaveBeenCalledExactlyOnceWith(7)
    expect(fetchAll).toHaveBeenCalledTimes(mode === 'narrow' ? 0 : 1)
    expect(state.toast).toHaveBeenCalledWith('건물 카드가 변경됐습니다')
  })

  test.each(['zero', 'error'])('failed card move does not refresh: %s', async (mode) => {
    state.result = { data: [], error: mode === 'error' ? new Error('denied') : null }
    const fetchAll = vi.fn(), refreshMovedBuilding = vi.fn()
    expect(await mutations({ fetchAll, refreshMovedBuilding }).moveBuildingToCard(7, 3)).toBe(false)
    expect(refreshMovedBuilding).not.toHaveBeenCalled()
    expect(fetchAll).not.toHaveBeenCalled()
    expect(state.toast).not.toHaveBeenCalled()
  })

  test.each([false, true])('final refresh failure retains rejection without success (targeted=%s)', async (targeted) => {
    state.result = { data: [{ id: 7 }], error: null }
    const fetchAll = vi.fn().mockRejectedValue(new Error('recovery failed'))
    const refreshMovedBuilding = targeted ? vi.fn().mockRejectedValue(new Error('offline')) : undefined
    await expect(mutations({ fetchAll, refreshMovedBuilding }).moveBuildingToCard(7, 3)).rejects.toThrow('recovery failed')
    expect(fetchAll).toHaveBeenCalledOnce()
    expect(state.toast).not.toHaveBeenCalled()
  })

  test('bulk reassignment does not use the single-move callback', async () => {
    state.result = { data: [], error: null }
    const fetchAll = vi.fn(), refreshMovedBuilding = vi.fn()
    expect(await mutations({ fetchAll, refreshMovedBuilding }).reassignBuildingsToCards([
      { buildingId: 7, cardId: 3 }, { buildingId: 8, cardId: 3 },
    ])).toEqual({ updated: 2, failed: 0 })
    expect(fetchAll).toHaveBeenCalledOnce()
    expect(refreshMovedBuilding).not.toHaveBeenCalled()
    expect(state.select).not.toHaveBeenCalled()
  })
})
