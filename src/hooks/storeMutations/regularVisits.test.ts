import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  token: '00000000-0000-0000-0000-000000000007' as string | null,
  rpc: vi.fn(),
  toast: vi.fn(),
  error: vi.fn(),
  update: vi.fn(),
  eq: vi.fn(),
  select: vi.fn(),
}))

vi.mock('../../lib/authToken', () => ({ getAuthToken: () => mocks.token }))
vi.mock('./shared', () => ({
  supabase: { rpc: mocks.rpc, from: () => ({ update: (value: unknown) => {
    mocks.update(value)
    return { eq: mocks.eq }
  } }) },
  showToast: mocks.toast,
  reportMutationError: mocks.error,
  requireVisitor: vi.fn(),
  ensureAffectedRows: (rows: unknown[] | null) => Boolean(rows?.length),
}))

beforeEach(() => {
  mocks.token = '00000000-0000-0000-0000-000000000007'
  mocks.rpc.mockReset().mockResolvedValue({ data: { ok: true, request_id: 9 }, error: null })
  mocks.toast.mockReset()
  mocks.error.mockReset()
  mocks.update.mockReset()
  mocks.select.mockReset().mockResolvedValue({ data: [{ id: 31 }], error: null })
  mocks.eq.mockReset().mockReturnValue({ select: mocks.select })
})

describe('address-only refresh', () => {
  it.each([false, true])('uses narrow refresh with full fallback on failure=%s', async (fails) => {
    const { makeRegularVisitMutations } = await import('./regularVisits')
    const fetchAll = vi.fn().mockResolvedValue(undefined)
    const refreshAddress = fails ? vi.fn().mockRejectedValue(new Error('offline')) : vi.fn().mockResolvedValue(undefined)
    const mutations = makeRegularVisitMutations({ fetchAll, refreshAddress, buildings: [], cards: [], returnVisits: [] })
    expect(await mutations.updateReturnVisitAddress(31, ' new address ')).toBe(true)
    expect(mocks.select).toHaveBeenCalledWith('id')
    expect(mocks.update).toHaveBeenCalledWith({ address: 'new address' })
    expect(mocks.eq).toHaveBeenCalledWith('id', 31)
    expect(refreshAddress).toHaveBeenCalledOnce()
    expect(fetchAll).toHaveBeenCalledTimes(fails ? 1 : 0)
  })
  it.each(['error', 'zero', 'throw'])('does not refresh or report success after write %s', async (failure) => {
    const { makeRegularVisitMutations } = await import('./regularVisits')
    if (failure === 'throw') mocks.select.mockRejectedValue(new Error('offline'))
    else mocks.select.mockResolvedValue({ data: [], error: failure === 'error' ? new Error('offline') : null })
    const fetchAll = vi.fn(), refreshAddress = vi.fn()
    expect(await makeRegularVisitMutations({ fetchAll, refreshAddress, buildings: [], cards: [], returnVisits: [] }).updateReturnVisitAddress(31, 'new')).toBe(false)
    expect(refreshAddress).not.toHaveBeenCalled()
    expect(fetchAll).not.toHaveBeenCalled()
    expect(mocks.toast).not.toHaveBeenCalled()
  })
})

describe('정기방문 종료 mutation', () => {
  it('종료 사유와 장소 문제를 하나의 RPC에 전달하고 성공 뒤 다시 읽는다', async () => {
    const { makeRegularVisitMutations } = await import('./regularVisits')
    const fetchAll = vi.fn().mockResolvedValue(undefined)
    const mutations = makeRegularVisitMutations({ fetchAll, buildings: [], cards: [], returnVisits: [] })

    const ok = await mutations.deleteReturnVisit(31, {
      reason: 'needs_reassignment',
      issueType: 'building_missing',
      issueNote: '철거됐습니다. ',
    })

    expect(ok).toBe(true)
    expect(mocks.rpc).toHaveBeenCalledWith('end_return_visit_tx', {
      p_token: mocks.token,
      p_return_visit_id: 31,
      p_reason: 'needs_reassignment',
      p_issue_type: 'building_missing',
      p_issue_note: '철거됐습니다.',
    })
    expect(fetchAll).toHaveBeenCalledOnce()
    expect(mocks.toast).toHaveBeenCalledWith('정기방문을 종료하고 장소 수정 요청을 보냈습니다')
  })

  it('서버가 거부하면 다시 읽거나 성공 알림을 내지 않는다', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: '42501', message: '권한 없음' } })
    const { makeRegularVisitMutations } = await import('./regularVisits')
    const fetchAll = vi.fn()
    const mutations = makeRegularVisitMutations({ fetchAll, buildings: [], cards: [], returnVisits: [] })

    expect(await mutations.deleteReturnVisit(31, { reason: 'no_longer_assigned' })).toBe(false)
    expect(fetchAll).not.toHaveBeenCalled()
    expect(mocks.toast).not.toHaveBeenCalled()
    expect(mocks.error).toHaveBeenCalledOnce()
  })

  it('토큰이 없으면 RPC를 호출하지 않는다', async () => {
    mocks.token = null
    const { makeRegularVisitMutations } = await import('./regularVisits')
    const mutations = makeRegularVisitMutations({ fetchAll: vi.fn(), buildings: [], cards: [], returnVisits: [] })

    expect(await mutations.deleteReturnVisit(31, { reason: 'no_longer_assigned' })).toBe(false)
    expect(mocks.rpc).not.toHaveBeenCalled()
    expect(mocks.toast).toHaveBeenCalledWith('다시 로그인해 주세요.', 'error')
  })
})
