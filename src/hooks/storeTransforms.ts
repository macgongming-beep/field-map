/**
 * Supabase Raw Row → 앱 타입 변환 함수 모음
 *
 * useStore.ts 에서 사용하는 모든 transformer 와 DB row 타입.
 * mutate 로직은 useStore.ts 에 그대로 두고, 순수 변환만 분리.
 */
import { compareUnitNumbers } from '../utils/unitNumber'
import { isLegacyNoEntryUnit } from '../utils/unitUsage'
import { INFORMAL_KINDS, type InformalKind } from '../types'
import type {
  Building,
  CalendarEvent,
  CardBoundary,
  CardType,
  EventCardAssignment,
  EventInformalAssignment,
  EventRestaurantAssignment,
  GeoPoint,
  InformalAsset,
  InformalGroup,
  Notice,
  Role,
  ScheduleType,
  ServiceSession,
  ServiceSessionStatus,
  TerritoryCard,
  TimeSlot,
  UnitStatus,
  VisitHistory,
} from '../types'

// 호수 정렬은 utils/unitNumber 로 옮겼다 (utils 가 hooks 를 부르지 않도록).
// 기존 호출부를 위해 여기서 다시 내보낸다.
export { compareUnitNumbers } from '../utils/unitNumber'
const unitNumberCollator = { compare: compareUnitNumbers }

// ===============================================================
// DB row 타입
// ===============================================================
export type RawUnit = {
  id: number
  building_id: number
  number: string
  status: UnitStatus
  is_chinese: boolean
  is_restaurant?: boolean | null
  usage_type?: '주택' | '상가' | null
  is_forbidden?: boolean | null
  memo: string | null
  regular_visits: { visitor_name: string; registered_at?: string | null }[]
}

export type RawBuilding = {
  id: number
  card_id: number
  name: string
  address: string
  type: '주택' | '상가'
  lat: number
  lng: number
  warning: boolean
  access_status?: 'normal' | 'blocked' | null
  memo: string | null
  is_restaurant?: boolean | null
  units_surveyed?: boolean | null
  building_access_events?: Array<{
    id: number
    action: 'blocked' | 'reopened'
    visitor_name: string
    visited_at: string
    time_slot: TimeSlot | null
    memo: string | null
    created_at: string
  }>
  units: RawUnit[]
}

export type RawCard = {
  id: number
  name: string
  area: string
  region: string
  type: string
  status: '미배정' | '진행중' | '완료' | '보류'
  leader_name: string | null
  card_assignments: { user_name: string }[]
  card_leader_assignments?: { user_name: string; created_at?: string | null }[]
}

export type RawCalendarEvent = {
  id: number
  event_date: string
  time: string
  end_time?: string | null
  title: string
  type: string
  place: string
  meeting_map_url?: string | null
  leader_name: string
  card_name: string
  has_meeting: boolean
  allow_applications?: boolean | null
  assignment_status?: 'draft' | 'confirmed' | 'shared' | null
  assignment_shared_at?: string | null
  assignment_shared_by?: string | null
  memo: string
  series_id: string | null
  event_participants: { user_name: string; role: string }[]
}

export type RawEventCardAssignment = {
  id: number
  event_id: number
  user_name: string
  assigned_card_id: number
  team_key?: string | null
  assigned_by: string | null
  assigned_at: string
  memo: string | null
}

export type RawInformalAsset = {
  id: number
  name: string
  kind?: string | null
  parent_id?: number | null
  image_url: string
  image_path: string
  uploaded_by: string
  created_at: string
  archived: boolean
  group_id?: number | null
  lat?: number | null
  lng?: number | null
  memo?: string | null
  boundary?: unknown
  route?: unknown
  zoom?: number | null
}

export type RawInformalGroup = {
  id: number
  name: string
  position: number
  created_by: string
  created_at: string
}

export type RawEventInformalAssignment = {
  id: number
  event_id: number
  user_name: string
  asset_id: number
  assigned_by: string | null
  assigned_at: string
  memo: string | null
}

export type RawEventRestaurantAssignment = {
  id: number
  event_id: number
  user_name: string
  building_id: number
  unit_id: number | null
  assigned_by: string | null
  assigned_at: string
  memo: string | null
}

export type RawEventCardAssignmentCard = {
  id: number
  event_id: number
  user_name: string
  card_id: number
}

export type RawVisitHistory = {
  id: number
  unit_id: number
  service_session_id?: number | null
  visitor_name: string
  result: UnitStatus
  time_slot: TimeSlot
  memo: string | null
  visited_at: string
  created_at: string
  special_period_id?: number | null
  invitation_left?: boolean | null
  visit_type?: 'card' | 'restaurant' | null
  created_by_user_id?: number | null
}

export type RawRestaurantRequest = {
  id: number
  name: string
  address: string
  requested_by: string
  requested_at: string
  status: 'pending' | 'approved' | 'rejected'
  memo: string | null
  visited_at: string | null
  reviewer: string | null
  reviewed_at: string | null
  building_id: number | null
  is_chinese?: boolean | null
  initial_status?: import('../types/restaurantRegistration').RestaurantInitialState | null
  regular_visitor?: string | null
}

export type RawServiceSession = {
  id: number
  user_name: string
  role: Role
  calendar_event_id?: number | null
  started_at: string
  ended_at: string | null
  service_date: string
  time_slot: TimeSlot
  status: ServiceSessionStatus
  primary_card_id: number | null
  assigned_card_id?: number | null
  assignment_id?: number | null
  source?: 'assigned' | 'manual' | 'manual_override'
  memo: string | null
  created_at: string
}

export type RawCardBoundary = {
  card_id: number
  points: unknown
}

export type RawNotice = {
  id: number
  title: string
  content: string
  priority: string
  author: string
  created_at: string
}

// ===============================================================
// 상수
// ===============================================================
export const PRIORITY_MAP: Record<string, Notice['priority']> = {
  normal: '일반', important: '긴급', urgent: '긴급',
  일반: '일반', 중요: '긴급', 긴급: '긴급', 정보: '정보',
}

// ===============================================================
// Transformer 함수
// ===============================================================
export function toBuilding(raw: RawBuilding): Building {
  return {
    id: raw.id,
    cardId: raw.card_id,
    name: raw.name,
    address: raw.address,
    type: raw.type,
    lat: Number(raw.lat),
    lng: Number(raw.lng),
    warning: raw.warning,
    accessStatus: raw.access_status ?? (raw.warning ? 'blocked' : 'normal'),
    accessEvents: [...(raw.building_access_events ?? [])]
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .map((event) => ({
        id: event.id,
        action: event.action,
        visitor: event.visitor_name,
        visitedAt: event.visited_at,
        timeSlot: event.time_slot ?? undefined,
        memo: event.memo ?? undefined,
      })),
    memo: raw.memo ?? undefined,
    isRestaurant: raw.is_restaurant ?? false,
    unitsSurveyed: raw.units_surveyed ?? false,
    units: [...raw.units]
      .sort((a, b) => unitNumberCollator.compare(a.number, b.number))
      .map((u) => ({
        id: u.id,
        number: u.number,
        status: u.status,
        isChinese: u.is_chinese,
        isRestaurant: u.is_restaurant ?? false,
        usageType: u.usage_type ?? undefined,
        isForbidden: Boolean(u.is_forbidden) || u.status === '거절',
        memo: u.memo ?? undefined,
        isRegularVisit: !!(u.regular_visits && (Array.isArray(u.regular_visits) ? u.regular_visits.length > 0 : true)),
        regularVisitor: u.regular_visits
          ? (Array.isArray(u.regular_visits) ? u.regular_visits[0]?.visitor_name : (u.regular_visits as { visitor_name?: string }).visitor_name)
          : undefined,
        regularVisitStart: u.regular_visits
          ? (Array.isArray(u.regular_visits) ? u.regular_visits[0]?.registered_at ?? undefined : (u.regular_visits as { registered_at?: string }).registered_at ?? undefined)
          : undefined,
      })),
  }
}

export function normalizeCardType(): CardType {
  return '전체'
}

/**
 * 카드의 건물·세대 통계를 다시 계산한다.
 *
 * 방문 기록이나 세대 추가처럼 건물 데이터만 바뀌었을 때, 서버를 다시 부르지 않고
 * 진행률·세대 수를 맞추는 데 쓴다. (toCard 와 같은 규칙을 공유해 어긋나지 않게)
 */
export function recomputeCardStats(card: TerritoryCard, buildings: Building[]): TerritoryCard {
  const cardBuildings = buildings.filter((b) => b.cardId === card.id)
  // 식당도 상가의 일부(구역의 한 세대)이므로 진행률에 포함한다.
  const allUnits = cardBuildings.flatMap((b) => b.units.filter((unit) => !isLegacyNoEntryUnit(unit)))
  // "완료" 기준을 지도의 방문완료 판정과 동일하게 — 미방문·부재는 아직 방문필요로 본다.
  const completed = allUnits.filter((u) => u.status !== '미방문' && u.status !== '부재').length
  const total = allUnits.length
  const regularVisitPoints = cardBuildings.flatMap((b) =>
    b.units
      .filter((unit) => !isLegacyNoEntryUnit(unit))
      .filter((u) => u.isRegularVisit)
      .map((u) => ({ point: `${b.name} ${u.number}`, visitor: u.regularVisitor ?? '' })),
  )
  return {
    ...card,
    buildings: cardBuildings.length,
    units: total,
    completed,
    progress: total > 0 ? Math.round((completed / total) * 100) : 100,
    regularVisits: regularVisitPoints.length,
    regularVisitPoints,
  }
}

export function toCard(raw: RawCard, buildings: Building[]): TerritoryCard {
  const assignedLeaders = Array.from(
    new Set((raw.card_leader_assignments ?? []).map((entry) => entry.user_name).filter(Boolean)),
  )
  const leaderAssignedAt = (raw.card_leader_assignments ?? []).reduce<Record<string, string>>((result, entry) => {
    if (!entry.user_name || !entry.created_at) return result
    const previous = result[entry.user_name]
    if (!previous || entry.created_at > previous) result[entry.user_name] = entry.created_at
    return result
  }, {})

  const base: TerritoryCard = {
    id: raw.id,
    name: raw.name,
    area: raw.area,
    region: raw.region,
    type: normalizeCardType(),
    status: raw.status,
    buildings: 0,
    units: 0,
    completed: 0,
    progress: 100,
    regularVisits: 0,
    regularVisitPoints: [],
    assignedLeader: assignedLeaders[0] ?? raw.leader_name,
    assignedLeaders,
    leaderAssignedAt,
    assignedUsers: (raw.card_assignments ?? []).map((a) => a.user_name),
  }
  return recomputeCardStats(base, buildings)
}

export function toCalendarEvent(
  raw: RawCalendarEvent,
  cardAssignments: EventCardAssignment[] = [],
): CalendarEvent {
  const participants = raw.event_participants ?? []
  return {
    id: raw.id,
    date: raw.event_date,
    time: raw.time,
    endTime: raw.end_time ?? undefined,
    title: raw.title,
    type: raw.type as ScheduleType,
    place: raw.place,
    mapLink: raw.meeting_map_url ?? undefined,
    leader: raw.leader_name ?? '',
    leaders: (raw.leader_name ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    card: raw.card_name,
    hasMeeting: raw.has_meeting,
    allowApplications: raw.allow_applications ?? true,
    applicants: participants.map((p) => p.user_name),
    assigned: participants.filter((p) => p.role === '입명').map((p) => p.user_name),
    guests: participants.filter((p) => p.role === '게스트').map((p) => p.user_name),
    cardAssignments,
    assignmentStatus: raw.assignment_status ?? 'draft',
    assignmentSharedAt: raw.assignment_shared_at ?? null,
    assignmentSharedBy: raw.assignment_shared_by ?? null,
    memo: raw.memo,
    seriesId: raw.series_id ?? undefined,
  }
}

export function toEventCardAssignment(raw: RawEventCardAssignment): EventCardAssignment {
  return {
    id: raw.id,
    eventId: raw.event_id,
    userName: raw.user_name,
    assignedCardId: raw.assigned_card_id,
    // 구역 카드가 없는 배정(비공식만 맡은 팀)은 빈 목록이다.
    // [null] 로 두면 화면이 '카드 null' 을 그리고, 개수 검사도 1로 센다.
    assignedCardIds: raw.assigned_card_id != null ? [raw.assigned_card_id] : [],
    teamKey: raw.team_key ?? null,
    assignedBy: raw.assigned_by ?? '',
    assignedAt: raw.assigned_at,
    memo: raw.memo ?? '',
  }
}

/** jsonb → 좌표 목록. 모양이 아니면 null (지도가 깨지는 것보다 안 그려지는 게 낫다) */
function toGeoPoints(value: unknown): GeoPoint[] | null {
  if (!Array.isArray(value)) return null
  const points = value.filter(
    (p): p is GeoPoint =>
      !!p && typeof p === 'object'
      && typeof (p as GeoPoint).lat === 'number'
      && typeof (p as GeoPoint).lng === 'number',
  )
  return points.length > 0 ? points : null
}

/**
 * jsonb → 선 여러 개.
 * 옛 자료는 점 목록 하나(GeoPoint[])로 저장돼 있어 그것도 받아 감싼다.
 * 마이그레이션 없이 두 모양을 함께 읽는 쪽이 안전하다 — 자료를 건드리지 않는다.
 */
function toGeoPointLines(value: unknown): GeoPoint[][] | null {
  if (!Array.isArray(value) || value.length === 0) return null
  const first = value[0]
  if (first && typeof first === 'object' && !Array.isArray(first)
      && typeof (first as GeoPoint).lat === 'number') {
    const single = toGeoPoints(value)
    return single ? [single] : null
  }
  const lines = value
    .map((line) => toGeoPoints(line))
    .filter((line): line is GeoPoint[] => line !== null && line.length >= 2)
  return lines.length > 0 ? lines : null
}

export function toInformalAsset(raw: RawInformalAsset): InformalAsset {
  return {
    id: raw.id,
    name: raw.name,
    // 모르는 값이 오면 '비공식구역' 으로 떨어뜨린다 — 지도가 안 그려지는 것보다 낫다
    kind: INFORMAL_KINDS.includes(raw.kind as InformalKind) ? (raw.kind as InformalKind) : '비공식구역',
    parentId: raw.parent_id ?? null,
    imageUrl: raw.image_url,
    imagePath: raw.image_path,
    uploadedBy: raw.uploaded_by ?? '',
    createdAt: raw.created_at,
    archived: !!raw.archived,
    groupId: raw.group_id ?? null,
    lat: raw.lat ?? null,
    lng: raw.lng ?? null,
    memo: raw.memo ?? '',
    boundary: toGeoPoints(raw.boundary),
    route: toGeoPointLines(raw.route),
    zoom: raw.zoom ?? null,
  }
}

export function toInformalGroup(raw: RawInformalGroup): InformalGroup {
  return {
    id: raw.id,
    name: raw.name,
    position: raw.position ?? 0,
    createdBy: raw.created_by ?? '',
    createdAt: raw.created_at,
  }
}

export function toEventInformalAssignment(raw: RawEventInformalAssignment): EventInformalAssignment {
  return {
    id: raw.id,
    eventId: raw.event_id,
    userName: raw.user_name,
    assetId: raw.asset_id,
    assignedBy: raw.assigned_by ?? '',
    assignedAt: raw.assigned_at,
    memo: raw.memo ?? '',
  }
}

export function toEventRestaurantAssignment(raw: RawEventRestaurantAssignment): EventRestaurantAssignment {
  return {
    id: raw.id,
    eventId: raw.event_id,
    userName: raw.user_name,
    buildingId: raw.building_id,
    unitId: raw.unit_id ?? null,
    assignedBy: raw.assigned_by ?? '',
    assignedAt: raw.assigned_at,
    memo: raw.memo ?? '',
  }
}

export function mergeEventCardAssignments(
  baseAssignments: EventCardAssignment[],
  cardRows: RawEventCardAssignmentCard[],
): EventCardAssignment[] {
  if (cardRows.length === 0) return baseAssignments

  const grouped = new Map<string, number[]>()
  cardRows.forEach((row) => {
    const key = `${row.event_id}:${row.user_name}`
    const current = grouped.get(key) ?? []
    current.push(row.card_id)
    grouped.set(key, current)
  })

  return baseAssignments.map((assignment) => {
    const key = `${assignment.eventId}:${assignment.userName}`
    const groupedIds = grouped.get(key)
    if (!groupedIds || groupedIds.length === 0) return assignment
    const deduped = Array.from(new Set(groupedIds))
    return {
      ...assignment,
      assignedCardIds: deduped,
      assignedCardId: deduped[0] ?? assignment.assignedCardId,
    }
  })
}

export function toVisitHistory(raw: RawVisitHistory): VisitHistory {
  return {
    id: raw.id,
    buildingId: 0, // not stored in DB, lookup from unit if needed
    unitId: raw.unit_id,
    serviceSessionId: raw.service_session_id ?? null,
    visitor: raw.visitor_name,
    result: raw.result,
    timeSlot: raw.time_slot,
    memo: raw.memo ?? undefined,
    visitedAt: raw.visited_at,
    createdAt: raw.created_at,
    specialPeriodId: raw.special_period_id ?? null,
    invitationLeft: raw.invitation_left ?? false,
    visitType: raw.visit_type ?? 'card',
    createdByUserId: raw.created_by_user_id ?? null,
  }
}

export function toRestaurantRequest(raw: RawRestaurantRequest): import('../types').RestaurantRequest {
  return {
    id: raw.id,
    name: raw.name,
    address: raw.address,
    requestedBy: raw.requested_by,
    requestedAt: raw.requested_at,
    status: raw.status,
    memo: raw.memo,
    visitedAt: raw.visited_at,
    reviewer: raw.reviewer,
    reviewedAt: raw.reviewed_at,
    buildingId: raw.building_id,
    isChinese: raw.is_chinese ?? true,
    initialStatus: raw.initial_status ?? '미방문',
    regularVisitor: raw.regular_visitor ?? null,
  }
}

export function toServiceSession(raw: RawServiceSession): ServiceSession {
  return {
    id: raw.id,
    userName: raw.user_name,
    role: raw.role,
    calendarEventId: raw.calendar_event_id ?? null,
    startedAt: raw.started_at,
    endedAt: raw.ended_at,
    serviceDate: raw.service_date,
    timeSlot: raw.time_slot,
    status: raw.status,
    primaryCardId: raw.primary_card_id,
    assignedCardId: raw.assigned_card_id ?? null,
    assignmentId: raw.assignment_id ?? null,
    source: raw.source ?? 'manual',
    memo: raw.memo ?? '',
    createdAt: raw.created_at,
  }
}

export function toCardBoundary(raw: RawCardBoundary): CardBoundary | null {
  if (!Array.isArray(raw.points)) return null
  const points = raw.points.filter((point): point is GeoPoint => {
    if (!point || typeof point !== 'object') return false
    const candidate = point as Partial<GeoPoint>
    return typeof candidate.lat === 'number' && typeof candidate.lng === 'number'
  })
  if (points.length < 3) return null
  return { cardId: raw.card_id, points }
}

export function toNotice(raw: RawNotice): Notice {
  return {
    id: raw.id,
    title: raw.title,
    content: raw.content ?? '',
    priority: PRIORITY_MAP[raw.priority] ?? '일반',
    author: raw.author ?? '',
    createdAt: raw.created_at,
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Supabase 원시 DB row → 타입 변환 입력
export function toServiceSuggestion(row: any): import('../types').ServiceSuggestion {
  return {
    id: row.id,
    title: row.title || '',
    show_title_on_home: row.show_title_on_home ?? false,
    tags: row.tags || [],
    last_used_at: row.last_used_at,
    is_visible: row.is_visible ?? false,
    content: row.content || [],
    created_at: row.created_at,
  }
}
