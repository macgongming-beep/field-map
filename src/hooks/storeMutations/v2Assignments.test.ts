import { beforeEach, describe, expect, test, vi } from 'vitest'

const state = vi.hoisted(() => ({
  result: { data: [] as Array<{ id: number }>, error: null as unknown },
  select: vi.fn(),
  single: vi.fn(),
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
    state.single.mockReset().mockResolvedValue({ data: { id: 7 }, error: null })
    state.select.mockReset().mockImplementation(() => Object.assign(Promise.resolve(state.result), { single: state.single }))
    // v2 RPC 는 지운 행의 사진 경로(text)를 돌려준다. 문자열이 아니면 실패다.
    state.rpc.mockReset().mockResolvedValue({ data: null, error: null })
    state.storageRemove.mockReset().mockResolvedValue({ data: [{ name: 'abc.png' }], error: null })
    state.toast.mockClear()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  test.each(['absent', 'narrow', 'fallback', 'legacy-fallback'])('group creation refresh: %s', async (mode) => {
    const fetchAll = vi.fn().mockResolvedValue(undefined)
    const refreshCreatedGroup = mode === 'absent' ? undefined : mode === 'narrow'
      ? vi.fn().mockResolvedValue(undefined) : vi.fn().mockRejectedValue(new Error('offline'))
    const refreshGroupsFallback = mode === 'legacy-fallback' ? undefined : vi.fn().mockResolvedValue(undefined)
    const mutations = makeV2AssignmentMutations({ fetchAll, refreshCreatedGroup, refreshGroupsFallback })
    expect(await mutations.createInformalGroup({ name: 'new', createdBy: 'admin' })).toBe(7)
    expect(state.single).toHaveBeenCalledOnce()
    if (refreshCreatedGroup) expect(refreshCreatedGroup).toHaveBeenCalledOnce()
    if (refreshGroupsFallback) expect(refreshGroupsFallback).toHaveBeenCalledTimes(mode === 'fallback' ? 1 : 0)
    expect(fetchAll).toHaveBeenCalledTimes(mode === 'absent' || mode === 'legacy-fallback' ? 1 : 0)
  })

  test.each([null, {}, { id: 0 }, { id: -1 }, { id: 1.5 }, { id: '7' }])('group creation rejects an invalid returned ID: %j', async (data) => {
    state.single.mockResolvedValue({ data, error: null })
    const fetchAll = vi.fn(), refreshCreatedGroup = vi.fn()
    expect(await makeV2AssignmentMutations({ fetchAll, refreshCreatedGroup })
      .createInformalGroup({ name: 'new', createdBy: 'admin' })).toBeNull()
    expect(fetchAll).not.toHaveBeenCalled()
    expect(refreshCreatedGroup).not.toHaveBeenCalled()
    expect(state.toast).toHaveBeenCalledWith(expect.any(String), 'error')
  })

  test('group insert error does not refresh', async () => {
    state.single.mockResolvedValue({ data: null, error: new Error('denied') })
    const fetchAll = vi.fn(), refreshCreatedGroup = vi.fn()
    expect(await makeV2AssignmentMutations({ fetchAll, refreshCreatedGroup })
      .createInformalGroup({ name: 'new', createdBy: 'admin' })).toBeNull()
    expect(refreshCreatedGroup).not.toHaveBeenCalled()
    expect(fetchAll).not.toHaveBeenCalled()
  })

  test('group creation without narrow callback retains refresh rejection', async () => {
    const fetchAll = vi.fn().mockRejectedValue(new Error('offline'))
    const refreshGroupsFallback = vi.fn()
    await expect(makeV2AssignmentMutations({ fetchAll, refreshGroupsFallback })
      .createInformalGroup({ name: 'new', createdBy: 'admin' })).rejects.toThrow('offline')
    expect(state.single).toHaveBeenCalledOnce()
    expect(fetchAll).toHaveBeenCalledOnce()
    expect(refreshGroupsFallback).not.toHaveBeenCalled()
    expect(state.toast).not.toHaveBeenCalled()
  })

  test('committed group ID survives narrow and fallback refresh failure', async () => {
    const fetchAll = vi.fn()
    const refreshCreatedGroup = vi.fn().mockRejectedValue(new Error('offline'))
    const refreshGroupsFallback = vi.fn().mockRejectedValue(new Error('offline'))
    expect(await makeV2AssignmentMutations({ fetchAll, refreshCreatedGroup, refreshGroupsFallback })
      .createInformalGroup({ name: 'new', createdBy: 'admin' })).toBe(7)
    expect(state.single).toHaveBeenCalledOnce()
    expect(state.toast).toHaveBeenCalledWith(expect.stringContaining('자료를 불러오지 못했습니다'), 'error')
    expect(refreshGroupsFallback).toHaveBeenCalledOnce()
    expect(fetchAll).not.toHaveBeenCalled()
  })

  test.each(['narrow', 'fallback', 'legacy-fallback', 'double-failure'])('single asset move refresh: %s', async (mode) => {
    state.result = { data: [{ id: 7 }], error: null }
    const fetchAll = vi.fn().mockResolvedValue(undefined)
    const refreshMovedAssets = mode === 'narrow' ? vi.fn().mockResolvedValue(undefined)
      : vi.fn().mockRejectedValue(new Error('offline'))
    const refreshMovedAssetsFallback = mode === 'legacy-fallback' ? undefined : mode === 'double-failure'
      ? vi.fn().mockRejectedValue(new Error('offline')) : vi.fn().mockResolvedValue(undefined)
    const refreshGroupsFallback = vi.fn()
    const mutations = makeV2AssignmentMutations({ fetchAll, refreshMovedAssets, refreshMovedAssetsFallback, refreshGroupsFallback })
    expect(await mutations.moveAssetToGroup(7, null)).toBe(mode !== 'double-failure')
    expect(refreshMovedAssets).toHaveBeenCalledOnce()
    if (refreshMovedAssetsFallback) expect(refreshMovedAssetsFallback).toHaveBeenCalledTimes(mode === 'narrow' ? 0 : 1)
    expect(fetchAll).toHaveBeenCalledTimes(mode === 'legacy-fallback' ? 1 : 0)
    expect(refreshGroupsFallback).not.toHaveBeenCalled()
    if (mode === 'double-failure') expect(state.toast).toHaveBeenCalledWith(expect.stringContaining('자료를 불러오지 못했습니다'), 'error')
  })

  test.each(['zero', 'error'])('failed asset move skips targeted reads: %s', async (mode) => {
    state.result = { data: [], error: mode === 'error' ? new Error('denied') : null }
    const fetchAll = vi.fn(), refreshMovedAssets = vi.fn(), refreshMovedAssetsFallback = vi.fn()
    expect(await makeV2AssignmentMutations({ fetchAll, refreshMovedAssets, refreshMovedAssetsFallback })
      .moveAssetToGroup(7, 3)).toBe(false)
    expect(refreshMovedAssets).not.toHaveBeenCalled()
    expect(refreshMovedAssetsFallback).not.toHaveBeenCalled()
    expect(fetchAll).not.toHaveBeenCalled()
  })

  test.each([false, true])('bulk move waits for all writes and refreshes partial success once (refreshFails=%s)', async (refreshFails) => {
    let finish!: (value: typeof state.result) => void
    state.select
      .mockResolvedValueOnce({ data: [{ id: 11 }], error: null })
      .mockRejectedValueOnce(new Error('offline'))
      .mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const fetchAll = vi.fn()
    const refreshMovedAssets = refreshFails ? vi.fn().mockRejectedValue(new Error('offline')) : vi.fn().mockResolvedValue(undefined)
    const refreshMovedAssetsFallback = vi.fn().mockRejectedValue(new Error('offline'))
    const pending = makeV2AssignmentMutations({ fetchAll, refreshMovedAssets, refreshMovedAssetsFallback })
      .moveAssetsToGroup([11, 12, 13], 5)
    await Promise.resolve()
    expect(refreshMovedAssets).not.toHaveBeenCalled()
    finish({ data: [{ id: 13 }], error: null })
    expect(await pending).toEqual(refreshFails ? { failed: [12], refreshFailed: true } : { failed: [12] })
    expect(refreshMovedAssets).toHaveBeenCalledOnce()
    expect(refreshMovedAssetsFallback).toHaveBeenCalledTimes(refreshFails ? 1 : 0)
    expect(fetchAll).not.toHaveBeenCalled()
    if (refreshFails) expect(state.toast).toHaveBeenCalledWith(expect.stringContaining('자료를 불러오지 못했습니다'), 'error')
  })

  test('empty bulk move skips writes and refresh', async () => {
    const fetchAll = vi.fn(), refreshMovedAssets = vi.fn()
    expect(await makeV2AssignmentMutations({ fetchAll, refreshMovedAssets }).moveAssetsToGroup([], 5)).toEqual({ failed: [] })
    expect(state.select).not.toHaveBeenCalled()
    expect(refreshMovedAssets).not.toHaveBeenCalled()
    expect(fetchAll).not.toHaveBeenCalled()
  })

  test('bulk refresh failure does not label successful writes as failed', async () => {
    state.result = { data: [{ id: 7 }], error: null }
    const fetchAll = vi.fn()
    const refreshMovedAssets = vi.fn().mockRejectedValue(new Error('offline'))
    const refreshMovedAssetsFallback = vi.fn().mockRejectedValue(new Error('offline'))
    const result = await makeV2AssignmentMutations({ fetchAll, refreshMovedAssets, refreshMovedAssetsFallback })
      .moveAssetsToGroup([11, 12], 5)
    expect(result).toEqual({ failed: [], refreshFailed: true })
    expect(refreshMovedAssets).toHaveBeenCalledOnce()
    expect(refreshMovedAssetsFallback).toHaveBeenCalledOnce()
    expect(fetchAll).not.toHaveBeenCalled()
  })

  test('new callbacks do not change group or bulk asset deletion refresh', async () => {
    state.result = { data: [{ id: 7 }], error: null }
    state.rpc.mockResolvedValue({ data: '', error: null })
    const fetchAll = vi.fn(), refreshCreatedGroup = vi.fn(), refreshMovedAssets = vi.fn()
    const mutations = makeV2AssignmentMutations({ fetchAll, refreshCreatedGroup, refreshMovedAssets })
    expect(await mutations.deleteInformalGroup(7)).toBe(true)
    expect(await mutations.deleteInformalAssets([11, 12])).toEqual({ failed: [] })
    expect(fetchAll).toHaveBeenCalledTimes(2)
    expect(refreshCreatedGroup).not.toHaveBeenCalled()
    expect(refreshMovedAssets).not.toHaveBeenCalled()
  })

  test.each([false, true])('rename refreshes only groups, falling back on failure=%s', async (fails) => {
    state.result = { data: [{ id: 7 }], error: null }
    const fetchAll = vi.fn().mockResolvedValue(undefined)
    const refreshGroups = fails ? vi.fn().mockRejectedValue(new Error('offline')) : vi.fn().mockResolvedValue(undefined)
    expect(await makeV2AssignmentMutations({ fetchAll, refreshGroups }).renameInformalGroup(7, 'new')).toBe(true)
    expect(refreshGroups).toHaveBeenCalledOnce()
    expect(fetchAll).toHaveBeenCalledTimes(fails ? 1 : 0)
  })

  test('rename reports refresh failure if both reads fail', async () => {
    state.result = { data: [{ id: 7 }], error: null }
    const fetchAll = vi.fn().mockRejectedValue(new Error('offline'))
    const refreshGroups = vi.fn().mockRejectedValue(new Error('offline'))
    expect(await makeV2AssignmentMutations({ fetchAll, refreshGroups }).renameInformalGroup(7, 'new')).toBe(false)
    expect(state.toast).toHaveBeenCalledWith(expect.stringContaining('자료를 불러오지 못했습니다'), 'error')
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

  test.each(['deleted', 'requested', 'error', 'throw'])('세대 삭제 뒤 빈 건물 결과가 %s여도 해당 건물을 갱신한다', async (outcome) => {
    state.rpc.mockResolvedValueOnce({ data: { action: 'deleted' }, error: null })
    if (outcome === 'throw') state.rpc.mockRejectedValueOnce(new Error('offline'))
    else state.rpc.mockResolvedValueOnce({ data: { action: outcome }, error: outcome === 'error' ? new Error('denied') : null })
    const fetchAll = vi.fn()
    const refreshRestaurantBuildings = vi.fn().mockResolvedValue(undefined)
    const mutations = makeV2AssignmentMutations({ fetchAll, refreshRestaurantBuildings })
    const operation = mutations.removeRestaurantUnit(17, 3, 'place', true)
    if (outcome === 'throw') await expect(operation).rejects.toThrow('offline')
    else await operation
    expect(refreshRestaurantBuildings).toHaveBeenCalledExactlyOnceWith([3])
    expect(fetchAll).not.toHaveBeenCalled()
  })

  test('삭제 요청만 접수되면 건물을 숨기거나 부분 삭제로 처리하지 않는다', async () => {
    state.rpc.mockResolvedValueOnce({ data: { action: 'requested' }, error: null })
    const fetchAll = vi.fn()
    const refreshRestaurantBuildings = vi.fn()
    await makeV2AssignmentMutations({ fetchAll, refreshRestaurantBuildings }).removeRestaurantUnit(17, 3, 'place', true)
    expect(refreshRestaurantBuildings).not.toHaveBeenCalled()
    expect(fetchAll).toHaveBeenCalledOnce()
  })

  test('목록 해제와 세대 없는 건물 해제는 건물 갱신 경로를 쓴다', async () => {
    state.result = { data: [{ id: 17 }], error: null }
    const fetchAll = vi.fn()
    const refreshRestaurantBuildings = vi.fn()
    const mutations = makeV2AssignmentMutations({ fetchAll, refreshRestaurantBuildings })
    await mutations.removeRestaurantUnit(17, 3)
    await mutations.toggleBuildingRestaurant(4, false)
    expect(refreshRestaurantBuildings.mock.calls).toEqual([[[3]], [[4]]])
    expect(fetchAll).not.toHaveBeenCalled()
  })
})
