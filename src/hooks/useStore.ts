import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { trackFetch } from '../lib/perfTracker'
import { withLoadDeadline } from '../lib/loadDeadline'
import { msg } from '../lib/msg'
import { showToast } from '../lib/toast'
import { findActivePeriodId } from '../utils/specialPeriod'
import { setRegions } from '../lib/regions'
import { isRestaurantAssignmentDeleted, resolvePlaceDeletionScope } from '../utils/placeDeletionSignal'
import type {
  Building,
  CalendarEvent,
  CardBoundary,
  EventInformalAssignment,
  EventRestaurantAssignment,
  InformalAsset,
  InformalGroup,
  Notice,
  RestaurantRequest,
  ReturnVisit,
  ReturnVisitLog,
  ServiceSession,
  SpecialPeriod,
  TerritoryCard,
  Unit,
  VisitHistory,
  PlaceDeletionSignal,
} from '../types'
import {
  toBuilding,
  toCard,
  toCalendarEvent,
  toEventCardAssignment,
  toInformalAsset,
  toInformalGroup,
  toEventInformalAssignment,
  toEventRestaurantAssignment,
  mergeEventCardAssignments,
  toVisitHistory,
  toRestaurantRequest,
  toServiceSession,
  toCardBoundary,
  toNotice,
  recomputeCardStats,
} from './storeTransforms'
import {
  makeNoticeMutations,
  makeSpecialPeriodMutations,
  makeTerritoryRegionMutations,
  makeCardBoundaryMutations,
  makeCalendarMutations,
  makeCardMutations,
  makeBuildingMutations,
  makeVisitMutations,
  makeRegularVisitMutations,
  makeServiceSessionMutations,
  makeEventAssignmentMutations,
  makeV2AssignmentMutations,
  makeRestaurantServiceMutations,
} from './storeMutations'
import type {
  RawBuilding,
  RawCard,
  RawCalendarEvent,
  RawEventCardAssignment,
  RawEventCardAssignmentCard,
  RawEventInformalAssignment,
  RawEventRestaurantAssignment,
  RawInformalAsset,
  RawInformalGroup,
  RawVisitHistory,
  RawRestaurantRequest,
  RawServiceSession,
  RawCardBoundary,
  RawNotice,
} from './storeTransforms'

export function getCurrentVisitor(): string {
  return localStorage.getItem('currentVisitor') ?? ''
}

// 공용 dateUtils 로 통합 (기존 import 경로 호환을 위해 재export)
export { getLocalDateString } from '../utils/dateUtils'

// PostgREST 는 한 번에 최대 1,000행만 준다. 통계용 데이터는 끝까지 받아야
// 숫자가 조용히 줄어들지 않는다.
async function fetchAllPages<T>(
  query: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<{ data: T[]; error: unknown }> {
  const pageSize = 1000
  const rows: T[] = []
  for (let from = 0; ; from += pageSize) {
    const res = await query(from, from + pageSize - 1)
    if (res.error) return { data: rows, error: res.error }
    const page = res.data ?? []
    rows.push(...page)
    if (page.length < pageSize) break
  }
  return { data: rows, error: null }
}

/**
 * @param enabled 로그인했는가. false 면 아무것도 받지 않는다.
 *
 * 예전에는 로그인 화면에서도 전부 받았다 (App.tsx 는 인증 판단보다 먼저
 * useStore() 를 호출한다). 실측으로 API 만 약 2.2MB · 47개 요청이었다.
 */
export function useStore(enabled: boolean = true) {
  const [cards, setCards] = useState<TerritoryCard[]>([])
  const [buildings, setBuildings] = useState<Building[]>([])
  // buildings는 cards transform에서 참조됨. fetchSlice가 useCallback([])이라
  // 클로저가 stale 가능 → ref로 항상 최신값 보장.
  const buildingsRef = useRef<Building[]>([])
  const [visitHistories, setVisitHistories] = useState<VisitHistory[]>([])
  const [serviceSessions, setServiceSessions] = useState<ServiceSession[]>([])
  const [calendarEvents, setCalendarEvents] = useState<CalendarEvent[]>([])
  const [cardBoundaries, setCardBoundaries] = useState<CardBoundary[]>([])
  const [notices, setNotices] = useState<Notice[]>([])
  const [specialPeriods, setSpecialPeriods] = useState<SpecialPeriod[]>([])
  const [returnVisits, setReturnVisits] = useState<ReturnVisit[]>([])
  const [returnVisitLogs, setReturnVisitLogs] = useState<ReturnVisitLog[]>([])
  const [informalAssets, setInformalAssets] = useState<InformalAsset[]>([])
  const [eventInformalAssignments, setEventInformalAssignments] = useState<EventInformalAssignment[]>([])
  const [eventRestaurantAssignments, setEventRestaurantAssignments] = useState<EventRestaurantAssignment[]>([])
  const [informalGroups, setInformalGroups] = useState<InformalGroup[]>([])
  const [restaurantRequests, setRestaurantRequests] = useState<RestaurantRequest[]>([])
  const [globalSettings, setGlobalSettings] = useState<Record<string, string>>({})
  const globalSettingsRef = useRef<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  /**
   * 이번 로그인에서 fetchAll 을 시작했는가.
   *
   * loading 상태만으로는 부족하다 — 로그인 화면에서 loading 을 false 로 내려
   * 두었기 때문에, 로그인한 순간(enabled false→true)부터 아래 useEffect 가
   * 돌기 전까지 한 프레임 동안 loading 이 false 다. 그 사이 본 화면이 빈
   * 데이터로 한 번 그려진다.
   */
  const fetchStartedRef = useRef(false)
  const loadedOnceRef = useRef(false)
  const [error, setError] = useState<string | null>(null)
  const [, setMissingCardLeaderAssignmentsTable] = useState(false)
  // 마지막 auto_close 호출 시각 (5분 디바운스)
  const lastAutoCloseAtRef = useRef(0)

  // ─── Phase 1: Slice 기반 fetch 아키텍처 ─────────────────────────
  // 각 slice는 도메인 단위로 묶인 테이블 + transform + setter를 캡슐화.
  // fetchSlices(['visits']) 같이 부분 호출 가능. fetchAll = 전체 slice 호출.
  //
  // Phase 5 hotfix: 거대 territory를 3개로 분할
  //   buildings   → buildings(units nested) — 무거움 (1MB+)
  //   cards       → cards(+assignments+leader_assignments) — 가벼움 (50KB)
  //   cardBoundaries → card_boundaries — 가벼움
  //
  //   visits      → visit_histories, service_sessions
  //   calendar    → calendar_events, event_card_assignments, event_card_assignment_cards
  //   resources   → informal_assets, informal_groups, event_informal_assignments, event_restaurant_assignments
  //   communication → notices
  //   returnVisits → return_visits, return_visit_logs
  //   specialPeriods → special_periods
  //   restaurantRequests → restaurant_requests
  //   system      → app_settings

  type Slice =
    | 'buildings'
    | 'cards'
    | 'cardBoundaries'
    | 'visits'
    | 'calendar'
    | 'resources'
    | 'communication'
    | 'returnVisits'
    | 'specialPeriods'
    | 'restaurantRequests'
    | 'system'

  const ALL_SLICES: Slice[] = [
    'buildings', 'cards', 'cardBoundaries', 'visits', 'calendar', 'resources',
    'communication', 'returnVisits', 'specialPeriods', 'restaurantRequests', 'system',
  ]

  // 각 slice를 독립적으로 fetch. 페이로드 크기 누적 반환.
  const fetchSlice = useCallback(async (slice: Slice): Promise<number> => {
    let approxBytes = 0
    // ⚠ 운영에서는 측정하지 않는다 — 숫자 하나 얻으려고 440KB 를 통째로
    //   문자열로 바꾸는 비용이 구형 기기에서 그대로 체감된다
    const measure = (data: unknown) => {
      if (!import.meta.env.DEV) return
      try { approxBytes += JSON.stringify(data ?? null).length } catch { /* ignore */ }
    }

    switch (slice) {
      case 'buildings': {
        // Phase 5 projection: 필요한 컬럼만 명시. created_at 등 메타 제외.
        // (is_forbidden은 DB 컬럼 미존재, 타입상 optional이라 제외 안전)
        // Supabase/PostgREST는 기본적으로 최대 1,000행만 반환한다.
        // 건물이 1,000개를 넘으면 새로 추가한 건물이 저장만 되고 지도에 나타나지 않으므로
        // 부모 행을 페이지 단위로 끝까지 조회한다.
        const pageSize = 1000
        const buildingRows: RawBuilding[] = []
        for (let from = 0; ; from += pageSize) {
          const buildingsRes = await supabase
            .from('buildings')
            .select('id, card_id, name, address, type, lat, lng, warning, access_status, memo, is_restaurant, units_surveyed, building_access_events(id, action, visitor_name, visited_at, time_slot, memo, created_at), units(id, building_id, number, status, is_chinese, is_restaurant, usage_type, memo, regular_visits(visitor_name, registered_at))')
            .order('id')
            .range(from, from + pageSize - 1)

          if (buildingsRes.error) {
            throw new Error('Building data load failed', { cause: buildingsRes.error })
          }
          const page = (buildingsRes.data ?? []) as RawBuilding[]
          buildingRows.push(...page)
          if (page.length < pageSize) break
        }
        measure(buildingRows)
        const transformedBuildings = buildingRows.map(toBuilding)
        setBuildings(transformedBuildings)
        buildingsRef.current = transformedBuildings  // ref 동기 갱신 (cards transform용)

        // 주의: cards transform이 buildings 의존. cards가 stale 상태라면
        // 새 buildings로 cards를 재변환해야 일관성 유지.
        // 단, 비용 절감을 위해 cards refetch는 별도 'cards' slice 호출 시에만 수행.
        // 대부분 buildings 변경 시 cards 데이터는 그대로지만 transform 결과는 약간 stale 가능.
        return approxBytes
      }

      case 'cards': {
        // 지역 목록도 여기서 받는다 — 카드의 region 값을 해석하는 재료라 늘 함께 쓰인다.
        // 표가 아직 없거나 실패하면 lib/regions 의 기본값이 그대로 남는다 (화면이 비지 않는다).
        void supabase.from('territory_regions')
          .select('id, name, city, sort_order, name_zh, name_en')
          .order('sort_order')
          .then(({ data, error }) => {
            if (error || !data) return
            setRegions(data.map((r) => ({
              id: r.id,
              name: r.name,
              city: r.city ?? '',
              sortOrder: r.sort_order ?? 0,
              nameZh: r.name_zh ?? '',
              nameEn: r.name_en ?? '',
            })))
          })

        // cards에 card_leader_assignments 컬럼이 없으면 폴백
        const cardsQueryPromise = (async () => {
          const withLeader = await fetchAllPages((from, to) => supabase
            .from('cards')
            .select('*, card_assignments(user_name), card_leader_assignments(user_name, created_at)')
            .order('id')
            .range(from, to))
          if (!withLeader.error) {
            setMissingCardLeaderAssignmentsTable(false)
            return withLeader
          }
          const message = (withLeader.error as { message?: string })?.message ?? ''
          if (message.includes('card_leader_assignments')) {
            setMissingCardLeaderAssignmentsTable(true)
            return fetchAllPages((from, to) => supabase
              .from('cards').select('*, card_assignments(user_name)').order('id').range(from, to))
          }
          return withLeader
        })()

        const cardsRes = await cardsQueryPromise
        if (cardsRes.error) {
          throw new Error('Card data load failed', { cause: cardsRes.error })
        }
        measure(cardsRes.data)
        // cards transform은 buildings 의존 — buildingsRef로 항상 최신 buildings 사용
        const transformedCards = (cardsRes.data as RawCard[]).map((raw) => toCard(raw, buildingsRef.current))
        setCards(transformedCards)
        return approxBytes
      }

      case 'cardBoundaries': {
        const boundariesRes = await supabase.from('card_boundaries').select('card_id, points, updated_at')
        measure(boundariesRes.data)
        const transformedBoundaries = boundariesRes.error
          ? []
          : ((boundariesRes.data as RawCardBoundary[]).map(toCardBoundary).filter(Boolean) as CardBoundary[])
        if (boundariesRes.error) {
          console.warn('카드별 구역선 로드 실패 (card_boundaries 스키마 미적용 가능).', boundariesRes.error)
        }
        setCardBoundaries(transformedBoundaries)
        return approxBytes
      }

      case 'visits': {
        // Phase 5 projection + 기간 필터
        // visit_histories: 최근 12개월만 (이전 데이터는 별도 통계 RPC 필요 시)
        const oneYearAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString()
        // ⚠ 통계가 이 데이터로 계산된다 — 한 페이지(1,000행)에서 잘리면
        //   숫자가 조용히 줄어든다. 반드시 끝까지 받는다.
        //   (예전에는 봉사 세션을 100개만 받아 누적 시간이 절반만 나왔다)
        const [visitsRes, sessionsRes] = await Promise.all([
          fetchAllPages((from, to) => supabase
            .from('visit_histories')
            .select('id, unit_id, visitor_name, result, time_slot, memo, visited_at, service_session_id, special_period_id, invitation_left, created_at, created_by_user_id')
            .is('invalidated_at', null)
            .gte('created_at', oneYearAgo)
            .order('created_at', { ascending: false })
            .range(from, to)),
          fetchAllPages((from, to) => supabase
            .from('service_sessions')
            .select('id, user_name, role, calendar_event_id, started_at, ended_at, service_date, time_slot, status, primary_card_id, assigned_card_id, assignment_id, source, memo, created_at')
            .order('started_at', { ascending: false })
            .range(from, to)),
        ])

        if (visitsRes.error) {
          throw new Error('Visit data load failed', { cause: visitsRes.error })
        }

        measure(visitsRes.data)
        measure(sessionsRes.data)

        setVisitHistories((visitsRes.data as RawVisitHistory[]).map(toVisitHistory))
        setServiceSessions(sessionsRes.error
          ? []
          : (sessionsRes.data as RawServiceSession[]).map(toServiceSession))

        if (sessionsRes.error) {
          console.warn('봉사 세션 로드 실패.', sessionsRes.error)
        }
        return approxBytes
      }

      case 'calendar': {
        const [eventsRes, eventCardAssignmentsRes, eventAssignmentCardsRes] = await Promise.all([
          // 1,000개를 넘으면 조용히 잘리므로 끝까지 받는다 (현재 일정 700개 근처)
          fetchAllPages((from, to) => supabase.from('calendar_events')
            .select('*, event_participants(*)').order('event_date').order('time').range(from, to)),
          fetchAllPages((from, to) => supabase.from('event_card_assignments').select('*').order('id').range(from, to)),
          fetchAllPages((from, to) => supabase.from('event_card_assignment_cards').select('*').order('id').range(from, to)),
        ])

        if (eventsRes.error) {
          throw new Error('Calendar data load failed', { cause: eventsRes.error })
        }

        measure(eventsRes.data)
        measure(eventCardAssignmentsRes.data)
        measure(eventAssignmentCardsRes.data)

        const base = eventCardAssignmentsRes.error
          ? []
          : (eventCardAssignmentsRes.data as RawEventCardAssignment[]).map(toEventCardAssignment)
        const merged = eventAssignmentCardsRes.error
          ? base
          : mergeEventCardAssignments(base, eventAssignmentCardsRes.data as RawEventCardAssignmentCard[])
        const transformedEvents = (eventsRes.data as RawCalendarEvent[]).map((event) =>
          toCalendarEvent(event, merged.filter((a) => a.eventId === event.id)),
        )
        setCalendarEvents(transformedEvents)

        if (eventCardAssignmentsRes.error) {
          console.warn('일정별 카드 배정 로드 실패.', eventCardAssignmentsRes.error)
        }
        if (eventAssignmentCardsRes.error) {
          console.warn('다중 카드 배정 로드 실패.', eventAssignmentCardsRes.error)
        }
        return approxBytes
      }

      case 'resources': {
        const [informalAssetsRes, eventInformalRes, eventRestaurantRes, informalGroupsRes] = await Promise.all([
          supabase.from('informal_assets').select('*').eq('archived', false).order('created_at', { ascending: false }),
          supabase.from('event_informal_assignments').select('*'),
          supabase.from('event_restaurant_assignments').select('*'),
          supabase.from('informal_groups').select('*').order('position').order('created_at'),
        ])

        measure(informalAssetsRes.data)
        measure(eventInformalRes.data)
        measure(eventRestaurantRes.data)
        measure(informalGroupsRes.data)

        setInformalAssets(informalAssetsRes.error ? [] : (informalAssetsRes.data as RawInformalAsset[]).map(toInformalAsset))
        setEventInformalAssignments(eventInformalRes.error ? [] : (eventInformalRes.data as RawEventInformalAssignment[]).map(toEventInformalAssignment))
        setEventRestaurantAssignments(eventRestaurantRes.error ? [] : (eventRestaurantRes.data as RawEventRestaurantAssignment[]).map(toEventRestaurantAssignment))
        setInformalGroups(informalGroupsRes.error ? [] : (informalGroupsRes.data as RawInformalGroup[]).map(toInformalGroup))

        if (informalAssetsRes.error || eventInformalRes.error || eventRestaurantRes.error || informalGroupsRes.error) {
          console.warn('v2 신 배정 모델 일부 미적용 — supabase/v2_assignment_model.sql 실행 필요')
        }
        return approxBytes
      }

      case 'communication': {
        const noticesRes = await supabase.from('notices').select('*').order('created_at', { ascending: false }).limit(50)
        measure(noticesRes.data)
        setNotices(noticesRes.error ? [] : (noticesRes.data as RawNotice[]).map(toNotice))
        return approxBytes
      }

      case 'returnVisits': {
        const [returnVisitsRes, returnVisitLogsRes] = await Promise.all([
          supabase.from('return_visits').select('*').is('ended_at', null).order('created_at', { ascending: false }),
          supabase.from('return_visit_logs').select('*').order('visited_at', { ascending: false }),
        ])

        measure(returnVisitsRes.data)
        measure(returnVisitLogsRes.data)

        setReturnVisits(returnVisitsRes.error ? [] : (returnVisitsRes.data as {
          id: number; unit_id: number; building_id: number; display_name: string;
          nickname: string | null; address: string; unit_number: string; assigned_user_name: string;
          created_by: string; last_visited_at: string | null; last_result: string | null; created_at: string;
          ended_at: string | null; ended_by_name: string | null; end_reason: string | null;
        }[]).map((r) => ({
          id: r.id,
          unitId: r.unit_id,
          buildingId: r.building_id,
          displayName: r.display_name,
          nickname: r.nickname ?? '',
          address: r.address ?? '',
          unitNumber: r.unit_number ?? '',
          assignedUserName: r.assigned_user_name ?? '',
          createdBy: r.created_by ?? '',
          lastVisitedAt: r.last_visited_at ?? null,
          lastResult: (r.last_result as '만남' | '부재' | null) ?? null,
          createdAt: r.created_at,
          endedAt: r.ended_at ?? null,
          endedByName: r.ended_by_name ?? '',
          endReason: (r.end_reason as import('../types').ReturnVisitEndReason | null) ?? null,
        })))
        setReturnVisitLogs(returnVisitLogsRes.error ? [] : (returnVisitLogsRes.data as {
          id: number; return_visit_id: number; visited_at: string;
          result: string | null; memo: string | null; created_by: string;
        }[]).map((r) => ({
          id: r.id,
          returnVisitId: r.return_visit_id,
          visitedAt: r.visited_at,
          result: (r.result as '만남' | '부재' | null) ?? null,
          memo: r.memo ?? '',
          createdBy: r.created_by ?? '',
        })))
        return approxBytes
      }

      case 'specialPeriods': {
        const periodsRes = await supabase.from('special_periods').select('*').order('start_date')
        measure(periodsRes.data)
        setSpecialPeriods(periodsRes.error ? [] : (periodsRes.data as { id: number; label: string; start_date: string; end_date: string; color: string; has_invitation?: boolean }[]).map((r) => ({
          id: r.id, label: r.label, startDate: r.start_date, endDate: r.end_date, color: r.color, hasInvitation: r.has_invitation ?? false,
        })))
        return approxBytes
      }

      case 'restaurantRequests': {
        const res = await supabase.from('restaurant_requests').select('*').order('requested_at', { ascending: false })
        measure(res.data)
        setRestaurantRequests(res.error ? [] : (res.data as RawRestaurantRequest[]).map(toRestaurantRequest))
        if (res.error) {
          console.warn('식당봉사 신청 로드 실패 (v3_restaurant_service.sql 미적용 가능).', res.error)
        }
        return approxBytes
      }

      case 'system': {
        const settingsRes = await supabase.from('app_settings').select('*')
        measure(settingsRes.data)
        const nextGlobalSettings = settingsRes.error ? {} : Object.fromEntries((settingsRes.data as { key: string; value: string }[]).map((r) => [r.key, r.value]))
        globalSettingsRef.current = nextGlobalSettings
        setGlobalSettings(nextGlobalSettings)
        return approxBytes
      }
    }
  }, [])

  // 공개 API: 특정 slice만 fetch. 측정 자동 기록.
  // Slice 의존성: cards transform이 buildings 의존 → buildings 먼저 완료해야 함.
  const fetchSlices = useCallback(async (
    slices: Slice[],
    options?: { triggeredBy?: string },
  ): Promise<void> => {
    const start = performance.now()
    let totalBytes = 0

    // buildings와 cards가 둘 다 요청되면 buildings 먼저 fetch (의존성)
    if (slices.includes('buildings') && slices.includes('cards')) {
      const buildingsBytes = await fetchSlice('buildings')
      totalBytes += buildingsBytes
      const remaining = slices.filter((s) => s !== 'buildings')
      const bytesArr = await Promise.all(remaining.map((s) => fetchSlice(s)))
      totalBytes += bytesArr.reduce((a, b) => a + b, 0)
    } else {
      const bytesArr = await Promise.all(slices.map((s) => fetchSlice(s)))
      totalBytes = bytesArr.reduce((a, b) => a + b, 0)
    }

    const duration = Math.round(performance.now() - start)
    trackFetch({
      triggeredBy: options?.triggeredBy ?? 'fetchSlices',
      slices,
      approxBytes: totalBytes,
      durationMs: duration,
      timestamp: Date.now(),
    })
    // 에러 클리어는 fetchAll에서만 (부분 fetch는 다른 slice의 실패 상태를 가리지 않음)
  }, [fetchSlice])

  // 기존 fetchAll: 모든 slice + auto_close 부수효과 유지 (100% 후방호환)
  const fetchAll = useCallback(async () => {
    // 자동 종료 함수 호출 (5분 디바운스, 백그라운드 fire-and-forget)
    if (Date.now() - lastAutoCloseAtRef.current > 5 * 60 * 1000) {
      lastAutoCloseAtRef.current = Date.now()
      void supabase.rpc('auto_close_stale_sessions').then((res) => {
        if (res.error && !res.error.message?.includes('Could not find the function')) {
          console.warn('[auto_close_stale_sessions] failed:', res.error)
        }
      })
    }
    // Clear previous failure before reading, never erase a failure reported by a slice.
    setError(null)
    try {
      await withLoadDeadline(fetchSlices(ALL_SLICES, { triggeredBy: 'fetchAll' }))
      loadedOnceRef.current = true
    } catch (error) {
      console.error('[fetchAll] failed:', error)
      const message = msg('자료를 불러오지 못했습니다. 연결을 확인하고 다시 시도해 주세요.')
      // A background refresh failure must not unmount an editor with unsaved work.
      if (loadedOnceRef.current) showToast(message, 'error')
      else setError(message)
      throw error
    } finally {
      setLoading(false)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchSlices])

  useEffect(() => {
    if (!enabled) {
      // 로그인 전에는 받지 않는다. 다만 loading 을 반드시 내려야 한다 —
      // 안 그러면 로그인 화면이 '데이터 불러오는 중' 에서 멈춘다 (App.tsx)
      fetchStartedRef.current = false
      loadedOnceRef.current = false
      setLoading(false)
      return
    }
    fetchStartedRef.current = true
    setLoading(true)
    fetchAll().then(async () => {
      // "미배정 건물" 카드가 없으면 자동 생성
      const { data: existing } = await supabase
        .from('cards')
        .select('id')
        .eq('name', '미배정 건물')
        .limit(1)
      if (existing?.length === 0) {
        await supabase.from('cards').insert({
          name: '미배정 건물',
          area: '미배정',
          region: '처인구',
          type: '전체',
          status: '미배정',
        })
        await fetchAll()
      }
    }).catch((error: unknown) => {
      console.error('[initial load] failed:', error)
    })
  }, [fetchAll, enabled])

  // PWA 백그라운드 → 포어그라운드 복귀 시 자동 갱신
  // (브라우저 새로고침이 없는 PWA에서 최신 데이터 확보)
  //
  // Phase 4: 디바운스 10초 → 2분 완화.
  // 근거: Realtime 채널이 백그라운드에서도 살아있으므로 visibility 자체로
  //       추가 fetch할 이유가 약함. 진짜 새 데이터는 PullToRefresh로.
  // 효과: 빠르게 탭 전환·앱 전환 시 불필요한 전체 fetchAll 방지.
  //       (자주 화면 켰다 끄는 모바일 환경에서 큰 절감)
  useEffect(() => {
    if (!enabled) return   // 로그인 전에는 창을 다시 켜도 받지 않는다
    let lastFetchAt = Date.now()
    const VISIBILITY_DEBOUNCE_MS = 2 * 60 * 1000  // 2분
    const onVisible = () => {
      if (document.hidden) return
      if (Date.now() - lastFetchAt < VISIBILITY_DEBOUNCE_MS) return
      lastFetchAt = Date.now()
      void fetchAll().catch(() => { /* fetchAll exposes the failure on screen */ })
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onVisible)
    }
  }, [fetchAll, enabled])

  // ── Phase 3: Mutation별 slice-scoped refetcher ─────────────
  // mutation 파일은 fetchAll: () => Promise<void> 를 기대하므로,
  // 도메인별로 적절한 slice만 refetch하는 함수를 만들어서 주입.
  // 결과: mutation 파일 손대지 않고 부분 refetch 적용.
  // Phase 5 hotfix: territory 분할에 따라 mutation별로 정밀 매핑
  const refetchVisits = useCallback(
    // buildings 는 다시 받지 않는다 — 바뀐 세대 한 줄만 patchUnit 으로 반영한다
    // (건물 1,000여 개 · 440KB 재다운로드가 기록할 때마다의 지연 원인이었다)
    () => fetchSlices(['visits'], { triggeredBy: 'mutation:visits' }),
    [fetchSlices],
  )

  // ── 건물 데이터를 서버 재조회 없이 화면에 반영 ────────────────
  // 건물 전체(약 440KB)를 다시 받는 대신 바뀐 부분만 갈아끼운다.
  // ⚠ 카드의 진행률·세대 수는 건물에서 계산되므로 함께 다시 계산해야 한다.
  //   (buildingsRef 는 다음 cards 조회가 쓰는 값이라 같이 갱신)
  const applyBuildingsChange = useCallback((update: (prev: Building[]) => Building[]) => {
    setBuildings((prev) => {
      const next = update(prev)
      buildingsRef.current = next
      return next
    })
    setCards((prevCards) => prevCards.map((card) => recomputeCardStats(card, buildingsRef.current)))
  }, [])

  // 세대 추가/삭제
  const appendUnits = useCallback((buildingId: number, units: Unit[]) => {
    if (units.length === 0) return
    applyBuildingsChange((prev) => prev.map((building) => (
      building.id === buildingId
        ? { ...building, units: [...building.units, ...units.filter((u) => !building.units.some((x) => x.id === u.id))] }
        : building
    )))
  }, [applyBuildingsChange])

  const removeUnit = useCallback((unitId: number) => {
    applyBuildingsChange((prev) => prev.map((building) => (
      building.units.some((u) => u.id === unitId)
        ? { ...building, units: building.units.filter((u) => u.id !== unitId) }
        : building
    )))
  }, [applyBuildingsChange])

  // Realtime 삭제 신호는 전체 목록을 다시 받지 않고 관련 메모리만 걷어낸다.
  // building 신호의 unitIds는 서버가 삭제 직전에 수집하므로 cascade 뒤에도 정확하다.
  const applyPlaceDeletionSignal = useCallback((signal: PlaceDeletionSignal) => {
    const { unitIds, returnVisitIds } = resolvePlaceDeletionScope(
      buildingsRef.current,
      returnVisits,
      signal,
    )

    applyBuildingsChange((current) => signal.targetType === 'building'
      ? current.filter((building) => building.id !== signal.buildingId)
      : current.map((building) => building.units.some((unit) => unitIds.has(unit.id))
          ? { ...building, units: building.units.filter((unit) => !unitIds.has(unit.id)) }
          : building))
    setVisitHistories((current) => current.filter((visit) => !unitIds.has(visit.unitId)))
    setReturnVisits((current) => current.filter((visit) => !returnVisitIds.has(visit.id)))
    setReturnVisitLogs((current) => current.filter((log) => !returnVisitIds.has(log.returnVisitId)))
    setEventRestaurantAssignments((current) => current.filter(
      (assignment) => !isRestaurantAssignmentDeleted(assignment, signal, unitIds),
    ))
  }, [applyBuildingsChange, returnVisits])

  // 방문 기록 등으로 세대 하나가 바뀐 경우
  const patchUnit = useCallback((unitId: number, patch: Partial<Unit>) => {
    applyBuildingsChange((prev) => prev.map((building) => (
      building.units.some((u) => u.id === unitId)
        ? { ...building, units: building.units.map((u) => (u.id === unitId ? { ...u, ...patch } : u)) }
        : building
    )))
  }, [applyBuildingsChange])
  const refetchCards = useCallback(
    // 카드 추가·수정·인도자 배정 — buildings 안 건드림 (가벼움)
    () => fetchSlices(['cards'], { triggeredBy: 'mutation:cards' }),
    [fetchSlices],
  )
  const refetchBuildings = useCallback(
    // 건물 추가·수정·삭제, 호수 추가·삭제 — units 변동 가능
    () => fetchSlices(['buildings', 'cards'], { triggeredBy: 'mutation:buildings' }),
    [fetchSlices],
  )
  const refetchCardBoundaries = useCallback(
    // 구역선 그리기·저장 — boundaries만 (가장 가벼움)
    () => fetchSlices(['cardBoundaries'], { triggeredBy: 'mutation:cardBoundaries' }),
    [fetchSlices],
  )
  const refetchCalendar = useCallback(
    () => fetchSlices(['calendar'], { triggeredBy: 'mutation:calendar' }),
    [fetchSlices],
  )
  const refetchCalendarAndVisits = useCallback(
    () => fetchSlices(['calendar', 'visits'], { triggeredBy: 'mutation:calendar:participant-removal' }),
    [fetchSlices],
  )
  const refetchCommunication = useCallback(
    () => fetchSlices(['communication'], { triggeredBy: 'mutation:communication' }),
    [fetchSlices],
  )
  const refetchReturnVisits = useCallback(
    // 정기방문은 regular_visits가 buildings.units에 nested → buildings도
    () => fetchSlices(['buildings', 'returnVisits'], { triggeredBy: 'mutation:returnVisits' }),
    [fetchSlices],
  )
  const refetchSpecialPeriods = useCallback(
    () => fetchSlices(['specialPeriods'], { triggeredBy: 'mutation:specialPeriods' }),
    [fetchSlices],
  )
  const refetchResources = useCallback(
    () => fetchSlices(['resources'], { triggeredBy: 'mutation:resources' }),
    [fetchSlices],
  )
  const refetchRestaurantRequests = useCallback(
    () => fetchSlices(['restaurantRequests', 'buildings', 'visits'], { triggeredBy: 'mutation:restaurantRequests' }),
    [fetchSlices],
  )

  // ── Mutations ─────────────────────────────────────────────
  const { getRecordServiceSession, startServiceSession, endServiceSession } =
    makeServiceSessionMutations({ fetchAll: refetchVisits, serviceSessions, buildings })

  const { assignCardToEventParticipant, assignCardsToEventParticipantsBulk } =
    makeEventAssignmentMutations({ fetchAll: refetchCalendar })

  const {
    assignLeaderToCard,
    setCardLeaders,
    setMultipleCardLeaders,
    toggleUserOnCard,
    createCard,
    deleteCards,
  } = makeCardMutations({ fetchAll: refetchCards, cards })

  // 특정 날짜에 활성화된 특별봉사 시즌 id 반환 (없으면 null)
  const getActiveSpecialPeriodIdForDate = (dateStr: string): number | null =>
    findActivePeriodId(specialPeriods, dateStr)

  const {
    updateUnitStatus,
    toggleInvitationLeft,
    quickLogVisit,
    updateUnitFlags,
    undoLatestVisit,
    updateVisitHistory,
    addVisitHistory,
    deleteVisitHistory,
  } = makeVisitMutations({ fetchAll: refetchVisits, visitHistories, buildings, cards, getRecordServiceSession, getActiveSpecialPeriodIdForDate, patchUnit })

  const {
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
  } = makeBuildingMutations({ fetchAll: refetchBuildings, buildings, cards, appendUnits, removeUnit })

  const { saveCardBoundary, deleteCardBoundary, restoreCardBoundaries, mergeCardBoundaries, undoMergeCardBoundaries } = makeCardBoundaryMutations({ fetchAll: refetchCardBoundaries, cardBoundaries, buildings })

  const {
    createCalendarEvent,
    createRepeatCalendarEvents,
    updateCalendarEvent,
    updateCalendarEventSeries,
    deleteCalendarEvent,
    deleteCalendarEventSeries,
    linkEventsToSeries,
    applyToEvent,
    assignToEvent,
    removeParticipantFromEvent,
    addParticipantToEvent,
  } = makeCalendarMutations({
    fetchAll: refetchCalendar,
    refetchAfterParticipantRemoval: refetchCalendarAndVisits,
    calendarEvents,
  })

  const {
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
    reassignReturnVisit,
  } = makeRegularVisitMutations({ fetchAll: refetchReturnVisits, buildings, cards, returnVisits })

  // ── 도메인별 mutation 분리 (storeMutations.ts) ──────────────
  const { createNotice, deleteNotice } = makeNoticeMutations({ fetchAll: refetchCommunication })
  const { createSpecialPeriod, updateSpecialPeriod, deleteSpecialPeriod } = makeSpecialPeriodMutations({ fetchAll: refetchSpecialPeriods })
  const {
    createTerritoryRegion, updateTerritoryRegion, moveTerritoryRegion, deleteTerritoryRegion,
  } = makeTerritoryRegionMutations({ fetchAll: refetchCards })

  const {
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
  } = makeV2AssignmentMutations({ fetchAll: refetchResources })

  const {
    addRestaurantVisit,
    registerRestaurant,
    submitRestaurantRequest,
    updateRestaurantRequestMemo,
    approveRestaurantRequest,
    rejectRestaurantRequest,
  } = makeRestaurantServiceMutations({ fetchAll: refetchRestaurantRequests, buildings, cardBoundaries })

  // app_settings 키/값 서버 저장 (기기 간 공유). 캘린더 프리셋 등에 사용.
  const upsertGlobalSetting = async (key: string, value: string): Promise<boolean> => {
    const previousValue = globalSettingsRef.current[key]
    const optimisticSettings = { ...globalSettingsRef.current, [key]: value }
    globalSettingsRef.current = optimisticSettings
    setGlobalSettings(optimisticSettings)
    const { error } = await supabase.from('app_settings').upsert({ key, value }, { onConflict: 'key' })
    if (error) {
      console.warn('[app_settings] 저장 실패', error)
      // 같은 키에 더 최신 저장이 시작됐다면 이전 실패가 새 값을 되돌리지 않는다.
      if (globalSettingsRef.current[key] === value) {
        const next = { ...globalSettingsRef.current }
        if (previousValue === undefined) delete next[key]
        else next[key] = previousValue
        globalSettingsRef.current = next
        setGlobalSettings(next)
      }
      showToast(msg('설정을 저장하지 못했습니다.'), 'error')
      return false
    }
    return true
  }

  return {
    refetchAll: fetchAll,
    refetchSlices: fetchSlices,
    applyPlaceDeletionSignal,
    cards,
    buildings,
    visitHistories,
    serviceSessions,
    calendarEvents,
    cardBoundaries,
    notices,
    // 로그인했는데 아직 받기 시작도 안 했다면 '불러오는 중' 으로 본다.
    // 그래야 로그인 직후 한 프레임 동안 빈 화면이 그려지지 않는다.
    loading: enabled ? (loading || !fetchStartedRef.current) : false,
    error,
    assignLeaderToCard,
    setCardLeaders,
    setMultipleCardLeaders,
    toggleUserOnCard,
    startServiceSession,
    endServiceSession,
    assignCardToEventParticipant,
    assignCardsToEventParticipantsBulk,
    updateUnitStatus,
    quickLogVisit,
    toggleInvitationLeft,
    updateUnitFlags,
    undoLatestVisit,
    addVisitHistory,
    updateVisitHistory,
    deleteVisitHistory,
    createCard,
    createBuilding,
    importBuildings,
    addUnitToBuilding,
    setBuildingAccess,
    deleteUnitFromBuilding,
    deleteBuilding,
    deleteBuildings,
    deleteCards,
    updateBuilding,
    setUnitsSurveyed,
    moveBuildingToCard,
    reassignBuildingsToCards,
    saveCardBoundary,
    deleteCardBoundary,
    restoreCardBoundaries,
    mergeCardBoundaries,
    undoMergeCardBoundaries,
    returnVisits,
    returnVisitLogs,
    createManualReturnVisit,
    toggleRegularVisit,
    addReturnVisitLog,
    updateReturnVisitLog,
    deleteReturnVisitLog,
    deleteReturnVisit,
    updateReturnVisitNickname,
    updateReturnVisitAddress,
    reassignReturnVisit,
    setRegularVisitor,
    toggleChinese,
    createCalendarEvent,
    createRepeatCalendarEvents,
    updateCalendarEvent,
    updateCalendarEventSeries,
    deleteCalendarEvent,
    deleteCalendarEventSeries,
    linkEventsToSeries,
    applyToEvent,
    assignToEvent,
    removeParticipantFromEvent,
    addParticipantToEvent,
    mergeDuplicateBuildings,
    createNotice,
    deleteNotice,
    specialPeriods,
    createSpecialPeriod,
    createTerritoryRegion,
    updateTerritoryRegion,
    moveTerritoryRegion,
    deleteTerritoryRegion,
    updateSpecialPeriod,
    deleteSpecialPeriod,
    getActiveSpecialPeriodIdForDate,
    // v2 신 배정 모델
    informalAssets,
    eventInformalAssignments,
    eventRestaurantAssignments,
    informalGroups,
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
    globalSettings,
    upsertGlobalSetting,
    // 식당봉사
    restaurantRequests,
    addRestaurantVisit,
    submitRestaurantRequest,
    updateRestaurantRequestMemo,
    approveRestaurantRequest,
    rejectRestaurantRequest,
    registerRestaurant,
  }
}
