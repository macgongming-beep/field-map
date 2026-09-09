import { useMemo, useState } from 'react'
import { FontScalePicker } from './FontScalePicker'
import { Routes, Route, Navigate, useNavigate, useLocation, useSearchParams } from 'react-router-dom'
import { MobileAdminAssignment } from './MobileAdminAssignment'
import { MobileMap } from './MobileMap'
import { MobileNotices } from './MobileNotices'
import { MobileTerritory } from './MobileTerritory'
import { MobileRegularVisitDetail } from './MobileRegularVisitDetail'
import { AdminMobileHome } from './admin/AdminMobileHome'
import { AdminMobileCalendar } from './admin/AdminMobileCalendar'
import { AdminMobileZone } from './admin/AdminMobileZone'
import { MobileUsers } from './MobileUsers'
import { MobileSignupRequests } from './MobileSignupRequests'
import { AdminSuggestions } from './admin/AdminSuggestions'
import { ServiceLogPage } from './ServiceLogPage'
import { RegularVisitManagement } from './RegularVisitManagement'
import { PlaceChangeRequests } from './PlaceChangeRequests'
import { PrivacyPolicy } from './PrivacyPolicy'
import { MobileProfileSettings } from './MobileProfileSettings'
import { UserMobileHome } from './UserMobileHome'
import type { Building, CalendarEvent, CardBoundary, EndReturnVisitInput, EventInformalAssignment, EventRestaurantAssignment, InformalAsset, InformalGroup, InformalKind, Notice, ReturnVisit, ReturnVisitLog, Role, ServiceSession, SpecialPeriod, TerritoryCard, TimeSlot, Unit, UnitStatus, VisitHistory } from '../types'
// InformalCardsTab / RestaurantsTab 은 AdminMobileZone 내부에서 사용됨 (직접 import 불필요)
import type { AuthUser, LoginLogRecord } from '../hooks/useAuth'
import type { AppLanguage } from '../i18n'
import { languageLabels, t } from '../i18n'
import { SpecialPeriodBanner } from './SpecialPeriodBanner'
import { SpecialPeriodSettings } from './SpecialPeriodSettings'
import { PwaInstallSection } from './PwaInstall'
import { NotificationSettings } from './NotificationSettings'
import { LocationPermissionSettings } from './LocationPermissionSettings'
import { AppUpdateCard } from './AppUpdateCard'
import { AppHeader } from './AppHeader'
import { formatRelativeVisitDate, getLatestReturnVisitDate, getUserReturnVisits, normalizeVisitorName } from '../utils/returnVisits'
import { msg } from '../lib/msg'
import { useAdminAttentionCounts } from '../hooks/useAdminAttentionCounts'

type MobileTab = '홈' | '캘린더' | '활동' | '구역' | '지도' | '배정' | '설정'

const tabToPath: Record<MobileTab, string> = {
  '홈': '/',
  '캘린더': '/calendar',
  '활동': '/territory',
  '구역': '/zone',
  '지도': '/map',
  '배정': '/assignment',
  '설정': '/settings',
}

const pathToTab: Record<string, MobileTab> = {
  '/': '홈',
  '/notices': '설정',
  '/profile': '설정',
  '/special-periods': '설정',
  '/signup-requests': '설정',
  '/calendar': '캘린더',
  '/territory': '활동',
  '/zone': '구역',
  '/map': '지도',
  '/assignment': '배정',
  '/users': '설정',
  '/settings': '설정',
  '/place-change-requests': '설정',
}

type IconName = 'home' | 'calendar' | 'territory' | 'map' | 'assignment' | 'settings' | 'notice'

const navIcons: Record<MobileTab, IconName> = {
  '홈': 'home',
  '캘린더': 'calendar',
  '활동': 'territory',
  '구역': 'territory',
  '지도': 'map',
  '배정': 'assignment',
  '설정': 'settings',
}

const homeWeekdayLabels: Record<AppLanguage, string[]> = {
  ko: ['일요일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일'],
  zh: ['周日', '周一', '周二', '周三', '周四', '周五', '周六'],
  en: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
}

function formatHomeDate(date: Date, language: AppLanguage) {
  if (language === 'en') {
    return new Intl.DateTimeFormat('en', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' }).format(date)
  }
  if (language === 'zh') {
    return `${date.getFullYear()}年 ${date.getMonth() + 1}月 ${date.getDate()}日 ${homeWeekdayLabels.zh[date.getDay()]}`
  }
  return `${date.getFullYear()}년 ${date.getMonth() + 1}월 ${date.getDate()}일 ${homeWeekdayLabels.ko[date.getDay()]}`
}


function NavIcon({ name }: { name: IconName }) {
  if (name === 'home') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 11.5 12 5l8 6.5" />
        <path d="M6.5 10.5V20h11V10.5" />
        <path d="M10 20v-5h4v5" />
      </svg>
    )
  }
  if (name === 'calendar') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M7 4v3M17 4v3M5 9h14" />
        <rect x="5" y="6" width="14" height="14" rx="2" />
      </svg>
    )
  }
  if (name === 'territory') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="m4 7 5-2 6 2 5-2v12l-5 2-6-2-5 2Z" />
        <path d="M9 5v12M15 7v12" />
      </svg>
    )
  }
  if (name === 'map') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 21s6-5.4 6-11a6 6 0 0 0-12 0c0 5.6 6 11 6 11Z" />
        <circle cx="12" cy="10" r="2.2" />
      </svg>
    )
  }
  if (name === 'settings') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="3" />
        <path d="M19 12a7.5 7.5 0 0 0-.1-1.2l2-1.5-2-3.4-2.4 1a7.4 7.4 0 0 0-2.1-1.2L14 3h-4l-.4 2.7a7.4 7.4 0 0 0-2.1 1.2l-2.4-1-2 3.4 2 1.5A7.5 7.5 0 0 0 5 12c0 .4 0 .8.1 1.2l-2 1.5 2 3.4 2.4-1a7.4 7.4 0 0 0 2.1 1.2L10 21h4l.4-2.7a7.4 7.4 0 0 0 2.1-1.2l2.4 1 2-3.4-2-1.5c.1-.4.1-.8.1-1.2Z" />
      </svg>
    )
  }
  if (name === 'assignment') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 7h16M4 12h10M4 17h7" />
        <path d="m17 11 3 3-3 3" />
      </svg>
    )
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 4v10" />
      <path d="M12 18h.01" />
    </svg>
  )
}

function SettingsIcon({ name }: { name: 'notice' | 'users' | 'signup' | 'season' | 'notification' | 'location' | 'logout' }) {
  if (name === 'users') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z" />
        <path d="M3 21v-1a6 6 0 0 1 12 0v1" />
        <path d="M17 10a3 3 0 1 0 0-6" />
        <path d="M17 14a5 5 0 0 1 4 5v1" />
      </svg>
    )
  }
  if (name === 'season') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="m12 3 2.7 5.5 6.1.9-4.4 4.3 1 6.1L12 16.9l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9Z" />
      </svg>
    )
  }
  if (name === 'signup') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z" />
        <path d="M3 21v-1a6 6 0 0 1 12 0v1" />
        <path d="m17 9 2 2 4-4" />
        <path d="M18 15v5" />
      </svg>
    )
  }
  if (name === 'logout') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M10 6H6v12h4" />
        <path d="M13 8l4 4-4 4" />
        <path d="M17 12H9" />
      </svg>
    )
  }
  if (name === 'notification') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M18 9a6 6 0 1 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" />
        <path d="M10 21a2 2 0 0 0 4 0" />
      </svg>
    )
  }
  if (name === 'location') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 21s7-4.6 7-11a7 7 0 1 0-14 0c0 6.4 7 11 7 11Z" />
        <circle cx="12" cy="10" r="2.4" />
      </svg>
    )
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 10v4" />
      <path d="M9 8v8" />
      <path d="M13 6v12" />
      <path d="M17 9v6" />
      <path d="M20 6v12" />
    </svg>
  )
}


// 구역 관련 헬퍼/상수는 디자인 v2 통합 후 AdminMobileZone 내부로 이동.

export function MobileHome({
  leaderNames = [],
  buildings,
  calendarEvents,
  cardBoundaries,
  cards,
  currentVisitor,
  currentUser,
  language,
  translatePlaceNames = false,
  onChangeTranslatePlaceNames,
  actualRole,
  viewMode,
  notices,
  serviceSessions,
  onChangeViewMode,
  onChangeLanguage,
  onSetCardLeaders,
  onAddUnit,
  onSetBuildingAccess,
  allUsers = [],
  onChangePin,
  onUpdateMyProfile,
  onFetchMyLoginLogs,
  onApplyToEvent,
  onAddParticipantToEvent: _onAddParticipantToEvent,
  onRemoveParticipantFromEvent: _onRemoveParticipantFromEvent,
  onToggleUser: _onToggleUser,
  onEndServiceSession,
  onAssignCardToEventParticipant: _onAssignCardToEventParticipant,
  onAssignCardsToEventParticipantsBulk,
  onCreateBuilding,
  onDeleteBuilding,
  onUpdateBuilding,
  onSetUnitsSurveyed,
  onDeleteUnit,
  onCreateCalendarEvent,
  onCreateRepeatCalendarEvents,
  onDeleteCalendarEvent,
  onDeleteCalendarEventSeries,
  onUpdateCalendarEvent,
  onUpdateCalendarEventSeries,
  onCreateNotice,
  onDeleteNotice,
  returnVisits = [],
  returnVisitLogs = [],
  onToggleRegularVisit,
  onCreateManualReturnVisit,
  onAddReturnVisitLog,
  onUpdateReturnVisitLog,
  onDeleteReturnVisitLog,
  onDeleteReturnVisit,
  onReassignReturnVisit,
  onUpdateReturnVisitNickname,
  onUpdateReturnVisitAddress,
  onToggleChinese,
  onUndoLatestVisit,
  onUpdateVisitHistory,
  onDeleteVisitHistory,
  onUpdateUnitStatus: _onUpdateUnitStatus,
  onQuickLogVisit,
  onUpdateUnitFlags,
  onRemoveRestaurantUnit,
  onToggleInvitationLeft,
  onLogout,
  visitHistories,
  specialPeriods,
  onCreateSpecialPeriod,
  onUpdateSpecialPeriod,
  onDeleteSpecialPeriod,
  // v2 신 배정 모델
  informalAssets = [],
  eventInformalAssignments = [],
  eventRestaurantAssignments = [],
  informalGroups = [],
  onUploadInformalAsset,
  onDeleteInformalAsset,
  onDeleteInformalAssets,
  onCreateInformalGroup,
  onCreateInformalPlace,
  onUpdateInformalPlace,
  onRenameInformalGroup,
  onDeleteInformalGroup,
  onMoveAssetToGroup,
  onMoveAssetsToGroup,
  onAssignInformalToUser,
  onRemoveInformalAssignment,
  onAssignRestaurantToUser,
  onRemoveRestaurantAssignment,
  onToggleBuildingRestaurant,
  onSetRegularVisitor,
  onAddRestaurantVisit,
  onSubmitRestaurantRequest,
  onUpdateRestaurantRequestMemo,
  restaurantRequests = [],
  onRegisterRestaurant,
  onApproveRestaurantRequest,
  onRejectRestaurantRequest,
  globalSettings = {},
  onUpsertGlobalSetting,
  onPlaceDeleted,
}: {
  leaderNames?: string[]
  buildings: Building[]
  calendarEvents: CalendarEvent[]
  cardBoundaries: CardBoundary[]
  cards: TerritoryCard[]
  currentVisitor: string
  currentUser: AuthUser
  language: AppLanguage
  translatePlaceNames?: boolean
  onChangeTranslatePlaceNames?: (v: boolean) => void
  actualRole: Role
  viewMode: Role
  notices: Notice[]
  serviceSessions: ServiceSession[]
  onChangeViewMode: (role: Role) => void
  onChangeLanguage: (language: AppLanguage) => void
  onSetCardLeaders: (cardId: number, leaderNames: string[], options?: { silentSuccess?: boolean }) => Promise<void> | void
  onAddUnit: (buildingId: number, unitNumber: string | string[], usageType?: Building['type']) => Promise<number[] | false>
  onSetBuildingAccess: (buildingId: number, blocked: boolean, note?: string) => Promise<boolean>
  allUsers?: Array<{ id: number; name: string; phone?: string | null; role: string; approvalStatus?: 'pending' | 'approved' | 'blocked'; isActive?: boolean; groupName?: string | null }>
  onChangePin: (newPin: string) => Promise<boolean>
  onUpdateMyProfile: (input: { name: string; phone?: string | null }) => Promise<boolean>
  onFetchMyLoginLogs: (limit?: number) => Promise<LoginLogRecord[]>
  onApplyToEvent: (eventId: number) => void
  onAddParticipantToEvent?: (eventId: number, userName: string, role?: '신청' | '게스트') => boolean | void | Promise<boolean | void>
  onRemoveParticipantFromEvent?: (eventId: number, userName: string) => void
  onToggleUser: (cardId: number, userName: string) => void
  onEndServiceSession: (sessionId: number) => void
  onAssignCardToEventParticipant: (eventId: number, userName: string, cardId: number | null) => void
  onAssignCardsToEventParticipantsBulk: (
    eventId: number,
    assignments: Array<{ userName: string; cardId?: number | null; cardIds?: number[] | null }>,
    options?: { silentSuccess?: boolean; status?: 'confirmed' | 'shared' },
  ) => Promise<void> | void
  onCreateBuilding: (input: { cardId: number; name: string; address: string; type: Building['type']; lat: number; lng: number }) => void
  onDeleteBuilding: (buildingId: number) => void
  onUpdateBuilding: (buildingId: number, name: string, address: string, lat?: number, lng?: number, type?: Building['type']) => Promise<boolean>
  /** 건물의 '세대를 다 파악함' 표시. 없으면 완료로 안 친다 (utils/buildingPin) */
  onSetUnitsSurveyed?: (buildingId: number, surveyed: boolean) => Promise<boolean> | void
  onDeleteUnit: (buildingId: number, unitId: number) => void
  onCreateCalendarEvent: (input: { date: string; time: string; title: string; place: string; mapLink?: string; leader: string; memo: string; hasMeeting: boolean; allowApplications: boolean }) => void
  onCreateRepeatCalendarEvents?: (dates: string[], input: { time: string; endTime?: string; title: string; place: string; mapLink?: string; leader: string; memo: string; hasMeeting: boolean; allowApplications: boolean }) => void
  onDeleteCalendarEvent: (id: number) => void
  onDeleteCalendarEventSeries?: (seriesId: string, fromDate: string) => void
  onUpdateCalendarEvent: (id: number, input: { time: string; title: string; place: string; mapLink?: string; leader: string; memo: string; hasMeeting: boolean; allowApplications: boolean }) => void
  onUpdateCalendarEventSeries?: (seriesId: string, fromDate: string, input: { time: string; endTime?: string; title: string; place: string; mapLink?: string; leader: string; memo: string; hasMeeting: boolean; allowApplications: boolean }) => void
  onCreateNotice: (input: { title: string; content: string; priority: Notice['priority']; author: string }) => void
  onDeleteNotice: (id: number) => void
  returnVisits?: ReturnVisit[]
  returnVisitLogs?: ReturnVisitLog[]
  onToggleRegularVisit: (buildingId: number, unitId: number, visitorName?: string) => void
  onCreateManualReturnVisit?: (input: import('../types').ManualReturnVisitInput) => Promise<boolean>
  onAddReturnVisitLog?: (returnVisitId: number, result: '만남' | '부재' | null, memo: string) => Promise<void>
  onUpdateReturnVisitLog?: (id: number, result: '만남' | '부재' | null, memo: string) => Promise<void>
  onDeleteReturnVisitLog?: (id: number) => Promise<void>
  onDeleteReturnVisit?: (id: number, input: EndReturnVisitInput) => Promise<boolean>
  onReassignReturnVisit?: (id: number, newAssignee: string) => Promise<boolean> | boolean
  onUpdateReturnVisitNickname?: (id: number, nickname: string) => Promise<void>
  onUpdateReturnVisitAddress?: (id: number, address: string) => Promise<void>
  onToggleChinese: (buildingId: number, unitId: number) => void
  onUndoLatestVisit: (buildingId: number, unitId: number) => void
  onUpdateVisitHistory: (historyId: number, unitId: number, input: { result: UnitStatus; timeSlot: TimeSlot; memo: string; visitedAt: string }) => void
  onDeleteVisitHistory: (historyId: number, unitId: number) => void
  onUpdateUnitStatus: (buildingId: number, unitId: number, status: UnitStatus, memo?: string) => void
  onQuickLogVisit: (buildingId: number, unitId: number, result: UnitStatus) => void
  onUpdateUnitFlags: (unitId: number, flags: Partial<Unit>) => void
  /** 식당 탭: 세대 단위 식당 해제 */
  onRemoveRestaurantUnit?: (unitId: number, buildingId: number) => Promise<void>
  onToggleInvitationLeft?: (buildingId: number, unitId: number) => void
  onLogout: () => void
  visitHistories: VisitHistory[]
  specialPeriods?: SpecialPeriod[]
  onCreateSpecialPeriod?: (input: { label: string; startDate: string; endDate: string; color: string }) => Promise<void> | void
  onUpdateSpecialPeriod?: (id: number, input: { label: string; startDate: string; endDate: string; color: string }) => Promise<void> | void
  onDeleteSpecialPeriod?: (id: number) => Promise<void> | void
  // v2 신 배정 모델
  informalAssets?: InformalAsset[]
  eventInformalAssignments?: EventInformalAssignment[]
  eventRestaurantAssignments?: EventRestaurantAssignment[]
  informalGroups?: InformalGroup[]
  onUploadInformalAsset?: (input: { file: File; name: string; uploadedBy: string; groupId?: number | null }) => Promise<{ ok: boolean; assetId?: number; error?: string }>
  onDeleteInformalAsset?: (assetId: number) => Promise<boolean>
  onDeleteInformalAssets?: (assetIds: number[]) => Promise<{ failed: number[] }>
  onCreateInformalGroup?: (input: { name: string; createdBy: string }) => Promise<number | null>
  /** 사진 없이 지도 핀으로 장소 만들기 (docs/비공식-봉사-재설계.md) */
  onCreateInformalPlace?: (input: {
    name: string
    createdBy: string
    groupId?: number | null
    lat: number
    lng: number
    memo?: string
    zoom?: number | null
    kind?: InformalKind
    parentId?: number | null
  }) => Promise<boolean>
  onRenameInformalGroup?: (groupId: number, name: string) => Promise<boolean>
  /** 만든 뒤에 종류·이름을 고친다 */
  onUpdateInformalPlace?: (
    assetId: number,
    input: { name?: string; memo?: string; lat?: number; lng?: number; zoom?: number | null; kind?: InformalKind },
  ) => Promise<boolean>
  onDeleteInformalGroup?: (groupId: number) => Promise<boolean>
  onMoveAssetToGroup?: (assetId: number, groupId: number | null) => Promise<boolean>
  onMoveAssetsToGroup?: (assetIds: number[], groupId: number | null) => Promise<{ failed: number[] }>
  onAssignInformalToUser?: (input: { eventId: number; userName: string; assetId: number; assignedBy: string }) => Promise<boolean>
  onRemoveInformalAssignment?: (assignmentId: number) => Promise<void>
  onAssignRestaurantToUser?: (input: { eventId: number; userName: string; buildingId: number; unitId?: number | null; assignedBy: string }) => Promise<boolean>
  onRemoveRestaurantAssignment?: (assignmentId: number) => Promise<void>
  onToggleBuildingRestaurant?: (buildingId: number, isRestaurant: boolean) => Promise<void>
  onSetRegularVisitor?: (unitId: number, visitorName: string, registeredAt?: string) => Promise<void>
  onAddRestaurantVisit?: (unitId: number, memo: string) => Promise<void>
  onSubmitRestaurantRequest?: import('../types/restaurantRegistration').SubmitRestaurantRequest
  onUpdateRestaurantRequestMemo?: (requestId: number, memo: string) => Promise<void>
  restaurantRequests?: import('../types').RestaurantRequest[]
  onRegisterRestaurant?: import('../types/restaurantRegistration').RegisterRestaurant
  onApproveRestaurantRequest?: (id: number, opts: { name: string; address: string; reviewer: string; existingBuildingId?: number | null; lat?: number; lng?: number }) => Promise<void>
  onRejectRestaurantRequest?: (id: number, reviewer: string) => Promise<void>
  globalSettings?: Record<string, string>
  onUpsertGlobalSetting?: (key: string, value: string) => Promise<boolean>
  onPlaceDeleted?: (signal: import('../types').PlaceDeletionSignal) => void
}) {
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams] = useSearchParams()
  const role = actualRole === 'admin' ? viewMode : actualRole

  const headerChatUsers = useMemo(
    () => allUsers.map((user) => ({ id: user.id, name: user.name, role: user.role as Role })),
    [allUsers],
  )
  // 디자인 v2: 홈에서 "오늘 봉사한 카드" 섹션 제거됨 (활동 탭으로 이동)
  // 토글 상태는 디버그/스위치용으로 보존 — 활동 탭에서 재사용 가능
  const [todayCardsCollapsed, setTodayCardsCollapsed] = useState(() =>
    window.localStorage.getItem('mobileTodaySessionsCollapsed') === 'true'
  )
  void todayCardsCollapsed; void setTodayCardsCollapsed

  const [returnVisitEnabled, setReturnVisitEnabled] = useState(
    () => window.localStorage.getItem('feat_returnVisit') === '1'
  )
  const handleToggleReturnVisit = (enabled: boolean) => {
    setReturnVisitEnabled(enabled)
    window.localStorage.setItem('feat_returnVisit', enabled ? '1' : '0')
  }

  // A안 선택 날짜 (dot row 클릭으로 변경)

  const rawActiveTab = pathToTab[location.pathname] || '홈'
  // 인도자는 '지도' 탭이 없으므로 /map 접근 시 '구역' 탭 활성화
  const activeTab: MobileTab =
    rawActiveTab === '지도' && role === 'leader' ? '구역' : rawActiveTab

  // KST(로컬) 기준 오늘. toISOString 은 UTC 라 새벽 시간대에 하루 어긋남 → local 날짜 사용
  const today = useMemo(() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }, [])
  const todayLabel = useMemo(() => formatHomeDate(new Date(), language), [language])
  const leaderCards = useMemo(() => cards.filter((c) => c.assignedLeader === currentVisitor), [cards, currentVisitor])
  const inProgressCards = useMemo(() => cards.filter((c) => c.status === '진행중'), [cards])
  const totalUnits = useMemo(() => cards.reduce((sum, card) => sum + card.units, 0), [cards])
  const completedUnits = useMemo(() => cards.reduce((sum, card) => sum + card.completed, 0), [cards])

  const todayEvents = useMemo(() =>
    calendarEvents.filter((e) => e.date === today).sort((a, b) => a.time.localeCompare(b.time)),
    [calendarEvents, today])
  // 7일치 dot row 데이터 (오늘부터 7일) — A안
  // A안: 선택된 날짜의 일정 목록

  // 디자인 v2: 활동 탭으로 이동. 홈에서는 사용 안 함.
  const myTodaySessions = useMemo(() =>
    serviceSessions.filter((session) => session.serviceDate === today && session.userName === currentVisitor),
    [currentVisitor, serviceSessions, today])
  void myTodaySessions

  // 오늘 봉사 — 모든 오늘 일정 표시.
  // 본인이 인도자면 kind='lead' (ink border + "인도" pill),
  // 신청/배정자면 kind='join', 아무 관여 없으면 kind='avail' (신청 가능).
  const myTodayEvents = useMemo(() => {
    return todayEvents.map((event) => {
      const isLeader = event.leaders.includes(currentVisitor)
      const isApplicant = event.applicants.includes(currentVisitor)
      const isAssigned = event.cardAssignments.some((a) => a.userName === currentVisitor)
        || (event.assigned ?? []).includes(currentVisitor)
      const kind: 'lead' | 'join' | 'avail' = isLeader
        ? 'lead'
        : (isApplicant || isAssigned) ? 'join' : 'avail'
      return { event, kind }
    })
  }, [todayEvents, currentVisitor])

  const myRegularVisits = useMemo(
    () => getUserReturnVisits(returnVisits, currentVisitor),
    [currentVisitor, returnVisits],
  )
  const latestReturnVisitDate = useMemo(
    () => getLatestReturnVisitDate(myRegularVisits, returnVisitLogs),
    [myRegularVisits, returnVisitLogs],
  )
  // 디자인 v2: 홈 정기방문 섹션에서 latestReturnVisitLabel 직접 노출 안 함 (카드 내부 last 로 흡수)
  const latestReturnVisitLabel = formatRelativeVisitDate(latestReturnVisitDate, language)
  void latestReturnVisitLabel

  // (정기방문 미리보기는 활동 탭으로 이동, 홈에서는 미사용)
  const focusedMapCardId = searchParams.get('cardId') ? Number(searchParams.get('cardId')) : null
  const focusedInformalId = searchParams.get('informalId') ? Number(searchParams.get('informalId')) : null
  const mapScope = searchParams.get('scope')
  const isRegularVisitMapScope = mapScope === 'regularVisits'
  const focusedReturnVisitId = searchParams.get('returnVisitId') ? Number(searchParams.get('returnVisitId')) : null
  const requestedRegularVisitBuildingId = searchParams.get('buildingId') ? Number(searchParams.get('buildingId')) : null
  const focusedMapCardIds = useMemo(() => {
    const raw = searchParams.get('cardIds')
    if (!raw) return []
    return raw
      .split(',')
      .map((value) => Number(value))
      .filter((value) => Number.isFinite(value))
  }, [searchParams])
  const focusedMapScopeLabel = mapScope === 'mine'
    ? t(language, 'zone.myTerritories')
    : isRegularVisitMapScope
      ? t(language, 'territory.regularVisit')
      : undefined
  const legacyRegularVisitBuildingIds = useMemo(() => {
    const ids = new Set<number>()
    const currentName = normalizeVisitorName(currentVisitor)
    buildings.forEach((building) => {
      if (building.units.some((unit) => unit.isRegularVisit && normalizeVisitorName(unit.regularVisitor) === currentName)) {
        ids.add(building.id)
      }
    })
    return ids
  }, [buildings, currentVisitor])
  const regularVisitBuildingIds = useMemo(() => {
    const ids = new Set<number>()
    myRegularVisits.forEach((rv) => {
      // ⚠ Number.isFinite 는 타입을 좁혀 주지 않는다. buildingId 는 null 일 수 있다
      //   (세대·건물에 안 이어진 정기방문). null 검사를 따로 한다.
      if (rv.buildingId !== null && Number.isFinite(rv.buildingId)) ids.add(rv.buildingId)
    })
    legacyRegularVisitBuildingIds.forEach((id) => ids.add(id))
    return ids
  }, [legacyRegularVisitBuildingIds, myRegularVisits])
  const focusedRegularVisitBuildingId = useMemo(() => {
    if (!isRegularVisitMapScope) return null
    const fromReturnVisit = focusedReturnVisitId
      ? myRegularVisits.find((rv) => rv.id === focusedReturnVisitId)?.buildingId ?? null
      : null
    if (fromReturnVisit != null) return fromReturnVisit
    if (requestedRegularVisitBuildingId != null && regularVisitBuildingIds.has(requestedRegularVisitBuildingId)) {
      return requestedRegularVisitBuildingId
    }
    return null
  }, [focusedReturnVisitId, isRegularVisitMapScope, myRegularVisits, regularVisitBuildingIds, requestedRegularVisitBuildingId])
  const regularVisitVisibleBuildingIds = useMemo(() => {
    const ids = new Set<number>()
    if (!isRegularVisitMapScope) return ids
    if (focusedRegularVisitBuildingId != null) {
      ids.add(focusedRegularVisitBuildingId)
      return ids
    }
    regularVisitBuildingIds.forEach((id) => ids.add(id))
    return ids
  }, [focusedRegularVisitBuildingId, isRegularVisitMapScope, regularVisitBuildingIds])
  const regularVisitVisibleCardIds = useMemo(() => {
    const ids = new Set<number>()
    if (!isRegularVisitMapScope) return ids
    buildings.forEach((building) => {
      if (regularVisitVisibleBuildingIds.has(building.id)) ids.add(building.cardId)
    })
    return ids
  }, [buildings, isRegularVisitMapScope, regularVisitVisibleBuildingIds])
  // map 의 onBack 은 navigate(-1) 로 직전 URL(드릴 상태 포함) 정확 복귀.
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
    // 일정별 카드 배정 (event_card_assignments) — 최근 14일 + 미래
    // eslint-disable-next-line react-hooks/purity -- 최근 14일 cutoff: 렌더 시점 기준이 의도된 동작
    const eventCutoff = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000)
      .toISOString().slice(0, 10)
    calendarEvents.forEach((event) => {
      if (event.date < eventCutoff) return
      event.cardAssignments.forEach((assignment) => {
        if (assignment.userName !== currentVisitor) return
        const list = assignment.assignedCardIds && assignment.assignedCardIds.length > 0
          ? assignment.assignedCardIds
          : [assignment.assignedCardId]
        list.forEach((cardId) => {
          if (cardId) ids.add(cardId)
        })
      })
    })
    return ids
  }, [cards, currentVisitor, serviceSessions, calendarEvents])
  const isUserMapScope = role === 'user'
  const mapCards = useMemo(
    () => {
      if (isRegularVisitMapScope) return cards.filter((card) => regularVisitVisibleCardIds.has(card.id))
      return isUserMapScope ? cards.filter((card) => userVisibleMapCardIds.has(card.id)) : cards
    },
    [cards, isRegularVisitMapScope, isUserMapScope, regularVisitVisibleCardIds, userVisibleMapCardIds],
  )
  const mapBuildings = useMemo(
    () => {
      if (isRegularVisitMapScope) return buildings.filter((building) => regularVisitVisibleBuildingIds.has(building.id))
      return isUserMapScope ? buildings.filter((building) => userVisibleMapCardIds.has(building.cardId)) : buildings
    },
    [buildings, isRegularVisitMapScope, isUserMapScope, regularVisitVisibleBuildingIds, userVisibleMapCardIds],
  )
  const mapCardBoundaries = useMemo(
    () => {
      if (isRegularVisitMapScope) return cardBoundaries.filter((boundary) => regularVisitVisibleCardIds.has(boundary.cardId))
      return isUserMapScope ? cardBoundaries.filter((boundary) => userVisibleMapCardIds.has(boundary.cardId)) : cardBoundaries
    },
    [cardBoundaries, isRegularVisitMapScope, isUserMapScope, regularVisitVisibleCardIds, userVisibleMapCardIds],
  )
  const safeFocusedMapCardId =
    isRegularVisitMapScope
      ? null
      : isUserMapScope && focusedMapCardId && !userVisibleMapCardIds.has(focusedMapCardId)
      ? null
      : focusedMapCardId
  const safeFocusedMapCardIds = isUserMapScope
    ? focusedMapCardIds.filter((cardId) => userVisibleMapCardIds.has(cardId))
    : focusedMapCardIds
  const roleLabel = role === 'admin' ? t(language, 'role.admin') : role === 'leader' ? t(language, 'role.leader') : t(language, 'role.user')
  // 내 소속 집단 (사용자 관리에서 지정) — 설정 프로필 카드에 표시
  const myGroupName = allUsers.find((item) => item.id === currentUser.id)?.groupName ?? null
  const adminAttention = useAdminAttentionCounts({
    enabled: role === 'admin' || role === 'developer',
    users: allUsers,
    returnVisits,
    refreshKey: location.pathname,
  })
  const tabLabel = (tab: MobileTab) => {
    if (tab === '홈') return t(language, 'nav.home')
    if (tab === '캘린더') return t(language, 'nav.calendar')
    if (tab === '활동') return t(language, 'nav.myService')
    if (tab === '구역') return t(language, 'nav.zone')
    if (tab === '지도') return t(language, 'nav.map')
    if (tab === '배정') return t(language, 'nav.assignment')
    return t(language, 'nav.settings')
  }

  const _toggleTodayCardsCollapsed = () => {
    const next = !todayCardsCollapsed
    setTodayCardsCollapsed(next)
    window.localStorage.setItem('mobileTodaySessionsCollapsed', String(next))
  }
  void _toggleTodayCardsCollapsed

  const visibleTabs: MobileTab[] = role === 'user'
    ? ['홈', '캘린더', '활동', '설정']
    : role === 'leader'
      ? ['홈', '캘린더', '활동', '구역', '설정']  // 인도자 배정은 일정상세로 이동 → 배정 탭 제거
      : ['홈', '캘린더', '구역', '배정', '설정']  // admin (카드→인도자 배정 유지)

  const BottomNav = (
    <nav className="bottom-nav" aria-label={msg('주요 메뉴')}>
      {visibleTabs.map((item) => (
        <button
          className={item === activeTab ? 'active' : ''}
          key={item}
          onClick={() => navigate(tabToPath[item])}
          type="button"
        >
          <NavIcon name={navIcons[item]} />
          {tabLabel(item)}
        </button>
      ))}
    </nav>
  )


  return (
    <Routes>
      <Route path="/map" element={
        <>
          <MobileMap language={language}
            translatePlaceNames={translatePlaceNames}
            informalAssets={informalAssets}
            focusedInformalId={focusedInformalId}
            onCreateInformalPlace={role === 'admin' || role === 'developer' ? onCreateInformalPlace : undefined}
            onUpdateInformalPlace={role === 'admin' || role === 'developer' ? onUpdateInformalPlace : undefined}
            buildings={mapBuildings}
            cardBoundaries={mapCardBoundaries}
            cards={mapCards}
            eventRestaurantAssignments={eventRestaurantAssignments}
            calendarEvents={calendarEvents}
            currentVisitor={currentVisitor}
            currentUserId={currentUser.id}
            actualRole={role}
            serviceSessions={serviceSessions}
            focusedCardId={safeFocusedMapCardId}
            focusedCardIds={safeFocusedMapCardIds}
            focusedBuildingId={isRegularVisitMapScope ? focusedRegularVisitBuildingId : requestedRegularVisitBuildingId}
            regularVisitScope={isRegularVisitMapScope}
            focusedScopeLabel={focusedMapScopeLabel}
            onBack={() => navigate(-1)}
            onAddUnit={onAddUnit}
            onSetBuildingAccess={onSetBuildingAccess}
            onCreateBuilding={onCreateBuilding}
            onDeleteBuilding={onDeleteBuilding}
            onUpdateBuilding={onUpdateBuilding}
            onSetUnitsSurveyed={onSetUnitsSurveyed}
            onDeleteUnit={onDeleteUnit}
            onToggleRegularVisit={onToggleRegularVisit}
            onToggleChinese={onToggleChinese}
            onUndoLatestVisit={onUndoLatestVisit}
            onUpdateVisitHistory={onUpdateVisitHistory}
            onDeleteVisitHistory={onDeleteVisitHistory}
            onQuickLogVisit={onQuickLogVisit}
            onUpdateUnitFlags={onUpdateUnitFlags}
            onToggleInvitationLeft={onToggleInvitationLeft}
            visitHistories={visitHistories}
            specialPeriods={specialPeriods}
            allUsers={allUsers.map(u => ({ id: u.id, name: u.name, approvalStatus: u.approvalStatus }))}
            onSetRegularVisitor={onSetRegularVisitor}
            onOpenLocationSettings={() => navigate('/location-permission-settings')}
          />
          {/* 지도는 풀스크린 — 하단 탭 없음 */}
        </>
      } />
      <Route path="/*" element={
        <main className="app-shell" style={{ paddingBottom: 72 }}>
          <Routes>
            {/* 홈 */}
            <Route path="/" element={
              <>
                <AppHeader
                  pageTitle={t(language, 'nav.home')}
                  language={language}
                  subtitle={todayLabel}
                  userId={currentUser.id}
                  userName={currentVisitor}
                  role={role}
                  chatUsers={headerChatUsers}
                  onOpenMenu={() => navigate('/settings')}
                />

                {specialPeriods && specialPeriods.length > 0 && (
                  <div style={{ padding: '0 16px', marginTop: '12px', marginBottom: '4px' }}>
                    <SpecialPeriodBanner specialPeriods={specialPeriods} variant="compact" />
                  </div>
                )}

                {role === 'admin' ? (
                  <AdminMobileHome
                    language={language}
                    
                    todayEvents={todayEvents}
                    cards={cards}
                    totalUnits={totalUnits}
                    completedUnits={completedUnits}
                    inProgressCount={inProgressCards.length}
                    unassignedCount={cards.filter((c) => c.status === '미배정').length}
                    
                    onOpenZone={() => navigate('/zone')}
                    
                    
                    
                    
                    
                    onOpenEventDetail={(id) => navigate(`/calendar?openEvent=${id}`)}
                  />
                ) : (
                  <UserMobileHome
                    language={language}
                    
                    myTodayEvents={myTodayEvents}
                    
                    
                    
                    
                    leaderCards={leaderCards}
                    role={role}
                    
                    
                    onOpenEventDetail={(id) => navigate(`/calendar?openEvent=${id}`)}
                    onOpenZone={() => navigate('/zone')}
                    globalSettings={globalSettings}
                  />
                )}
              </>
            } />

            {/* 공지 */}
            <Route path="/notices" element={
              <>
                <AppHeader
                  pageTitle={t(language, 'settings.notice')}
                  language={language}
                  subtitle={(t(language, 'settings.noticeSubtitle') ?? `공지 ${notices.length}개`).replace('{count}', String(notices.length))}
                  showBack
                  onBack={() => navigate('/settings')}
                  userId={currentUser.id}
                  userName={currentVisitor}
                  role={role}
                  chatUsers={headerChatUsers}
                  onOpenMenu={() => navigate('/settings')}
                />
                <MobileNotices
                  language={language}
                  currentVisitor={currentVisitor}
                  currentUserId={currentUser.id}
                  notices={notices}
                  role={role}
                  mentionUsers={allUsers.map((user) => ({ id: user.id, name: user.name, role: user.role }))}
                  onCreateNotice={onCreateNotice}
                  onDeleteNotice={onDeleteNotice}
                />
              </>
            } />

            {/* 내 정보 */}
            <Route path="/profile" element={
              <MobileProfileSettings
                user={currentUser}
                language={language}
                onChangePin={onChangePin}
                onUpdateProfile={onUpdateMyProfile}
                onFetchLoginLogs={onFetchMyLoginLogs}
              />
            } />

            {/* 캘린더 */}
            <Route path="/calendar" element={
              <>
                <AppHeader
                  pageTitle={t(language, 'nav.calendar')}
                  language={language}
                  subtitle={(() => {
                    const now = new Date()
                    const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
                    const count = calendarEvents.filter((e) => e.date.startsWith(ym)).length
                    return t(language, 'calendar.subtitleCount')
                      .replace('{year}', String(now.getFullYear()))
                      .replace('{month}', String(now.getMonth() + 1))
                      .replace('{count}', String(count))
                  })()}
                  userId={currentUser.id}
                  userName={currentVisitor}
                  role={role}
                  chatUsers={headerChatUsers}
                  onOpenMenu={() => navigate('/settings')}
                />
                {/* 모든 역할이 AdminMobileCalendar 사용 — 권한별 콜백 가시성으로 차등 */}
                <AdminMobileCalendar
                  language={language}
                  translatePlaceNames={translatePlaceNames}
                  currentVisitor={currentVisitor}
                  currentUserId={currentUser.id}
                  role={role}
                  events={calendarEvents}
                  cards={cards}
                  buildings={buildings}
                  visitHistories={visitHistories}
                  cardBoundaries={cardBoundaries}
                  leaderNames={leaderNames}
                  mentionUsers={allUsers.map((user) => ({ id: user.id, name: user.name, role: user.role }))}
                  participantUsers={allUsers}
                  onAssignCardsToEventParticipantsBulk={onAssignCardsToEventParticipantsBulk}
                  informalAssets={informalAssets}
                  informalGroups={informalGroups}
                  eventInformalAssignments={eventInformalAssignments}
                  eventRestaurantAssignments={eventRestaurantAssignments}
                  onAssignInformalToUser={onAssignInformalToUser}
                  onRemoveInformalAssignment={onRemoveInformalAssignment}
                  onAssignRestaurantToUser={onAssignRestaurantToUser}
                  onRemoveRestaurantAssignment={onRemoveRestaurantAssignment}
                  /* 일정 생성: 관리자·개발자만. 인도자는 본인 일정 수정만 가능, user 는 신청만. */
                  onCreateEvent={(role === 'admin' || role === 'developer') ? onCreateCalendarEvent : undefined}
                  onCreateRepeatEvents={(role === 'admin' || role === 'developer') ? onCreateRepeatCalendarEvents : undefined}
                  onDeleteEvent={role === 'user' ? undefined : onDeleteCalendarEvent}
                  onDeleteEventSeries={role === 'user' ? undefined : onDeleteCalendarEventSeries}
                  onUpdateEvent={role === 'user' ? undefined : onUpdateCalendarEvent}
                  onUpdateEventSeries={role === 'user' ? undefined : onUpdateCalendarEventSeries}
                  onApplyToEvent={onApplyToEvent}
                  onAddParticipantToEvent={_onAddParticipantToEvent}
                  onRemoveParticipantFromEvent={_onRemoveParticipantFromEvent}
                  specialPeriods={specialPeriods}
                  globalSettings={globalSettings}
                  onUpsertGlobalSetting={onUpsertGlobalSetting}
                />
              </>
            } />

            {/* 정기방문 상세 (풀스크린) — 디자인 핸드오프 대기 */}
            <Route path="/territory/regular/:id" element={
              role === 'admin' ? (
                <Navigate to="/zone" replace />
              ) : (
                <MobileRegularVisitDetail
                  language={language}
                  returnVisits={returnVisits}
                  returnVisitLogs={returnVisitLogs}
                  buildings={buildings}
                  currentVisitor={currentVisitor}
                  onAddReturnVisitLog={onAddReturnVisitLog}
                  onUpdateReturnVisitLog={onUpdateReturnVisitLog}
                  onDeleteReturnVisitLog={onDeleteReturnVisitLog}
                  onDeleteReturnVisit={onDeleteReturnVisit}
                  onUpdateReturnVisitNickname={onUpdateReturnVisitNickname}
                  onUpdateReturnVisitAddress={onUpdateReturnVisitAddress}
                />
              )
            } />

            {/* 나의봉사 (개인 봉사 현황) */}
            <Route path="/territory" element={
              role === 'admin' ? (
                <Navigate to="/zone" replace />
              ) : (
                <>
                <AppHeader
                  pageTitle={t(language, 'nav.myService')}
                  language={language}
                  subtitle={(() => {
                    const myEvents = calendarEvents.filter((e) =>
                      e.date === today && (
                        e.leaders.includes(currentVisitor) ||
                        e.assigned?.includes(currentVisitor) ||
                        e.applicants?.includes(currentVisitor)
                      )
                    )
                    return myEvents.length > 0 ? t(language, 'territory.serviceActive') : t(language, 'territory.serviceNone')
                  })()}
                  userId={currentUser.id}
                  userName={currentVisitor}
                  role={role}
                  chatUsers={headerChatUsers}
                  onOpenMenu={() => navigate('/settings')}
                />
                <MobileTerritory
                  language={language}
                  translatePlaceNames={translatePlaceNames}
                  buildings={buildings}
                  cards={cards}
                  cardBoundaries={cardBoundaries}
                  calendarEvents={calendarEvents}
                  currentVisitor={currentVisitor}
                  role={role}
                  serviceSessions={serviceSessions}
                  returnVisits={returnVisits}
                  returnVisitLogs={returnVisitLogs}
                  onOpenMap={(cardId) => navigate(`/map?cardId=${cardId}`)}
                  onOpenInformalMap={(assetId) => navigate(`/map?informalId=${assetId}`)}
                  onOpenRegularVisitMap={(returnVisitId) => {
                    const params = new URLSearchParams()
                    params.set('scope', 'regularVisits')
                    if (returnVisitId) {
                      const rv = myRegularVisits.find((item) => item.id === returnVisitId)
                      params.set('returnVisitId', String(returnVisitId))
                      if (rv?.buildingId) params.set('buildingId', String(rv.buildingId))
                    }
                    navigate(`/map?${params.toString()}`)
                  }}
                  onEndServiceSession={onEndServiceSession}
                  onCreateManualReturnVisit={onCreateManualReturnVisit}
                  onAddReturnVisitLog={onAddReturnVisitLog}
                  onUpdateReturnVisitLog={onUpdateReturnVisitLog}
                  onDeleteReturnVisitLog={onDeleteReturnVisitLog}
                  onDeleteReturnVisit={onDeleteReturnVisit}
                  onUpdateReturnVisitNickname={onUpdateReturnVisitNickname}
                  onUpdateReturnVisitAddress={onUpdateReturnVisitAddress}
                  informalAssets={informalAssets}
                  eventInformalAssignments={eventInformalAssignments}
                  eventRestaurantAssignments={eventRestaurantAssignments}
                  visitHistories={visitHistories}
                  onAddRestaurantVisit={onAddRestaurantVisit}
                  onSubmitRestaurantRequest={onSubmitRestaurantRequest}
                  onUpdateRestaurantRequestMemo={onUpdateRestaurantRequestMemo}
                  restaurantRequests={restaurantRequests}
                />
                </>
              )
            } />

            {/* 구역 (인도자·관리자용 — 목록↔지도 토글) */}
            <Route path="/zone" element={
              <>
              <AppHeader
                pageTitle={t(language, 'nav.zone')}
                language={language}
                subtitle={(() => {
                  if (role === 'admin') {
                    const total = cards.length
                    const unassigned = cards.filter((c) => c.status === '미배정').length
                    return t(language, 'zone.subtitleAdmin')
                      .replace('{total}', String(total))
                      .replace('{unassigned}', String(unassigned))
                  }
                  const myCards = cards.filter((c) =>
                    c.assignedLeaders?.includes(currentVisitor) ||
                    c.assignedLeader === currentVisitor ||
                    c.assignedUsers?.includes(currentVisitor)
                  ).length
                  return `${t(language, 'home.assignedCards')} ${myCards}`
                })()}
                userId={currentUser.id}
                userName={currentVisitor}
                role={role}
                chatUsers={headerChatUsers}
                onOpenMenu={() => navigate('/settings')}
              />
              {/* 디자인 v2: 모든 역할이 AdminMobileZone 사용 — 권한별 콜백 가시성으로 차등.
                  admin: 모든 콜백 / leader: 식당 토글만 / user: 자료 관리 콜백 일체 차단 */}
              <AdminMobileZone
                onCreateInformalPlace={role === 'admin' || role === 'developer' ? onCreateInformalPlace : undefined}
                onUpdateInformalPlace={role === 'admin' || role === 'developer' ? onUpdateInformalPlace : undefined}
                onOpenInformalOnMap={(assetId) => navigate(`/map?informalId=${assetId}`)}
                language={language}
                translatePlaceNames={translatePlaceNames}
                cards={cards}
                buildings={buildings}
                cardBoundaries={cardBoundaries}
                visitHistories={visitHistories}
                onUpdateUnitFlags={onUpdateUnitFlags}
                onRemoveRestaurantUnit={onRemoveRestaurantUnit}
                currentVisitor={currentVisitor}
                visitorNames={allUsers
                  .filter((user) => user.approvalStatus === 'approved' && user.isActive !== false)
                  .map((user) => user.name)
                  .sort((a, b) => a.localeCompare(b, 'ko'))}
                role={role}
                informalAssets={informalAssets}
                informalGroups={informalGroups}
                onOpenMap={(cardId) => navigate(`/map?cardId=${cardId}`)}
                onOpenAssignedMap={(cardIds, context) => {
                  const params = new URLSearchParams()
                  if (cardIds.length > 0) params.set('cardIds', cardIds.join(','))
                  if (context?.scope === 'mine') params.set('scope', 'mine')
                  if (context?.region) params.set('region', context.region)
                  if (context?.dong) params.set('dong', context.dong)
                  navigate(`/map${params.toString() ? `?${params.toString()}` : ''}`)
                }}
                onShowMapView={() => navigate('/map')}
                /* 비공식 자료와 그룹 관리는 admin/developer */
                onUploadInformalAsset={role === 'admin' || role === 'developer' ? onUploadInformalAsset : undefined}
                onDeleteInformalAsset={role === 'admin' || role === 'developer' ? onDeleteInformalAsset : undefined}
                onDeleteInformalAssets={role === 'admin' || role === 'developer' ? onDeleteInformalAssets : undefined}
                onCreateInformalGroup={role === 'admin' || role === 'developer' ? onCreateInformalGroup : undefined}
                onRenameInformalGroup={role === 'admin' || role === 'developer' ? onRenameInformalGroup : undefined}
                onDeleteInformalGroup={role === 'admin' || role === 'developer' ? onDeleteInformalGroup : undefined}
                onMoveAssetToGroup={role === 'admin' || role === 'developer' ? onMoveAssetToGroup : undefined}
                onMoveAssetsToGroup={role === 'admin' || role === 'developer' ? onMoveAssetsToGroup : undefined}
                /* 식당 토글은 leader/admin 모두, user 는 제외 */
                onToggleBuildingRestaurant={role === 'user' ? undefined : onToggleBuildingRestaurant}
                restaurantRequests={restaurantRequests}
                onRegisterRestaurant={onRegisterRestaurant}
                onApproveRestaurantRequest={onApproveRestaurantRequest}
                onRejectRestaurantRequest={onRejectRestaurantRequest}
              />
              </>
            } />

            {/* 배정 */}
            <Route path="/assignment" element={
              <>
              <AppHeader
                pageTitle={t(language, 'nav.assignment')}
                language={language}
                subtitle={role === 'admin' ? (() => {
                  const leaderCount = leaderNames.length
                  const unassigned = cards.filter((c) => {
                    const ls = c.assignedLeaders?.length ? c.assignedLeaders : c.assignedLeader ? [c.assignedLeader] : []
                    return ls.length === 0
                  }).length
                  return t(language, 'zone.subtitleAssignment')
                    .replace('{unassigned}', String(unassigned))
                    .replace('{leaderCount}', String(leaderCount))
                })() : (() => {
                  const myEvents = calendarEvents.filter((e) =>
                    e.date === today && (
                      e.leaders.includes(currentVisitor) ||
                      e.assigned?.includes(currentVisitor) ||
                      e.applicants?.includes(currentVisitor)
                    )
                  )
                  if (myEvents.length === 0) return t(language, 'assignment.subtitleNone')
                  const total = myEvents.reduce((sum, e) => {
                    const participants = new Set([...(e.assigned ?? []), ...(e.applicants ?? [])])
                    return sum + participants.size
                  }, 0)
                  return t(language, 'assignment.subtitleCount').replace('{count}', String(total))
                })()}
                userId={currentUser.id}
                userName={currentVisitor}
                role={role}
                chatUsers={headerChatUsers}
                onOpenMenu={() => navigate('/settings')}
              />
              {role === 'admin' ? (
                <MobileAdminAssignment
                  cards={cards}
                  buildings={buildings}
                  leaderNames={leaderNames}
                  currentVisitor={currentVisitor}
                  onSetCardLeaders={onSetCardLeaders}
                  onOpenMapView={(cardIds) => {
                    const query = cardIds && cardIds.length > 0
                      ? `?cardIds=${cardIds.join(',')}&return=assignment`
                      : '?return=assignment'
                    navigate(`/map${query}`)
                  }}
                />
              ) : (
                /* 인도자 배정은 일정상세(캘린더)로 이동됨 → 직접 접근 시 캘린더로 */
                <Navigate to="/calendar" replace />
              )}
              </>
            } />

            {/* 사용자 */}
            <Route path="/users" element={<MobileUsers />} />

            {/* 가입 신청 관리 */}
            <Route path="/signup-requests" element={
              role === 'admin' ? <MobileSignupRequests /> : <Navigate to="/settings" replace />
            } />


            {/* 봉사 로그 조회 */}
            <Route path="/service-logs" element={
              role === 'admin' ? (
                <div className="mobile-settings-page" style={{ paddingBottom: 60 }}>
                  <AppHeader
                    pageTitle={t(language, 'settings.serviceLogs')}
                    language={language}
                    showBack
                    onBack={() => navigate('/settings')}
                    userId={currentUser.id}
                    userName={currentVisitor}
                    role={role}
                    chatUsers={headerChatUsers}
                    onOpenMenu={() => navigate('/settings')}
                  />
                  <div style={{ padding: '0 16px', marginTop: 16 }}>
                    <ServiceLogPage cards={cards} calendarEvents={calendarEvents} role={role} isEmbedded visitHistories={visitHistories} buildings={buildings} />
                  </div>
                </div>
              ) : <Navigate to="/settings" replace />
            } />

            {/* 개인정보 처리방침 (전체 사용자) */}
            <Route path="/privacy" element={
              <div className="mobile-settings-page" style={{ paddingBottom: 60 }}>
                <AppHeader
                  pageTitle={t(language, 'privacy.title')}
                  language={language}
                  showBack
                  onBack={() => navigate('/settings')}
                  userId={currentUser.id}
                  userName={currentVisitor}
                  role={role}
                  chatUsers={headerChatUsers}
                  onOpenMenu={() => navigate('/settings')}
                />
                <div style={{ padding: '0 16px 40px', marginTop: 16 }}>
                  <PrivacyPolicy language={language} />
                </div>
              </div>
            } />

            {/* 정기방문 관리 (관리자·개발자) */}
            <Route path="/regular-visits" element={
              (role === 'admin' || role === 'developer') ? (
                <div className="mobile-settings-page" style={{ paddingBottom: 60 }}>
                  <AppHeader
                    pageTitle={msg('정기방문 관리')}
                    language={language}
                    showBack
                    onBack={() => navigate('/settings')}
                    userId={currentUser.id}
                    userName={currentVisitor}
                    role={role}
                    chatUsers={headerChatUsers}
                    onOpenMenu={() => navigate('/settings')}
                  />
                  <div style={{ padding: '0 16px', marginTop: 16 }}>
                    <RegularVisitManagement
                      returnVisits={returnVisits}
                      activeUsers={allUsers}
                      isDeveloper={actualRole === 'developer'}
                      language={language}
                      onReassign={(id, name) => onReassignReturnVisit?.(id, name) ?? false}
                    />
                  </div>
                </div>
              ) : <Navigate to="/settings" replace />
            } />

            {/* 특별 봉사 시즌 관리 */}
            <Route path="/special-periods" element={
              role === 'admin' ? (
                <div className="mobile-settings-page">
                  <AppHeader
                    pageTitle={t(language, 'settings.specialSeason')}
                    language={language}
                    showBack
                    onBack={() => navigate('/settings')}
                    userId={currentUser.id}
                    userName={currentVisitor}
                    role={role}
                    chatUsers={headerChatUsers}
                    onOpenMenu={() => navigate('/settings')}
                  />
                  <SpecialPeriodSettings
                    isAdmin
                    specialPeriods={specialPeriods}
                    onCreateSpecialPeriod={onCreateSpecialPeriod}
                    onUpdateSpecialPeriod={onUpdateSpecialPeriod}
                    onDeleteSpecialPeriod={onDeleteSpecialPeriod}
                  />
                </div>
              ) : (
                <Navigate to="/settings" replace />
              )
            } />

            
            {/* 봉사 제안 관리 */}
            <Route path="/suggestions" element={
              (role === 'admin' || role === 'developer') ? (
                <div className="mobile-settings-page" style={{ paddingBottom: 60 }}>
                  <AppHeader
                    pageTitle={msg('대화 방법 제안 관리')}
                    language={language}
                    showBack
                    onBack={() => navigate('/settings')}
                    userId={currentUser.id}
                    userName={currentVisitor}
                    role={role}
                    chatUsers={headerChatUsers}
                    onOpenMenu={() => navigate('/settings')}
                  />
                  <div style={{ padding: '0 16px' }}>
                    <AdminSuggestions />
                  </div>
                </div>
              ) : (
                <Navigate to="/settings" replace />
              )
            } />
    
            {/* 알림 설정 */}
            <Route path="/notification-settings" element={
              <div className="mobile-settings-page">
                <AppHeader
                  pageTitle={t(language, 'settings.notificationTitle')}
                  language={language}
                  showBack
                  onBack={() => navigate('/settings')}
                  userId={currentUser.id}
                  userName={currentVisitor}
                  role={role}
                  chatUsers={headerChatUsers}
                  onOpenMenu={() => navigate('/settings')}
                />
                <div style={{ padding: '0 16px', marginBottom: 16 }}>
                  <NotificationSettings userId={currentUser.id} language={language} role={actualRole} />
                </div>
              </div>
            } />

            {/* 위치 권한 */}
            <Route path="/location-permission-settings" element={
              <div className="mobile-settings-page">
                <AppHeader
                  pageTitle={t(language, 'settings.locationTitle')}
                  language={language}
                  showBack
                  onBack={() => navigate('/settings')}
                  userId={currentUser.id}
                  userName={currentVisitor}
                  role={role}
                  chatUsers={headerChatUsers}
                  onOpenMenu={() => navigate('/settings')}
                />
                <div style={{ padding: '0 16px', marginBottom: 16 }}>
                  <LocationPermissionSettings language={language} />
                </div>
              </div>
            } />

            {/* 설정 */}
            <Route path="/place-change-requests" element={
              (role === 'admin' || role === 'developer') ? (
                <div className="mobile-settings-page">
                  <AppHeader
                    pageTitle={msg('자료 수정 요청')}
                    language={language}
                    showBack
                    onBack={() => navigate('/settings')}
                    userId={currentUser.id}
                    userName={currentVisitor}
                    role={role}
                    chatUsers={headerChatUsers}
                    onOpenMenu={() => navigate('/settings')}
                  />
                  <PlaceChangeRequests onPlaceDeleted={onPlaceDeleted} />
                </div>
              ) : <Navigate to="/settings" replace />
            } />

            {/* 설정 */}
            <Route path="/settings" element={
              <div className="mobile-settings-page">
                <AppHeader
                  pageTitle={t(language, 'settings.title')}
                  language={language}
                  subtitle={`${currentVisitor} · ${roleLabel}`}
                  userId={currentUser.id}
                  userName={currentVisitor}
                  role={role}
                  chatUsers={headerChatUsers}
                  onOpenMenu={() => navigate('/settings')}
                />

                <button className="mobile-settings-profile" onClick={() => navigate('/profile')} type="button" aria-label={msg('내 정보 관리')}>
                  <div className="mobile-settings-avatar" aria-hidden="true">
                    {currentVisitor.slice(0, 1)}
                  </div>
                  <div className="mobile-settings-profile-text">
                    <strong>{currentVisitor}</strong>
                    <span>
                      {t(language, 'settings.currentRole')} · {roleLabel}
                      {myGroupName ? ` · ${myGroupName}` : ''}
                    </span>
                  </div>
                  <span className="mobile-settings-chevron" aria-hidden="true">›</span>
                </button>

                {actualRole === 'admin' && (
                  <section className="mobile-settings-switch" aria-label={msg('화면 보기 전환')}>
                    <p>{t(language, 'settings.viewMode')}</p>
                    <div className="mobile-role-grid">
                      {(['admin', 'leader', 'user'] as Role[]).map((r) => (
                        <button
                          key={r}
                          onClick={() => onChangeViewMode(r)}
                          className={role === r ? 'active' : ''}
                          type="button"
                        >
                          {r === 'admin' ? t(language, 'role.admin') : r === 'leader' ? t(language, 'role.leader') : t(language, 'role.user')}
                        </button>
                      ))}
                    </div>
                  </section>
                )}

                <section className="mobile-settings-switch" aria-label={msg('글씨 크기')}>
                  <p>{t(language, 'settings.fontScale')}</p>
                  <FontScalePicker userId={currentUser.id} language={language} />
                </section>

                <section className="mobile-settings-switch" aria-label={msg('언어 설정')}>
                  <p>{t(language, 'settings.language')}</p>
                  <div className="mobile-language-grid">
                    {(['ko', 'zh', 'en'] as AppLanguage[]).map((item) => (
                      <button
                        key={item}
                        className={language === item ? 'active' : ''}
                        onClick={() => onChangeLanguage(item)}
                        type="button"
                      >
                        {languageLabels[item]}
                      </button>
                    ))}
                  </div>
                  {language !== 'ko' && onChangeTranslatePlaceNames && (
                    <label style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      marginTop: 10, cursor: 'pointer',
                      fontSize: 13, color: 'var(--text)',
                    }}>
                      <input
                        type="checkbox"
                        checked={translatePlaceNames}
                        onChange={(e) => onChangeTranslatePlaceNames(e.target.checked)}
                        style={{ width: 16, height: 16, cursor: 'pointer', accentColor: 'var(--ink)' }}
                      />
                      {t(language, 'settings.translatePlaceNames')}
                    </label>
                  )}
                </section>

                
                {/* [기능] 섹션 */}
                <div style={{ marginTop: 24, paddingLeft: 16, marginBottom: 8, fontSize: 13, fontWeight: 700, color: 'var(--gray-500)', letterSpacing: 0.5 }}>{t(language, 'settings.features')}</div>
                <section className="mobile-settings-menu" aria-label={msg('기능 설정')}>
                  <div className="mobile-settings-feature-row">
                    <span className="mobile-settings-icon mobile-settings-icon-neutral" aria-hidden="true">
                      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" />
                        <path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
                      </svg>
                    </span>
                    <span className="mobile-settings-row-text">
                      <strong>{t(language, 'settings.regularVisitManagement')}</strong>
                      <small>{t(language, 'settings.regularVisitManagementDesc')}</small>
                    </span>
                    <label className="mobile-feature-toggle-switch" style={{ marginLeft: 'auto', flexShrink: 0 }}>
                      <input
                        type="checkbox"
                        checked={returnVisitEnabled}
                        onChange={(e) => handleToggleReturnVisit(e.target.checked)}
                      />
                      <span />
                    </label>
                  </div>
                </section>

                {/* [소식 & 알림] 섹션 */}
                <div style={{ marginTop: 24, paddingLeft: 16, marginBottom: 8, fontSize: 13, fontWeight: 700, color: 'var(--gray-500)', letterSpacing: 0.5 }}>{msg('소식 & 알림')}</div>
                <section className="mobile-settings-menu" aria-label={msg('소식 및 알림 메뉴')}>
                  {role === 'admin' && (
                    <button onClick={() => navigate('/notices')} type="button">
                      <span className="mobile-settings-icon mobile-settings-icon-neutral" aria-hidden="true">
                        <SettingsIcon name="notice" />
                      </span>
                      <span className="mobile-settings-row-text">
                        <strong>{t(language, 'settings.notice')}</strong>
                        <small>{t(language, 'settings.noticeDesc')}</small>
                      </span>
                      <span className="mobile-settings-chevron" aria-hidden="true">›</span>
                    </button>
                  )}
                  <button onClick={() => navigate('/notification-settings')} type="button">
                    <span className="mobile-settings-icon mobile-settings-icon-neutral" aria-hidden="true">
                      <SettingsIcon name="notification" />
                    </span>
                    <span className="mobile-settings-row-text">
                      <strong>{t(language, 'settings.notificationTitle')}</strong>
                      <small>{t(language, 'settings.notificationDesc')}</small>
                    </span>
                    <span className="mobile-settings-chevron" aria-hidden="true">›</span>
                  </button>
                  <button onClick={() => navigate('/location-permission-settings')} type="button">
                    <span className="mobile-settings-icon mobile-settings-icon-neutral" aria-hidden="true">
                      <SettingsIcon name="location" />
                    </span>
                    <span className="mobile-settings-row-text">
                      <strong>{t(language, 'settings.locationTitle')}</strong>
                      <small>{t(language, 'settings.locationDesc')}</small>
                    </span>
                    <span className="mobile-settings-chevron" aria-hidden="true">›</span>
                  </button>
                </section>

                {(role === 'admin' || role === 'developer') && (
                  <>
                    {/* [관리 (Admin)] 섹션 — 관리자·개발자 */}
                    <div style={{ marginTop: 24, paddingLeft: 16, marginBottom: 8, fontSize: 13, fontWeight: 700, color: 'var(--gray-500)', letterSpacing: 0.5 }}>{msg('관리 (Admin)')}</div>
                    <section className="mobile-settings-menu" aria-label={msg('관리 메뉴')}>
                      <button onClick={() => navigate('/users')} type="button">
                        <span className="mobile-settings-icon mobile-settings-icon-neutral" aria-hidden="true">
                          <SettingsIcon name="users" />
                        </span>
                        <span className="mobile-settings-row-text">
                          <strong>{t(language, 'settings.users')}</strong>
                          <small>{t(language, 'settings.usersDesc')}</small>
                        </span>
                        <span className="mobile-settings-chevron" aria-hidden="true">›</span>
                      </button>
                      <button onClick={() => navigate('/signup-requests')} type="button">
                        <span className="mobile-settings-icon mobile-settings-icon-neutral" aria-hidden="true">
                          <SettingsIcon name="signup" />
                        </span>
                        <span className="mobile-settings-row-text">
                          <strong>{t(language, 'settings.signup')}</strong>
                          <small>{t(language, 'settings.signupDesc')}</small>
                        </span>
                        {adminAttention.signupRequests > 0 && (
                          <span className="mobile-settings-badge" aria-label={msg('승인 대기 {count}명', { count: adminAttention.signupRequests })}>
                            {adminAttention.signupRequests}
                          </span>
                        )}
                        <span className="mobile-settings-chevron" aria-hidden="true">›</span>
                      </button>
                      {/* 정기방문 관리 (관리자·개발자) */}
                      <button onClick={() => navigate('/regular-visits')} type="button">
                        <span className="mobile-settings-icon mobile-settings-icon-neutral" aria-hidden="true">
                          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 11l18-5v12L3 14v-3z" /><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6" /></svg>
                        </span>
                        <span className="mobile-settings-row-text">
                          <strong>{msg('정기방문 관리')}</strong>
                          <small>{msg('담당자 끊긴 정기방문 점검·재배정')}</small>
                        </span>
                        {adminAttention.regularVisits > 0 && (
                          <span className="mobile-settings-badge" aria-label={msg('재지정 필요 {count}건', { count: adminAttention.regularVisits })}>
                            {adminAttention.regularVisits}
                          </span>
                        )}
                        <span className="mobile-settings-chevron" aria-hidden="true">›</span>
                      </button>
                      <button onClick={() => navigate('/place-change-requests')} type="button">
                        <span className="mobile-settings-icon mobile-settings-icon-neutral" aria-hidden="true">
                          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
                        </span>
                        <span className="mobile-settings-row-text">
                          <strong>{msg('자료 수정 요청')}</strong>
                          <small>{msg('건물·세대·주소 신고 확인')}</small>
                        </span>
                        {adminAttention.placeRequests > 0 && (
                          <span className="mobile-settings-badge" aria-label={msg('처리 대기 {count}건', { count: adminAttention.placeRequests })}>
                            {adminAttention.placeRequests}
                          </span>
                        )}
                        <span className="mobile-settings-chevron" aria-hidden="true">›</span>
                      </button>
                      {/* 봉사 로그는 개발자 전용 (데스크톱과 동일) — 일반 관리자는 못 보므로 숨김 */}
                      {actualRole === 'developer' && (
                        <button onClick={() => navigate('/service-logs')} type="button">
                          <span className="mobile-settings-icon mobile-settings-icon-neutral" aria-hidden="true">
                            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M7 8h10M7 12h10M7 16h6" /></svg>
                          </span>
                          <span className="mobile-settings-row-text">
                            <strong>{t(language, 'settings.serviceLogs')}</strong>
                            <small>{t(language, 'settings.serviceLogsDesc')}</small>
                          </span>
                          <span className="mobile-settings-chevron" aria-hidden="true">›</span>
                        </button>
                      )}
                      <button onClick={() => navigate('/special-periods')} type="button">
                        <span className="mobile-settings-icon mobile-settings-icon-season" aria-hidden="true">
                          <SettingsIcon name="season" />
                        </span>
                        <span className="mobile-settings-row-text">
                          <strong>{t(language, 'settings.specialSeason')}</strong>
                          <small>{t(language, 'settings.specialSeasonDesc')}</small>
                        </span>
                        <span className="mobile-settings-chevron" aria-hidden="true">›</span>
                      </button>
                      <button onClick={() => navigate('/suggestions')} type="button">
                        <span className="mobile-settings-icon mobile-settings-icon-neutral" aria-hidden="true">
                          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
                        </span>
                        <span className="mobile-settings-row-text">
                          <strong>{t(language, 'settings.suggestions')}</strong>
                          <small>{t(language, 'settings.suggestionsDesc')}</small>
                        </span>
                        <span className="mobile-settings-chevron" aria-hidden="true">›</span>
                      </button>
                    </section>
                  </>
                )}

                <div style={{ padding: '0 16px', marginBottom: 16 }}>
                  <PwaInstallSection language={language} />
                </div>

                <div style={{ padding: '0 16px', marginBottom: 16 }}>
                  <AppUpdateCard variant="mobile" />
                </div>

                <button className="mobile-settings-logout" onClick={onLogout} type="button">
                  <span className="mobile-settings-icon mobile-settings-icon-danger" aria-hidden="true">
                    <SettingsIcon name="logout" />
                  </span>
                  <strong>{t(language, 'settings.logout')}</strong>
                </button>

                <button
                  onClick={() => navigate('/privacy')}
                  type="button"
                  style={{ minHeight: 0, margin: '14px auto 0', display: 'block', background: 'none', border: 'none', color: 'var(--muted)', fontSize: 12.5, textDecoration: 'underline', cursor: 'pointer' }}
                >
                  {t(language, 'privacy.title')}
                </button>

                <p className="mobile-settings-version">{t(language, 'settings.version')}</p>
              </div>
            } />
            {/* 모르는 경로는 홈으로. 없으면 아래 탭만 남고 본문이 빈 화면이 된다 —
                PC 에서 복사한 주소(예: /settings/territory-regions)를 폰으로 열면
                실제로 그렇게 됐다. DesktopApp 에는 같은 폴백이 이미 있다 */}
            <Route path="*" element={<Navigate replace to="/" />} />
          </Routes>

          {BottomNav}
        </main>
      } />
    </Routes>
  )
}
