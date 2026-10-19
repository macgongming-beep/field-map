import type { Building, CardBoundary } from '../../types'
import { findCardForCoordinates } from '../../utils/mapUtils'
import { geocodeFirstMatch } from '../../lib/naverGeocode'
import { getGeocodeCandidates } from '../../utils/geocodeCandidates'
import { shortAddress } from '../../utils/shortAddress'
import { ensureAffectedRows, reportMutationError, showToast, supabase } from './shared'
import { msg } from '../../lib/msg'
import { getAuthToken } from '../../lib/authToken'
import type { RegisterRestaurant, SubmitRestaurantRequest } from '../../types/restaurantRegistration'

async function geocodeRestaurantAddress(address: string) {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      geocodeFirstMatch(getGeocodeCandidates(address)),
      new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), 5000) }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export function makeRestaurantServiceMutations(deps: {
  fetchAll: () => Promise<void>
  refreshVisit?: (unitId: number) => Promise<void>
  refreshRequests?: () => Promise<void>
  buildings: Building[]
  cardBoundaries: CardBoundary[]
}) {
  const { fetchAll, cardBoundaries } = deps

  const registerRestaurant: RegisterRestaurant = async (input) => {
    try {
      const token = getAuthToken()
      if (!token) throw new Error(msg('다시 로그인해 주세요.'))
      const selectedCoords = Number.isFinite(input.lat) && Number.isFinite(input.lng)
        ? { lat: input.lat as number, lng: input.lng as number }
        : null
      const coords = input.existingBuildingId ? null : selectedCoords ?? await geocodeRestaurantAddress(input.address)
      const cardId = coords ? findCardForCoordinates(coords.lat, coords.lng, cardBoundaries) : null
      const result = await supabase.rpc('register_restaurant_v2_tx', {
        p_token: token,
        p_name: input.name.trim(),
        p_address: input.address.trim(),
        p_existing_building_id: input.existingBuildingId,
        p_card_id: cardId ?? null,
        p_lat: coords?.lat ?? 0,
        p_lng: coords?.lng ?? 0,
        p_is_chinese: input.isChinese,
        p_initial_state: input.initialState,
        p_regular_visitor: input.regularVisitor,
        p_building_name: shortAddress(input.address),
      })
      if (result.error) throw result.error
      if (!result.data?.unit_id || !result.data?.building_id) throw new Error('Missing restaurant result')
    } catch (error) {
      reportMutationError(msg('식당을 등록하지 못했습니다.'), error)
      return false
    }
    // A refresh failure must not invite another insert after a committed write.
    try { await fetchAll() } catch (error) {
      reportMutationError(msg('등록은 완료됐지만 목록을 새로 불러오지 못했습니다.'), error)
      return true
    }
    showToast(msg('식당이 등록됐습니다.'))
    return true
  }



  /** 봉사자: 식당 방문 기록 직접 추가 (기존 is_restaurant 건물) */
  const addRestaurantVisit = async (
    unitId: number,
    memo: string,
  ): Promise<void> => {
    const visitor = localStorage.getItem('currentVisitor') ?? ''
    const now = new Date().toISOString()
    const result = await supabase.from('visit_histories').insert({
      unit_id: unitId,
      visitor_name: visitor,
      result: '만남',
      time_slot: (() => {
        const h = new Date().getHours()
        if (h < 12) return '오전'
        if (h < 17) return '오후'
        return '저녁'
      })(),
      memo: memo.trim() || null,
      visited_at: now,
      visit_type: 'restaurant',
    })
    if (result.error) {
      reportMutationError(msg('식당봉사 기록을 추가하지 못했습니다.'), result.error)
      return
    }
    if (deps.refreshVisit) await deps.refreshVisit(unitId)
    else await fetchAll()
    showToast(msg('식당봉사 기록이 저장됐습니다 🍜'))
  }

  /** 봉사자: 새 식당 추가 신청 */
  const submitRestaurantRequest: SubmitRestaurantRequest = async (input) => {
    const requestedBy = localStorage.getItem('currentVisitor') ?? ''
    const result = await supabase.from('restaurant_requests').insert({
      name: input.name.trim(),
      address: input.address.trim(),
      requested_by: requestedBy,
      memo: input.memo.trim() || null,
      visited_at: input.initialState === '미방문' ? null : new Date().toISOString(),
      is_chinese: input.isChinese,
      initial_status: input.initialState,
      regular_visitor: input.initialState === '정기방문' ? input.regularVisitor : null,
    }).select('id')
    if (result.error) {
      reportMutationError(msg('식당 추가 신청을 하지 못했습니다.'), result.error)
      return false
    }
    if (!ensureAffectedRows(result.data, msg('식당 추가 신청을 하지 못했습니다.'))) return false
    try { await (deps.refreshRequests ?? fetchAll)() } catch (error) {
      reportMutationError(msg('신청은 완료됐지만 목록을 새로 불러오지 못했습니다.'), error)
      return true
    }
    showToast(msg('식당 추가 신청이 완료됐습니다. 관리자 승인 후 반영됩니다.'))
    return true
  }

  /** 봉사자: 신청한 식당의 메모 업데이트 */
  const updateRestaurantRequestMemo = async (
    requestId: number,
    memo: string,
  ): Promise<boolean> => {
    const result = await supabase
      .from('restaurant_requests')
      .update({ memo: memo.trim() || null })
      .eq('id', requestId)
      .select('id')
    if (result.error) {
      reportMutationError(msg('메모를 저장하지 못했습니다.'), result.error)
      return false
    }
    // 남의 신청이면 RLS 로 0행이 온다 — 오류가 아니므로 행 수로 봐야 한다
    if (!ensureAffectedRows(result.data, msg('메모를 저장하지 못했습니다.'))) return false
    try { await (deps.refreshRequests ?? fetchAll)() } catch (error) {
      reportMutationError(msg('메모는 저장됐지만 목록을 새로 불러오지 못했습니다.'), error)
      return true
    }
    showToast(msg('메모가 저장됐습니다 🍜'))
    return true
  }

  /** 관리자: 식당 신청 승인. 건물·세대·이력·신청 상태를 DB 한 트랜잭션에서 처리한다. */
  const approveRestaurantRequest = async (
    requestId: number,
    opts: {
      name: string
      address: string
      reviewer: string
      existingBuildingId?: number | null
      lat?: number
      lng?: number
    },
  ): Promise<void> => {
    const token = getAuthToken()
    if (!token) {
      showToast(msg('다시 로그인해 주세요.'), 'error')
      return
    }

    let lat = opts.lat ?? 0
    let lng = opts.lng ?? 0
    if (!opts.existingBuildingId && (!lat || !lng)) {
      const found = await geocodeRestaurantAddress(opts.address)
      if (found) { lat = found.lat; lng = found.lng }
    }
    const cardId = lat && lng ? findCardForCoordinates(lat, lng, cardBoundaries) : null
    const result = await supabase.rpc('approve_restaurant_request_tx', {
      p_token: token,
      p_request_id: requestId,
      p_name: opts.name.trim(),
      p_address: opts.address.trim(),
      p_existing_building_id: opts.existingBuildingId ?? null,
      p_card_id: cardId,
      p_lat: lat,
      p_lng: lng,
      p_building_name: shortAddress(opts.address),
    })

    if (result.error || !result.data?.unit_id) {
      reportMutationError(msg('식당 신청 승인에 실패했습니다.'), result.error)
      return
    }

    try { await fetchAll() } catch (error) {
      reportMutationError(msg('승인은 완료됐지만 목록을 새로 불러오지 못했습니다. 새로고침 후 확인해 주세요.'), error)
      return
    }
    showToast(msg('식당 신청이 승인됐습니다.'))
  }

  /** 관리자: 식당 신청 거절 */
  const rejectRestaurantRequest = async (
    requestId: number,
    reviewer: string,
  ): Promise<void> => {
    const result = await supabase
      .from('restaurant_requests')
      .update({
        status: 'rejected',
        reviewer,
        reviewed_at: new Date().toISOString(),
      })
      .eq('id', requestId)
      .select('id')
    if (result.error) {
      reportMutationError(msg('신청 거절에 실패했습니다.'), result.error)
      return
    }
    if (!ensureAffectedRows(result.data, msg('신청 거절에 실패했습니다.'))) return
    try { await fetchAll() } catch (error) {
      reportMutationError(msg('거절은 완료됐지만 목록을 새로 불러오지 못했습니다. 새로고침 후 확인해 주세요.'), error)
      return
    }
    showToast(msg('식당 신청이 거절됐습니다.'))
  }

  return {
    registerRestaurant,
    addRestaurantVisit,
    submitRestaurantRequest,
    updateRestaurantRequestMemo,
    approveRestaurantRequest,
    rejectRestaurantRequest,
  }
}
