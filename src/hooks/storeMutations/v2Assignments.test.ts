import { beforeEach, describe, expect, test, vi } from 'vitest'

const state = vi.hoisted(() => ({
  result: { data: [] as Array<{ id: number }>, error: null as unknown },
  select: vi.fn(),
  rpc: vi.fn(),
  toast: vi.fn(),
  storageRemove: vi.fn(),
}))

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: () => ({
      update: () => ({ eq: () => ({ select: state.select }) }),
      insert: () => ({ select: state.select }),
      delete: () => ({ eq: () => ({ select: state.select }) }),
    }),
    rpc: state.rpc,
    storage: { from: () => ({ remove: state.storageRemove }) },
  },
}))
vi.mock('../../lib/toast', () => ({ showToast: state.toast }))
vi.mock('../../lib/authToken', () => ({ getAuthToken: () => '00000000-0000-4000-8000-000000000001' }))

const { makeV2AssignmentMutations } = await import('./v2Assignments')

describe('비공식 그룹 쓰기 결과 계약', () => {
  beforeEach(() => {
    state.result = { data: [], error: null }
    state.select.mockReset().mockImplementation(() => Promise.resolve(state.result))
    // v2 RPC 는 지운 행의 사진 경로(text)를 돌려준다. 문자열이 아니면 실패다.
    state.rpc.mockReset().mockResolvedValue({ data: null, error: null })
    state.storageRemove.mockReset().mockResolvedValue({ data: [{ name: 'abc.png' }], error: null })
    state.toast.mockClear()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  test.each([
    ['이름 변경', (mutations: ReturnType<typeof makeV2AssignmentMutations>) => mutations.renameInformalGroup(7, '새 이름')],
    ['삭제', (mutations: ReturnType<typeof makeV2AssignmentMutations>) => mutations.deleteInformalGroup(7)],
  ])('RLS가 0행을 돌려주면 %s을 성공으로 보지 않는다', async (_label, mutate) => {
    const fetchAll = vi.fn()
    const mutations = makeV2AssignmentMutations({ fetchAll })

    await expect(mutate(mutations)).resolves.toBe(false)
    expect(state.select).toHaveBeenCalledWith('id')
    expect(fetchAll).not.toHaveBeenCalled()
    expect(state.toast).toHaveBeenCalledWith(
      expect.stringContaining('변경할 자료를 찾지 못했거나 권한이 없습니다.'),
      'error',
    )
  })

  test.each([
    ['이름 변경', (mutations: ReturnType<typeof makeV2AssignmentMutations>) => mutations.renameInformalGroup(7, '새 이름')],
    ['삭제', (mutations: ReturnType<typeof makeV2AssignmentMutations>) => mutations.deleteInformalGroup(7)],
  ])('한 행이 바뀐 때만 %s 성공을 돌려준다', async (_label, mutate) => {
    state.result = { data: [{ id: 7 }], error: null }
    const fetchAll = vi.fn().mockResolvedValue(undefined)
    const mutations = makeV2AssignmentMutations({ fetchAll })

    await expect(mutate(mutations)).resolves.toBe(true)
    expect(fetchAll).toHaveBeenCalledOnce()
  })

  test.each([
    ['장소 생성', (mutations: ReturnType<typeof makeV2AssignmentMutations>) => mutations.createInformalPlace({
      name: '장소', createdBy: '관리자', lat: 37.2, lng: 127.1,
    })],
    ['모양 저장', (mutations: ReturnType<typeof makeV2AssignmentMutations>) => mutations.saveInformalShape(7, 'route', [
      { lat: 37.2, lng: 127.1 }, { lat: 37.3, lng: 127.2 },
    ])],
    ['장소 수정', (mutations: ReturnType<typeof makeV2AssignmentMutations>) => mutations.updateInformalPlace(7, { name: '새 이름' })],
    ['그룹 이동', (mutations: ReturnType<typeof makeV2AssignmentMutations>) => mutations.moveAssetToGroup(7, 3)],
  ])('비공식 자료 %s이 0행이면 성공으로 보지 않는다', async (_label, mutate) => {
    const fetchAll = vi.fn()
    const mutations = makeV2AssignmentMutations({ fetchAll })

    await expect(mutate(mutations)).resolves.toBe(false)
    expect(fetchAll).not.toHaveBeenCalled()
  })

  test.each([
    ['장소 생성', (mutations: ReturnType<typeof makeV2AssignmentMutations>) => mutations.createInformalPlace({
      name: '장소', createdBy: '관리자', lat: 37.2, lng: 127.1,
    })],
    ['모양 저장', (mutations: ReturnType<typeof makeV2AssignmentMutations>) => mutations.saveInformalShape(7, 'route', [
      { lat: 37.2, lng: 127.1 }, { lat: 37.3, lng: 127.2 },
    ])],
    ['장소 수정', (mutations: ReturnType<typeof makeV2AssignmentMutations>) => mutations.updateInformalPlace(7, { name: '새 이름' })],
    ['그룹 이동', (mutations: ReturnType<typeof makeV2AssignmentMutations>) => mutations.moveAssetToGroup(7, 3)],
  ])('비공식 자료 %s은 한 행이 확인돼야 성공한다', async (_label, mutate) => {
    state.result = { data: [{ id: 7 }], error: null }
    const fetchAll = vi.fn().mockResolvedValue(undefined)
    const mutations = makeV2AssignmentMutations({ fetchAll })

    await expect(mutate(mutations)).resolves.toBe(true)
    expect(fetchAll).toHaveBeenCalledOnce()
  })

  test('삭제 RPC가 경로를 안 돌려주면 성공으로 보지 않는다', async () => {
    const fetchAll = vi.fn()
    const mutations = makeV2AssignmentMutations({ fetchAll })

    await expect(mutations.deleteInformalAsset(7)).resolves.toBe(false)
    expect(fetchAll).not.toHaveBeenCalled()
  })

  test('삭제 RPC가 경로를 돌려준 때만 성공한다', async () => {
    state.rpc.mockResolvedValue({ data: 'abc.png', error: null })
    const fetchAll = vi.fn().mockResolvedValue(undefined)
    const mutations = makeV2AssignmentMutations({ fetchAll })

    await expect(mutations.deleteInformalAsset(7)).resolves.toBe(true)
    expect(fetchAll).toHaveBeenCalledOnce()
  })

  // ── Storage 정리 ──────────────────────────────────
  // 버킷이 공개라 파일이 남으면 지운 뒤에도 주소만 알면 계속 보인다.

  test('자료를 지우면 Storage 사진도 지운다', async () => {
    state.rpc.mockResolvedValue({ data: 'abc.png', error: null })
    const mutations = makeV2AssignmentMutations({ fetchAll: vi.fn().mockResolvedValue(undefined) })

    await expect(mutations.deleteInformalAsset(7)).resolves.toBe(true)
    expect(state.storageRemove).toHaveBeenCalledWith(['abc.png'])
  })

  test('사진 경로를 따로 조회하지 않는다 — 서버가 돌려준 값만 쓴다', async () => {
    // 따로 조회하면 그 조회만 실패했을 때 행은 지워지고 파일이 남는다.
    // 또 조회와 삭제 사이에 사진이 바뀌면 옛 파일을 지운다.
    state.rpc.mockResolvedValue({ data: '서버가준경로.png', error: null })
    const mutations = makeV2AssignmentMutations({ fetchAll: vi.fn().mockResolvedValue(undefined) })

    await mutations.deleteInformalAsset(7)
    expect(state.storageRemove).toHaveBeenCalledWith(['서버가준경로.png'])
  })

  test('사진이 없는 자료는 Storage 를 건드리지 않는다', async () => {
    state.rpc.mockResolvedValue({ data: '', error: null })
    const mutations = makeV2AssignmentMutations({ fetchAll: vi.fn().mockResolvedValue(undefined) })

    await expect(mutations.deleteInformalAsset(7)).resolves.toBe(true)
    expect(state.storageRemove).not.toHaveBeenCalled()
  })

  test('Storage 가 0개를 지웠다면 파일이 남았다고 알린다', async () => {
    // ⚠ remove 는 정책으로 막혀도 오류가 아니라 빈 배열을 준다. 개수를 봐야 안다.
    state.rpc.mockResolvedValue({ data: 'abc.png', error: null })
    state.storageRemove.mockResolvedValue({ data: [], error: null })
    const mutations = makeV2AssignmentMutations({ fetchAll: vi.fn().mockResolvedValue(undefined) })

    await mutations.deleteInformalAsset(7)
    expect(state.toast).toHaveBeenCalledWith(
      expect.stringContaining('사진 파일이 남았습니다'),
      'error',
    )
  })

  test('권한 없음과 이미 없는 자료를 다른 문구로 알린다', async () => {
    const mutations = makeV2AssignmentMutations({ fetchAll: vi.fn() })

    state.rpc.mockResolvedValue({ data: null, error: { message: 'permission denied' } })
    await mutations.deleteInformalAsset(7)
    expect(state.toast).toHaveBeenCalledWith(expect.stringContaining('삭제 권한이 없습니다.'), 'error')

    state.toast.mockClear()
    state.rpc.mockResolvedValue({ data: null, error: { message: 'informal asset not found' } })
    await mutations.deleteInformalAsset(7)
    expect(state.toast).toHaveBeenCalledWith(expect.stringContaining('이미 지워진 자료입니다.'), 'error')
  })

  // ── 일괄 처리: 재조회는 딱 한 번 ────────────────────
  // 항목마다 다시 읽으면 20개 지울 때 슬라이스를 20번 읽는다.

  test('일괄 삭제는 항목이 몇 개든 재조회를 한 번만 한다', async () => {
    state.rpc.mockResolvedValue({ data: '', error: null })
    const fetchAll = vi.fn().mockResolvedValue(undefined)
    const mutations = makeV2AssignmentMutations({ fetchAll })

    const result = await mutations.deleteInformalAssets([1, 2, 3, 4, 5])
    expect(result.failed).toEqual([])
    expect(state.rpc).toHaveBeenCalledTimes(5)
    expect(fetchAll).toHaveBeenCalledOnce()
  })

  test('일괄 삭제는 실패한 id 만 돌려준다', async () => {
    // 2번과 4번만 권한으로 막힌다
    state.rpc.mockImplementation((_fn: string, args: { p_asset_id: number }) =>
      Promise.resolve(args.p_asset_id % 2 === 0
        ? { data: null, error: { message: 'permission denied' } }
        : { data: '', error: null }))
    const fetchAll = vi.fn().mockResolvedValue(undefined)
    const mutations = makeV2AssignmentMutations({ fetchAll })

    const result = await mutations.deleteInformalAssets([1, 2, 3, 4, 5])
    expect(result.failed).toEqual([2, 4])
    expect(fetchAll).toHaveBeenCalledOnce()
  })

  test('전부 실패해도 재조회는 한 번 한다', async () => {
    state.rpc.mockResolvedValue({ data: null, error: { message: 'permission denied' } })
    const fetchAll = vi.fn().mockResolvedValue(undefined)
    const mutations = makeV2AssignmentMutations({ fetchAll })

    const result = await mutations.deleteInformalAssets([7, 8])
    expect(result.failed).toEqual([7, 8])
    expect(fetchAll).toHaveBeenCalledOnce()
  })

  test('하나가 예외를 던져도 재조회는 반드시 실행된다', async () => {
    // ⚠ 여기가 핵심이다. 던진 뒤 재조회를 건너뛰면, 성공한 삭제가 화면에
    //   안 비쳐서 사용자는 안 지워진 줄 알고 다시 누른다.
    state.rpc.mockImplementation((_fn: string, args: { p_asset_id: number }) =>
      args.p_asset_id === 2
        ? Promise.reject(new Error('네트워크 끊김'))
        : Promise.resolve({ data: '', error: null }))
    const fetchAll = vi.fn().mockResolvedValue(undefined)
    const mutations = makeV2AssignmentMutations({ fetchAll })

    const result = await mutations.deleteInformalAssets([1, 2, 3])
    expect(result.failed).toEqual([2])
    expect(fetchAll).toHaveBeenCalledOnce()
  })

  test('빈 목록은 서버도 재조회도 건드리지 않는다', async () => {
    const fetchAll = vi.fn()
    const mutations = makeV2AssignmentMutations({ fetchAll })

    expect((await mutations.deleteInformalAssets([])).failed).toEqual([])
    expect(state.rpc).not.toHaveBeenCalled()
    expect(fetchAll).not.toHaveBeenCalled()
  })

  test('일괄 이동도 재조회를 한 번만 하고 실패한 id 를 돌려준다', async () => {
    let call = 0
    state.select.mockImplementation(() => {
      call += 1
      // 두 번째만 0행 (권한 없음)
      return Promise.resolve({ data: call === 2 ? [] : [{ id: call }], error: null })
    })
    const fetchAll = vi.fn().mockResolvedValue(undefined)
    const mutations = makeV2AssignmentMutations({ fetchAll })

    const result = await mutations.moveAssetsToGroup([11, 12, 13], 5)
    expect(result.failed).toEqual([12])
    expect(fetchAll).toHaveBeenCalledOnce()
  })

  test('단건 삭제는 지금처럼 스스로 재조회한다', async () => {
    state.rpc.mockResolvedValue({ data: '', error: null })
    const fetchAll = vi.fn().mockResolvedValue(undefined)
    const mutations = makeV2AssignmentMutations({ fetchAll })

    await expect(mutations.deleteInformalAsset(7)).resolves.toBe(true)
    expect(fetchAll).toHaveBeenCalledOnce()
  })

  test('식당 해제는 변경 행을 확인하고 목록 재조회 전에 성공을 알린다', async () => {
    state.result = { data: [{ id: 17 }], error: null }
    const order: string[] = []
    state.toast.mockImplementation(() => order.push('toast'))
    const fetchAll = vi.fn().mockImplementation(async () => { order.push('fetch') })
    const mutations = makeV2AssignmentMutations({ fetchAll })

    await mutations.removeRestaurantUnit(17, 3)

    expect(state.select).toHaveBeenCalledWith('id')
    expect(order).toEqual(['toast', 'fetch'])
    expect(state.toast).toHaveBeenCalledWith('식당 목록에서 제거됐습니다.')
  })

  test('식당 해제가 0행이면 성공 알림이나 재조회를 하지 않는다', async () => {
    const fetchAll = vi.fn()
    const mutations = makeV2AssignmentMutations({ fetchAll })

    await mutations.removeRestaurantUnit(17, 3)

    expect(fetchAll).not.toHaveBeenCalled()
    expect(state.toast).not.toHaveBeenCalledWith('식당 목록에서 제거됐습니다.')
    expect(state.toast).toHaveBeenCalledWith(expect.stringContaining('권한이 없습니다.'), 'error')
  })

  test('관리자 장소 삭제는 사유 입력 없이 식당 세대와 빈 건물을 순서대로 안전 삭제한다', async () => {
    state.rpc
      .mockResolvedValueOnce({ data: { action: 'deleted' }, error: null })
      .mockResolvedValueOnce({ data: { action: 'deleted' }, error: null })
    const fetchAll = vi.fn().mockResolvedValue(undefined)
    const mutations = makeV2AssignmentMutations({ fetchAll })

    await mutations.removeRestaurantUnit(17, 3, 'place', true)

    expect(state.rpc).toHaveBeenNthCalledWith(1, 'delete_place_or_request_tx', expect.objectContaining({
      p_target_type: 'unit', p_target_id: 17, p_note: '식당 관리에서 관리자 직접 정리',
    }))
    expect(state.rpc).toHaveBeenNthCalledWith(2, 'delete_place_or_request_tx', expect.objectContaining({
      p_target_type: 'building', p_target_id: 3, p_note: '식당 관리에서 관리자 직접 정리',
    }))
    expect(state.toast).toHaveBeenCalledWith('식당 세대와 빈 건물을 삭제했습니다')
    expect(fetchAll).toHaveBeenCalledOnce()
  })

  test('연결 자료가 있으면 장소 삭제 요청만 접수하고 빈 건물 삭제를 진행하지 않는다', async () => {
    state.rpc.mockResolvedValueOnce({ data: { action: 'requested' }, error: null })
    const fetchAll = vi.fn().mockResolvedValue(undefined)
    const mutations = makeV2AssignmentMutations({ fetchAll })

    await mutations.removeRestaurantUnit(17, 3, 'place', true)

    expect(state.rpc).toHaveBeenCalledOnce()
    expect(state.toast).toHaveBeenCalledWith('연결된 자료가 있어 삭제 요청으로 접수했습니다')
    expect(fetchAll).toHaveBeenCalledOnce()
  })
})
