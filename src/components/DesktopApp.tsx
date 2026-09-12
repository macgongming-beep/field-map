import { useMemo, useRef, useState } from 'react'
import { showToast } from '../lib/toast'
import { Routes, Route, Navigate, useNavigate, useLocation, useSearchParams } from 'react-router-dom'
import { DesktopCalendar } from './DesktopCalendar'
import { DesktopHome } from './DesktopHome'

import { DesktopSettings } from './DesktopSettings'
import { DesktopStats } from './DesktopStats'
import { DesktopTerritory } from './DesktopTerritory'
import { DesktopMyService } from './DesktopMyService'
import { DesktopMap } from './DesktopMap'
import { DesktopAdminAssignment } from './DesktopAdminAssignment'
import { AdminSuggestions } from './admin/AdminSuggestions'
import { MobileUsers } from './MobileUsers'
import { MobileNotices } from './MobileNotices'
import { MobileSignupRequests } from './MobileSignupRequests'
import { DesktopProfileSettings } from './DesktopProfileSettings'
import { DesktopDataManagement } from './DesktopDataManagement'
import { DesktopSpecialPeriods } from './DesktopSpecialPeriods'
import { DesktopTerritoryRegions } from './DesktopTerritoryRegions'
import { DesktopNotificationSettings } from './DesktopNotificationSettings'
import { LocationPermissionSettings } from './LocationPermissionSettings'
import { ServiceLogPage } from './ServiceLogPage'
import { RegularVisitManagement } from './RegularVisitManagement'
import { PlaceChangeRequests } from './PlaceChangeRequests'
import { AppHeaderActionButtons } from './AppHeader'
import type { InformalKind, Building, CalendarEvent, CardBoundary, DesktopPage, EndReturnVisitInput, EventInformalAssignment, EventRestaurantAssignment, GeoPoint, InformalAsset, InformalGroup, Notice, ReturnVisit, ReturnVisitLog, Role, ServiceSession, SpecialPeriod, TerritoryCard, TimeSlot, Unit, UnitStatus, VisitHistory } from '../types'
import type { CsvBuildingImport } from '../utils/csvBuildingImport'
import type { CardMergeUndoSnapshot } from '../hooks/storeMutations/cardBoundaries'
import type { AuthUser, LoginLogRecord } from '../hooks/useAuth'
import { roleLabels } from '../types'
import type { AppLanguage } from '../i18n'
import { msg } from '../lib/msg'
import type { MergeResult } from '../utils/duplicateBuildingMerge'

const pageToPath: Record<DesktopPage, string> = {
  '홈': '/',
  '공지': '/notices',
  '캘린더': '/calendar',
  '구역': '/zone',       // 구역 관리 (인도자/관리자)
  '활동': '/territory', // 개인 봉사 (봉사자/인도자)
  '지도': '/map',
  '배정': '/assignment',
  '사용자': '/users',
  '통계': '/stats',
  '설정': '/settings'
}

const pathToPage: Record<string, DesktopPage> = {
  '/': '홈',
  '/notices': '공지',
  '/calendar': '캘린더',
  '/territory': '활동',
  '/zone': '구역',
  '/map': '지도',
  '/assignment': '배정',
  '/users': '사용자',
  '/stats': '통계',
  '/settings': '설정'
}

export function DesktopApp({
  buildings,
  calendarEvents,
  cardBoundaries,
  cards,
  currentVisitor,
  currentUserId,
  actualRole,
  viewMode,
  notices,
  serviceSessions,
  onAddUnit,
  onApplyToEvent,
  onSetCardLeaders,
  onSetMultipleCardLeaders,
  onStartServiceSession,
  onEndServiceSession,
  onAssignCardToEventParticipant,
  onAssignCardsToEventParticipantsBulk,
  onCreateCalendarEvent,
  onCreateRepeatCalendarEvents,
  onUpdateCalendarEvent,
  onUpdateCalendarEventSeries,
  onDeleteCalendarEvent,
  onDeleteCalendarEventSeries,
  onLinkEventsToSeries,
  onCreateCard,
  onCreateTerritoryRegion,
  onUpdateTerritoryRegion,
  onMoveTerritoryRegion,
  onDeleteTerritoryRegion,
  onCreateBuilding,
  onImportBuildings,
  onCreateNotice,
  onCreateSpecialPeriod,
  onUpdateSpecialPeriod,
  onDeleteBuilding,
  onDeleteBuildings,
  onDeleteCards,
  onMergeDuplicateBuildings,
  onDeleteCardBoundary,
  onMoveBuildingToCard,
  onReassignBuildingsToCards,
  onDeleteNotice,
  onDeleteSpecialPeriod,
  specialPeriods,
  onDeleteUnit,
  onRemoveParticipantFromEvent,
  onAddParticipantToEvent,
  allUsers,
  returnVisits,
  returnVisitLogs,
  onAddReturnVisitLog,
  onToggleRegularVisit,
  onSetRegularVisitor,
  onDeleteReturnVisit: _onDeleteReturnVisit,
  onReassignReturnVisit,
  onToggleChinese,
  onToggleUser: _onToggleUser,
  onUndoLatestVisit,
  onAddVisitHistory,
  onUpdateVisitHistory,
  onDeleteVisitHistory,
  onUpdateUnitStatus,
  onQuickLogVisit,
  onToggleInvitationLeft,
  onUpdateUnitFlags,
  onUpdateBuilding,
  onSetUnitsSurveyed,
  onSaveCardBoundary,
  onRestoreCardBoundaries,
  onMergeCardBoundaries,
  onUndoMergeCardBoundaries,
  visitHistories,
  onChangeViewMode,
  onLogout,
  leaderNames,
  // v2 신 배정 모델
  informalAssets = [],
  eventInformalAssignments = [],
  eventRestaurantAssignments = [],
  informalGroups = [],
  onCreateInformalPlace,
  onUpdateInformalPlace,
  onSaveInformalShape,
  onUploadInformalAsset,
  onDeleteInformalAsset,
  onDeleteInformalAssets,
  onCreateInformalGroup,
  onRenameInformalGroup,
  onDeleteInformalGroup,
  onMoveAssetToGroup,
  onMoveAssetsToGroup,
  onAssignInformalToUser,
  onRemoveInformalAssignment,
  onAssignRestaurantToUser,
  onRemoveRestaurantAssignment,
  onToggleBuildingRestaurant,
  onRemoveRestaurantUnit,
  onBulkSetRestaurant,
  restaurantRequests = [],
  onRegisterRestaurant,
  onApproveRestaurantRequest,
  onRejectRestaurantRequest,
  language,
  currentUser,
  onChangePin,
  onUpdateMyProfile,
  onFetchMyLoginLogs,
  globalSettings = {},
  onUpsertGlobalSetting,
  onPlaceDeleted,
}: {
  language: AppLanguage
  buildings: Building[]
  calendarEvents: CalendarEvent[]
  cardBoundaries: CardBoundary[]
  cards: TerritoryCard[]
  currentVisitor: string
  currentUserId: number
  actualRole: Role
  viewMode: Role
  leaderNames: string[]
  notices: Notice[]
  serviceSessions: ServiceSession[]
  onAddUnit: (buildingId: number, unitNumber: string | string[], usageType?: Building['type']) => Promise<number[] | false>
  onApplyToEvent: (eventId: number) => void
  onSetCardLeaders: (cardId: number, leaderNames: string[], options?: { silentSuccess?: boolean }) => Promise<void> | void
  onSetMultipleCardLeaders: (cardIds: number[], leaderNames: string[], options?: { silentSuccess?: boolean }) => Promise<void> | void
  onStartServiceSession: (input: {
    role: Role
    timeSlot: TimeSlot
    primaryCardId?: number | null
    calendarEventId?: number | null
    assignedCardId?: number | null
    assignmentId?: number | null
    source?: ServiceSession['source']
    memo?: string
  }) => Promise<number | null>
  onEndServiceSession: (sessionId: number) => void
  onAssignCardToEventParticipant: (eventId: number, userName: string, cardId: number | null) => void
  onAssignCardsToEventParticipantsBulk: (
    eventId: number,
    assignments: Array<{ userName: string; cardId?: number | null; cardIds?: number[] | null; teamKey?: string | null }>,
    options?: {
      silentSuccess?: boolean
      status?: 'confirmed' | 'shared'
      expectedSharedAt?: string | null
      onConflict?: (serverSharedAt: string | null) => void
    },
  ) => Promise<void> | void
  onCreateCalendarEvent: (input: { date: string; time: string; endTime?: string; title: string; place: string; mapLink?: string; leader: string; memo: string; hasMeeting: boolean; allowApplications: boolean }) => void
  onCreateRepeatCalendarEvents: (dates: string[], input: { time: string; endTime?: string; title: string; place: string; mapLink?: string; leader: string; memo: string; hasMeeting: boolean; allowApplications: boolean }) => void
  onUpdateCalendarEvent: (eventId: number, input: { time: string; endTime?: string; title: string; place: string; mapLink?: string; leader: string; memo: string; hasMeeting: boolean; allowApplications: boolean }) => void
  onUpdateCalendarEventSeries: (seriesId: string, fromDate: string, input: { time: string; endTime?: string; title: string; place: string; mapLink?: string; leader: string; memo: string; hasMeeting: boolean; allowApplications: boolean }) => void
  onDeleteCalendarEvent: (eventId: number) => void
  onDeleteCalendarEventSeries: (seriesId: string, fromDate: string) => void
  onLinkEventsToSeries: (eventIds: number[]) => void
  onCreateCard: (input: {
    area: string
    region: string
    index: number
    pinCount: number
  }) => Promise<number | null> | number | null
  onCreateTerritoryRegion?: (input: { name: string; city?: string }) => Promise<boolean>
  onUpdateTerritoryRegion?: (id: number, input: { city?: string; nameZh?: string; nameEn?: string }) => Promise<boolean>
  onMoveTerritoryRegion?: (id: number, direction: 'up' | 'down') => Promise<boolean>
  onDeleteTerritoryRegion?: (id: number, name: string) => Promise<boolean>
  // ⚠ 예전에 => void 였다. TypeScript 는 반환값 있는 함수를 void 콜백에 넣게
  //    해 주므로 컴파일은 됐지만, **실패 계약이 이 층에서 지워졌다.**
  //    저장이 실패해도 화면은 성공으로 알았다.
  onCreateBuilding: (input: {
    cardId: number
    name: string
    address: string
    type: Building['type']
    lat: number
    lng: number
  }) => Promise<boolean>
  onImportBuildings: (inputs: CsvBuildingImport[]) => Promise<{ inserted: number; skipped: number }>
  onCreateNotice: (input: { title: string; content: string; priority: Notice['priority']; author: string }) => void
  onCreateSpecialPeriod: (input: { label: string; startDate: string; endDate: string; color: string }) => Promise<boolean | void> | boolean | void
  onUpdateSpecialPeriod: (id: number, input: { label: string; startDate: string; endDate: string; color: string }) => Promise<boolean | void> | boolean | void
  onDeleteBuilding: (buildingId: number) => void
  onDeleteBuildings: (buildingIds: number[]) => void
  onDeleteCards: (cardIds: number[]) => void
  onMergeDuplicateBuildings: (scopeCardId?: number, nameOverrides?: Record<number, string>, selectedPrimaryIds?: number[]) => Promise<MergeResult>
  onUpdateBuilding: (buildingId: number, name: string, address: string, lat?: number, lng?: number, type?: Building['type'], memo?: string, isChineseHeavy?: boolean) => Promise<boolean>
  onSetUnitsSurveyed?: (buildingId: number, surveyed: boolean) => Promise<boolean> | void
  onMoveBuildingToCard: (buildingId: number, cardId: number) => Promise<boolean>
  onReassignBuildingsToCards: (updates: Array<{ buildingId: number; cardId: number }>) => Promise<{ updated: number; failed: number }>
  onDeleteCardBoundary: (cardId: number) => Promise<boolean>
  onDeleteNotice: (id: number) => void
  onDeleteSpecialPeriod: (id: number) => void
  specialPeriods: SpecialPeriod[]
  onDeleteUnit: (buildingId: number, unitId: number) => void
  onRemoveParticipantFromEvent: (eventId: number, userName: string) => void
  onAddParticipantToEvent: (eventId: number, userName: string, participantRole?: '신청' | '게스트') => boolean | void | Promise<boolean | void>
  allUsers: Array<{ id: number; name: string; role: string; approvalStatus?: 'pending' | 'approved' | 'blocked'; isActive?: boolean }>
  returnVisits?: ReturnVisit[]
  returnVisitLogs?: ReturnVisitLog[]
  onAddReturnVisitLog: (returnVisitId: number, result: '만남' | '부재' | null, memo: string) => Promise<void>
  onToggleRegularVisit: (buildingId: number, unitId: number, visitorName?: string) => void
  onSetRegularVisitor: (unitId: number, visitorName: string) => void
  onDeleteReturnVisit?: (id: number, input: EndReturnVisitInput) => Promise<boolean>
  onReassignReturnVisit?: (id: number, newAssignee: string) => Promise<boolean> | boolean
  onToggleChinese: (buildingId: number, unitId: number) => void
  onToggleUser: (cardId: number, userName: string) => void
  onUndoLatestVisit: (buildingId: number, unitId: number) => void
  onAddVisitHistory: (
    buildingId: number,
    unitId: number,
    input: { result: UnitStatus; timeSlot: TimeSlot; memo: string; visitedAt: string },
  ) => Promise<boolean>
  onUpdateVisitHistory: (
    historyId: number,
    unitId: number,
    input: { result: UnitStatus; timeSlot: TimeSlot; memo: string; visitedAt: string },
  ) => Promise<boolean>
  onDeleteVisitHistory: (historyId: number, unitId: number) => void
  onUpdateUnitStatus: (buildingId: number, unitId: number, status: UnitStatus, memo?: string) => void
  onQuickLogVisit: (buildingId: number, unitId: number, result: UnitStatus, invitationLeft?: boolean) => void
  onToggleInvitationLeft: (buildingId: number, unitId: number) => void
  onUpdateUnitFlags: (unitId: number, flags: Partial<Unit>) => void | Promise<boolean>
  onSaveCardBoundary: (cardId: number, points: GeoPoint[]) => Promise<boolean>
  onRestoreCardBoundaries?: (boundaries: CardBoundary[]) => Promise<void> | void
  onMergeCardBoundaries?: (input: {
    targetCardId: number
    sourceCardIds: number[]
    mergedPoints: GeoPoint[]
  }) => Promise<void> | void
  onUndoMergeCardBoundaries?: (snapshot: CardMergeUndoSnapshot) => Promise<void>
  visitHistories: VisitHistory[]
  onChangeViewMode: (role: Role) => void
  onLogout: () => void
  // v2 신 배정 모델
  informalAssets?: InformalAsset[]
  onCreateInformalPlace?: (input: { name: string; createdBy: string; groupId?: number | null; lat: number; lng: number; memo?: string; zoom?: number | null; kind?: InformalKind; parentId?: number | null }) => Promise<boolean>
  onSaveInformalShape?: (assetId: number, field: 'boundary' | 'route', points: GeoPoint[]) => Promise<boolean>
  /** 만든 뒤에 종류·이름을 고친다 */
  onUpdateInformalPlace?: (
    assetId: number,
    input: { name?: string; memo?: string; lat?: number; lng?: number; zoom?: number | null; kind?: InformalKind },
  ) => Promise<boolean>
  eventInformalAssignments?: EventInformalAssignment[]
  eventRestaurantAssignments?: EventRestaurantAssignment[]
  informalGroups?: InformalGroup[]
  onUploadInformalAsset?: (input: { file: File; name: string; uploadedBy: string; groupId?: number | null }) => Promise<{ ok: boolean; assetId?: number; error?: string }>
  onDeleteInformalAsset?: (assetId: number) => Promise<boolean>
  onDeleteInformalAssets?: (assetIds: number[]) => Promise<{ failed: number[] }>
  onCreateInformalGroup?: (input: { name: string; createdBy: string }) => Promise<number | null>
  onRenameInformalGroup?: (groupId: number, name: string) => Promise<boolean>
  onDeleteInformalGroup?: (groupId: number) => Promise<boolean>
  onMoveAssetToGroup?: (assetId: number, groupId: number | null) => Promise<boolean>
  onMoveAssetsToGroup?: (assetIds: number[], groupId: number | null) => Promise<{ failed: number[] }>
  onAssignInformalToUser?: (input: { eventId: number; userName: string; assetId: number; assignedBy: string }) => Promise<boolean>
  onRemoveInformalAssignment?: (assignmentId: number) => Promise<void>
  onAssignRestaurantToUser?: (input: { eventId: number; userName: string; buildingId: number; unitId?: number | null; assignedBy: string }) => Promise<boolean>
  onRemoveRestaurantAssignment?: (assignmentId: number) => Promise<void>
  onToggleBuildingRestaurant?: (buildingId: number, isRestaurant: boolean) => Promise<void>
  onRemoveRestaurantUnit?: (unitId: number, buildingId: number) => Promise<void>
  onBulkSetRestaurant?: (buildingIds: number[], nameUpdates?: { id: number; name: string }[]) => Promise<void>
  restaurantRequests?: import('../types').RestaurantRequest[]
  onRegisterRestaurant?: import('../types/restaurantRegistration').RegisterRestaurant
  onApproveRestaurantRequest?: (id: number, opts: { name: string; address: string; reviewer: string; existingBuildingId?: number | null; lat?: number; lng?: number }) => Promise<void>
  onRejectRestaurantRequest?: (id: number, reviewer: string) => Promise<void>
  currentUser: AuthUser
  onChangePin: (newPin: string) => Promise<boolean>
  onUpdateMyProfile: (input: { name: string; phone?: string | null }) => Promise<boolean>
  onFetchMyLoginLogs: (limit?: number) => Promise<LoginLogRecord[]>
  globalSettings?: Record<string, string>
  onUpsertGlobalSetting?: (key: string, value: string) => Promise<boolean>
  onPlaceDeleted?: (signal: import('../types').PlaceDeletionSignal) => void
}) {
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams] = useSearchParams()
  
  const [boundaryEditRequest, setBoundaryEditRequest] = useState(0)
  const [roleDropdownOpen, setRoleDropdownOpen] = useState(false)
  const roleDropdownRef = useRef<HTMLDivElement>(null)

  const handleViewModeChange = (role: Role) => {
    onChangeViewMode(role)
    setRoleDropdownOpen(false)
    const label = role === 'user' ? '봉사자' : roleLabels[role]
    showToast(msg('{label}로 변경되었습니다.', { label: label }), 'success')
  }
  // /zone?view=map 에서 지도 뷰 (인도자 구역 탭 내부 토글)
  const showZoneMapView = location.pathname === '/zone' && searchParams.get('view') === 'map'

  const rawActivePage = location.pathname.startsWith('/settings') ? '설정' : pathToPage[location.pathname] || '홈'
  // 인도자가 /map에 있을 때 → '구역' 탭 활성화 (지도 탭 없음)
  const activePage: DesktopPage =
    rawActivePage === '지도' && viewMode === 'leader' ? '구역' : rawActivePage

  const visibleDesktopPages: DesktopPage[] = viewMode === 'user'
    ? ['홈', '캘린더', '활동', '설정']
    : viewMode === 'leader'
      ? ['홈', '캘린더', '활동', '구역', '설정']
      : ['홈', '캘린더', '구역', '지도', '배정', '통계', '설정']

  const focusedMapCardId = searchParams.get('cardId') ? Number(searchParams.get('cardId')) : null
  const focusedMapBuildingId = searchParams.get('buildingId') ? Number(searchParams.get('buildingId')) : null
  const focusedInformalId = searchParams.get('informalId') ? Number(searchParams.get('informalId')) : null
  // 지역 관리 화면에서 '지워도 되는지' 를 보여 준다 — 카드가 있으면 지우면 안 된다
  const regionCardCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const card of cards) {
      if (!card.region) continue
      counts[card.region] = (counts[card.region] ?? 0) + 1
    }
    return counts
  }, [cards])

  const userVisibleMapCardIds = useMemo(() => {
    const ids = new Set<number>()
    cards.forEach((card) => {
      if (card.assignedUsers.includes(currentVisitor)) ids.add(card.id)
    })
    // eslint-disable-next-line react-hooks/purity -- 최근 7일 cutoff: 렌더 시점 기준이 의도된 동작
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000
    serviceSessions.forEach((session) => {
      if (session.userName !== currentVisitor) return
      const sessionTime = new Date(session.serviceDate || session.startedAt).getTime()
      if (Number.isFinite(sessionTime) && sessionTime < cutoff) return
      if (session.primaryCardId) ids.add(session.primaryCardId)
      if (session.assignedCardId) ids.add(session.assignedCardId)
    })
    return ids
  }, [cards, currentVisitor, serviceSessions])
  const isUserMapScope = viewMode === 'user'
  const mapCards = useMemo(
    () => isUserMapScope ? cards.filter((card) => userVisibleMapCardIds.has(card.id)) : cards,
    [cards, isUserMapScope, userVisibleMapCardIds],
  )
  const mapBuildings = useMemo(
    () => isUserMapScope ? buildings.filter((building) => userVisibleMapCardIds.has(building.cardId)) : buildings,
    [buildings, isUserMapScope, userVisibleMapCardIds],
  )
  const mapCardBoundaries = useMemo(
    () => isUserMapScope ? cardBoundaries.filter((boundary) => userVisibleMapCardIds.has(boundary.cardId)) : cardBoundaries,
    [cardBoundaries, isUserMapScope, userVisibleMapCardIds],
  )
  const safeFocusedMapCardId =
    isUserMapScope && focusedMapCardId && !userVisibleMapCardIds.has(focusedMapCardId)
      ? null
      : focusedMapCardId
  const safeFocusedMapBuildingId =
    isUserMapScope && focusedMapBuildingId && !mapBuildings.some((building) => building.id === focusedMapBuildingId)
      ? null
      : focusedMapBuildingId

  const openCardOnMap = (cardId: number, editBoundary = false) => {
    if (editBoundary) setBoundaryEditRequest((request) => request + 1)
    if (viewMode === 'leader') {
      navigate(`/zone?view=map&cardId=${cardId}`)
    } else {
      navigate(`/map?cardId=${cardId}`)
    }
  }

  const openInformalOnMap = (assetId: number) => {
    if (viewMode === 'leader') navigate(`/zone?view=map&informalId=${assetId}`)
    else navigate(`/map?informalId=${assetId}`)
  }

  const openBuildingOnMap = (buildingId: number) => {
    const building = buildings.find((item) => item.id === buildingId)
    if (!building) return
    if (viewMode === 'leader') {
      navigate(`/zone?view=map&cardId=${building.cardId}&buildingId=${building.id}`)
    } else {
      navigate(`/map?cardId=${building.cardId}&buildingId=${building.id}`)
    }
  }

  const startServiceSessionAndOpenMap = async (input: {
    role: Role
    timeSlot: TimeSlot
    primaryCardId?: number | null
    calendarEventId?: number | null
    assignedCardId?: number | null
    assignmentId?: number | null
    source?: ServiceSession['source']
    memo?: string
  }) => {
    const id = await onStartServiceSession(input)
    if (id && input.primaryCardId) {
      if (viewMode === 'leader') {
        navigate(`/zone?view=map&cardId=${input.primaryCardId}`)
      } else {
        navigate(`/map?cardId=${input.primaryCardId}`)
      }
    }
    return id
  }

  return (
    <main className="desktop-shell">
      <aside className="desktop-sidebar">
        {/* Brand */}
        <div className="nav-brand" style={{ paddingLeft: 8 }}>
          <div className="nav-mark" aria-hidden="true">
            <img src="/icons/icon-192.png" alt="" />
          </div>
          <div className="nav-brand-text">
            <strong style={{ fontSize: 18 }}>Field Map</strong>
            <span style={{ letterSpacing: '0.2em', fontSize: '10px' }}>YONGIN</span>
          </div>
        </div>

        {/* Navigation */}
        <nav className="desktop-sidebar-nav" aria-label="관리 메뉴">
          {visibleDesktopPages.map((item) => {
            let icon = null;
            if (item === '홈') icon = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline></svg>;
            else if (item === '공지') icon = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path><path d="M13.73 21a2 2 0 0 1-3.46 0"></path></svg>;
            else if (item === '캘린더') icon = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>;
            else if (item === '구역') icon = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"></polygon><line x1="8" y1="2" x2="8" y2="18"></line><line x1="16" y1="6" x2="16" y2="22"></line></svg>;
            else if (item === '지도') icon = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg>;
            else if (item === '활동') icon = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>;
            else if (item === '배정') icon = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>;
            else if (item === '통계') icon = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><line x1="18" y1="20" x2="18" y2="10"></line><line x1="12" y1="20" x2="12" y2="4"></line><line x1="6" y1="20" x2="6" y2="14"></line></svg>;
            else if (item === '설정') icon = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>;

            const tabLabel: Record<string, string> = { '활동': '나의 봉사' }
            return (
              <button
                className={item === activePage ? 'active' : ''}
                key={item}
                onClick={() => navigate(pageToPath[item])}
                type="button"
              >
                {icon}
                {tabLabel[item] ?? item}
              </button>
            )
          })}
        </nav>
        {/* User Info & Actions (Bottom of sidebar) */}
        <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 8px' }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--gray-500)' }}>알림 및 메시지</span>
            <AppHeaderActionButtons
              userId={currentUserId}
              userName={currentVisitor}
              role={viewMode}
              chatUsers={allUsers.map((user) => ({ id: user.id, name: user.name, role: user.role as Role }))}
              onOpenMenu={() => navigate('/settings')}
              className="desktop-header-actions"
              buttonClassName="desktop-header-action"
            />
          </div>
          
          <div className="nav-user" ref={roleDropdownRef} style={{ justifyContent: 'flex-start', padding: '12px 16px', background: 'var(--bg-wash)', borderRadius: 12 }}>
            <div className={`nav-avatar${actualRole === 'admin' ? ' nav-avatar--admin' : ''}`}>
              {currentVisitor.slice(0, 1) || '사'}
            </div>
            <div className="nav-user-info" style={{ alignItems: 'flex-start', flex: 1, minWidth: 0 }}>
              <strong className="nav-user-name">{currentVisitor}</strong>
              {actualRole === 'admin' ? (
                <div className="nav-role-dropdown-wrap" style={{ width: '100%' }}>
                  <button
                    className="nav-role-dropdown-btn"
                    onClick={() => setRoleDropdownOpen((o) => !o)}
                    type="button"
                    style={{ background: 'transparent', padding: 0, border: 'none', fontSize: 12, color: 'var(--gray-500)', marginTop: 2, display: 'flex', alignItems: 'center', gap: 4 }}
                  >
                    {viewMode === 'user' ? '봉사자' : roleLabels[viewMode]} 뷰
                    <span className="nav-role-chevron">{roleDropdownOpen ? '▴' : '▾'}</span>
                  </button>
                  {roleDropdownOpen && (
                    <div className="nav-role-dropdown-menu" style={{ bottom: '100%', top: 'auto', left: 0, right: 'auto', marginBottom: 8, width: '200px' }}>
                      {(['admin', 'leader', 'user'] as Role[]).map((role) => (
                        <button
                          className={viewMode === role ? 'active' : ''}
                          key={role}
                          onClick={() => handleViewModeChange(role)}
                          type="button"
                        >
                          {role === 'user' ? '봉사자' : roleLabels[role]}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <span className="nav-user-role" style={{ marginTop: 2 }}>{roleLabels[actualRole]}</span>
              )}
            </div>
          </div>
        </div>
      </aside>

      <div className="desktop-main">
        <Routes>
        <Route path="/" element={
          <DesktopHome
            language={language}
            calendarEvents={calendarEvents}
            cards={cards}
            currentVisitor={currentVisitor}
            role={viewMode}
            serviceSessions={serviceSessions}
            returnVisits={returnVisits}
            returnVisitLogs={returnVisitLogs}
            onApplyToEvent={onApplyToEvent}
            onStartServiceSession={(input) => startServiceSessionAndOpenMap({ ...input, role: viewMode })}
            globalSettings={globalSettings}
            onEndServiceSession={onEndServiceSession}
            onOpenTerritory={() => navigate('/territory')}
            specialPeriods={specialPeriods}
            onOpenSettings={() => navigate('/settings')}
          />
        } />
        <Route path="/calendar" element={
          <DesktopCalendar
            buildings={buildings}
            cardBoundaries={cardBoundaries}
            visitHistories={visitHistories}
            informalAssets={informalAssets}
            informalGroups={informalGroups}
            eventInformalAssignments={eventInformalAssignments}
            eventRestaurantAssignments={eventRestaurantAssignments}
            currentVisitor={currentVisitor}
            currentUserId={currentUserId}
            leaderNames={leaderNames}
            events={calendarEvents}
            role={viewMode}
            actualRole={actualRole}
            participantUsers={allUsers}
            mentionUsers={allUsers.map((user) => ({ id: user.id, name: user.name, role: user.role }))}
            onApplyToEvent={onApplyToEvent}
            onAssignCardToEventParticipant={onAssignCardToEventParticipant}
            onAssignCardsToEventParticipantsBulk={onAssignCardsToEventParticipantsBulk}
            onAssignInformalToUser={onAssignInformalToUser}
            onRemoveInformalAssignment={onRemoveInformalAssignment}
            onAssignRestaurantToUser={onAssignRestaurantToUser}
            onRemoveRestaurantAssignment={onRemoveRestaurantAssignment}
            cards={cards}
            onCreateEvent={onCreateCalendarEvent}
            onCreateRepeatEvents={onCreateRepeatCalendarEvents}
            onUpdateEvent={onUpdateCalendarEvent}
            onUpdateEventSeries={onUpdateCalendarEventSeries}
            onDeleteEvent={onDeleteCalendarEvent}
            onDeleteEventSeries={onDeleteCalendarEventSeries}
            onLinkEventsToSeries={onLinkEventsToSeries}
            onCreateSpecialPeriod={onCreateSpecialPeriod}
            onDeleteSpecialPeriod={onDeleteSpecialPeriod}
            specialPeriods={specialPeriods}
            onRemoveParticipant={onRemoveParticipantFromEvent}
            onAddParticipant={onAddParticipantToEvent}
            globalSettings={globalSettings}
            onUpsertGlobalSetting={onUpsertGlobalSetting}
          />
        } />
        {/* /territory → 나의봉사 (개인 봉사 현황) */}
        <Route path="/territory" element={
          viewMode === 'admin' ? (
            <DesktopTerritory
              language={language}
              buildings={buildings}
              cardBoundaries={cardBoundaries}
              cards={cards}
              role={viewMode}
              onSetCardLeaders={onSetCardLeaders}
              onSetMultipleCardLeaders={onSetMultipleCardLeaders}
              onCreateCard={onCreateCard}
              onCreateTerritoryRegion={onCreateTerritoryRegion}
              onImportBuildings={onImportBuildings}
              onDeleteBuildings={onDeleteBuildings}
              onDeleteCards={onDeleteCards}
              onMergeDuplicateBuildings={onMergeDuplicateBuildings}
              onAddUnit={onAddUnit}
              onSetUnitsSurveyed={onSetUnitsSurveyed}
              onDeleteUnit={onDeleteUnit}
              onMoveBuildingToCard={onMoveBuildingToCard}
              onReassignBuildingsToCards={onReassignBuildingsToCards}
              onUpdateBuilding={onUpdateBuilding}
              onToggleChinese={onToggleChinese}
              onToggleRegularVisit={onToggleRegularVisit}
              onSetRegularVisitor={onSetRegularVisitor}
              onUpdateUnitFlags={onUpdateUnitFlags}
              onUpdateUnitStatus={onUpdateUnitStatus}
              onAddVisitHistory={onAddVisitHistory}
              onUpdateVisitHistory={onUpdateVisitHistory}
              onDeleteVisitHistory={onDeleteVisitHistory}
              onRestoreCardBoundaries={onRestoreCardBoundaries}
              onMergeCardBoundaries={onMergeCardBoundaries}
              onUndoMergeCardBoundaries={onUndoMergeCardBoundaries}
              onOpenCardMap={openCardOnMap}
              onOpenBuildingMap={openBuildingOnMap}
              visitHistories={visitHistories}
              onCreateBuilding={onCreateBuilding}
              currentVisitor={currentVisitor}
              informalAssets={informalAssets}
              informalGroups={informalGroups}
              onUploadInformalAsset={onUploadInformalAsset}
              onDeleteInformalAsset={onDeleteInformalAsset}
              onDeleteInformalAssets={onDeleteInformalAssets}
              onCreateInformalGroup={onCreateInformalGroup}
              onRenameInformalGroup={onRenameInformalGroup}
              onDeleteInformalGroup={onDeleteInformalGroup}
              onMoveAssetToGroup={onMoveAssetToGroup}
              onMoveAssetsToGroup={onMoveAssetsToGroup}
              onToggleBuildingRestaurant={onToggleBuildingRestaurant}
              onRemoveRestaurantUnit={onRemoveRestaurantUnit}
              onBulkSetRestaurant={onBulkSetRestaurant}
              restaurantRequests={restaurantRequests}
              onRegisterRestaurant={onRegisterRestaurant}
              onApproveRestaurantRequest={onApproveRestaurantRequest}
              onRejectRestaurantRequest={onRejectRestaurantRequest}
            />
          ) : (
            <DesktopMyService
              language={language}
              buildings={buildings}
              calendarEvents={calendarEvents}
              cards={cards}
              currentVisitor={currentVisitor}
              role={viewMode}
              serviceSessions={serviceSessions}
              informalAssets={informalAssets}
              eventInformalAssignments={eventInformalAssignments}
              eventRestaurantAssignments={eventRestaurantAssignments}
              returnVisits={returnVisits}
              returnVisitLogs={returnVisitLogs}
              onOpenMap={openCardOnMap}
              onOpenInformalMap={openInformalOnMap}
              onOpenBuildingMap={openBuildingOnMap}
              onEndServiceSession={onEndServiceSession}
              onAddReturnVisitLog={onAddReturnVisitLog}
            />
          )
        } />

        {/* /zone → 구역 관리 (인도자·관리자용, 목록↔지도 토글) */}
        <Route path="/zone" element={
          <div style={{ position: 'relative' }}>
            {showZoneMapView ? (
              <DesktopMap language={language}
                buildings={buildings}
                informalAssets={informalAssets}
                focusedInformalId={focusedInformalId}
                onCreateInformalPlace={onCreateInformalPlace}
                onUpdateInformalPlace={onUpdateInformalPlace}
                onSaveInformalShape={onSaveInformalShape}
                boundaryEditRequest={boundaryEditRequest}
                cardBoundaries={cardBoundaries}
                cards={cards}
                currentVisitor={currentVisitor}
                actualRole={viewMode}
                serviceSessions={serviceSessions}
                focusedCardId={focusedMapCardId}
                focusedBuildingId={focusedMapBuildingId}
                onAddUnit={onAddUnit}
                onCreateBuilding={onCreateBuilding}
                onDeleteBuilding={onDeleteBuilding}
                onUpdateBuilding={onUpdateBuilding}
                onDeleteCardBoundary={onDeleteCardBoundary}
                onDeleteUnit={onDeleteUnit}
                onSaveCardBoundary={onSaveCardBoundary}
                onMergeCardBoundaries={onMergeCardBoundaries}
                onUndoMergeCardBoundaries={onUndoMergeCardBoundaries}
                onToggleRegularVisit={onToggleRegularVisit}
                onToggleChinese={onToggleChinese}
                onUndoLatestVisit={onUndoLatestVisit}
                onAddVisitHistory={onAddVisitHistory}
                onUpdateVisitHistory={onUpdateVisitHistory}
                onDeleteVisitHistory={onDeleteVisitHistory}
                onUpdateUnitStatus={onUpdateUnitStatus}
                onQuickLogVisit={onQuickLogVisit}
                onToggleInvitationLeft={onToggleInvitationLeft}
                onUpdateUnitFlags={onUpdateUnitFlags}
                visitHistories={visitHistories}
                onSwitchToList={() => navigate('/zone')}
              />
            ) : (
              <DesktopTerritory
                language={language}
                buildings={buildings}
                cardBoundaries={cardBoundaries}
                cards={cards}
                role={viewMode}
                onSetCardLeaders={onSetCardLeaders}
                onSetMultipleCardLeaders={onSetMultipleCardLeaders}
                onCreateCard={onCreateCard}
                onCreateTerritoryRegion={onCreateTerritoryRegion}
                onCreateInformalPlace={onCreateInformalPlace}
                onUpdateInformalPlace={onUpdateInformalPlace}
                onOpenInformalOnMap={openInformalOnMap}
                onImportBuildings={onImportBuildings}
                onDeleteBuildings={onDeleteBuildings}
                onDeleteCards={onDeleteCards}
                onMergeDuplicateBuildings={onMergeDuplicateBuildings}
                onAddUnit={onAddUnit}
                onSetUnitsSurveyed={onSetUnitsSurveyed}
                onDeleteUnit={onDeleteUnit}
                onMoveBuildingToCard={onMoveBuildingToCard}
                onReassignBuildingsToCards={onReassignBuildingsToCards}
                onUpdateBuilding={onUpdateBuilding}
                onToggleChinese={onToggleChinese}
                onToggleRegularVisit={onToggleRegularVisit}
                onSetRegularVisitor={onSetRegularVisitor}
                onUpdateUnitFlags={onUpdateUnitFlags}
                onUpdateUnitStatus={onUpdateUnitStatus}
                onAddVisitHistory={onAddVisitHistory}
                onUpdateVisitHistory={onUpdateVisitHistory}
                onDeleteVisitHistory={onDeleteVisitHistory}
                onRestoreCardBoundaries={onRestoreCardBoundaries}
                onMergeCardBoundaries={onMergeCardBoundaries}
                onOpenCardMap={openCardOnMap}
                onOpenBuildingMap={openBuildingOnMap}
                visitHistories={visitHistories}
                onCreateBuilding={onCreateBuilding}
                onSwitchToMap={() => navigate('/zone?view=map')}
                currentVisitor={currentVisitor}
                informalAssets={informalAssets}
                informalGroups={informalGroups}
                onUploadInformalAsset={onUploadInformalAsset}
                onDeleteInformalAsset={onDeleteInformalAsset}
                onDeleteInformalAssets={onDeleteInformalAssets}
                onCreateInformalGroup={onCreateInformalGroup}
                onRenameInformalGroup={onRenameInformalGroup}
                onDeleteInformalGroup={onDeleteInformalGroup}
                onMoveAssetToGroup={onMoveAssetToGroup}
                onMoveAssetsToGroup={onMoveAssetsToGroup}
                onToggleBuildingRestaurant={onToggleBuildingRestaurant}
                onRemoveRestaurantUnit={onRemoveRestaurantUnit}
                onBulkSetRestaurant={onBulkSetRestaurant}
                restaurantRequests={restaurantRequests}
                onRegisterRestaurant={onRegisterRestaurant}
                onApproveRestaurantRequest={onApproveRestaurantRequest}
                onRejectRestaurantRequest={onRejectRestaurantRequest}
              />
            )}
          </div>
        } />
        <Route path="/map" element={
          <DesktopMap language={language}
            buildings={mapBuildings}
            informalAssets={informalAssets}
            focusedInformalId={focusedInformalId}
            onCreateInformalPlace={onCreateInformalPlace}
            onUpdateInformalPlace={onUpdateInformalPlace}
            onSaveInformalShape={onSaveInformalShape}
            boundaryEditRequest={boundaryEditRequest}
            cardBoundaries={mapCardBoundaries}
            cards={mapCards}
            currentVisitor={currentVisitor}
            actualRole={viewMode}
            serviceSessions={serviceSessions}
            focusedCardId={safeFocusedMapCardId}
            focusedBuildingId={safeFocusedMapBuildingId}
            onAddUnit={onAddUnit}
            onCreateBuilding={onCreateBuilding}
            onDeleteBuilding={onDeleteBuilding}
            onUpdateBuilding={onUpdateBuilding}
            onDeleteCardBoundary={onDeleteCardBoundary}
            onDeleteUnit={onDeleteUnit}
            onSaveCardBoundary={onSaveCardBoundary}
            onMergeCardBoundaries={onMergeCardBoundaries}
            onUndoMergeCardBoundaries={onUndoMergeCardBoundaries}
            onToggleRegularVisit={onToggleRegularVisit}
            onToggleChinese={onToggleChinese}
            onUndoLatestVisit={onUndoLatestVisit}
            onAddVisitHistory={onAddVisitHistory}
            onUpdateVisitHistory={onUpdateVisitHistory}
            onDeleteVisitHistory={onDeleteVisitHistory}
            onUpdateUnitStatus={onUpdateUnitStatus}
            onQuickLogVisit={onQuickLogVisit}
            onToggleInvitationLeft={onToggleInvitationLeft}
            onUpdateUnitFlags={onUpdateUnitFlags}
            visitHistories={visitHistories}
            specialPeriods={specialPeriods}
          />
        } />
        <Route path="/assignment" element={
          viewMode === 'admin' ? (
            <DesktopAdminAssignment
              cards={cards}
              currentVisitor={currentVisitor}
              leaderNames={leaderNames}
              onSetCardLeaders={onSetCardLeaders}
            />
          ) : <Navigate to="/calendar" replace />
        } />
        <Route path="/stats" element={
          <DesktopStats
            cards={cards}
            buildings={buildings}
            visitHistories={visitHistories}
            serviceSessions={serviceSessions}
            specialPeriods={specialPeriods}
            actualRole={actualRole}
          />
        } />
        <Route path="/settings" element={
          <DesktopSettings
            currentUserId={currentUserId}
            actualRole={viewMode}
            onLogout={onLogout}
            allUsers={allUsers}
            returnVisits={returnVisits ?? []}
          />
        }>
          <Route index element={<Navigate to="profile" replace />} />
          <Route path="profile" element={
            <DesktopProfileSettings
              user={currentUser}
              language={language}
              onChangePin={onChangePin}
              onUpdateProfile={onUpdateMyProfile}
              onFetchLoginLogs={onFetchMyLoginLogs}
            />
          } />
          
          <Route path="suggestions" element={
            (viewMode === 'admin' || viewMode === 'developer')
              ? <AdminSuggestions language={language} />
              : <Navigate to="/settings/profile" replace />
          } />
          <Route path="notification" element={
            <DesktopNotificationSettings userId={currentUserId} role={actualRole} />
          } />
          <Route path="location-permission" element={
            <div className="desk-settings-subpage" style={{ maxWidth: 640 }}>
              <h2 style={{ fontSize: 22, fontWeight: 800, color: 'var(--gray-900)', marginBottom: 24 }}>위치 권한</h2>
              <div className="desktop-profile-stack" style={{ display: 'grid', gap: 24 }}>
                <article className="desk-card ds-card">
                  <LocationPermissionSettings language={language} />
                </article>
              </div>
            </div>
          } />
          <Route path="data-management" element={
            (viewMode === 'admin' || viewMode === 'developer')
              ? <DesktopDataManagement />
              : <Navigate to="/settings/profile" replace />
          } />
          <Route path="place-change-requests" element={
            (viewMode === 'admin' || viewMode === 'developer')
              ? <PlaceChangeRequests onPlaceDeleted={onPlaceDeleted} />
              : <Navigate to="/settings/profile" replace />
          } />
          <Route path="territory-regions" element={
            (viewMode === 'admin' || viewMode === 'developer')
              ? <DesktopTerritoryRegions
                  cardCounts={regionCardCounts}
                  onDeleteRegion={async (id, name) => (await onDeleteTerritoryRegion?.(id, name)) ?? false}
                  onMoveRegion={async (id, dir) => (await onMoveTerritoryRegion?.(id, dir)) ?? false}
                  onUpdateRegion={async (id, input) => (await onUpdateTerritoryRegion?.(id, input)) ?? false}
                />
              : <Navigate to="/settings/profile" replace />
          } />
          <Route path="special-periods" element={
            (viewMode === 'admin' || viewMode === 'developer')
              ? <DesktopSpecialPeriods
                  specialPeriods={specialPeriods}
                  onCreateSpecialPeriod={async (input) => onCreateSpecialPeriod(input)}
                  onUpdateSpecialPeriod={async (id, input) => onUpdateSpecialPeriod(id, input)}
                  onDeleteSpecialPeriod={async (id) => onDeleteSpecialPeriod(id)}
                />
              : <Navigate to="/settings/profile" replace />
          } />
          <Route path="users" element={
            (viewMode === 'admin' || viewMode === 'developer')
              ? <section className="la-page" style={{ alignItems: 'center' }}><div style={{ maxWidth: 640, width: '100%', position: 'relative', padding: '24px 0' }}><MobileUsers isEmbedded /></div></section>
              : <Navigate to="/settings/profile" replace />
          } />
          <Route path="signup-requests" element={
            (viewMode === 'admin' || viewMode === 'developer')
              ? <section className="la-page" style={{ alignItems: 'center' }}><div style={{ maxWidth: 640, width: '100%', position: 'relative', padding: '24px 0' }}><MobileSignupRequests isEmbedded /></div></section>
              : <Navigate to="/settings/profile" replace />
          } />
          <Route path="notices" element={
            <section className="la-page" style={{ alignItems: 'center' }}>
              <div style={{ maxWidth: 640, width: '100%', position: 'relative', padding: '24px 0' }}>
                <MobileNotices
                  notices={notices}
                  language={language}
                  currentVisitor={currentVisitor}
                  currentUserId={currentUserId}
                  role={actualRole}
                  mentionUsers={allUsers.map((user) => ({ id: user.id, name: user.name, role: user.role }))}
                  onCreateNotice={onCreateNotice}
                  onDeleteNotice={onDeleteNotice}
                />
              </div>
            </section>
          } />
          <Route path="service-logs" element={
            actualRole === 'developer'
              ? <section className="la-page" style={{ alignItems: 'center' }}><div style={{ maxWidth: 1100, width: '100%', position: 'relative', padding: '24px' }}><ServiceLogPage cards={cards} calendarEvents={calendarEvents} role={actualRole} isEmbedded visitHistories={visitHistories} buildings={buildings} /></div></section>
              : <Navigate to="/settings/profile" replace />
          } />
          <Route path="regular-visits" element={
            (viewMode === 'admin' || viewMode === 'developer')
              ? <section className="la-page" style={{ alignItems: 'center' }}><div style={{ maxWidth: 640, width: '100%', position: 'relative', padding: '24px 0' }}>
                  <h2 style={{ fontSize: 22, fontWeight: 800, color: 'var(--gray-900)', marginBottom: 20 }}>정기방문 관리</h2>
                  <RegularVisitManagement
                    returnVisits={returnVisits ?? []}
                    activeUsers={allUsers}
                    isDeveloper={actualRole === 'developer'}
                    language={language}
                    onReassign={(id, name) => onReassignReturnVisit?.(id, name) ?? false}
                  />
                </div></section>
              : <Navigate to="/settings/profile" replace />
          } />
        </Route>
        <Route path="/signup-requests" element={<Navigate to="/settings/signup-requests" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      </div>
    </main>
  )
}
