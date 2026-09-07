import type { Building, TerritoryCard, Unit, UnitStatus } from '../../types'
import type { CsvBuildingImport } from '../../utils/csvBuildingImport'
import { isValidMapCoordinate } from '../../utils/mapUtils'
import { buildImportPayload } from '../../utils/importBuildingPayload'
import { explainDbError } from '../../utils/dbError'
import { getAuthToken } from '../../lib/authToken'
import { promptDialog } from '../../lib/confirm'
import type { MergeResult } from '../../utils/duplicateBuildingMerge'
import { ensureAffectedRows, supabase, showToast, reportMutationError } from './shared'
import { logServiceAction } from './serviceLog'
import { msg } from '../../lib/msg'
import { canonicalUnitNumber } from '../../utils/unitNumber'

export function makeBuildingMutations(deps: {
  fetchAll: () => Promise<void>
  buildings: Building[]
  cards: TerritoryCard[]
  /**
   * 세대 추가·삭제를 화면 상태에 바로 반영한다.
   * 이게 없으면 호수 하나 넣을 때마다 건물 전체(약 440KB)를 다시 받아야 해서
   * 일괄로 여러 개 넣을 때 눈에 띄게 느려진다. (방문 기록과 같은 방식)
   */
  appendUnits: (buildingId: number, units: Unit[]) => void
  removeUnit: (unitId: number) => void
}) {
  const { fetchAll, buildings, cards, appendUnits, removeUnit } = deps

  /** 성공하면 true, 실패하면 false. 이 계약이 화면까지 그대로 간다. */
  const createBuilding = async (input: {
    cardId: number
    name: string
    address: string
    type: Building['type']
    lat: number
    lng: number
  }): Promise<boolean> => {
    if (!input.address.trim()) {
      showToast(msg('주소를 입력해 주세요.'), 'error')
      return false
    }
    if (!cards.some((card) => card.id === input.cardId)) {
      showToast(msg('건물을 추가할 카드를 찾지 못했습니다. 카드를 직접 선택해 주세요.'), 'error')
      return false
    }
    // 이름이 없으면 주소에서 자동 추출 (예: "언동로 213")
    const autoName = input.name.trim() || (() => {
      const m = input.address.match(/([가-힣]+(?:로|길)\s*[\d-]+)/)
      if (m) return m[1].replace(/\s+/, ' ').trim()
      const parts = input.address.trim().split(/\s+/)
      return parts.slice(-2).join(' ')
    })()

    const result = await supabase.from('buildings').insert({
      card_id: input.cardId,
      name: autoName,
      address: input.address.trim(),
      type: input.type,
      lat: input.lat,
      lng: input.lng,
    })
    if (result.error) {
      reportMutationError(msg('건물을 추가하지 못했습니다.'), result.error)
      return false
    }
    const card = cards.find((c) => c.id === input.cardId)
    await logServiceAction({
      cardId: input.cardId,
      action: 'building_added',
      targetType: 'building',
      details: { building_name: autoName, card_name: card?.name ?? null },
    })
    await fetchAll()
    showToast(msg('"{autoName}" 건물이 추가됐습니다', { autoName: autoName }))
    return true
  }

  const importBuildings = async (inputs: CsvBuildingImport[]) => {
    const cleanedInputs = inputs
      .map((input) => ({
        ...input,
        name: input.name.trim(),
        address: input.address.trim(),
        units: Array.from(
          new Map(
            input.units
              .map((unit) => ({ ...unit, number: unit.number.trim(), memo: unit.memo?.trim() }))
              .filter((unit) => unit.number)
              .map((unit) => [unit.number, unit]),
          ).values(),
        ),
      }))
      .filter((input) => input.name && input.address && isValidMapCoordinate(input.lat, input.lng))

    if (cleanedInputs.length === 0) {
      showToast(msg('업로드할 건물 데이터가 없습니다.'), 'error')
      return { inserted: 0, skipped: inputs.length, failures: [] }
    }

    let inserted = 0
    let skipped = inputs.length - cleanedInputs.length
    let visitHistoriesInserted = 0
    const existingKeys = new Set(buildings.map((building) => `${building.cardId}|${building.address}|${building.name}`))

    const failures: Array<{ rowNumber: number; address: string; error: string }> = []

    const token = getAuthToken()
    if (!token) {
      showToast(msg('로그인 정보가 없습니다. 다시 로그인해 주세요.'), 'error')
      return { inserted: 0, skipped: cleanedInputs.length, failures }
    }

    for (const input of cleanedInputs) {
      const key = `${input.cardId}|${input.address}|${input.name}`
      if (existingKeys.has(key)) {
        skipped += 1
        continue
      }

      // ⚠ 건물 하나를 **통째로** 한 트랜잭션에 넣는다.
      //   예전에는 건물 → 세대 → 정기방문 → 방문기록을 따로 넣어서,
      //   세대나 정기방문이 실패하면 continue 로 넘어가고 **건물만 남았다**
      //   (세대가 하나도 없는 건물). 방문기록 실패는 아예 조용했다.
      const payload = buildImportPayload(input)
      const rpc = await supabase.rpc('import_building_tx', {
        p_token: token,
        p_building: payload.building,
        p_units: payload.units,
      })
      if (rpc.error || !(rpc.data as { ok?: boolean } | null)?.ok) {
        // ⚠ 개수만 세지 않는다. **어떤 줄이 왜** 실패했는지 돌려줘야
        //   사용자가 고쳐서 다시 올릴 수 있다.
        console.warn('[importBuildings] 건물 하나 실패 — 통째로 되돌아감', input.address, rpc.error)
        failures.push({
          rowNumber: (input as { rowNumber?: number }).rowNumber ?? 0,
          address: input.address,
          error: explainDbError(rpc.error) ?? rpc.error?.message ?? '알 수 없는 이유',
        })
        skipped += 1
        continue
      }
      visitHistoriesInserted += (rpc.data as { visits?: number }).visits ?? 0

      existingKeys.add(key)
      inserted += 1
    }

    await fetchAll()
    const visitMsg = visitHistoriesInserted > 0 ? `, 방문기록 ${visitHistoriesInserted}건` : ''
    showToast(msg('CSV 업로드 완료: 건물 {inserted}개 추가{visitMsg}, {skipped}개 제외', { inserted: inserted, visitMsg: visitMsg, skipped: skipped }), inserted > 0 ? 'success' : 'info')
    return { inserted, skipped, failures }
  }

  /** 성공하면 새로 만든 호수 id 들, 실패하면 false. 화면이 입력을 지킬 수 있어야 한다 */
  const addUnitToBuilding = async (
    buildingId: number,
    unitNumber: string | string[],
    usageType?: Building['type'],
  ): Promise<number[] | false> => {
    const unitNumbers = (Array.isArray(unitNumber) ? unitNumber : [unitNumber])
      .map(canonicalUnitNumber)
      .filter(Boolean)
    if (unitNumbers.length === 0) return false

    // 새로 만든 행을 돌려받는다 — id 는 추가 직후 기록(출입불가 → 대상외)에,
    // 나머지는 화면에 바로 반영하는 데 쓴다
    const building = buildings.find((item) => item.id === buildingId)
    if (!building) {
      showToast(msg('건물을 찾을 수 없습니다.'), 'error')
      return false
    }
    const token = getAuthToken()
    if (!token) {
      showToast(msg('다시 로그인해 주세요.'), 'error')
      return false
    }
    const result = await supabase.rpc('add_units_to_building_tx', {
      p_token: token,
      p_building_id: buildingId,
      p_unit_numbers: unitNumbers,
      p_usage_type: usageType ?? building.type,
    })
    const payload = result.data as {
      ok?: boolean
      created?: Array<{ id: number; number: string; status: string; usage_type: Building['type'] | null }>
      skipped?: Array<{ id: number; number: string }>
    } | null
    if (result.error || !payload?.ok) {
      reportMutationError(msg('호수를 추가하지 못했습니다.'), result.error)
      return false
    }
    const created = payload.created ?? []
    const skipped = payload.skipped ?? []
    const newIds = created.map((row) => row.id)
    // 건물 전체를 다시 받지 않고 새 호수만 목록에 얹는다
    appendUnits(buildingId, created.map((row) => ({
      id: row.id,
      number: row.number,
      status: (row.status ?? '미방문') as UnitStatus,
      isChinese: false,
      usageType: row.usage_type ?? undefined,
    })))
    if (created.length === 0) {
      showToast(msg('이미 등록된 호수입니다.'), 'info')
    } else if (skipped.length > 0) {
      showToast(msg('{created}개 호수 추가 · 기존 {skipped}개 제외', { created: created.length, skipped: skipped.length }))
    } else {
      showToast(created.length === 1 ? `${created[0].number} 호수가 추가됐습니다` : `${created.length}개 호수가 추가됐습니다`)
    }
    return newIds
  }

  const setBuildingAccess = async (buildingId: number, blocked: boolean, note = ''): Promise<boolean> => {
    const token = getAuthToken()
    if (!token) {
      showToast(msg('다시 로그인해 주세요.'), 'error')
      return false
    }
    const result = await supabase.rpc('set_building_access_tx', {
      p_token: token,
      p_building_id: buildingId,
      p_blocked: blocked,
      p_note: note,
    })
    if (result.error || !(result.data as { ok?: boolean } | null)?.ok) {
      reportMutationError(msg('건물 출입 상태를 변경하지 못했습니다.'), result.error)
      return false
    }
    await fetchAll()
    showToast(blocked ? msg('건물을 출입불가로 표시했습니다') : msg('건물 출입불가를 해제했습니다'))
    return true
  }

  const deletePlace = async (
    targetType: 'building' | 'unit',
    targetId: number,
    suppliedReason?: string,
  ): Promise<{ action: 'deleted' | 'requested' } | null> => {
    const token = getAuthToken()
    if (!token) {
      showToast(msg('다시 로그인해 주세요.'), 'error')
      return null
    }
    const reason = suppliedReason?.trim() || await promptDialog({
      title: msg(targetType === 'building' ? '건물 삭제' : '세대 삭제'),
      message: msg('삭제하거나 요청하는 이유를 입력해 주세요.'),
      placeholder: msg('예: 중복 등록, 철거, 잘못 등록함'),
      confirmLabel: msg('계속'),
    })
    if (!reason) return null
    const result = await supabase.rpc('delete_place_or_request_tx', {
      p_token: token,
      p_target_type: targetType,
      p_target_id: targetId,
      p_request_type: 'remove_place',
      p_note: reason,
    })
    const action = result.data?.action
    if (result.error || (action !== 'deleted' && action !== 'requested')) {
      reportMutationError(
        targetType === 'building' ? msg('건물을 삭제하지 못했습니다.') : msg('호수를 삭제하지 못했습니다.'),
        result.error ?? new Error('Missing delete result'),
      )
      return null
    }
    return { action }
  }

  const deleteUnitFromBuilding = async (_buildingId: number, unitId: number) => {
    const result = await deletePlace('unit', unitId)
    if (!result) return
    if (result.action === 'requested') {
      showToast(msg('연결된 자료가 있어 삭제 요청으로 접수했습니다'))
      return
    }
    removeUnit(unitId)
    showToast(msg('호수가 삭제됐습니다'))
  }

  const deleteBuilding = async (buildingId: number) => {
    const result = await deletePlace('building', buildingId)
    if (!result) return
    if (result.action === 'requested') {
      showToast(msg('연결된 자료가 있어 삭제 요청으로 접수했습니다'))
      return
    }
    await fetchAll()
    showToast(msg('건물이 삭제됐습니다'))
  }

  const deleteBuildings = async (buildingIds: number[]) => {
    const ids = Array.from(new Set(buildingIds)).filter(Number.isFinite)
    if (ids.length === 0) {
      showToast(msg('삭제할 건물이 없습니다.'), 'info')
      return
    }
    const reason = (await promptDialog({
      title: msg('건물 일괄 삭제'),
      message: msg('{count}개 건물을 삭제하거나 삭제 요청으로 접수합니다. 이유를 입력해 주세요.', { count: ids.length }),
      placeholder: msg('예: 중복 등록, 구역 밖 자료 정리'),
      confirmLabel: msg('계속'),
    }))?.trim()
    if (!reason) return
    const results = await Promise.all(ids.map((id) => deletePlace('building', id, reason)))
    const deleted = results.filter((result) => result?.action === 'deleted').length
    const requested = results.filter((result) => result?.action === 'requested').length
    if (deleted > 0) await fetchAll()
    if (deleted > 0 && requested > 0) {
      showToast(msg('건물 {deleted}개 삭제 · {requested}개 삭제 요청', { deleted, requested }))
    } else if (deleted > 0) {
      showToast(msg('건물 {length}개가 삭제됐습니다', { length: deleted }))
    } else if (requested > 0) {
      showToast(msg('건물 {length}개의 삭제 요청을 접수했습니다', { length: requested }))
    }
  }

  /**
   * 같은 카드 내 중복 주소 건물들을 합칩니다.
   * - 주소가 동일한 건물들 중 id가 가장 작은 건물(기준)에 나머지 건물의 호수를 모두 이전
   * - 호수 번호가 겹칠 경우 기준 건물의 호수를 유지 (중복 삽입 스킵)
   * - 나머지 건물 삭제
   */
  /**
   * 같은 주소로 두 번 등록된 건물을 합친다. **DB 안에서 한 트랜잭션으로 돈다.**
   *
   * 예전에는 여기서 이름변경 → 호수이동 → 건물삭제를 순서대로 쐈다. 중간에
   * 실패하면 앞의 변경이 남아 DB 와 화면이 어긋났고, 되돌릴 방법이 없었다.
   * 그리고 계획을 화면의 옛 데이터로 세워서, 그 사이 다른 사람이 호수를 추가하면
   * 서버에는 충돌이 생겼는데 모르고 진행했다.
   *
   * ⚠ **RPC 가 없으면 옛 경로로 돌아가지 않는다.** 조용히 폴백하면 지금 상황이
   *   그대로 반복된다. 명확히 실패시킨다.
   *
   * 호수가 겹치는 묶음은 건드리지 않고 conflicts 로 돌려준다 —
   * units 가 visit_histories · regular_visits 에 cascade 로 물려 있어서,
   * 겹치는 호수를 두고 원본을 지우면 방문 기록이 조용히 사라진다.
   */
  const mergeDuplicateBuildings = async (
    scopeCardId?: number,
    nameOverrides?: Record<number, string>,
    selectedPrimaryIds?: number[],
  ): Promise<MergeResult> => {
    const token = getAuthToken()
    if (!token) {
      showToast(msg('로그인 정보가 없습니다. 다시 로그인해 주세요.'), 'error')
      return { ok: false, mergedBuildings: 0, movedUnits: 0, conflicts: [] }
    }

    const { data, error } = await supabase.rpc('merge_duplicate_buildings_tx', {
      p_token: token,
      p_scope_card_id: scopeCardId ?? null,
      p_name_overrides: nameOverrides ?? {},
      p_selected_primary_ids: selectedPrimaryIds ?? null,
    })

    if (error) {
      // ⚠ '아무것도 안 바뀌었다' 고 단정하지 않는다. RPC 가 통째로 도는 것과
      //   우리가 결과를 받는 것은 별개다 — 서버가 마치고 응답만 유실될 수 있다.
      //   그래서 목록을 새로 받아 실제 상태를 보여 주고, 확인하라고 말한다.
      await fetchAll()
      reportMutationError(msg('병합 결과를 확인하지 못했습니다. 새로고침된 목록을 확인한 뒤 다시 시도해 주세요.'), error)
      return { ok: false, mergedBuildings: 0, movedUnits: 0, conflicts: [] }
    }

    const result = data as MergeResult
    await fetchAll()

    if (result.mergedBuildings === 0 && result.conflicts.length === 0) {
      showToast(msg('중복 주소 건물이 없습니다.'), 'info')
    } else if (result.mergedBuildings === 0) {
      showToast(msg('호수 번호가 겹쳐 병합할 수 없는 주소가 {n}곳 있습니다. 직접 정리해 주세요.', { n: result.conflicts.length }), 'info')
    } else {
      showToast(
        result.conflicts.length > 0
          ? msg('중복 건물 {mergedBuildings}개 합병 완료 (호수 {movedUnits}개 이전).\n호수가 겹치는 {skipped}곳은 건드리지 않았습니다.', { mergedBuildings: result.mergedBuildings, movedUnits: result.movedUnits, skipped: result.conflicts.length })
          : msg('중복 건물 {mergedBuildings}개 합병 완료 (호수 {movedUnits}개 이전)', { mergedBuildings: result.mergedBuildings, movedUnits: result.movedUnits }),
      )
    }
    return result
  }

  /**
   * **이 건물의 세대를 다 파악했는가** 를 표시한다.
   *
   * ⚠ 이 표시가 없으면 등록된 세대를 다 방문해도 '완료' 로 치지 않는다
   *   (`utils/buildingPin`). 시스템은 '등록된 세대' 만 알기 때문이다 —
   *   104·105호만 등록된 건물에서 둘 다 가면 100% 가 되어 아무도 안 갔다.
   */
  const setUnitsSurveyed = async (buildingId: number, surveyed: boolean) => {
    const result = await supabase.from('buildings')
      .update({ units_surveyed: surveyed }).eq('id', buildingId)
    if (result.error) {
      reportMutationError(msg('세대 파악 표시를 저장하지 못했습니다.'), result.error)
      return false
    }
    const building = buildings.find((b) => b.id === buildingId)
    const card = building ? cards.find((c) => c.id === building.cardId) : undefined
    await logServiceAction({
      cardId: card?.id ?? null,
      action: 'building_units_surveyed',
      targetType: 'building',
      targetId: buildingId,
      details: { building_name: building?.name ?? null, surveyed },
    })
    await fetchAll()
    return true
  }

  const updateBuilding = async (
    buildingId: number,
    name: string,
    address: string,
    lat?: number,
    lng?: number,
    type?: string,
    memo?: string,
  ): Promise<boolean> => {
    const payload: Record<string, unknown> = { name, address }
    if (lat !== undefined) payload.lat = lat
    if (lng !== undefined) payload.lng = lng
    if (type !== undefined) payload.type = type
    if (memo !== undefined) payload.memo = memo
    const result = await supabase.from('buildings').update(payload).eq('id', buildingId).select('id')
    if (result.error) {
      reportMutationError(msg('건물 정보를 수정하지 못했습니다.'), result.error)
      return false
    }
    if (!ensureAffectedRows(result.data, msg('건물 정보를 수정하지 못했습니다.'))) return false
    const building = buildings.find((b) => b.id === buildingId)
    const card = building ? cards.find((c) => c.id === building.cardId) : undefined
    await logServiceAction({
      cardId: card?.id ?? null,
      action: 'building_updated',
      targetType: 'building',
      targetId: buildingId,
      details: { building_name: name, card_name: card?.name ?? null },
    })
    await fetchAll()
    if (lat === undefined) {
      showToast(msg('건물 정보가 수정됐습니다'))
    }
    return true
  }

  const moveBuildingToCard = async (buildingId: number, cardId: number): Promise<boolean> => {
    const result = await supabase.from('buildings').update({ card_id: cardId }).eq('id', buildingId).select('id')
    if (result.error) {
      reportMutationError(msg('건물 카드를 변경하지 못했습니다.'), result.error)
      return false
    }
    if (!ensureAffectedRows(result.data, msg('건물 카드를 변경하지 못했습니다.'))) return false
    await fetchAll()
    showToast(msg('건물 카드가 변경됐습니다'))
    return true
  }

  const reassignBuildingsToCards = async (
    updates: Array<{ buildingId: number; cardId: number }>,
  ) => {
    if (updates.length === 0) {
      showToast(msg('재배정할 건물이 없습니다.'), 'info')
      return { updated: 0, failed: 0 }
    }

    let updated = 0
    let failed = 0
    const chunkSize = 40
    for (let index = 0; index < updates.length; index += chunkSize) {
      const chunk = updates.slice(index, index + chunkSize)
      const results = await Promise.all(
        chunk.map((item) =>
          supabase
            .from('buildings')
            .update({ card_id: item.cardId })
            .eq('id', item.buildingId),
        ),
      )
      results.forEach((result) => {
        if (result.error) failed += 1
        else updated += 1
      })
    }

    await fetchAll()
    showToast(msg('좌표 기준 카드 재배정 완료: {updated}개 변경{v1}', { updated: updated, v1: failed ? `, ${failed}개 실패` : '' }), failed ? 'info' : 'success')
    return { updated, failed }
  }

  return {
    createBuilding,
    importBuildings,
    addUnitToBuilding,
    setBuildingAccess,
    deleteUnitFromBuilding,
    deleteBuilding,
    deleteBuildings,
    mergeDuplicateBuildings,
    updateBuilding,
    setUnitsSurveyed,
    moveBuildingToCard,
    reassignBuildingsToCards,
  }
}
