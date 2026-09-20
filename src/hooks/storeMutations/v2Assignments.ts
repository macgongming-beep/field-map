// v2 신 배정 모델 mutations
// - 비공식 자료 풀 관리 (informal_assets)
// - event_informal_assignments / event_restaurant_assignments
// - buildings.is_restaurant 마킹
import { supabase } from '../../lib/supabase'
import { showToast } from '../../lib/toast'
import { getAuthToken } from '../../lib/authToken'
import { msg } from '../../lib/msg'
import { ensureAffectedRows, reportMutationError } from './shared'
import type { InformalKind } from '../../types'

export function makeV2AssignmentMutations(deps: { fetchAll: () => Promise<void> }) {
  const { fetchAll } = deps

  // ── 비공식 자료 풀 ────────────────────────────────
  /**
   * 사진 없이 지도 핀으로 비공식 장소 만들기 (docs/비공식-봉사-재설계.md)
   *
   * 사진은 위치를 알려 주지 못한다 — 처음 가는 형제는 못 찾는다.
   * 그리고 사진을 안 쓰면 회중마다 스토리지 버킷을 만들 필요가 없어져
   * 다른 회중 설치 절차가 하나 줄어든다.
   */
  const createInformalPlace = async (input: {
    name: string
    createdBy: string
    groupId?: number | null
    lat: number
    lng: number
    memo?: string
    zoom?: number | null
    kind?: InformalKind
    /** 이 장소를 품는 상위 장소. 없으면 스스로가 그릇이다 */
    parentId?: number | null
  }): Promise<boolean> => {
    const name = input.name.trim()
    if (!name) {
      showToast(msg('이름을 입력해 주세요'), 'error')
      return false
    }
    const { data, error } = await supabase.from('informal_assets').insert({
      name,
      kind: input.kind ?? '비공식구역',
      parent_id: input.parentId ?? null,
      // 사진이 없는 자료다. 빈 글자로 두어 기존 화면이 그대로 동작하게 한다
      image_url: '',
      image_path: '',
      uploaded_by: input.createdBy,
      archived: false,
      group_id: input.groupId ?? null,
      lat: input.lat,
      lng: input.lng,
      memo: input.memo?.trim() || null,
      zoom: input.zoom ?? null,
    }).select('id')
    if (error) {
      const message = (error as { message?: string }).message ?? ''
      if (/lat|lng|memo|zoom|column/.test(message)) {
        showToast(msg('지도 칸이 아직 없습니다. supabase/v3_informal_map.sql 을 실행해 주세요.'), 'error')
      } else {
        reportMutationError(msg('비공식 장소를 등록하지 못했습니다.'), error)
      }
      return false
    }
    if (!ensureAffectedRows(data, msg('비공식 장소를 등록하지 못했습니다.'))) return false
    await fetchAll()
    showToast(msg('등록했습니다'))
    return true
  }

  /**
   * 비공식 장소의 구역선·동선 저장.
   *
   * 둘은 같은 좌표 목록이고 그리는 도구도 같다 — 그리는 방식이 아니라
   * 어디에 담느냐만 다르다 (구역선은 닫힌 도형, 동선은 열린 선).
   * 빈 목록을 주면 지운다.
   */
  const saveInformalShape = async (
    assetId: number,
    field: 'boundary' | 'route',
    points: { lat: number; lng: number }[],
    /**
     * 동선은 **여러 줄**이라 이미 있는 줄들을 함께 받는다.
     * 새 줄을 뒤에 붙여 저장한다. 비우려면 빈 배열을 준다.
     */
    existingRoutes?: { lat: number; lng: number }[][],
  ): Promise<boolean> => {
    const value = field === 'route'
      ? (() => {
          const kept = existingRoutes ?? []
          const lines = points.length >= 2 ? [...kept, points] : kept
          return lines.length > 0 ? lines : null
        })()
      : (points.length >= 3 ? points : null)
    const { data, error } = await supabase
      .from('informal_assets')
      .update({ [field]: value })
      .eq('id', assetId)
      .select('id')
    if (error) {
      const message = (error as { message?: string }).message ?? ''
      if (/boundary|route|column/.test(message)) {
        showToast(msg('지도 칸이 아직 없습니다. supabase/v3_informal_map.sql 을 실행해 주세요.'), 'error')
      } else {
        reportMutationError(msg('지도 모양을 저장하지 못했습니다.'), error)
      }
      return false
    }
    if (!ensureAffectedRows(data, msg('지도 모양을 저장하지 못했습니다.'))) return false
    await fetchAll()
    showToast(value ? msg('저장했습니다') : msg('지웠습니다'))
    return true
  }

  /** 핀·메모 고치기. 사진이 있는 기존 자료에도 그대로 쓴다 */
  const updateInformalPlace = async (
    assetId: number,
    input: { name?: string; memo?: string; lat?: number; lng?: number; zoom?: number | null; kind?: InformalKind },
  ): Promise<boolean> => {
    const patch: Record<string, unknown> = {}
    if (input.name !== undefined) patch.name = input.name.trim()
    if (input.memo !== undefined) patch.memo = input.memo.trim() || null
    if (input.lat !== undefined) patch.lat = input.lat
    if (input.lng !== undefined) patch.lng = input.lng
    if (input.zoom !== undefined) patch.zoom = input.zoom
    if (input.kind !== undefined) patch.kind = input.kind
    if (Object.keys(patch).length === 0) return true

    const { data, error } = await supabase.from('informal_assets').update(patch).eq('id', assetId).select('id')
    if (error) {
      reportMutationError(msg('비공식 장소를 수정하지 못했습니다.'), error)
      return false
    }
    if (!ensureAffectedRows(data, msg('비공식 장소를 수정하지 못했습니다.'))) return false
    await fetchAll()
    showToast(msg('저장했습니다'))
    return true
  }

  const uploadInformalAsset = async (input: {
    file: File
    name: string
    uploadedBy: string
    groupId?: number | null
  }): Promise<{ ok: boolean; assetId?: number; error?: string }> => {
    const ext = input.file.name.split('.').pop()?.toLowerCase() || 'jpg'
    const id = typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`
    const path = `${id}.${ext}`

    // Storage 업로드
    const { error: uploadError } = await supabase.storage
      .from('informal-assets')
      .upload(path, input.file, {
        cacheControl: '31536000',
        upsert: false,
        contentType: input.file.type || `image/${ext}`,
      })
    if (uploadError) {
      showToast(msg('업로드 실패: {message}', { message: uploadError.message }), 'error')
      return { ok: false, error: uploadError.message }
    }

    const { data: pub } = supabase.storage.from('informal-assets').getPublicUrl(path)
    const imageUrl = pub.publicUrl

    // DB INSERT
    const { data, error } = await supabase
      .from('informal_assets')
      .insert({
        name: input.name.trim() || '비공식 증거 카드',
        image_url: imageUrl,
        image_path: path,
        uploaded_by: input.uploadedBy,
        archived: false,
        group_id: input.groupId ?? null,
      })
      .select('id')
      .single()
    if (error) {
      // Storage 롤백
      await supabase.storage.from('informal-assets').remove([path])
      showToast(msg('등록 실패: {message}', { message: error.message }), 'error')
      return { ok: false, error: error.message }
    }
    await fetchAll()
    return { ok: true, assetId: data?.id }
  }

  // ── 비공식 그룹 ────────────────────────────────────
  const createInformalGroup = async (input: { name: string; createdBy: string }) => {
    const { data, error } = await supabase
      .from('informal_groups')
      .insert({ name: input.name.trim() || '새 그룹', created_by: input.createdBy })
      .select('id')
      .single()
    if (error) {
      showToast(msg('그룹 생성 실패: {message}', { message: error.message }), 'error')
      return null
    }
    await fetchAll()
    return data?.id ?? null
  }

  const renameInformalGroup = async (groupId: number, name: string): Promise<boolean> => {
    const { data, error } = await supabase
      .from('informal_groups')
      .update({ name: name.trim() || '새 그룹' })
      .eq('id', groupId)
      .select('id')
    if (error) {
      showToast(msg('그룹 이름 변경 실패: {message}', { message: error.message }), 'error')
      return false
    }
    if (!ensureAffectedRows(data, msg('그룹 이름을 변경하지 못했습니다.'))) return false
    await fetchAll()
    return true
  }

  const deleteInformalGroup = async (groupId: number): Promise<boolean> => {
    // 그룹 내 자료는 group_id 가 NULL 로 풀림 (FK on delete set null)
    const { data, error } = await supabase.from('informal_groups').delete().eq('id', groupId).select('id')
    if (error) {
      showToast(msg('그룹 삭제 실패: {message}', { message: error.message }), 'error')
      return false
    }
    if (!ensureAffectedRows(data, msg('그룹을 삭제하지 못했습니다.'))) return false
    await fetchAll()
    return true
  }

  /** 재조회를 뺀 알맹이. 일괄 작업이 항목마다 다시 읽지 않도록 분리했다. */
  const moveAssetToGroupCore = async (assetId: number, groupId: number | null): Promise<boolean> => {
    const { data, error } = await supabase
      .from('informal_assets')
      .update({ group_id: groupId })
      .eq('id', assetId)
      .select('id')
    if (error) {
      showToast(msg('자료 이동 실패: {message}', { message: error.message }), 'error')
      return false
    }
    return ensureAffectedRows(data, msg('자료를 이동하지 못했습니다.'))
  }

  const moveAssetToGroup = async (assetId: number, groupId: number | null): Promise<boolean> => {
    if (!await moveAssetToGroupCore(assetId, groupId)) return false
    await fetchAll()
    return true
  }

  /** 재조회를 뺀 알맹이. Storage 정리까지 여기서 끝낸다. */
  const deleteInformalAssetCore = async (assetId: number): Promise<boolean> => {
    const token = getAuthToken()
    if (!token) {
      showToast(msg('로그인 세션을 확인할 수 없습니다.'), 'error')
      return false
    }
    // ⚠ 지운 행의 사진 경로를 **서버가 돌려준다** (delete ... returning).
    //   전에는 지우기 전에 따로 SELECT 했는데, 그 조회만 실패하면 경로가 빈 값이
    //   되고 삭제는 성공해서 **공개 버킷에 파일만 조용히 남았다.** 조회와 삭제
    //   사이에 사진이 바뀌면 옛 파일을 지우는 문제도 있었다.
    //   옛 delete_informal_asset_secure 는 캐시에 남은 앱을 위해 서버에 그대로 둔다.
    const { data, error } = await supabase.rpc('delete_informal_asset_secure_v2', {
      p_token: token,
      p_asset_id: assetId,
    })
    if (error || typeof data !== 'string') {
      // 권한 없음과 없는 행을 구분한다 — 관리자가 "왜 안 지워지지" 를 알 수 있게
      const raw = error?.message ?? ''
      const reason = /permission denied/i.test(raw)
        ? msg('삭제 권한이 없습니다.')
        : /not found/i.test(raw) || !raw
          ? msg('이미 지워진 자료입니다.')
          : raw
      showToast(msg('자료 삭제 실패: {message}', { message: reason }), 'error')
      return false
    }

    const imagePath = data
    if (imagePath) {
      const { data: removed, error: removeError } = await supabase.storage
        .from('informal-assets').remove([imagePath])
      // ⚠ Storage 의 remove 는 권한으로 막혀도 오류가 아니라 **빈 배열**을 준다.
      //   DB 쪽 ensureAffectedRows 와 같은 이유로 개수를 봐야 한다.
      // 행은 이미 지워졌다. 파일만 남은 것은 삭제 실패가 아니므로 true 를 유지하고,
      // 대신 남았다는 사실을 숨기지 않는다.
      if (removeError || (removed?.length ?? 0) === 0) {
        showToast(msg('자료는 지웠지만 사진 파일이 남았습니다. 관리자에게 알려 주세요.'), 'error')
      }
    }

    return true
  }

  const deleteInformalAsset = async (assetId: number): Promise<boolean> => {
    if (!await deleteInformalAssetCore(assetId)) return false
    await fetchAll()
    return true
  }

  /**
   * 여러 자료를 한 번에 처리한다. 항목마다 재조회하면 20개 지울 때 20번을 다시
   * 읽는다 — 병렬로 돌리고 **끝나고 딱 한 번**만 읽는다.
   *
   * ⚠ 재조회는 `finally` 에 둔다. 하나가 던져도 반드시 실행돼야 한다 —
   *   성공한 삭제가 화면에 안 비치면 사용자는 안 지워진 줄 알고 다시 누른다.
   */
  const runBulk = async (
    ids: number[],
    one: (id: number) => Promise<boolean>,
  ): Promise<{ failed: number[] }> => {
    if (ids.length === 0) return { failed: [] }
    try {
      // allSettled 를 쓴다 — 하나가 던져도 나머지 결과를 잃지 않는다
      const results = await Promise.allSettled(ids.map((id) => one(id)))
      return {
        failed: ids.filter((_id, index) => {
          const r = results[index]
          return r.status !== 'fulfilled' || r.value !== true
        }),
      }
    } finally {
      await fetchAll()
    }
  }

  const deleteInformalAssets = (assetIds: number[]) =>
    runBulk(assetIds, deleteInformalAssetCore)

  const moveAssetsToGroup = (assetIds: number[], groupId: number | null) =>
    runBulk(assetIds, (id) => moveAssetToGroupCore(id, groupId))

  // ── 비공식 배정 ────────────────────────────────────
  const assignInformalToUser = async (input: {
    eventId: number
    userName: string
    assetId: number
    assignedBy: string
  }) => {
    const { error } = await supabase.from('event_informal_assignments').insert({
      event_id: input.eventId,
      user_name: input.userName,
      asset_id: input.assetId,
      assigned_by: input.assignedBy,
    })
    if (error) {
      if (error.code === '23505') {
        showToast(msg('이미 배정된 자료입니다.'), 'info')
      } else {
        showToast(msg('비공식 배정 실패: {message}', { message: error.message }), 'error')
      }
      return false
    }
    await fetchAll()
    return true
  }

  const removeInformalAssignment = async (assignmentId: number) => {
    const { error } = await supabase
      .from('event_informal_assignments')
      .delete()
      .eq('id', assignmentId)
    if (error) showToast(msg('배정 해제 실패: {message}', { message: error.message }), 'error')
    else await fetchAll()
  }

  // ── 식당 배정 ──────────────────────────────────────
  const assignRestaurantToUser = async (input: {
    eventId: number
    userName: string
    buildingId: number
    unitId?: number | null
    assignedBy: string
  }) => {
    const { error } = await supabase.from('event_restaurant_assignments').insert({
      event_id: input.eventId,
      user_name: input.userName,
      building_id: input.buildingId,
      unit_id: input.unitId ?? null,
      assigned_by: input.assignedBy,
    })
    if (error) {
      showToast(msg('식당 배정 실패: {message}', { message: error.message }), 'error')
      return false
    }
    await fetchAll()
    return true
  }

  const removeRestaurantAssignment = async (assignmentId: number) => {
    const { error } = await supabase
      .from('event_restaurant_assignments')
      .delete()
      .eq('id', assignmentId)
    if (error) showToast(msg('식당 배정 해제 실패: {message}', { message: error.message }), 'error')
    else await fetchAll()
  }

  // ── 식당 세대 해제 ──
  // ⚠ 예전에는 is_chinese(중국인 여부)를 껐다. 그러면 "중국어 안 씀"과
  //   "식당 아님"이 구분되지 않아, 중국어를 안 쓴다고 표시하면 식당 목록에서
  //   통째로 사라졌다. 이제 식당 표시(is_restaurant)만 끈다.
  //   중국어를 쓰지 않는 식당은 방문 결과를 '대상외' 로 찍으면 된다.
  const removeRestaurantUnit = async (
    unitId: number | null,
    buildingId: number,
    mode: 'list' | 'place' = 'list',
    deleteEmptyBuilding = false,
  ) => {
    if (mode === 'place') {
      const token = getAuthToken()
      if (!token) {
        showToast(msg('다시 로그인해 주세요.'), 'error')
        return
      }
      const deleteTarget = async (targetType: 'unit' | 'building', targetId: number) => {
        const result = await supabase.rpc('delete_place_or_request_tx', {
          p_token: token,
          p_target_type: targetType,
          p_target_id: targetId,
          p_request_type: 'remove_place',
          p_note: '식당 관리에서 관리자 직접 정리',
        })
        const action = result.data?.action
        if (result.error || (action !== 'deleted' && action !== 'requested')) {
          reportMutationError(msg('장소를 삭제하지 못했습니다.'), result.error ?? new Error('Missing delete result'))
          return null
        }
        return action as 'deleted' | 'requested'
      }

      const unitAction = unitId == null ? 'deleted' : await deleteTarget('unit', unitId)
      if (!unitAction) return
      if (unitAction === 'requested') {
        showToast(msg('연결된 자료가 있어 삭제 요청으로 접수했습니다'))
        await fetchAll()
        return
      }

      if (deleteEmptyBuilding) {
        const buildingAction = await deleteTarget('building', buildingId)
        if (!buildingAction) return
        showToast(buildingAction === 'requested'
          ? msg('세대는 삭제했고 빈 건물은 삭제 요청으로 접수했습니다')
          : msg('식당 세대와 빈 건물을 삭제했습니다'))
      } else {
        showToast(msg('식당 세대를 삭제했습니다'))
      }
      await fetchAll()
      return
    }

    if (unitId == null) {
      showToast(msg('식당 세대를 찾을 수 없습니다.'), 'error')
      return
    }
    const unitResult = await supabase
      .from('units')
      .update({ is_restaurant: false })
      .eq('id', unitId)
      .select('id')
    if (unitResult.error) {
      showToast(msg('세대 해제 실패: {message}', { message: unitResult.error.message }), 'error')
      return
    }
    if (!ensureAffectedRows(unitResult.data, msg('식당 목록에서 제거하지 못했습니다.'))) return
    // 건물의 식당 표시는 DB 트리거가 세대에 맞춰 자동으로 맞춘다
    void buildingId
    showToast(msg('식당 목록에서 제거됐습니다.'))
    await fetchAll()
  }

  // ── 식당 마킹 (buildings.is_restaurant) ────────────
  const toggleBuildingRestaurant = async (buildingId: number, isRestaurant: boolean) => {
    const result = await supabase
      .from('buildings')
      .update({ is_restaurant: isRestaurant })
      .eq('id', buildingId)
      .select('id')
    if (result.error) showToast(msg('식당 표시 변경 실패: {message}', { message: result.error.message }), 'error')
    else if (ensureAffectedRows(result.data, msg('식당 표시를 변경하지 못했습니다.'))) {
      showToast(msg(isRestaurant ? '식당 목록에 추가됐습니다.' : '식당 목록에서 제거됐습니다.'))
      await fetchAll()
    }
  }

  // ── CSV 일괄 식당 마킹 + 이름 업데이트 ──────────────────────────
  const bulkSetRestaurantFlag = async (
    buildingIds: number[],
    nameUpdates?: { id: number; name: string }[],
  ): Promise<void> => {
    if (buildingIds.length === 0) return

    // 1) is_restaurant 플래그 일괄 설정
    const { error } = await supabase
      .from('buildings')
      .update({ is_restaurant: true })
      .in('id', buildingIds)
    if (error) {
      showToast(msg('일괄 식당 등록 실패: {message}', { message: error.message }), 'error')
      throw error
    }

    // 2) 식당명이 건물명과 다른 경우 이름 업데이트 (순차 처리)
    if (nameUpdates && nameUpdates.length > 0) {
      await Promise.all(
        nameUpdates.map(({ id, name }) =>
          supabase.from('buildings').update({ name }).eq('id', id),
        ),
      )
    }

    await fetchAll()
  }

  return {
    createInformalPlace,
    updateInformalPlace,
    saveInformalShape,
    uploadInformalAsset,
    deleteInformalAsset,
    deleteInformalAssets,
    createInformalGroup,
    renameInformalGroup,
    deleteInformalGroup,
    moveAssetToGroup,
    moveAssetsToGroup,
    assignInformalToUser,
    removeInformalAssignment,
    assignRestaurantToUser,
    removeRestaurantAssignment,
    toggleBuildingRestaurant,
    removeRestaurantUnit,
    bulkSetRestaurantFlag,
  }
}
