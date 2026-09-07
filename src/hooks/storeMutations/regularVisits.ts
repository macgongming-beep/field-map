import type { Building, EndReturnVisitInput, ManualReturnVisitInput, ReturnVisit, TerritoryCard } from '../../types'
import { supabase, showToast, reportMutationError, requireVisitor } from './shared'
import { msg } from '../../lib/msg'
import { getAuthToken } from '../../lib/authToken'
import { promptDialog } from '../../lib/confirm'

export function makeRegularVisitMutations(deps: {
  fetchAll: () => Promise<void>
  buildings: Building[]
  cards: TerritoryCard[]
  returnVisits: ReturnVisit[]
}) {
  const { fetchAll, buildings, returnVisits } = deps

  // 표시 이름: 건물명 + 호수 (이전에는 카드에서 동 이름을 추출했는데 불필요하게 앞에 붙음)
  const getReturnVisitDisplayName = (building: Building, unitNumber: string) => {
    return `${building.name} ${unitNumber}`
  }

  const syncReturnVisitForUnit = async (building: Building, unitId: number, visitorName: string) => {
    const unit = building.units.find((u) => u.id === unitId)
    if (!unit) return

    const existing = returnVisits.find((rv) => rv.unitId === unitId)
    const payload = {
      unit_id: unitId,
      building_id: building.id,
      display_name: existing?.displayName || getReturnVisitDisplayName(building, unit.number),
      address: building.address,
      unit_number: unit.number,
      assigned_user_name: visitorName,
      created_by: existing?.createdBy || visitorName,
    }

    const result = existing
      ? await supabase.from('return_visits').update(payload).eq('id', existing.id)
      : await supabase.from('return_visits').insert(payload)

    if (result.error) {
      reportMutationError(msg('활동 정기방문 목록을 동기화하지 못했습니다.'), result.error)
    }
  }

  const toggleRegularVisit = async (buildingId: number, unitId: number, visitorName?: string) => {
    const building = buildings.find((b) => b.id === buildingId)
    const unit = building?.units.find((u) => u.id === unitId)
    if (!building || !unit) return

    if (unit.isRegularVisit) {
      const result = await supabase.from('regular_visits').delete().eq('unit_id', unitId)
      if (result.error) {
        reportMutationError(msg('정기방문을 해제하지 못했습니다.'), result.error)
        return
      }
      await fetchAll()
      showToast(msg('정기방문이 해제됐습니다'))
    } else {
      const name = visitorName || requireVisitor()
      if (!name) return
      const result = await supabase.from('regular_visits').insert({ unit_id: unitId, visitor_name: name, registered_at: new Date().toISOString() })
      if (result.error) {
        reportMutationError(msg('정기방문을 등록하지 못했습니다.'), result.error)
        return
      }

      await syncReturnVisitForUnit(building, unitId, name)
      await fetchAll()
      showToast(msg('정기방문이 등록됐습니다'))
    }
  }

  const setRegularVisitor = async (unitId: number, visitorName: string, registeredAt?: string) => {
    const building = buildings.find((item) => item.units.some((unit) => unit.id === unitId))
    const name = visitorName.trim()
    if (!name) {
      const result = await supabase.from('regular_visits').delete().eq('unit_id', unitId)
      if (result.error) {
        reportMutationError(msg('정기방문자를 해제하지 못했습니다.'), result.error)
        return
      }
      await fetchAll()
      showToast(msg('정기방문자가 해제됐습니다'))
      return
    }

    const upsertData: Record<string, unknown> = { unit_id: unitId, visitor_name: name }
    if (registeredAt) upsertData.registered_at = registeredAt

    const result = await supabase
      .from('regular_visits')
      .upsert(upsertData, { onConflict: 'unit_id' })

    if (result.error) {
      reportMutationError(msg('정기방문자를 저장하지 못했습니다.'), result.error)
      return
    }
    if (building) {
      await syncReturnVisitForUnit(building, unitId, name)
    }
    await fetchAll()
    showToast(msg('정기방문자가 저장됐습니다'))
  }

  const toggleChinese = async (buildingId: number, unitId: number) => {
    const building = buildings.find((b) => b.id === buildingId)
    const unit = building?.units.find((u) => u.id === unitId)
    if (!building || !unit) return

    const newValue = !unit.isChinese
    const result = await supabase.from('units').update({ is_chinese: newValue }).eq('id', unitId)
    if (result.error) {
      reportMutationError(msg('중국인 거주 여부를 저장하지 못했습니다.'), result.error)
      return
    }
    await fetchAll()
    showToast(newValue ? '중국인 거주가 등록됐습니다' : '중국인 거주가 해제됐습니다')
  }

  const addReturnVisitLog = async (
    returnVisitId: number,
    result: '만남' | '부재' | null,
    memo: string,
  ) => {
    const visitor = requireVisitor()
    if (!visitor) return
    const now = new Date().toISOString()
    const logRes = await supabase.from('return_visit_logs').insert({
      return_visit_id: returnVisitId,
      result: result ?? null,
      memo,
      created_by: visitor,
      visited_at: now,
    }).select('id')
    if (logRes.error) {
      reportMutationError(msg('기록을 저장하지 못했습니다.'), logRes.error)
      return
    }
    if (result) {
      const updRes = await supabase.from('return_visits')
        .update({ last_visited_at: now, last_result: result })
        .eq('id', returnVisitId)
      if (updRes.error) {
        // 로그는 저장됐지만 요약 갱신 실패 → 조용히 stale 되지 않게 알림
        console.warn('정기방문 요약(last_*) 갱신 실패:', updRes.error)
        showToast(msg('기록은 저장됐지만 요약 갱신에 실패했어요. 새로고침 해주세요.'), 'info')
        await fetchAll()
        return
      }
    }
    await fetchAll()
    showToast(msg('기록이 저장됐습니다'))
  }

  /**
   * 수동 정기방문 추가.
   *
   * ⚠ **성공 여부를 돌려준다.** 예전에는 void 라서 화면이 실패해도 시트를 닫았고,
   *   오류 토스트는 뜨는데 별명·주소·연결한 세대가 통째로 날아갔다.
   * ⚠ 메모는 `return_visits` 에 넣을 칸이 **없다.** 예전에는 화면이 넘긴 메모를
   *   그냥 버렸다. 첫 기록(return_visit_logs)으로 남긴다 — 기록 화면이 이미
   *   그걸 보여 주므로 새 칸을 만들 이유가 없다.
   */
  const createManualReturnVisit = async (input: ManualReturnVisitInput): Promise<boolean> => {
    const token = getAuthToken()
    if (!token) {
      showToast(msg('다시 로그인해 주세요.'), 'error')
      return false
    }

    const common = {
      p_token: token,
      p_display_name: input.displayName.trim(),
      p_address: input.address.trim(),
      p_memo: input.memo.trim(),
      p_first_result: input.firstResult,
    }
    const res = input.newLocation
      ? await supabase.rpc('create_return_visit_location_tx', {
          ...common,
          p_existing_building_id: input.newLocation.existingBuildingId,
          p_building_name: input.newLocation.buildingName.trim(),
          p_building_type: input.newLocation.buildingType,
          p_unit_number: input.newLocation.unitNumber.trim(),
          p_unit_usage_type: input.newLocation.unitUsageType,
          p_card_id: input.newLocation.cardId,
          p_lat: input.newLocation.lat,
          p_lng: input.newLocation.lng,
        })
      : await supabase.rpc('create_return_visit_tx', {
          ...common,
          p_unit_id: input.unitId ?? null,
        })
    if (res.error || !res.data?.id) {
      reportMutationError(msg('정기방문을 추가하지 못했습니다.'), res.error ?? new Error('Missing return visit result'))
      return false
    }

    // 커밋 뒤 새로고침 실패는 중복 등록을 유도하면 더 위험하다.
    try {
      await fetchAll()
    } catch (error) {
      reportMutationError(msg('등록은 완료됐지만 목록을 새로 불러오지 못했습니다.'), error)
      return true
    }
    showToast(msg('정기방문이 추가됐습니다'))
    return true
  }

  const updateReturnVisitLog = async (id: number, result: '만남' | '부재' | null, memo: string) => {
    const token = getAuthToken()
    if (!token) { showToast(msg('다시 로그인해 주세요.'), 'error'); return }
    let res = await supabase.rpc('update_return_visit_log_tx', {
      p_token: token, p_log_id: id, p_result: result, p_memo: memo, p_reason: '',
    })
    if (res.error?.code === '22023') {
      const reason = await promptDialog({ title: '기록 수정', message: res.error.message, confirmLabel: '수정' })
      if (!reason) return
      res = await supabase.rpc('update_return_visit_log_tx', {
        p_token: token, p_log_id: id, p_result: result, p_memo: memo, p_reason: reason,
      })
    }
    if (res.error || res.data?.ok !== true) { reportMutationError(msg('기록을 수정하지 못했습니다.'), res.error); return }
    await fetchAll()
    showToast(msg('기록이 수정됐습니다'))
  }

  const deleteReturnVisitLog = async (id: number) => {
    const token = getAuthToken()
    if (!token) { showToast(msg('다시 로그인해 주세요.'), 'error'); return }
    let res = await supabase.rpc('invalidate_return_visit_log_tx', { p_token: token, p_log_id: id, p_reason: '' })
    if (res.error?.code === '22023') {
      const reason = await promptDialog({ title: '기록 삭제', message: res.error.message, confirmLabel: '삭제' })
      if (!reason) return
      res = await supabase.rpc('invalidate_return_visit_log_tx', { p_token: token, p_log_id: id, p_reason: reason })
    }
    if (res.error || res.data?.ok !== true) {
      reportMutationError(msg('기록을 삭제하지 못했습니다.'), res.error)
      return
    }
    await fetchAll()
    showToast(msg('기록이 삭제됐습니다'))
  }

  const deleteReturnVisit = async (id: number, input: EndReturnVisitInput): Promise<boolean> => {
    const token = getAuthToken()
    if (!token) {
      showToast(msg('다시 로그인해 주세요.'), 'error')
      return false
    }
    const res = await supabase.rpc('end_return_visit_tx', {
      p_token: token,
      p_return_visit_id: id,
      p_reason: input.reason,
      p_issue_type: input.issueType ?? null,
      p_issue_note: input.issueNote?.trim() ?? '',
    })
    if (res.error || res.data?.ok !== true) {
      reportMutationError(msg('정기방문을 종료하지 못했습니다.'), res.error ?? new Error('Missing end result'))
      return false
    }
    await fetchAll()
    showToast(input.issueType ? msg('정기방문을 종료하고 장소 수정 요청을 보냈습니다') : msg('정기방문을 종료했습니다'))
    return true
  }

  const updateReturnVisitNickname = async (id: number, nickname: string) => {
    const res = await supabase.from('return_visits').update({ nickname: nickname.trim() }).eq('id', id)
    if (res.error) { reportMutationError(msg('별칭을 저장하지 못했습니다.'), res.error); return }
    await fetchAll()
    showToast(msg('별칭이 저장됐습니다'))
  }

  const updateReturnVisitAddress = async (id: number, address: string) => {
    const res = await supabase.from('return_visits').update({ address: address.trim() }).eq('id', id)
    if (res.error) { reportMutationError(msg('주소를 저장하지 못했습니다.'), res.error); return }
    await fetchAll()
    showToast(msg('주소가 저장됐습니다'))
  }

  // 정기방문 담당자 재배정 (전출/삭제로 끊긴 정기방문을 다른 봉사자에게)
  const reassignReturnVisit = async (id: number, newAssignee: string): Promise<boolean> => {
    const token = getAuthToken()
    if (!token) {
      showToast(msg('다시 로그인해 주세요.'), 'error')
      return false
    }
    const res = await supabase.rpc('reassign_return_visit_tx', {
      p_token: token,
      p_return_visit_id: id,
      p_new_assignee: newAssignee.trim(),
    })
    if (res.error || res.data?.ok !== true) {
      reportMutationError(msg('담당자를 변경하지 못했습니다.'), res.error ?? new Error('Missing reassignment result'))
      return false
    }
    await fetchAll()
    showToast(msg('담당자가 {v1}님으로 변경됐습니다', { v1: newAssignee.trim() }))
    return true
  }

  return {
    reassignReturnVisit,
    toggleRegularVisit,
    setRegularVisitor,
    toggleChinese,
    addReturnVisitLog,
    createManualReturnVisit,
    updateReturnVisitLog,
    deleteReturnVisitLog,
    deleteReturnVisit,
    updateReturnVisitNickname,
    updateReturnVisitAddress,
  }
}
