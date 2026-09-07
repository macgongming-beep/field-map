/* eslint-disable @typescript-eslint/no-explicit-any -- 네이버 지도 SDK(window.naver)는 공식 TS 타입이 없어 any 사용이 불가피함 */
import { useState, useMemo, useRef, useEffect, useCallback } from 'react'
import { canEditVisitor, visitorOptionsFrom, visitorOptionsWithCurrent } from '../utils/visitorPicker'
import { useSearchParams } from 'react-router-dom'
import { MapCanvas } from './MapCanvas'
import type { MapAggregateMarker } from './MapCanvas'
import type { Building, CalendarEvent, CardBoundary, EventRestaurantAssignment, InformalAsset, Role, ServiceSession, SpecialPeriod, TerritoryCard, TimeSlot, Unit, UnitStatus, VisitHistory } from '../types'
import type { AppLanguage } from '../i18n'
import { t, translateKoreanAddress, currentLang } from '../i18n'
import { findCardForCoordinates } from '../utils/mapUtils'
import { getPinGroup, type PinGroup } from '../utils/buildingPin'
import { showToast } from '../lib/toast'
import { confirmDialog } from '../lib/confirm'
import { getLocalDateString } from '../utils/dateUtils'
import { suggestNextUnitNumber } from '../utils/nextUnitNumber'
import { findActivePeriod } from '../utils/specialPeriod'
import { AppHeaderActionButtons } from './AppHeader'
import { MobileBulkUnitSheet } from './MobileBulkUnitSheet'
import { msg } from '../lib/msg'
import { INFORMAL_KINDS, type InformalKind } from '../types'
import { INFORMAL_KIND_STYLE } from '../utils/informalKind'
import { InformalKindIcon } from './InformalKindIcon'
import { placeDeletionCopy } from '../utils/placeDeletion'
import { PlaceChangeRequestDialog } from './PlaceChangeRequestDialog'
import { getNextMobileMapDetailLevel, type MobileMapDetailLevel } from '../utils/mapClustering'
import { getFloatingMenuPosition } from '../utils/floatingMenu'
import { isBareUnitSearch, searchMapData, type MapSearchResult } from '../utils/mapSearch'
import { OverlayPortal } from './OverlayPortal'
import { getCurrentRestaurantAssignmentsForUnit } from '../utils/restaurantAssignments'
import { buildingHasUsage, effectiveUnitUsage, scopeBuildingToUsage, unitsForUsage } from '../utils/unitUsage'

type NavLevel = 'area' | 'region' | 'card' | 'map'
type StrategyFilter = '전체' | '중국인' | '부재' | '만남'
type BuildingTypeFilter = '전체' | Building['type']

function shortenAddress(addr: string): string {
  return addr.replace(/^경기도\s*용인시\s*/, '')
}

/** 종류의 화면 이름. 값(kind)과 라벨을 섞지 않는다 */
function informalKindLabel(kind: InformalKind): string {
  return kind === '비공식구역' ? msg('비공식 구역')
    : kind === '거점' ? msg('거점')
      : msg('대화하기 좋은 장소')
}

function EditIcon({ size = 17 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L8 18l-4 1 1-4Z" />
    </svg>
  )
}

export function MobileMap({
  language,
  translatePlaceNames = false,
  buildings,
  cardBoundaries,
  cards,
  currentVisitor,
  currentUserId,
  actualRole,
  serviceSessions,
  focusedCardId,
  informalAssets = [],
  focusedInformalId,
  onCreateInformalPlace,
  onUpdateInformalPlace,
  focusedCardIds = [],
  focusedBuildingId,
  regularVisitScope = false,
  onOpenLocationSettings,
  onBack,
  onAddUnit,
  onSetBuildingAccess,
  onCreateBuilding,
  onDeleteBuilding,
  onUpdateBuilding,
  onDeleteUnit,
  onToggleRegularVisit,
  onToggleChinese,
  onUndoLatestVisit,
  onUpdateVisitHistory,
  onDeleteVisitHistory,
  onQuickLogVisit,
  onUpdateUnitFlags,
  onToggleInvitationLeft,
  visitHistories,
  specialPeriods,
  allUsers = [],
  onSetUnitsSurveyed,
  onSetRegularVisitor,
  eventRestaurantAssignments = [],
  calendarEvents = [],
}: {
  language: AppLanguage
  translatePlaceNames?: boolean
  buildings: Building[]
  cardBoundaries: CardBoundary[]
  cards: TerritoryCard[]
  currentVisitor: string
  currentUserId?: number | null
  actualRole: Role
  serviceSessions: ServiceSession[]
  focusedCardId?: number | null
  /** 비공식 봉사 장소 — 핀이 찍힌 것만 지도에 뜬다 (docs/비공식-봉사-재설계.md) */
  informalAssets?: InformalAsset[]
  /** 비공식 화면에서 '지도에서 보기' 로 들어왔을 때 그 장소로 옮긴다 */
  focusedInformalId?: number | null
  /**
   * 구역 안의 포인트를 만든다. 최상위 비공식 장소는 비공식 카드 탭에서만
   * 만들고, 여기서 만드는 것은 언제나 지금 보고 있는 구역의 자식이다.
   */
  onCreateInformalPlace?: (input: {
    name: string
    createdBy: string
    lat: number
    lng: number
    memo?: string
    kind?: InformalKind
    parentId?: number | null
  }) => Promise<boolean>
  /** 만든 뒤에 종류·이름을 고친다 */
  onUpdateInformalPlace?: (
    assetId: number,
    input: { name?: string; memo?: string; lat?: number; lng?: number; zoom?: number | null; kind?: InformalKind },
  ) => Promise<boolean>
  focusedCardIds?: number[]
  focusedBuildingId?: number | null
  regularVisitScope?: boolean
  focusedScopeLabel?: string
  onOpenLocationSettings?: () => void
  onBack: () => void
  onAddUnit: (buildingId: number, unitNumber: string | string[], usageType?: Building['type']) => Promise<number[] | false>
  onSetBuildingAccess: (buildingId: number, blocked: boolean, note?: string) => Promise<boolean>
  onCreateBuilding: (input: { cardId: number; name: string; address: string; type: Building['type']; lat: number; lng: number }) => void
  onDeleteBuilding: (buildingId: number) => void
  onUpdateBuilding: (buildingId: number, name: string, address: string, lat?: number, lng?: number, type?: Building['type']) => Promise<boolean>
  onDeleteUnit: (buildingId: number, unitId: number) => void
  onToggleRegularVisit: (buildingId: number, unitId: number, visitorName?: string) => void
  onToggleChinese: (buildingId: number, unitId: number) => void
  onUndoLatestVisit: (buildingId: number, unitId: number) => void
  onUpdateVisitHistory: (historyId: number, unitId: number, input: { result: UnitStatus; timeSlot: TimeSlot; memo: string; visitedAt: string; invitationLeft?: boolean; visitor?: string }) => void | Promise<boolean>
  onDeleteVisitHistory: (historyId: number, unitId: number) => void
  onQuickLogVisit: (buildingId: number, unitId: number, result: UnitStatus) => void
  onUpdateUnitFlags: (unitId: number, flags: Partial<Unit>) => void | Promise<boolean>
  onToggleInvitationLeft?: (buildingId: number, unitId: number, mode?: 'direct' | 'door') => void
  visitHistories: VisitHistory[]
  specialPeriods?: SpecialPeriod[]
  allUsers?: { id: number; name: string; approvalStatus?: 'pending' | 'approved' | 'blocked' }[]
  /** 건물의 '세대를 다 파악함' 표시. 없으면 완료로 안 친다 (utils/buildingPin) */
  onSetUnitsSurveyed?: (buildingId: number, surveyed: boolean) => Promise<boolean> | void
  onSetRegularVisitor?: (unitId: number, visitorName: string, registeredAt?: string) => Promise<void>
  eventRestaurantAssignments?: EventRestaurantAssignment[]
  calendarEvents?: CalendarEvent[]
}) {
  // URL 파라미터 (가상 핀용)
  const [searchParams, setSearchParams] = useSearchParams()
  const focusedUnitId = searchParams.get('unitId') ? Number(searchParams.get('unitId')) : null
  const focusedInformalChildId = searchParams.get('informalChildId') ? Number(searchParams.get('informalChildId')) : null
  const addrParam = searchParams.get('addr')
  const pinLabelParam = searchParams.get('pinLabel') ?? addrParam ?? ''
  const [virtualPinLat, setVirtualPinLat] = useState<number | null>(null)
  const [virtualPinLng, setVirtualPinLng] = useState<number | null>(null)
  const [virtualGeocoding, setVirtualGeocoding] = useState(false)

  // addr 파라미터 있으면 geocoding
  useEffect(() => {
    if (!addrParam) return
    const tryGeocode = () => {
      const naver = (window as any).naver
      if (!naver?.maps?.Service) { setTimeout(tryGeocode, 500); return }
      setVirtualGeocoding(true)
      naver.maps.Service.geocode({ query: addrParam }, (status: any, response: any) => {
        setVirtualGeocoding(false)
        if (status === naver.maps.Service.Status.ERROR) { showToast(t(language, 'map.addressNotFound')); return }
        const result = response?.v2?.addresses?.[0]
        if (result) {
          setVirtualPinLat(parseFloat(result.y))
          setVirtualPinLng(parseFloat(result.x))
        } else {
          showToast(t(language, 'map.addressNotFound'))
        }
      })
    }
    tryGeocode()
  }, [addrParam, language])

  // 내비게이션 상태 머신
  // (구) area → region → card → map 4단계 drill
  // (신) 항상 'map' 으로 시작 + 지역 칩 필터 (drill 폐기)
  //      과거 drill 함수들은 코드 호환 위해 남겨둠 (도달 안 됨)
  const [navLevel, setNavLevel] = useState<NavLevel>('map')
  const initialMapRegion = searchParams.get('region')
  const initialMapDong = searchParams.get('dong')
  const [selectedArea, setSelectedArea] = useState<string | null>(initialMapRegion || null)
  const [selectedRegion, setSelectedRegion] = useState<string | null>(initialMapDong || null)
  const [automaticMapDetail, setAutomaticMapDetail] = useState<MobileMapDetailLevel>('region')
  const [selectedCardId, setSelectedCardId] = useState<number | null>(
    focusedCardId ?? null
  )
  // 진입 시점의 구/동 (뒤로가기 단계 복귀 기준 — 진입보다 깊게 드릴한 것만 단계 복귀)
  const [entrySelectedArea] = useState<string | null>(initialMapRegion || null)
  const [entrySelectedRegion] = useState<string | null>(initialMapDong || null)
  const [showCardFinder, setShowCardFinder] = useState(false)
  const [cardSearch, setCardSearch] = useState('')

  // 필터
  const [strategyFilter] = useState<StrategyFilter>('전체')
  const [statusFilter, setStatusFilter] = useState<PinGroup | '전체'>('전체')
  const [buildingTypeFilter, setBuildingTypeFilter] = useState<BuildingTypeFilter>('전체')

  // 지도/패널 상태
  const [selectedBuildingId, setSelectedBuildingId] = useState<number | null>(focusedBuildingId ?? null)
  const [expandedBuildingIds, setExpandedBuildingIds] = useState<Set<number>>(new Set())
  const [collapsedStatusGroups, setCollapsedStatusGroups] = useState<Set<PinGroup>>(new Set(['완료']))
  const [hiddenMapStatuses, setHiddenMapStatuses] = useState<Set<PinGroup>>(new Set())
  const [fullScreenUnit, setFullScreenUnit] = useState<{ unit: Unit; building: Building; unitHistories: VisitHistory[] } | null>(null)
  // buildings가 fetchAll 후 업데이트될 때 스냅샷이 아닌 최신 unit 사용
  // 비공식 봉사 장소 — PC 와 같은 규칙이다.
  // 기본은 감추고, 비공식 화면에서 '지도에서 보기' 로 들어왔을 때만 보인다.
  // 호별방문 지도에 섞이면 구역이 안 보인다 (docs/비공식-봉사-재설계.md)
  const showInformal = Boolean(focusedInformalId)
  const informalPins = useMemo(
    () => (!showInformal ? [] : informalAssets)
      .filter((a) => typeof a.lat === 'number' && typeof a.lng === 'number')
      .map((a) => ({ id: a.id, name: a.name, kind: a.kind, lat: a.lat as number, lng: a.lng as number })),
    [informalAssets, showInformal],
  )
  /** 추가 중인 비공식 포인트의 종류. null 이면 추가 모드가 아니다 */
  const [addingChildKind, setAddingChildKind] = useState<InformalKind | null>(null)
  const [childDraft, setChildDraft] = useState<
    { lat: number; lng: number; name: string; memo: string; kind: InformalKind } | null
  >(null)
  const [savingChild, setSavingChild] = useState(false)
  const [focusedChildId, setFocusedChildId] = useState<number | null>(focusedInformalChildId)
  const [editInformalDraft, setEditInformalDraft] = useState<
    { id: number; name: string; memo: string } | null
  >(null)
  const [savingInformalEdit, setSavingInformalEdit] = useState(false)

  const selectedInformal = useMemo(
    () => (focusedInformalId ? informalAssets.find((a) => a.id === focusedInformalId) ?? null : null),
    [focusedInformalId, informalAssets],
  )
  // 선택한 장소의 모양만 그린다 — 전부 그리면 감춘 이유가 없어진다
  const informalShape = useMemo(
    () => (selectedInformal ? { boundary: selectedInformal.boundary, route: selectedInformal.route } : null),
    [selectedInformal],
  )


  /** 지금 보고 있는 구역에 속한 점들 */
  const informalChildren = useMemo(
    () => (selectedInformal
      ? informalAssets.filter((a) => a.parentId === selectedInformal.id)
      : []),
    [informalAssets, selectedInformal],
  )
  const informalFocusPoint = useMemo(() => {
    // 목록에서 고른 점이 있으면 그쪽이 우선이다
    const child = focusedChildId
      ? informalChildren.find((item) => item.id === focusedChildId)
      : null
    if (child && typeof child.lat === 'number' && typeof child.lng === 'number') {
      return { lat: child.lat, lng: child.lng, zoom: 18 }
    }
    if (!selectedInformal || typeof selectedInformal.lat !== 'number' || typeof selectedInformal.lng !== 'number') return null
    return { lat: selectedInformal.lat, lng: selectedInformal.lng, zoom: selectedInformal.zoom ?? null }
  }, [focusedChildId, informalChildren, selectedInformal])

  useEffect(() => {
    // 다른 구역으로 옮겨 가면 골라 둔 점은 뜻이 없다
    setFocusedChildId(focusedInformalChildId)
  }, [focusedInformalChildId, focusedInformalId])

  /** 구역 안에 찍은 점의 이름을 정하는 창 */
  const childDraftModal = (childDraft && selectedInformal) ? (
    <div className="mobile-sheet-backdrop" onClick={() => setChildDraft(null)}>
      <div className="mobile-sheet" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <InformalKindIcon kind={childDraft.kind} size={18} />
          <strong style={{ fontSize: 16 }}>
            {msg('{v1} 추가', { v1: informalKindLabel(childDraft.kind) })}
          </strong>
        </div>
        <div className="mobile-form-field">
          <label htmlFor="informal-child-name">{msg('이름')}</label>
          <input
            id="informal-child-name"
            className="cal-input"
            autoFocus
            placeholder={msg('예: 롯데백화점 앞')}
            value={childDraft.name}
            onChange={(e) => setChildDraft({ ...childDraft, name: e.target.value })}
          />
        </div>
        <div className="mobile-form-field" style={{ marginTop: 12 }}>
          <label htmlFor="informal-child-memo">{msg('메모')}</label>
          <textarea
            id="informal-child-memo"
            className="cal-input informal-point-memo-input"
            placeholder={msg('이 장소에서 기억할 내용을 적어 주세요.')}
            value={childDraft.memo}
            onChange={(e) => setChildDraft({ ...childDraft, memo: e.target.value })}
          />
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
          <button
            className="cal-cancel-btn"
            style={{ flex: 1 }}
            onClick={() => setChildDraft(null)}
            type="button"
          >
            {msg('취소')}
          </button>
          <button
            className="cal-save-btn"
            style={{ flex: 1 }}
            disabled={savingChild || !childDraft.name.trim()}
            onClick={async () => {
              if (!onCreateInformalPlace) return
              setSavingChild(true)
              try {
                const ok = await onCreateInformalPlace({
                  name: childDraft.name,
                  createdBy: currentVisitor,
                  lat: childDraft.lat,
                  lng: childDraft.lng,
                  kind: childDraft.kind,
                  memo: childDraft.memo.trim(),
                  // ⚠ 언제나 지금 보고 있는 구역의 자식이다
                  parentId: selectedInformal.id,
                })
                if (ok) setChildDraft(null)
              } finally {
                setSavingChild(false)
              }
            }}
            type="button"
          >
            {savingChild ? msg('저장 중…') : msg('저장')}
          </button>
        </div>
      </div>
    </div>
  ) : null

  const editInformalModal = editInformalDraft ? (
    <div className="mobile-sheet-backdrop" onClick={() => setEditInformalDraft(null)}>
      <div className="mobile-sheet" onClick={(event) => event.stopPropagation()}>
        <div className="mobile-sheet-title">
          <h2>{msg('장소 수정')}</h2>
          <button className="mobile-sheet-close" type="button" aria-label={msg('닫기')} onClick={() => setEditInformalDraft(null)}>×</button>
        </div>
        <div className="mobile-form-field">
          <label htmlFor="informal-edit-name">{msg('이름')}</label>
          <input
            id="informal-edit-name"
            className="cal-input"
            value={editInformalDraft.name}
            onChange={(event) => setEditInformalDraft({ ...editInformalDraft, name: event.target.value })}
          />
        </div>
        <div className="mobile-form-field" style={{ marginTop: 12 }}>
          <label htmlFor="informal-edit-memo">{msg('메모')}</label>
          <textarea
            id="informal-edit-memo"
            className="cal-input informal-point-memo-input"
            placeholder={msg('이 장소에서 기억할 내용을 적어 주세요.')}
            value={editInformalDraft.memo}
            onChange={(event) => setEditInformalDraft({ ...editInformalDraft, memo: event.target.value })}
          />
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <button className="cal-cancel-btn" style={{ flex: 1 }} type="button" onClick={() => setEditInformalDraft(null)}>{msg('취소')}</button>
          <button
            className="cal-save-btn"
            style={{ flex: 1 }}
            type="button"
            disabled={savingInformalEdit || !editInformalDraft.name.trim()}
            onClick={async () => {
              if (!onUpdateInformalPlace) return
              setSavingInformalEdit(true)
              try {
                const ok = await onUpdateInformalPlace(editInformalDraft.id, {
                  name: editInformalDraft.name.trim(),
                  memo: editInformalDraft.memo.trim(),
                })
                if (ok) setEditInformalDraft(null)
              } finally {
                setSavingInformalEdit(false)
              }
            }}
          >
            {savingInformalEdit ? msg('저장 중…') : msg('저장')}
          </button>
        </div>
      </div>
    </div>
  ) : null

  const liveFullScreenUnit = useMemo(() => {
    if (!fullScreenUnit) return null
    const b = buildings.find(b => b.id === fullScreenUnit.building.id)
    const u = b?.units.find(u => u.id === fullScreenUnit.unit.id)
    // visitHistoriesByUnitId 는 아직 계산되기 전이므로 visitHistories prop에서 직접 필터
    const liveHistories = visitHistories
      .filter(h => h.unitId === fullScreenUnit.unit.id)
      .sort((a, b) => b.visitedAt.localeCompare(a.visitedAt))
    return { unit: u ?? fullScreenUnit.unit, building: b ?? fullScreenUnit.building, unitHistories: liveHistories }
  }, [buildings, visitHistories, fullScreenUnit])
  const [editingHistoryId, setEditingHistoryId] = useState<number | null>(null)
  const [historyToEdit, setHistoryToEdit] = useState<VisitHistory | null>(null)
  const [showUnitHeaderMenu, setShowUnitHeaderMenu] = useState(false)
  const [editingUnitNumber, setEditingUnitNumber] = useState(false)
  const [unitNumberDraft, setUnitNumberDraft] = useState('')

  // 특정 날짜에 활성화된 특별봉사 시즌 (없으면 null)
  const getActivePeriodForDate = (dateStr: string): SpecialPeriod | null =>
    findActivePeriod(specialPeriods, dateStr)
  const [unitMemos, setUnitMemos] = useState<Record<number, string>>({})
  const [_absentTimestamps, _setAbsentTimestamps] = useState<Record<number, number>>({})
  // 미리 채워두면 매번 지우고 다시 쳐야 한다 — 비워두고 추천 번호는 placeholder 로만 보여준다
  const [newUnitNumber, setNewUnitNumber] = useState('')
  const [newUnitUsageType, setNewUnitUsageType] = useState<Building['type']>('주택')
  const [addingUnitToBuildingId, setAddingUnitToBuildingId] = useState<number | null>(null)
  const [bulkUnitBuildingId, setBulkUnitBuildingId] = useState<number | null>(null)

  // 건물 수정
  const [editingBuildingId, setEditingBuildingId] = useState<number | null>(null)
  const [editBuildingType, setEditBuildingType] = useState<Building['type']>('주택')
  const [buildingMenuId, setBuildingMenuId] = useState<number | null>(null)
  const [buildingMenuPosition, setBuildingMenuPosition] = useState<{
    right: number
    top?: number
    bottom?: number
  } | null>(null)

  const closeBuildingMenu = () => {
    setBuildingMenuId(null)
    setBuildingMenuPosition(null)
  }

  const toggleBuildingMenu = (buildingId: number, button: HTMLButtonElement) => {
    if (buildingMenuId === buildingId) {
      closeBuildingMenu()
      return
    }
    const rect = button.getBoundingClientRect()
    setBuildingMenuPosition(getFloatingMenuPosition(
      rect,
      { width: window.innerWidth, height: window.innerHeight },
      190,
    ))
    setBuildingMenuId(buildingId)
  }
  const [placeRequestTarget, setPlaceRequestTarget] = useState<{ building: Building; unit?: Unit } | null>(null)
  const [editName, setEditName] = useState('')
  const [editAddress, setEditAddress] = useState('')
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

  // 건물 추가 모달
  const backdropTouched = useRef(false)
  const addingGuard = useRef(false)
  const [showAddModal, setShowAddModal] = useState(false)
  const [addLat, setAddLat] = useState<number | null>(null)
  const [addLng, setAddLng] = useState<number | null>(null)
  const [addName, setAddName] = useState('')
  const [addAddress, setAddAddress] = useState('')
  const [addType, setAddType] = useState<Building['type']>('주택')
  const [addCardId, setAddCardId] = useState(cards[0]?.id ?? 1)
  const [geocoding, setGeocoding] = useState(false)
  const [addingBuildingMode, setAddingBuildingMode] = useState(false)
  const [showMapActionMenu, setShowMapActionMenu] = useState(false)
  const [editingPinMode, setEditingPinMode] = useState(false)
  const [drawingBoundaryMode, setDrawingBoundaryMode] = useState(false)
  const [invitationPopupUnitId, setInvitationPopupUnitId] = useState<number | null>(null)
  const placeLabel = useCallback((value: string) => translateKoreanAddress(value, language, translatePlaceNames), [language, translatePlaceNames])
  const today = getLocalDateString()
  const activePeriod = getActivePeriodForDate(today)
  const activeInvitation = activePeriod?.hasInvitation === true
  const activeServiceSession = serviceSessions.find((session) =>
    session.userName === currentVisitor &&
    session.serviceDate === today &&
    session.status === 'active' &&
    !session.endedAt
  )
  const todayRecordableSession = serviceSessions.find((session) =>
    session.userName === currentVisitor &&
    session.serviceDate === today &&
    (session.status === 'active' || session.status === 'ended')
  )
  const activeSessionCard = activeServiceSession?.primaryCardId
    ? cards.find((card) => card.id === activeServiceSession.primaryCardId)
    : undefined
  const isUserMap = actualRole === 'user'

  // 방문자를 고칠 수 있는 사람: 관리자·개발자·인도자.
  // 봉사를 마치고 한 사람이 몰아서 입력하면 **실제로 간 형제가 아니라 입력한
  // 사람 이름**으로 남아 통계가 어긋난다. 수정할 때 고칠 수 있게 한다.
  // ⚠ 일반 사용자에게는 칸 자체를 안 보여준다 — 자기 기록만 적는 사람에게
  //   남의 이름을 고를 수단을 주면 실수로 엉뚱하게 남는다.
  const canEditVisitorHere = canEditVisitor(actualRole)
  const visitorNameOptions = visitorOptionsFrom(allUsers)
  // territory 화면의 [지도] 버튼으로 진입 → focusedCardId 가 있음
  // 이 카드는 이미 userVisibleMapCardIds 로 본인 배정 카드만 통과했으므로
  // 봉사 시작 없이도 즉시 기록 가능
  const isUserDirectAssignment = isUserMap && (focusedCardId != null || focusedCardIds.length > 0)
  const canRecordVisits =
    actualRole !== 'user' || !!todayRecordableSession || isUserDirectAssignment
  const isViewingActiveCard = !!activeSessionCard && selectedCardId === activeSessionCard.id
  const mapSearchResults = useMemo(() => searchMapData({
    query: cardSearch,
    cards,
    buildings,
    informalAssets,
  }), [buildings, cardSearch, cards, informalAssets])
  const bareUnitSearch = isBareUnitSearch(cardSearch)

  const requireRecordAccess = () => {
    if (canRecordVisits) return true
    showToast(t(language, 'map.viewOnlyDesc'), 'info')
    return false
  }
 
  // 바텀 시트 드래그 및 토글 상태
  const MIN_HEIGHT = 65
  const HALF_HEIGHT = window.innerHeight * 0.46
  const FULL_HEIGHT = window.innerHeight * 0.92
  const UNIT_NAV_HEIGHT = Math.max(210, Math.min(280, window.innerHeight * 0.3))
  const SHEET_TRANSITION_MS = 350
 
  // cardIds 로 진입한 경우(드릴 컨텍스트 지도) 는 바텀 시트 최소화로 시작 — 경계선 전체 보기
  const enteredWithFocusedCardIds = focusedCardIds.length > 0
  const [sheetHeight, setSheetHeight] = useState(enteredWithFocusedCardIds ? MIN_HEIGHT : HALF_HEIGHT)
  const sheetHeightBeforeUnitRef = useRef<number | null>(null)
  const sheetHeightBeforeMemoRef = useRef<number | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const dragStartY = useRef<number>(0)
  const dragStartHeight = useRef<number>(0)
  const dragMoved = useRef(false)
  const lastSheetTapAt = useRef(0)
  const buildingScrollTimerRef = useRef<number | null>(null)

  const scrollBuildingAfterSheetTransition = (buildingId: number) => {
    if (buildingScrollTimerRef.current !== null) {
      window.clearTimeout(buildingScrollTimerRef.current)
    }
    buildingScrollTimerRef.current = window.setTimeout(() => {
      buildingScrollTimerRef.current = null
      document.getElementById(`building-card-${buildingId}`)?.scrollIntoView({
        behavior: 'auto',
        block: 'center',
      })
    }, SHEET_TRANSITION_MS + 30)
  }

  const closeUnitDetail = () => {
    setFullScreenUnit(null)
    sheetHeightBeforeMemoRef.current = null
    if (sheetHeightBeforeUnitRef.current !== null) {
      setSheetHeight(sheetHeightBeforeUnitRef.current)
      sheetHeightBeforeUnitRef.current = null
    }
  }

  const showUnitDetail = (unit: Unit, building: Building, unitHistories: VisitHistory[]) => {
    if (sheetHeightBeforeUnitRef.current === null) {
      sheetHeightBeforeUnitRef.current = sheetHeight
    }
    sheetHeightBeforeMemoRef.current = null
    setFullScreenUnit({ unit, building, unitHistories })
    // 상세와 호수 목록이 서로 덮지 않도록 목록은 3~4줄이 보이는 탐색 높이로 둔다.
    setSheetHeight(UNIT_NAV_HEIGHT)
    moveMobileMapToBuilding(building)
    window.setTimeout(() => {
      const row = document.querySelector<HTMLElement>(`[data-unit-id="${unit.id}"]`)
      if (typeof row?.scrollIntoView === 'function') {
        row.scrollIntoView({ block: 'center', behavior: 'smooth' })
      }
    }, 380)
  }

  const openUnitDetail = (unit: Unit, building: Building, unitHistories: VisitHistory[]) => {
    if (fullScreenUnit?.unit.id === unit.id) {
      closeUnitDetail()
      return
    }
    showUnitDetail(unit, building, unitHistories)
  }

  const handleUnitMemoEditingChange = (editing: boolean) => {
    if (editing) {
      if (sheetHeightBeforeMemoRef.current === null) sheetHeightBeforeMemoRef.current = sheetHeight
      setSheetHeight(MIN_HEIGHT)
      return
    }
    setSheetHeight(sheetHeightBeforeMemoRef.current ?? UNIT_NAV_HEIGHT)
    sheetHeightBeforeMemoRef.current = null
  }

  useEffect(() => {
    if (!fullScreenUnit) sheetHeightBeforeUnitRef.current = null
  }, [fullScreenUnit])

  useEffect(() => {
    document.body.classList.add('mobile-map-scroll-lock')
    return () => {
      document.body.classList.remove('mobile-map-scroll-lock')
      if (buildingScrollTimerRef.current !== null) {
        window.clearTimeout(buildingScrollTimerRef.current)
      }
    }
  }, [])
 
  const startSheetDrag = (clientY: number) => {
    setIsDragging(true)
    dragMoved.current = false
    dragStartY.current = clientY
    dragStartHeight.current = sheetHeight
  }

  const moveSheetDrag = (clientY: number) => {
    if (!isDragging) return
    const deltaY = dragStartY.current - clientY
    if (Math.abs(deltaY) > 10) dragMoved.current = true  // 10px 이상 움직여야 드래그로 인정
    const newHeight = Math.max(MIN_HEIGHT, Math.min(FULL_HEIGHT, dragStartHeight.current + deltaY))
    setSheetHeight(newHeight)
  }

  const handlePointerStart = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    startSheetDrag(e.clientY)
  }

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging) return
    e.preventDefault()
    moveSheetDrag(e.clientY)
  }

  const handlePointerEnd = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
    setIsDragging(false)
  }

  const toggleSheetSnap = () => {
    setSheetHeight((height) => (height > MIN_HEIGHT + 40 ? MIN_HEIGHT : HALF_HEIGHT))
  }

  const handleSheetHandleClick = () => {
    if (dragMoved.current) {
      dragMoved.current = false
      return
    }
    const now = Date.now()
    const elapsed = now - lastSheetTapAt.current
    if (elapsed < 400 && elapsed > 50) {  // 50~400ms 사이 두 번 탭 = 더블탭
      toggleSheetSnap()
      lastSheetTapAt.current = 0
    } else {
      lastSheetTapAt.current = now
    }
  }

  // 카드(구역) 선택 변경 시 바텀 시트 자동 최소화
  useEffect(() => {
    setSheetHeight(MIN_HEIGHT)
  }, [selectedCardId])

  useEffect(() => {
    if (focusedBuildingId == null) return
    const building = buildings.find((item) => item.id === focusedBuildingId)
    if (!building) return
    setSelectedBuildingId(focusedBuildingId)
    setExpandedBuildingIds(new Set([focusedBuildingId]))
    const focusedUnit = focusedUnitId == null ? null : building.units.find((unit) => unit.id === focusedUnitId)
    setFullScreenUnit(focusedUnit ? {
      unit: focusedUnit,
      building,
      unitHistories: visitHistories.filter((history) => history.unitId === focusedUnit.id),
    } : null)
    setSheetHeight((height) => Math.max(height, HALF_HEIGHT))
    setCollapsedStatusGroups((prev) => {
      const next = new Set(prev)
      next.delete(getPinGroup(building))
      return next
    })
    moveMobileMapToBuilding(building)
    // 시트 높이 애니메이션과 목록 스크롤을 동시에 돌리면 긴 목록에서 프레임이 끊긴다.
    scrollBuildingAfterSheetTransition(focusedBuildingId)
  // moveMobileMapToBuilding intentionally reads the current map instance.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buildings, focusedBuildingId, focusedUnitId, visitHistories])

  useEffect(() => {
    if (!isUserMap || focusedCardId != null || !activeServiceSession?.primaryCardId) return
    setNavLevel('map')
    setSelectedCardId(activeServiceSession.primaryCardId)
  }, [activeServiceSession?.primaryCardId, focusedCardId, isUserMap])

  // focusedCardId/배정 화면에서 직접 진입했는지 여부 (뒤로가기 시 외부 네비게이션으로 돌아가기 위함)
  const enteredFromAssignment = searchParams.get('return') === 'assignment'
  const enteredDirectly = focusedCardId != null || focusedCardIds.length > 0 || enteredFromAssignment

  // 뒤로가기 로직
  function handleBack() {
    // area/region/card 드릴 단계는 디자인 v2 이후 /zone 으로 통합돼 사용 안 함.
    // 안전을 위해 단계별 복귀 로직은 유지하되 최상위에서는 이전 페이지로.
    if (navLevel === 'area') { onBack(); return }
    if (navLevel === 'region') { setNavLevel('area'); setSelectedArea(null); return }
    if (navLevel === 'card') { setNavLevel('region'); setSelectedRegion(null); return }
    // 지도 레벨: 지도 안에서 드릴한 단계(구→동→카드)를 한 단계씩 복귀.
    // 진입 단계에 도달하면 이전 페이지(목록)로 나감.
    if (navLevel === 'map') {
      // 단일 카드(나의봉사) / 배정 진입만 바로 이탈. 지역 범위 진입(focusedCardIds)은 드릴 복귀 허용.
      if (focusedCardId != null || enteredFromAssignment) { onBack(); return }
      if (selectedCardId != null) {              // 카드 선택 → 카드 해제(이전 동 화면)
        setSelectedCardId(null)
        setSelectedBuildingId(null)
        setFullScreenUnit(null)
        return
      }
      if (selectedRegion && selectedRegion !== entrySelectedRegion) { setSelectedRegion(null); return }  // 동 → 구 묶음
      if (selectedArea && selectedArea !== entrySelectedArea) { setSelectedArea(null); return }          // 구 → 전체
      onBack()
      return
    }
  }

  // B안: 데이터에서 region=대권역(구), area=동
  // Level 1: 대권역 선택 (region 필드 사용)
  const areas = useMemo(() =>
    [...new Set(cards.map(c => c.region))].sort(),
    [cards]
  )
  const areaCardCount = (region: string) => cards.filter(c => c.region === region).length

  // Level 2: 동 선택 (area 필드 사용)
  const regions = useMemo(() =>
    [...new Set(cards.filter(c => c.region === selectedArea).map(c => c.area))].sort(),
    [cards, selectedArea]
  )
  const regionCardCount = (area: string) =>
    cards.filter(c => c.region === selectedArea && c.area === area).length

  // Level 3: 카드 선택
  const regionCards = useMemo(() =>
    cards.filter(c => c.region === selectedArea && c.area === selectedRegion),
    [cards, selectedArea, selectedRegion]
  )

  const focusedCardIdSet = useMemo(
    () => new Set(focusedCardIds.filter((id) => Number.isFinite(id))),
    [focusedCardIds],
  )

  const scopedCards = useMemo(() =>
    cards.filter((card) => {
      if (focusedCardIdSet.size > 0 && selectedCardId == null && !focusedCardIdSet.has(card.id)) return false
      if (selectedArea && card.region !== selectedArea) return false
      if (selectedRegion && card.area !== selectedRegion) return false
      return true
    }),
    [cards, focusedCardIdSet, selectedArea, selectedCardId, selectedRegion]
  )

  const scopedCardIds = useMemo(
    () => new Set(scopedCards.map((card) => card.id)),
    [scopedCards]
  )

  const cardMap = useMemo(() => new Map(cards.map(c => [c.id, c])), [cards])
  const visitHistoriesByUnitId = useMemo(() => {
    const map = new Map<number, VisitHistory[]>()
    visitHistories.forEach((history) => {
      const list = map.get(history.unitId)
      if (list) list.push(history)
      else map.set(history.unitId, [history])
    })
    return map
  }, [visitHistories])
  const cardBuildingTypeCounts = useMemo(() => {
    const map = new Map<number, { total: number; house: number; shop: number }>()
    cards.forEach((card) => map.set(card.id, { total: 0, house: 0, shop: 0 }))
    buildings.forEach((building) => {
      const current = map.get(building.cardId) ?? { total: 0, house: 0, shop: 0 }
      current.total += unitsForUsage(building, '전체').length
      current.house += unitsForUsage(building, '주택').length
      current.shop += unitsForUsage(building, '상가').length
      map.set(building.cardId, current)
    })
    return map
  }, [buildings, cards])

  const unitMatchesStrategyFilter = (unit: Building['units'][number]) => {
    if (strategyFilter === '전체') return true
    if (strategyFilter === '중국인') return unit.isChinese
    if (strategyFilter === '부재') return unit.status === '부재'
    if (strategyFilter === '만남') return unit.status === '만남'
    return true
  }

  const geographicallyFilteredBuildings = useMemo(() =>
    buildings.filter((b) => {
      if (selectedCardId != null && b.cardId !== selectedCardId) return false
      if (selectedCardId == null && focusedCardIdSet.size > 0 && !focusedCardIdSet.has(b.cardId)) return false
      if (selectedCardId == null && (selectedArea || selectedRegion) && !scopedCardIds.has(b.cardId)) return false
      if (b.units.length > 0 && !b.units.some(unitMatchesStrategyFilter)) return false
      return true
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 필터 함수는 이미 포함된 필터 state만 참조함
    [buildings, selectedCardId, focusedCardIdSet, selectedArea, selectedRegion, scopedCardIds, strategyFilter]
  )

  const typeCounts = useMemo(() => ({
    전체: geographicallyFilteredBuildings.reduce((sum, building) => sum + unitsForUsage(building, '전체').length, 0),
    주택: geographicallyFilteredBuildings.reduce((sum, building) => sum + unitsForUsage(building, '주택').length, 0),
    상가: geographicallyFilteredBuildings.reduce((sum, building) => sum + unitsForUsage(building, '상가').length, 0),
  }), [geographicallyFilteredBuildings])

  const filteredBuildings = useMemo(() =>
    geographicallyFilteredBuildings
      .filter((building) => buildingHasUsage(building, buildingTypeFilter))
      .map((building) => scopeBuildingToUsage(building, buildingTypeFilter))
      .filter((building) => statusFilter === '전체' || getPinGroup(building) === statusFilter),
    [geographicallyFilteredBuildings, buildingTypeFilter, statusFilter]
  )

  const statusCounts = useMemo(() =>
    filteredBuildings.reduce<Record<PinGroup, number>>(
      (acc, b) => { const s = getPinGroup(b); acc[s] += 1; return acc },
      { 방문필요: 0, 확인필요: 0, 완료: 0, 방문금지: 0, 정기방문: 0 }
    ), [filteredBuildings])

  const mapBuildings = useMemo(
    () => filteredBuildings.filter((building) => !hiddenMapStatuses.has(getPinGroup(building))),
    [filteredBuildings, hiddenMapStatuses],
  )

  const mapDetailLevel: MobileMapDetailLevel = selectedRegion
    ? 'building'
    : selectedArea
      ? automaticMapDetail === 'building' ? 'building' : 'area'
      : automaticMapDetail

  const shouldUseAggregateMap =
    !isUserMap &&
    navLevel === 'map' &&
    !regularVisitScope &&
    mapDetailLevel !== 'building' &&
    selectedCardId == null &&
    (focusedCardIdSet.size === 0 || !!selectedArea) &&
    !addingBuildingMode &&
    !editingPinMode &&
    !drawingBoundaryMode

  const mapAggregateMarkers = useMemo<MapAggregateMarker[]>(() => {
    if (!shouldUseAggregateMap) return []
    const groups = new Map<string, MapAggregateMarker & { latSum: number; lngSum: number; pointCount: number }>()
    mapBuildings.forEach((building) => {
      const card = cardMap.get(building.cardId)
      if (!card) return
      const rawLabel = mapDetailLevel === 'area' ? card.area : String(card.region)
      if (!rawLabel) return
      const id = mapDetailLevel === 'area'
        ? `area:${card.region}:${rawLabel}`
        : `region:${rawLabel}`
      const current = groups.get(id) ?? {
        id,
        label: placeLabel(rawLabel),
        count: 0,
        unitCount: 0,
        houseCount: 0,
        shopCount: 0,
        lat: 0,
        lng: 0,
        latSum: 0,
        lngSum: 0,
        pointCount: 0,
      }
      current.count += 1
      current.unitCount += unitsForUsage(building, '전체').length
      current.houseCount += unitsForUsage(building, '주택').length
      current.shopCount += unitsForUsage(building, '상가').length
      if (Number.isFinite(building.lat) && Number.isFinite(building.lng)) {
        current.latSum += building.lat
        current.lngSum += building.lng
        current.pointCount += 1
      }
      groups.set(id, current)
    })
    return Array.from(groups.values())
      .filter((group) => group.pointCount > 0)
      .map((group) => ({
        id: group.id,
        label: group.label,
        count: group.count,
        unitCount: group.unitCount,
        houseCount: group.houseCount,
        shopCount: group.shopCount,
        lat: group.latSum / group.pointCount,
        lng: group.lngSum / group.pointCount,
      }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'ko'))
  }, [cardMap, mapBuildings, mapDetailLevel, shouldUseAggregateMap, placeLabel])

  const aggregateScopeLabel = mapDetailLevel === 'area' ? msg('동') : msg('구')

  const handleSelectAggregateMarker = (id: string) => {
    const [kind, first, second] = id.split(':')
    setSelectedBuildingId(null)
    setExpandedBuildingIds(new Set())
    setFullScreenUnit(null)
    if (kind === 'region') {
      setSelectedArea(first)
      setSelectedRegion(null)
      setSelectedCardId(null)
      setNavLevel('map')
      return
    }
    if (kind === 'area') {
      setSelectedArea(first)
      setSelectedRegion(second)
      setSelectedCardId(null)
      setNavLevel('map')
    }
  }

  const buildingGroups = useMemo(() => {
    if (shouldUseAggregateMap) return []
    // 목록 순서: 가야 할 것부터. '확인 필요' 는 방문필요 바로 다음이다 —
    // 가 볼 가치가 있는 곳이지 끝난 곳이 아니다.
    const order: PinGroup[] = ['방문금지', '방문필요', '확인필요', '정기방문', '완료']
    const grouped = new Map<PinGroup, Building[]>()
    order.forEach((status) => grouped.set(status, []))
    filteredBuildings.forEach((building) => {
      grouped.get(getPinGroup(building))?.push(building)
    })
    return order.map((status) => ({
      status,
      buildings: grouped.get(status) ?? [],
    }))
  }, [filteredBuildings, shouldUseAggregateMap])

  const unitTotal = useMemo(() => filteredBuildings.reduce((t, b) => t + b.units.length, 0), [filteredBuildings])
  const visitedTotal = useMemo(() => filteredBuildings.reduce((t, b) => t + b.units.filter(u => u.status !== '미방문').length, 0), [filteredBuildings])
  const completionRate = unitTotal === 0 ? 0 : Math.round((visitedTotal / unitTotal) * 100)

  useEffect(() => {
    if (selectedBuildingId == null) return
    if (filteredBuildings.some((building) => building.id === selectedBuildingId)) return
    setSelectedBuildingId(null)
    setExpandedBuildingIds(new Set())
    setFullScreenUnit(null)
  }, [filteredBuildings, selectedBuildingId])

  const toggleStatusGroup = (status: PinGroup) => {
    setCollapsedStatusGroups((prev) => {
      const next = new Set(prev)
      if (next.has(status)) next.delete(status)
      else next.add(status)
      return next
    })
  }

  const toggleStatusFromMap = (status: PinGroup) => {
    const nextHidden = !hiddenMapStatuses.has(status)
    setHiddenMapStatuses((prev) => {
      const next = new Set(prev)
      if (nextHidden) next.add(status)
      else next.delete(status)
      return next
    })
    setCollapsedStatusGroups((prev) => {
      const next = new Set(prev)
      if (nextHidden) next.add(status)
      else next.delete(status)
      return next
    })
  }

  const mapBoundaries = useMemo(() =>
    selectedCardId != null
      ? cardBoundaries.filter(cb => cb.cardId === selectedCardId)
      : focusedCardIdSet.size > 0 && !selectedArea && !selectedRegion
        ? cardBoundaries.filter(cb => focusedCardIdSet.has(cb.cardId))
      : (selectedArea || selectedRegion)
        ? cardBoundaries.filter(cb => scopedCardIds.has(cb.cardId))
        : cardBoundaries,
    [selectedCardId, focusedCardIdSet, selectedArea, selectedRegion, cardBoundaries, scopedCardIds])

  const drillBreadcrumb = navLevel === 'region'
    ? selectedArea ? placeLabel(selectedArea) : selectedArea
    : navLevel === 'card'
      ? [selectedArea, selectedRegion].filter((part): part is string => Boolean(part)).map((part) => placeLabel(part)).join(' › ')
      : ''
  const drillTitle =
    navLevel === 'area' ? t(language, 'map.areaSelect')
      : navLevel === 'region' ? t(language, 'map.dongSelect')
        : navLevel === 'card' ? t(language, 'map.cardSelect')
          : ''
  const showScopeAllButton = !isUserMap && (navLevel === 'area' || navLevel === 'region' || navLevel === 'card')
  const mapSelectedCardId = selectedCardId ?? '전체'

  function openCurrentScopeMap() {
    if (navLevel === 'area') {
      setSelectedArea(null)
      setSelectedRegion(null)
    }
    setSelectedCardId(null)
    setNavLevel('map')
  }

  const closeAddModal = () => {
    setShowAddModal(false)
    setAddLat(null)
    setAddLng(null)
    backdropTouched.current = false
    addingGuard.current = false
  }

  // 건물 추가 로직 (아이콘 모드 또는 꾹 누르기 통합)
  const handleAddBuildingAt = (lat: number, lng: number) => {
    if (addingGuard.current) return
    addingGuard.current = true

    setExpandedBuildingIds(new Set())
    setAddLat(lat); setAddLng(lng); setAddName(t(language, 'map.addBuilding')); setAddAddress(''); setAddType('주택')
    const matched = findCardForCoordinates(lat, lng, cardBoundaries)
    setAddCardId(matched ?? selectedCardId ?? cards[0]?.id ?? 1)

    // 역지오코딩으로 주소/건물명만 자동 입력 (좌표는 탭 위치 그대로 유지)
    const naver = (window as any).naver
    if (naver?.maps?.Service) {
      setGeocoding(true)
      naver.maps.Service.reverseGeocode(
        { coords: new naver.maps.LatLng(lat, lng), orders: [naver.maps.Service.OrderType.ADDR, naver.maps.Service.OrderType.ROAD_ADDR].join(',') },
        (status: any, response: any) => {
          setGeocoding(false)
          if (status === naver.maps.Service.Status.OK) {
            const r = response.v2?.results?.find((x: any) => x.name === 'roadaddr') ?? response.v2?.results?.[0]
            if (r?.region) {
              const parts = [
                r.region.area1?.name, r.region.area2?.name, r.region.area3?.name,
                r.land?.name ?? null,
                r.land?.number1 ? r.land.number1 + (r.land?.number2 ? `-${r.land.number2}` : '') : null,
              ].filter(Boolean)
              if (parts.length) setAddAddress(parts.join(' '))

              const rawName = r.land?.addition0?.value || r.land?.addition1?.value
              const buildingName = rawName && !/^\d+$/.test(rawName) ? rawName : null
              if (buildingName) {
                setAddName(buildingName)
              } else {
                const landParts = [r.land?.name, r.land?.number1 ? r.land.number1 + (r.land?.number2 ? `-${r.land.number2}` : '') : null].filter(Boolean)
                if (landParts.length) setAddName(landParts.join(' '))
              }
            }
          }
        },
      )
    }

    backdropTouched.current = false
    setShowAddModal(true)
    setAddingBuildingMode(false)
  }

  const handleConfirmAdd = () => {
    if (!addName.trim() || addLat == null || addLng == null) return
    onCreateBuilding({ cardId: addCardId, name: addName.trim(), address: addAddress.trim(), type: addType, lat: addLat, lng: addLng })
    closeAddModal()
    showToast(t(language, 'map.buildingAdded'), 'success')
  }

  const openAddBuildingMode = () => {
    setShowMapActionMenu(false)
    setEditingPinMode(false)
    setAddingBuildingMode(true)
    setSheetHeight(MIN_HEIGHT)
    showToast(t(language, 'map.tapToAddBuilding'), 'info')
  }

  const toggleEditPinMode = () => {
    const next = !editingPinMode
    setShowMapActionMenu(false)
    setAddingBuildingMode(false)
    setEditingPinMode(next)
    setSheetHeight(MIN_HEIGHT)
    showToast(next ? t(language, 'map.pinEditStart') : t(language, 'map.pinEditEnd'), 'info')
  }

  const editingBuilding = editingBuildingId != null ? buildings.find(b => b.id === editingBuildingId) ?? null : null
  const buildingTypeLabel = (type: Building['type']) => type === '상가' ? t(language, 'map.shop') : t(language, 'map.house')
  const canChangeBuildingType = actualRole === 'leader' || actualRole === 'admin' || actualRole === 'developer'

  const saveBuildingEdit = async (building: Building) => {
    if (canChangeBuildingType && editBuildingType !== building.type) {
      const inherited = building.units.filter((unit) =>
        unit.usageType == null && !unit.isRestaurant && unit.number.trim() !== '출입불가'
      ).length
      const ok = await confirmDialog({
        message: msg('건물 유형을 바꾸면 기본 용도를 따르는 세대 {count}개도 함께 바뀝니다. 변경할까요?', { count: inherited }),
        confirmLabel: msg('변경'),
      })
      if (!ok) return
    }
    const saved = await onUpdateBuilding(
      building.id,
      editName.trim(),
      editAddress.trim(),
      undefined,
      undefined,
      canChangeBuildingType ? editBuildingType : undefined,
    )
    if (saved) setEditingBuildingId(null)
  }

  const moveMobileMapToBuilding = (building: Building) => {
    const naver = (window as any).naver
    const map = (window as any).__mobileMapInstance
    const lat = Number(building.lat)
    const lng = Number(building.lng)
    if (!naver?.maps || !map || !Number.isFinite(lat) || !Number.isFinite(lng)) return
    const latLng = new naver.maps.LatLng(lat, lng)
    if (map.getZoom() >= 16) {
      map.panTo(latLng)
    } else {
      map.morph(latLng, 17)
    }
  }

  const selectMapSearchResult = (result: MapSearchResult) => {
    setShowCardFinder(false)
    setCardSearch('')

    if (result.kind === 'informal' && result.informalId != null) {
      const next = new URLSearchParams()
      const returnTarget = searchParams.get('return')
      if (returnTarget) next.set('return', returnTarget)
      next.set('informalId', String(result.informalId))
      if (result.informalChildId != null) next.set('informalChildId', String(result.informalChildId))
      setSearchParams(next)
      return
    }

    const building = result.buildingId == null
      ? null
      : buildings.find((item) => item.id === result.buildingId) ?? null
    const card = cards.find((item) => item.id === (result.cardId ?? building?.cardId)) ?? null
    if (!card) return

    // 검색 결과는 현재 지역·상태 필터 밖에 있어도 보여야 한다.
    const next = new URLSearchParams()
    const returnTarget = searchParams.get('return')
    if (returnTarget) next.set('return', returnTarget)
    setSearchParams(next, { replace: true })
    setSelectedArea(null)
    setSelectedRegion(null)
    setStatusFilter('전체')
    setBuildingTypeFilter('전체')
    setSelectedCardId(card.id)

    if (!building) {
      setSelectedBuildingId(null)
      setExpandedBuildingIds(new Set())
      setFullScreenUnit(null)
      setSheetHeight(MIN_HEIGHT)
      return
    }

    // 카드 fit 효과가 먼저 끝난 다음 건물로 이동해야 구역 전체로 되돌아가지 않는다.
    window.setTimeout(() => {
      setSelectedBuildingId(building.id)
      setExpandedBuildingIds(new Set([building.id]))
      setCollapsedStatusGroups((previous) => {
        const next = new Set(previous)
        next.delete(getPinGroup(building))
        return next
      })
      setHiddenMapStatuses((previous) => {
        const next = new Set(previous)
        next.delete(getPinGroup(building))
        return next
      })

      const unit = result.unitId == null
        ? null
        : building.units.find((item) => item.id === result.unitId) ?? null
      if (unit) {
        showUnitDetail(unit, building, visitHistoriesByUnitId.get(unit.id) ?? [])
      } else {
        setFullScreenUnit(null)
        setSheetHeight(HALF_HEIGHT)
        moveMobileMapToBuilding(building)
        scrollBuildingAfterSheetTransition(building.id)
      }
    }, 80)
  }
  const hasAreaChips = !isUserMap && !enteredDirectly && areas.length > 1
  return (
    <main
      className={`mobile-map-shell${navLevel === 'map' ? ' mobile-map-shell--map' : ''}`}
      style={hasAreaChips && navLevel === 'map' ? { '--map-chips-push': '53px' } as React.CSSProperties : undefined}
    >
      {childDraftModal}
      {editInformalModal}
      {/* 통합 헤더 — map 레벨에서는 floating + blur (디자인 23) */}
      <header className={`mobile-map-header${navLevel === 'map' ? ' mobile-map-header--floating' : ''}`}>
        <button onClick={handleBack} type="button" className="mm-back-btn" aria-label="Back">‹</button>
        <div className="mobile-map-header-content">
          <div className="mobile-map-title-row">
            <div className="mobile-map-title-copy">
              {navLevel === 'map' && selectedInformal ? (
                /* 비공식 장소를 보러 온 화면 — 구역 통계(전체/주택/상가)는 이 장소와
                   아무 상관이 없다. 숨기고 장소 이름과 메모만 보여 준다 */
                /* 메모는 아래 시트에 있다. 헤더에도 넣으면 같은 글이 두 번 보이고,
                   긴 메모는 헤더에서 잘린다 */
                <h1>{selectedInformal.name}</h1>
              ) : navLevel === 'map' ? (
                <>
                  <h1>{selectedCardId ? translateKoreanAddress(cards.find(c => c.id === selectedCardId)?.name ?? t(language, 'map.zoneMap'), language, translatePlaceNames) : t(language, 'map.zoneMap')}</h1>
                  <span className="mm-stats-sub" role="tablist">
                    <button
                      type="button"
                      role="tab"
                      aria-selected={buildingTypeFilter === '전체'}
                      className={`mm-stat-chip${buildingTypeFilter === '전체' ? ' is-active' : ''}`}
                      onClick={() => setBuildingTypeFilter('전체')}
                    >
                      <span>{t(language, 'map.all')}</span><b className="tnum">{typeCounts.전체}</b>
                    </button>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={buildingTypeFilter === '주택'}
                      className={`mm-stat-chip${buildingTypeFilter === '주택' ? ' is-active' : ''}`}
                      onClick={() => setBuildingTypeFilter('주택')}
                    >
                      <span>{t(language, 'map.house')}</span><b className="tnum">{typeCounts.주택}</b>
                    </button>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={buildingTypeFilter === '상가'}
                      className={`mm-stat-chip${buildingTypeFilter === '상가' ? ' is-active' : ''}`}
                      onClick={() => setBuildingTypeFilter('상가')}
                    >
                      <span>{t(language, 'map.shop')}</span><b className="tnum">{typeCounts.상가}</b>
                    </button>
                  </span>
                </>
              ) : (
                <>
                  {drillBreadcrumb && <p>{drillBreadcrumb}</p>}
                  <h1>{drillTitle}</h1>
                </>
              )}
            </div>
            {navLevel === 'map' ? (
              <div className="mobile-map-header-actions">
                <button
                  type="button"
                  className="mobile-map-header-action"
                  onClick={() => setShowCardFinder((open) => !open)}
                  aria-label={t(language, 'map.searchAllLabel')}
                >
                  <svg viewBox="0 0 24 24" aria-hidden>
                    <circle cx="11" cy="11" r="7" />
                    <line x1="21" y1="21" x2="16.65" y2="16.65" />
                  </svg>
                </button>
              </div>
            ) : (
              <>
                {showScopeAllButton && (
                  <button
                    className="mm-scope-all-btn"
                    onClick={openCurrentScopeMap}
                    type="button"
                  >
                    {t(language, 'map.allView')}
                  </button>
                )}
                <AppHeaderActionButtons
                  userId={currentUserId}
                  userName={currentVisitor}
                  role={actualRole}
                  className="mobile-map-header-actions"
                  buttonClassName="mobile-map-header-action"
                  showMenu={false}
                />
              </>
            )}
          </div>
          {navLevel === 'map' && isUserMap && !isUserDirectAssignment && (
            <div className="mobile-map-field-actions">
              {activeSessionCard && (
                <button
                  className={isViewingActiveCard ? 'active' : ''}
                  onClick={() => {
                    setSelectedCardId(activeSessionCard.id)
                    setShowCardFinder(false)
                    setCardSearch('')
                  }}
                  type="button"
                >
                  {t(language, 'map.myServiceCard')}
                </button>
              )}
              <button
                className={showCardFinder ? 'active' : ''}
                onClick={() => setShowCardFinder((open) => !open)}
                type="button"
              >
                {t(language, 'map.otherCard')}
              </button>
              <button
                className={!selectedCardId ? 'active' : ''}
                onClick={() => {
                  setSelectedCardId(null)
                  setShowCardFinder(false)
                  setCardSearch('')
                }}
                type="button"
              >
                {t(language, 'map.all')}
              </button>
            </div>
          )}
          {navLevel === 'map' && showCardFinder && (
            <div className="mobile-map-card-finder">
              <input
                autoFocus
                placeholder={t(language, 'map.searchAllPlaceholder')}
                value={cardSearch}
                onChange={(event) => setCardSearch(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && mapSearchResults[0]) {
                    event.preventDefault()
                    selectMapSearchResult(mapSearchResults[0])
                  }
                }}
              />
              {cardSearch && (
                <div className="mobile-map-card-results">
                  {bareUnitSearch && (
                    <span>{t(language, 'map.searchUnitHint')}</span>
                  )}
                  {!bareUnitSearch && mapSearchResults.length === 0 && <span>{t(language, 'map.noSearchResults')}</span>}
                  {mapSearchResults.length > 0 && <span>{t(language, 'map.searchResults')} {mapSearchResults.length}{t(language, 'calendar.countSuffix')}</span>}
                  {mapSearchResults.map((result) => (
                    <button
                      key={result.key}
                      onClick={() => selectMapSearchResult(result)}
                      type="button"
                    >
                      <span className={`mobile-map-search-kind kind-${result.kind}`}>
                        {t(language, `map.searchKind.${result.kind}`)}
                      </span>
                      <strong>{translateKoreanAddress(result.title, language, translatePlaceNames)}</strong>
                      {result.subtitle && <small>{translateKoreanAddress(result.subtitle, language, translatePlaceNames)}</small>}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </header>

      {/* Level 1: 대권역 선택 */}
      {navLevel === 'area' && (
        <div className="mm-drill-list">
          {areas.map(area => (
            <button
              key={area}
              className="mm-drill-item"
              onClick={() => { setSelectedArea(area); setNavLevel('region') }}
              type="button"
            >
              <div className="mm-drill-item-body">
                <div className="mm-drill-item-title">{placeLabel(area)}</div>
                <div className="mm-drill-item-sub">{t(language, 'zone.cardCount')} {areaCardCount(area)}{t(language, 'calendar.countSuffix')}</div>
              </div>
              <span className="mm-drill-chevron">›</span>
            </button>
          ))}
        </div>
      )}

      {/* Level 2: 동 선택 */}
      {navLevel === 'region' && (
        <div className="mm-drill-list">
          {regions.map(region => (
            <button
              key={region}
              className="mm-drill-item"
              onClick={() => { setSelectedRegion(region); setNavLevel('card') }}
              type="button"
            >
              <div className="mm-drill-item-body">
                <div className="mm-drill-item-title">{placeLabel(region)}</div>
                <div className="mm-drill-item-sub">{t(language, 'zone.cardCount')} {regionCardCount(region)}{t(language, 'calendar.countSuffix')}</div>
              </div>
              <span className="mm-drill-chevron">›</span>
            </button>
          ))}
        </div>
      )}

      {/* Level 3: 카드 선택 */}
      {navLevel === 'card' && (
        <div className="mm-drill-list">
          {regionCards.map(card => {
            const counts = cardBuildingTypeCounts.get(card.id) ?? { total: card.buildings, house: 0, shop: 0 }
            return (
              <button
                key={card.id}
                className="mm-drill-item"
                onClick={() => { setSelectedCardId(card.id); setNavLevel('map') }}
                type="button"
              >
                <div className="mm-drill-item-body">
                  <div className="mm-drill-item-title">{translateKoreanAddress(card.name, language, translatePlaceNames)}</div>
                  <div className="mm-drill-item-sub">
                    {t(language, 'map.total')} {counts.total} · {t(language, 'map.house')} {counts.house} · {t(language, 'map.shop')} {counts.shop}
                  </div>
                </div>
                <span className="mm-drill-chevron">›</span>
              </button>
            )
          })}
        </div>
      )}

      {/* Level 4: 지도 화면 */}
      {navLevel === 'map' && (
        <>
          {/* 지역 칩 필터 (drill 폐기 후 신규) — admin/leader 만 */}
          {!isUserMap && !enteredDirectly && areas.length > 1 && (
            <div className="mobile-map-area-chips" role="tablist" aria-label={msg('지역 필터')}>
              <button
                role="tab"
                aria-selected={selectedArea === null}
                className={selectedArea === null ? 'active' : ''}
                onClick={() => { setSelectedArea(null); setSelectedRegion(null); setSelectedCardId(null) }}
                type="button"
              >{t(language, 'map.all')}</button>
              {areas.map((area) => (
                <button
                  key={area}
                  role="tab"
                  aria-selected={selectedArea === area}
                  className={selectedArea === area ? 'active' : ''}
                  onClick={() => { setSelectedArea(area); setSelectedRegion(null); setSelectedCardId(null) }}
                  type="button"
                >{placeLabel(area)} <em>{areaCardCount(area)}</em></button>
              ))}
            </div>
          )}

          {/* 지도 */}
          <div className="mobile-map-container" style={{ position: 'relative' }}>
            {virtualGeocoding && (
              <div style={{ position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)', zIndex: 50, background: 'rgba(0,0,0,0.65)', color: '#fff', fontSize: 12, fontWeight: 600, padding: '6px 14px', borderRadius: 20, pointerEvents: 'none' }}>
                {t(language, 'map.searchingAddress')}
              </div>
            )}
            <MapCanvas
              informalPlaces={informalPins}
              informalShape={informalShape}
              focusPoint={informalFocusPoint}
              onSelectInformal={(id) => {
                const place = informalAssets.find((a) => a.id === id)
                if (place) showToast(place.memo?.trim() || place.name, 'info')
              }}
              buildings={mapAggregateMarkers.length > 0 ? [] : mapBuildings}
              aggregateMarkers={mapAggregateMarkers}
              cardBoundaries={mapAggregateMarkers.length > 0 || selectedInformal ? [] : mapBoundaries}
              cards={cards}
              selectedCardId={mapSelectedCardId}
              highlightedCardIds={scopedCardIds}
              onSelectAggregate={handleSelectAggregateMarker}
              onZoomChange={(zoom) => {
                setAutomaticMapDetail((current) => getNextMobileMapDetailLevel(current, zoom))
              }}
              onLocationPermissionBlocked={() => {
                showToast(
                  t(language, 'map.locationPermissionOff'),
                  'error',
                  onOpenLocationSettings ? { label: t(language, 'map.viewSettings'), onClick: onOpenLocationSettings } : undefined,
                )
              }}
              onSelectBuilding={(id) => {
                if (editingPinMode) return
                if (selectedBuildingId === id) {
                  // 이미 선택된 포인트를 다시 클릭하면 해제 및 시트 내리기
                  setSelectedBuildingId(null)
                  setExpandedBuildingIds(new Set())
                  setFullScreenUnit(null)
                  setSheetHeight(MIN_HEIGHT)
                } else {
                  // 새로운 포인트 클릭 시 선택 및 상세내역 펴기
                  setSelectedBuildingId(id)
                  setExpandedBuildingIds(new Set([id]))
                  setFullScreenUnit(null) // 다른 건물로 넘어갈 때도 호수 상세 내역 초기화

                  // 해당 건물 그룹이 접혀 있으면 자동으로 펼치기 (예: 방문완료 그룹)
                  const b = buildings.find(item => item.id === id)
                  if (b) {
                    const grp = getPinGroup(b)
                    setCollapsedStatusGroups((prev) => { const n = new Set(prev); n.delete(grp); return n })
                  }

                  // 포인트 클릭 시 바텀 시트 자동 대응 (최소 HALF 이상)
                  if (sheetHeight < HALF_HEIGHT) {
                    setSheetHeight(HALF_HEIGHT)
                  }

                  // 시트가 다 올라온 뒤 위치만 맞춘다. 두 애니메이션을 겹치지 않는다.
                  scrollBuildingAfterSheetTransition(id)
                }
              }}
              onSelectCardBoundary={(cardId) => setSelectedCardId(cardId)}
              selectedBuildingId={selectedBuildingId ?? 0}
              pickingPoint={addingChildKind !== null}
              onMapClick={(lat, lng) => {
                if (addingChildKind !== null) {
                  // 한 번 찍으면 모드를 끈다 — 계속 켜져 있으면 지도를 누를
                  // 때마다 창이 떠서 다른 일을 못 한다
                  setChildDraft({ lat, lng, name: '', memo: '', kind: addingChildKind })
                  setAddingChildKind(null)
                } else if (addingBuildingMode) {
                  handleAddBuildingAt(lat, lng)
                } else if (editingPinMode) {
                  return
                } else {
                  // 배경 클릭 시 상세내역 닫기 및 시트 내리기
                  setSelectedBuildingId(null)
                  setExpandedBuildingIds(new Set())
                  setFullScreenUnit(null)
                  setSheetHeight(MIN_HEIGHT)
                }
              }}
              previewPinLat={addLat}
              previewPinLng={addLng}
              virtualPinLat={virtualPinLat}
              virtualPinLng={virtualPinLng}
              virtualPinLabel={pinLabelParam}
              onMovePreviewPin={(lat, lng) => {
                setAddLat(lat)
                setAddLng(lng)
              }}
              onMoveBuilding={async (id, lat, lng) => {
                const b = buildings.find(item => item.id === id)
                if (b) {
                  const saved = await onUpdateBuilding(id, b.name, b.address, lat, lng)
                  if (saved) showToast(`${placeLabel(b.name || b.address)} ${t(language, 'map.pinSaved')}`, 'success')
                }
              }}
              isMobile={true}
              bottomPadding={sheetHeight + 20}
              addingBuilding={addingBuildingMode}
              editingBuildingLocation={editingPinMode}
              onOpenActionMenu={() => setShowMapActionMenu(prev => !prev)}
              onToggleAddingBuilding={setAddingBuildingMode}
              drawingBoundary={drawingBoundaryMode}
              onToggleDrawingBoundary={setDrawingBoundaryMode}
            />
            {selectedInformal && (
              <div className="mobile-map-legend-card">
                {INFORMAL_KINDS.map((kind) => (
                  <div
                    key={kind}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 7,
                      padding: '3px 2px', fontSize: 12, color: 'var(--gray-600)',
                    }}
                  >
                    <InformalKindIcon kind={kind} size={13} />
                    <span style={{ flex: 1 }}>{informalKindLabel(kind)}</span>
                    <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)' }}>
                      {informalChildren.filter((child) => child.kind === kind).length}
                    </span>
                  </div>
                ))}
              </div>
            )}
            {!selectedInformal && (
            <div className="mobile-map-legend-card" aria-label={t(language, 'map.status')}>
              {([
                { status: '방문필요', label: t(language, 'zone.summaryNeed') },
                // ⚠ '확인 필요' — 등록된 세대는 다 갔지만 **세대를 다 파악했는지 모른다.**
                //   예전에는 이것도 '완료'(초록)라 아무도 안 갔다.
                { status: '확인필요', label: t(language, 'map.needsCheck') },
                { status: '완료', label: t(language, 'zone.summaryDone') },
                { status: '방문금지', label: t(language, 'map.forbidden') },
                { status: '정기방문', label: t(language, 'map.regularVisit') },
              ] as Array<{ status: PinGroup; label: string }>).map(({ status, label }) => {
                const collapsed = collapsedStatusGroups.has(status)
                const hidden = hiddenMapStatuses.has(status)
                return (
                  <button
                    className={`mobile-map-legend-toggle${collapsed ? ' collapsed' : ''}${hidden ? ' map-hidden' : ''}`}
                    key={status}
                    onClick={() => toggleStatusFromMap(status)}
                    type="button"
                  >
                    <i className={`map-dot status-${status}`} />
                    <span>{label}</span>
                    <strong className="tnum">{statusCounts[status]}</strong>
                  </button>
                )
              })}
            </div>
            )}
            {showMapActionMenu && (
              <div className="mobile-map-action-popover">
                {/* 비공식 장소를 보고 있으면 건물 작업 대신 그 구역에 넣을 포인트를 고른다 */}
                {selectedInformal && onCreateInformalPlace ? (
                  INFORMAL_KINDS.map((kind) => {
                    const on = addingChildKind === kind
                    return (
                      <button
                        key={kind}
                        onClick={() => {
                          setAddingChildKind(on ? null : kind)
                          setShowMapActionMenu(false)
                        }}
                        style={on ? { color: INFORMAL_KIND_STYLE[kind].color, fontWeight: 700 } : undefined}
                        type="button"
                      >
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                          <InformalKindIcon kind={kind} size={13} />
                          {on ? msg('그만 추가') : `+ ${informalKindLabel(kind)}`}
                        </span>
                      </button>
                    )
                  })
                ) : (<>
                <button onClick={openAddBuildingMode} type="button">{t(language, 'map.addBuilding')}</button>
                <button onClick={toggleEditPinMode} type="button">
                  {editingPinMode ? t(language, 'map.finishEditPin') : t(language, 'map.editPin')}
                </button>
                </>)}
              </div>
            )}
          </div>

          {(addingBuildingMode || editingPinMode) && (
            <div className={`mobile-map-mode-banner${editingPinMode ? ' edit-pin' : ''}`}>
              <strong>{editingPinMode ? t(language, 'map.editPin') : t(language, 'map.addBuilding')}</strong>
              <button
                onClick={() => {
                  setAddingBuildingMode(false)
                  setEditingPinMode(false)
                }}
                type="button"
              >
                {t(language, 'map.finish')}
              </button>
            </div>
          )}

          {/* 건물 아코디언 (바텀시트) */}
          <section
            className={`mobile-bottom-sheet${isDragging ? ' dragging' : ''}`}
            style={{
              height: `${sheetHeight}px`,
              transition: isDragging ? 'none' : 'height 0.35s cubic-bezier(0.25, 0.46, 0.45, 0.94)'
            }}
          >
            <div
              className="sheet-handle"
              onPointerDown={handlePointerStart}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerEnd}
              onPointerCancel={handlePointerEnd}
              onClick={handleSheetHandleClick}
              style={{ cursor: 'grab' }}
            />
            <div
              className="mobile-sheet-summary"
              onPointerDown={handlePointerStart}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerEnd}
              onPointerCancel={handlePointerEnd}
              onClick={handleSheetHandleClick}
            >
              {liveFullScreenUnit ? (
                <>
                  <span>{placeLabel(liveFullScreenUnit.building.name || liveFullScreenUnit.building.address)}</span>
                  <em>{liveFullScreenUnit.unit.number} · {msg('다른 호수를 눌러 이동')}</em>
                </>
              ) : selectedInformal ? (
                /* 비공식 장소 화면 — 구역 진척률은 이 장소와 상관없다 */
                <>
                  <span>{msg('비공식 봉사 장소')}</span>
                  <em>
                    {[
                      selectedInformal.boundary?.length ? msg('구역선') : null,
                      selectedInformal.route?.length ? msg('중심거리 {n}개', { n: selectedInformal.route.length }) : null,
                    ].filter(Boolean).join(' · ') || msg('핀')}
                  </em>
                </>
              ) : (
                <>
                  <span>
                    {mapAggregateMarkers.length > 0
                      ? `${aggregateScopeLabel} ${mapAggregateMarkers.length}${t(language, 'calendar.countSuffix')}`
                      : `${t(language, 'map.building')} ${filteredBuildings.length}${t(language, 'calendar.countSuffix')}`}
                  </span>
                  <em>{completionRate}% · {visitedTotal}/{unitTotal} {t(language, 'map.unit')}</em>
                </>
              )}
            </div>

            {!canRecordVisits && (
              <div className="record-lock-banner mobile">
                <strong>{t(language, 'map.viewOnly')}</strong>
                <span>{t(language, 'map.viewOnlyDesc')}</span>
              </div>
            )}

            <div className="mobile-sheet-scroll">
              {selectedInformal ? (
                /* 비공식 장소 화면 — 구역 목록(처인구·기흥구…)은 이 장소와 상관없다.
                   그 자리를 메모에 준다. 헤더보다 넓어 길게 적어도 읽힌다 */
                <div style={{ padding: '4px 2px 20px' }}>
                  {selectedInformal.memo?.trim() && (
                    <p className="informal-map-parent-memo">
                      {selectedInformal.memo}
                    </p>
                  )}
                  {/* 종류 바꾸기. 목록에서 점을 고르면 그 점이, 아니면 이 구역이 대상이다. */}
                {onUpdateInformalPlace && (() => {
                  const target = (focusedChildId
                    ? informalChildren.find((child) => child.id === focusedChildId)
                    : null) ?? selectedInformal
                  if (!target) return null
                  return (
                    <div style={{ marginTop: 14 }}>
                      <div style={{
                        display: 'flex', alignItems: 'center', gap: 8,
                        fontSize: 12.5, color: 'var(--muted)', marginBottom: 6,
                      }}>
                        <span style={{
                          flex: 1, minWidth: 0, overflow: 'hidden',
                          textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        }}>{msg('{v1} 의 종류', { v1: target.name })}</span>
                        <button
                          type="button"
                          aria-label={msg('장소 수정')}
                          onClick={() => {
                            setEditInformalDraft({ id: target.id, name: target.name, memo: target.memo ?? '' })
                          }}
                          style={{
                            height: 28, minHeight: 28, padding: '0 10px', flexShrink: 0,
                            borderRadius: 8, border: '1px solid var(--line)',
                            background: 'var(--surface)', color: 'var(--text)',
                            fontSize: 12, cursor: 'pointer',
                          }}
                        >
                          {msg('수정')}
                        </button>
                      </div>
                      <div style={{ display: 'flex', gap: 6 }}>
                        {INFORMAL_KINDS.map((kind) => {
                          const on = target.kind === kind
                          const style = INFORMAL_KIND_STYLE[kind]
                          return (
                            <button
                              key={kind}
                              type="button"
                              onClick={() => { void onUpdateInformalPlace(target.id, { kind }) }}
                              style={{
                                flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
                                gap: 6, height: 40, minHeight: 40, borderRadius: 10, cursor: 'pointer',
                                border: `1px solid ${on ? style.color : 'var(--line-2)'}`,
                                background: on ? `${style.color}14` : 'var(--surface)',
                                color: on ? style.color : 'var(--muted)',
                                fontSize: 12.5, fontWeight: on ? 700 : 500,
                              }}
                            >
                              <InformalKindIcon kind={kind} size={14} color={on ? style.color : 'var(--muted-2)'} />
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  )
                })()}
                {/* 이 구역에 속한 점들. 누르면 그 자리로 지도가 간다 (핀을 누른 것과 같다). */}
                  {informalChildren.length > 0 && (
                    <div style={{ marginTop: 14 }}>
                      {INFORMAL_KINDS.map((kind) => {
                        const rows = informalChildren.filter((child) => child.kind === kind)
                        if (rows.length === 0) return null
                        return (
                          <div key={kind} className="informal-point-section">
                            <div className="informal-point-section-title">
                              {informalKindLabel(kind)} <span>{rows.length}</span>
                            </div>
                            {rows.map((child) => {
                              const style = INFORMAL_KIND_STYLE[child.kind]
                              return (
                                <div
                                  className={`informal-point-card${focusedChildId === child.id ? ' is-selected' : ''}`}
                                  key={child.id}
                                  style={{ '--informal-accent': style.color } as React.CSSProperties}
                                >
                                  <button
                                    className="informal-point-card-main"
                                    type="button"
                                    onClick={() => setFocusedChildId(child.id)}
                                  >
                                    <InformalKindIcon kind={child.kind} size={22} />
                                    <span className="informal-point-card-copy">
                                      <strong>{child.name}</strong>
                                      {child.memo?.trim() && <small>{child.memo}</small>}
                                    </span>
                                  </button>
                                  {onUpdateInformalPlace && (
                                    <button
                                      className="informal-point-edit"
                                      type="button"
                                      aria-label={msg('{v1} 수정', { v1: child.name })}
                                      onClick={() => setEditInformalDraft({ id: child.id, name: child.name, memo: child.memo ?? '' })}
                                    >
                                      <EditIcon />
                                    </button>
                                  )}
                                </div>
                              )
                            })}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              ) : (
              <>
              {mapAggregateMarkers.length > 0 && (
                <div className="mobile-map-aggregate-list">
                  {mapAggregateMarkers.map((marker) => (
                    <button
                      className="mobile-map-aggregate-row"
                      key={marker.id}
                      onClick={() => handleSelectAggregateMarker(marker.id)}
                      type="button"
                    >
                      <div>
                        <strong>{marker.label}</strong>
                        <span>{t(language, 'map.building')} {marker.count} · {t(language, 'map.unit')} {marker.unitCount}</span>
                        <span>{t(language, 'map.house')} {marker.houseCount} · {t(language, 'map.shop')} {marker.shopCount}</span>
                      </div>
                      <em>{t(language, 'map.unit')} {marker.unitCount}</em>
                    </button>
                  ))}
                </div>
              )}

              {mapAggregateMarkers.length === 0 && filteredBuildings.length === 0 && (
                <div style={{ padding: '24px', textAlign: 'center', color: '#94a3b8', fontSize: '14px' }}>
                  <p>{t(language, 'map.noBuildings')}</p>
                </div>
              )}

              {mapAggregateMarkers.length === 0 && buildingGroups.map(({ status, buildings: groupedBuildings }) => {
                if (groupedBuildings.length === 0) return null
                const isGroupCollapsed = collapsedStatusGroups.has(status)
                return (
                  <section className={`mobile-building-status-group mobile-status-${status}${isGroupCollapsed ? ' collapsed' : ''}`} key={status}>
                    <button
                      aria-label={`${status} ${isGroupCollapsed ? 'open' : 'close'}`}
                      className="mobile-building-status-head"
                      onClick={() => toggleStatusGroup(status)}
                      type="button"
                    />
                    {!isGroupCollapsed && groupedBuildings.map((building) => {
                const isExpanded = expandedBuildingIds.has(building.id)
                const handledUnits = building.units.filter(u => u.status !== '미방문').length
const completion = building.units.length === 0 ? 0 : Math.round((handledUnits / building.units.length) * 100)
                const card = cardMap.get(building.cardId)

                return (
                  <article
                    className={`bld-row${isExpanded ? ' bld-expanded' : ''}`}
                    key={building.id}
                    id={`building-card-${building.id}`}
                    style={{ scrollMargin: '120px' }}
                  >
                    <div className="bld-row-head">
                        <button
                          className="bld-row-head-btn"
                          onClick={() => {
                            const wasExpanded = expandedBuildingIds.has(building.id)
                            setSelectedBuildingId(building.id)
                            setExpandedBuildingIds(prev => {
                              const n = new Set(prev)
                              if (n.has(building.id)) n.delete(building.id)
                              else n.add(building.id)
                              return n
                            })
                            if (!wasExpanded) moveMobileMapToBuilding(building)
                          }}
                          type="button"
                        >
                          <span className="bld-chevron">{isExpanded ? '▾' : '▸'}</span>
                          <div className="bld-head-text">
                            <strong>{translateKoreanAddress(building.name || shortenAddress(building.address), language, translatePlaceNames)}</strong>
                            {building.name && <span className="bld-sub-name">{translateKoreanAddress(shortenAddress(building.address), language, translatePlaceNames)}</span>}
                            {card && selectedCardId === null && <span className="bld-sub-name" style={{ color: '#94a3b8' }}>{translateKoreanAddress(card.name, language, translatePlaceNames)}</span>}
                            {building.accessStatus === 'blocked' && (
                              <span className="bld-access-note">
                                {msg('출입불가')}
                                {building.accessEvents?.[0] && ` · ${building.accessEvents[0].visitor} · ${building.accessEvents[0].visitedAt.slice(5)}`}
                              </span>
                            )}
                          </div>
                          <div className="bld-head-right">
                            <small>{handledUnits}/{building.units.length} · {completion}%</small>
                          </div>
                        </button>
                        <div className="bld-menu-wrap">
                          <button
                            className="bld-edit-btn"
                            onClick={(event) => toggleBuildingMenu(building.id, event.currentTarget)}
                            type="button"
                            aria-label={msg('더보기')}
                          >⋯</button>
                          {buildingMenuId === building.id && buildingMenuPosition && (
                            <OverlayPortal>
                              <div
                                className="bld-menu-backdrop"
                                onClick={closeBuildingMenu}
                              />
                              <div className="bld-menu-popover" role="menu" style={buildingMenuPosition}>
                                <button
                                  type="button"
                                  onClick={() => {
                                    closeBuildingMenu()
                                    setEditingBuildingId(building.id)
                                    setEditName(building.name || '')
                                    setEditAddress(building.address)
                                    setEditBuildingType(building.type)
                                    setShowDeleteConfirm(false)
                                  }}
                                >{t(language, 'map.settings')}</button>
                                {actualRole === 'user' && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      closeBuildingMenu()
                                      setPlaceRequestTarget({ building })
                                    }}
                                  >{msg('자료 수정 요청')}</button>
                                )}
                                <button
                                  type="button"
                                  onClick={() => {
                                    closeBuildingMenu()
                                    const dname = encodeURIComponent(building.name || building.address)
                                    const sname = encodeURIComponent(t(language, 'map.myLocation'))
                                    const openUrl = (url: string) => window.open(url, '_blank', 'noopener,noreferrer')
                                    const fallback = () => {
                                      const url = building.lat && building.lng
                                        ? `https://map.naver.com/p/directions/-/${building.lng},${building.lat},${dname},,PLACE_POI/-/walk`
                                        : `https://map.naver.com/p/search/${dname}`
                                      openUrl(url)
                                    }
                                    if (!navigator.geolocation || !building.lat || !building.lng) {
                                      fallback()
                                      return
                                    }
                                    navigator.geolocation.getCurrentPosition(
                                      (pos) => {
                                        const slat = pos.coords.latitude
                                        const slng = pos.coords.longitude
                                        openUrl(`https://map.naver.com/p/directions/${slng},${slat},${sname},,ADDRESS_POI/${building.lng},${building.lat},${dname},,PLACE_POI/-/walk`)
                                      },
                                      (error) => {
                                        if (error.code === error.PERMISSION_DENIED) {
                                          showToast(msg('위치 권한이 꺼져 있습니다. 설정에서 위치 권한을 허용하면 현재 위치를 볼 수 있습니다.'), 'error')
                                        }
                                        fallback()
                                      },
                                      { enableHighAccuracy: true, timeout: 8000, maximumAge: 30000 },
                                    )
                                  }}
                                >{t(language, 'map.directions')}</button>
                                {/* ⚠ **이 표시가 있어야 '완료'(채운 초록)로 바뀐다.**
                                    시스템은 '등록된 세대' 만 안다 — 104·105호만 등록된 건물에서 둘 다 가면
                                    100% 가 되어 아무도 안 갔다. 몇 세대가 있는지는 사람만 안다. */}
                                {onSetUnitsSurveyed && (
                                  <button
                                    type="button"
                                    className={building.unitsSurveyed ? 'bld-menu-on' : undefined}
                                    onClick={() => {
                                      closeBuildingMenu()
                                      void onSetUnitsSurveyed(building.id, !building.unitsSurveyed)
                                    }}
                                  >{building.unitsSurveyed ? `✓ ${t(language, 'map.unitsSurveyed')}` : t(language, 'map.unitsSurveyed')}</button>
                                )}
                                <button
                                  type="button"
                                  className={building.accessStatus === 'blocked' ? 'bld-menu-on' : undefined}
                                  onClick={() => {
                                    closeBuildingMenu()
                                    void onSetBuildingAccess(building.id, building.accessStatus !== 'blocked')
                                  }}
                                >{building.accessStatus === 'blocked' ? `✓ ${msg('출입불가')}` : msg('출입불가로 표시')}</button>
                              </div>
                            </OverlayPortal>
                          )}
                        </div>
                      </div>

                    {isExpanded && (
                      <div className="bld-body">
                        <div className={`unit-col-header${activeInvitation ? ' with-invitation' : ''}`}>
                          <span>{t(language, 'map.unitInfo')}</span>
                          {activeInvitation && <span>{t(language, 'map.invitation')}</span>}
                          <span>{t(language, 'map.met')}</span>
                          <span>{t(language, 'map.absent')}</span>
                          <span>{t(language, 'map.korean')}</span>
                        </div>

                        {(strategyFilter === '전체'
                          ? building.units
                          : building.units.filter(unitMatchesStrategyFilter)
                        ).map((unit) => {
                          const unitHistories = visitHistoriesByUnitId.get(unit.id) ?? []
                          const latestHistory = unitHistories[0]

                          return (
                            <div
                              className={`unit-grid-row${unit.isRegularVisit ? ' ugr-regular' : ''}${fullScreenUnit?.unit.id === unit.id ? ' is-detail-selected' : ''}`}
                              data-unit-id={unit.id}
                              key={unit.id}
                            >
                              <div className={`unit-grid-main${activeInvitation ? ' with-invitation' : ''}`}>
                                <button className="unit-name-btn" onClick={() => openUnitDetail(unit, building, unitHistories)} type="button">
                                  <span className="unit-chevron">›</span>
                                  <span className="unit-number-text">{unit.number}</span>
                                  {unit.isChinese && <span className="unit-chinese-badge">中</span>}
                                  {effectiveUnitUsage(building, unit) !== building.type && (
                                    <span className="unit-usage-exception-badge">{effectiveUnitUsage(building, unit) === '상가' ? t(language, 'map.shop') : t(language, 'map.house')}</span>
                                  )}
                                  {unit.isForbidden && <span className="unit-forbidden-badge">{t(language, 'map.forbidden')}</span>}
                                  {unit.isRegularVisit && (
                                    <span className="unit-regular-badge">
                                      {t(language, 'map.regularVisit')}{unit.regularVisitor ? ` · ${unit.regularVisitor}` : ''}
                                    </span>
                                  )}
                                </button>
                                {activeInvitation && (() => {
                                  const hasInv = latestHistory?.invitationLeft
                                  const isPopupOpen = invitationPopupUnitId === unit.id
                                  return (
                                    <div style={{ position: 'relative', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
                                      <button
                                        className={`unit-check-btn unit-check-btn-invitation${hasInv ? ' ucb-invitation' : ''}${!canRecordVisits ? ' locked' : ''}`}
                                        onClick={() => {
                                          if (!requireRecordAccess()) return
                                          if (hasInv) {
                                            onToggleInvitationLeft?.(building.id, unit.id)
                                          } else {
                                            setInvitationPopupUnitId(isPopupOpen ? null : unit.id)
                                          }
                                        }}
                                        title={t(language, 'map.invitationLeft')}
                                        type="button"
                                      >{hasInv ? '✓' : ''}</button>
                                      {isPopupOpen && (
                                        <div style={{ position: 'absolute', top: '100%', right: 0, zIndex: 200, marginTop: 4, background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 10, boxShadow: '0 4px 16px rgba(0,0,0,0.18)', padding: '10px 8px', width: 148, display: 'flex', flexDirection: 'column', gap: 5 }}>
                                          <p style={{ margin: '0 0 5px', fontSize: 11, color: 'var(--muted)', textAlign: 'center', fontWeight: 600 }}>{t(language, 'map.invitationHow')}</p>
                                          <button type="button"
                                            onClick={() => { onToggleInvitationLeft?.(building.id, unit.id, 'direct'); setInvitationPopupUnitId(null) }}
                                            style={{ padding: '7px 10px', border: 0, borderRadius: 7, background: '#4F7A4B', color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                                            {t(language, 'map.invitationDirect')}
                                          </button>
                                          <button type="button"
                                            onClick={() => { onToggleInvitationLeft?.(building.id, unit.id, 'door'); setInvitationPopupUnitId(null) }}
                                            style={{ padding: '7px 10px', border: 0, borderRadius: 7, background: '#C44536', color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                                            {t(language, 'map.invitationDoor')}
                                          </button>
                                          <button type="button"
                                            onClick={() => setInvitationPopupUnitId(null)}
                                            style={{ padding: '5px', border: 0, borderRadius: 6, background: 'none', color: 'var(--muted)', fontSize: 11, cursor: 'pointer' }}>
                                            {t(language, 'common.cancel')}
                                          </button>
                                        </div>
                                      )}
                                    </div>
                                  )
                                })()}
                                <button className={`unit-check-btn${unit.status === '만남' ? ' ucb-meet' : ''}${!canRecordVisits ? ' locked' : ''}`}
                                  onClick={() => {
                                    if (!requireRecordAccess()) return
                                    if (unit.status === '만남') onUndoLatestVisit(building.id, unit.id)
                                    else onQuickLogVisit(building.id, unit.id, '만남')
                                  }}
                                  type="button">{unit.status === '만남' ? '✓' : ''}</button>
                                <button
                                  className={`unit-check-btn${(unit.status === '부재' && latestHistory?.visitedAt === getLocalDateString()) ? ' ucb-absent' : ''}${!canRecordVisits ? ' locked' : ''}`}
                                  onClick={() => {
                                    if (!requireRecordAccess()) return
                                    if (unit.status === '부재' && latestHistory?.visitedAt === getLocalDateString()) onUndoLatestVisit(building.id, unit.id)
                                    else onQuickLogVisit(building.id, unit.id, '부재')
                                  }}
                                  type="button">{(unit.status === '부재' && latestHistory?.visitedAt === getLocalDateString()) ? '✓' : ''}</button>
                                <button className={`unit-check-btn${unit.status === '대상외' ? ' ucb-korean' : ''}${!canRecordVisits ? ' locked' : ''}`}
                                  onClick={() => {
                                    if (!requireRecordAccess()) return
                                    if (unit.status === '대상외') onUndoLatestVisit(building.id, unit.id)
                                    else onQuickLogVisit(building.id, unit.id, '대상외')
                                  }}
                                  type="button">{unit.status === '대상외' ? '✓' : ''}</button>
                              </div>

                            </div>
                          )
                        })}

                        {addingUnitToBuildingId === building.id ? (() => {
                          // 입력이 비어 있으면 이미 있는 호수 다음 번호를 알아서 붙인다
                          const existingNumbers = building.units.map((u) => u.number)
                          const suggested = suggestNextUnitNumber(existingNumbers)
                          const submitUnit = async () => {
                            const number = newUnitNumber.trim() || suggested
                            // 결과를 보고 나서 비운다 — 실패했는데 비우면 적은 호수가 사라진다
                            if (await onAddUnit(building.id, number, newUnitUsageType)) setNewUnitNumber('')
                          }
                          return (
                          <div className="mm-unit-add-box">
                            <div className="mm-unit-add-row">
                              <input autoFocus placeholder={suggested} value={newUnitNumber} onChange={e => setNewUnitNumber(e.target.value)}
                                onKeyDown={e => { if (e.key === 'Enter') void submitUnit() }}
                                className="mm-unit-add-input" />
                              <button onClick={submitUnit}
                                className="mm-unit-add-btn">{t(language, 'common.add')}</button>
                              <button onClick={() => setAddingUnitToBuildingId(null)} className="mm-unit-cancel-btn" aria-label={msg('닫기')}>
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>
                              </button>
                            </div>
                            <div className="mm-unit-add-options">
                              <div className="mm-unit-usage-toggle" role="group" aria-label={msg('용도')}>
                                {(['주택', '상가'] as const).map((usage) => (
                                  <button key={usage} className={newUnitUsageType === usage ? 'active' : ''} type="button" onClick={() => setNewUnitUsageType(usage)}>
                                    {usage === '주택' ? t(language, 'map.house') : t(language, 'map.shop')}
                                  </button>
                                ))}
                              </div>
                              <button onClick={() => setBulkUnitBuildingId(building.id)} className="mm-unit-bulk-link" type="button">{t(language, 'unit.bulkAdd')} ›</button>
                            </div>
                          </div>
                          )
                        })() : (
                          <button className="bld-add-unit-btn" onClick={() => { setNewUnitUsageType(building.type); setNewUnitNumber(''); setAddingUnitToBuildingId(building.id) }} type="button">{t(language, 'map.addUnit')}</button>
                        )}
                      </div>
                    )}
                  </article>
                )
              })}
                  </section>
                )
              })}
              </>
              )}
            </div>
          </section>

          {/* 건물 추가 모달 */}
          {showAddModal && (
            <div 
              style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'grid', placeItems: 'end center', zIndex: 3000 }}
              onTouchStart={(e) => { if (e.target === e.currentTarget) backdropTouched.current = true }}
              onClick={(e) => {
                if (e.target === e.currentTarget && backdropTouched.current) {
                  closeAddModal()
                }
              }}
            >
              <div className="mm-building-edit-sheet" onClick={e => e.stopPropagation()}>
                <h3 style={{ margin: '0 0 16px', fontSize: '18px', fontWeight: 700 }}>{t(language, 'map.addBuilding')}</h3>
                {addLat && <p style={{ margin: '0 0 8px', fontSize: '12px', color: '#94a3b8' }}>{addLat.toFixed(5)}, {addLng?.toFixed(5)} {geocoding ? `· ${t(language, 'map.searchingAddress')}` : ''}</p>}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <div>
                    <label style={{ fontSize: '12px', fontWeight: 700, color: 'var(--ink-500)', display: 'block', marginBottom: '4px' }}>{t(language, 'zone.cardCount')}</label>
                    <select value={addCardId} onChange={e => setAddCardId(Number(e.target.value))} style={{ width: '100%', padding: '10px', border: '1px solid #e2e8f0', borderRadius: 'var(--r-md)', fontSize: '14px' }}>
                      {cards.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={{ fontSize: '12px', fontWeight: 700, color: 'var(--ink-500)', display: 'block', marginBottom: '4px' }}>{t(language, 'map.buildingNameRequired')}</label>
                    <input value={addName} onChange={e => setAddName(e.target.value)} placeholder={t(language, 'map.buildingNamePlaceholder')}
                      style={{ width: '100%', padding: '10px', border: '1px solid #e2e8f0', borderRadius: 'var(--r-md)', fontSize: '14px', boxSizing: 'border-box' }} />
                  </div>
                  <div>
                    <label style={{ fontSize: '12px', fontWeight: 700, color: 'var(--ink-500)', display: 'block', marginBottom: '4px' }}>{t(language, 'map.address')}</label>
                    <input value={addAddress} onChange={e => setAddAddress(e.target.value)} placeholder={t(language, 'map.addressPlaceholder')}
                      style={{ width: '100%', padding: '10px', border: '1px solid #e2e8f0', borderRadius: 'var(--r-md)', fontSize: '14px', boxSizing: 'border-box' }} />
                  </div>
                  <div>
                    <label style={{ fontSize: '12px', fontWeight: 700, color: 'var(--ink-500)', display: 'block', marginBottom: '4px' }}>{t(language, 'map.type')}</label>
                    <select value={addType} onChange={e => setAddType(e.target.value as Building['type'])} style={{ width: '100%', padding: '10px', border: '1px solid #e2e8f0', borderRadius: 'var(--r-md)', fontSize: '14px' }}>
                      <option value="주택">{buildingTypeLabel('주택')}</option>
                      <option value="상가">{buildingTypeLabel('상가')}</option>
                    </select>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '8px', marginTop: '20px' }}>
                  <button onClick={closeAddModal} style={{ flex: 1, padding: '12px', borderRadius: 'var(--r-md)', border: '1px solid #e2e8f0', background: '#f8fafc', fontWeight: 700, cursor: 'pointer', fontSize: '15px' }}>{t(language, 'common.cancel')}</button>
                  <button onClick={handleConfirmAdd} disabled={!addName.trim()} style={{ flex: 2, padding: '12px', borderRadius: 'var(--r-md)', border: 'none', background: addName.trim() ? 'var(--accent-700)' : '#e2e8f0', color: addName.trim() ? '#fff' : '#94a3b8', fontWeight: 700, cursor: addName.trim() ? 'pointer' : 'not-allowed', fontSize: '15px' }}>{t(language, 'common.add')}</button>
                </div>
              </div>
            </div>
          )}

          {/* 건물 수정/삭제 모달 */}
          {editingBuilding && (
            <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'grid', placeItems: 'end center', zIndex: 3000 }} onClick={() => { setEditingBuildingId(null); setShowDeleteConfirm(false) }}>
              <div style={{ background: '#fff', borderRadius: '20px 20px 0 0', width: '100%', maxWidth: '480px', padding: '24px 20px 36px' }} onClick={e => e.stopPropagation()}>
                {!showDeleteConfirm ? (
                  <>
                    <h3 style={{ margin: '0 0 16px', fontSize: '18px', fontWeight: 700 }}>{t(language, 'map.editBuilding')}</h3>
                    <div className="mm-building-edit-fields">
                      <div>
                        <label style={{ fontSize: '12px', fontWeight: 700, color: 'var(--ink-500)', display: 'block', marginBottom: '4px' }}>{t(language, 'map.buildingName')}</label>
                        <input value={editName} onChange={e => setEditName(e.target.value)} style={{ width: '100%', padding: '10px', border: '1px solid #e2e8f0', borderRadius: 'var(--r-md)', fontSize: '14px', boxSizing: 'border-box' }} />
                      </div>
                      <div>
                        <label style={{ fontSize: '12px', fontWeight: 700, color: 'var(--ink-500)', display: 'block', marginBottom: '4px' }}>{t(language, 'map.address')}</label>
                        <input value={editAddress} onChange={e => setEditAddress(e.target.value)} style={{ width: '100%', padding: '10px', border: '1px solid #e2e8f0', borderRadius: 'var(--r-md)', fontSize: '14px', boxSizing: 'border-box' }} />
                      </div>
                      {canChangeBuildingType && (
                        <div className="mm-building-kind-row">
                          <span>{t(language, 'map.buildingKind')}</span>
                          <select
                            aria-label={t(language, 'map.buildingKind')}
                            className="mm-place-kind-select"
                            value={editBuildingType}
                            onChange={(event) => setEditBuildingType(event.target.value as Building['type'])}
                          >
                            <option value="주택">{buildingTypeLabel('주택')}</option>
                            <option value="상가">{buildingTypeLabel('상가')}</option>
                          </select>
                        </div>
                      )}
                    </div>
                    <div className="mm-building-edit-actions">
                      <button className="mm-building-delete-action" onClick={() => setShowDeleteConfirm(true)}>{placeDeletionCopy(actualRole, 'building').actionLabel}</button>
                      <span className="mm-building-edit-action-spacer" />
                      <button className="mm-building-cancel-action" onClick={() => { setEditingBuildingId(null); setShowDeleteConfirm(false) }}>{t(language, 'common.cancel')}</button>
                      <button className="mm-building-save-action" onClick={() => void saveBuildingEdit(editingBuilding)}>{t(language, 'common.save')}</button>
                    </div>
                  </>
                ) : (
                  <>
                    <h3 style={{ margin: '0 0 12px', fontSize: '18px', fontWeight: 700, color: 'var(--danger-600)' }}>{placeDeletionCopy(actualRole, 'building').title}</h3>
                    <p style={{ margin: '0 0 20px', fontSize: '15px', color: '#4b5563', lineHeight: 1.5 }}>{placeDeletionCopy(actualRole, 'building').description}</p>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button onClick={() => setShowDeleteConfirm(false)} style={{ flex: 1, padding: '12px', borderRadius: 'var(--r-md)', border: '1px solid #e2e8f0', background: '#f8fafc', fontWeight: 700, cursor: 'pointer', fontSize: '15px' }}>{t(language, 'common.cancel')}</button>
                      <button onClick={() => { onDeleteBuilding(editingBuilding.id); setEditingBuildingId(null); setShowDeleteConfirm(false) }} style={{ flex: 2, padding: '12px', borderRadius: 'var(--r-md)', border: 'none', background: 'var(--danger-600)', color: '#fff', fontWeight: 700, cursor: 'pointer', fontSize: '15px' }}>{placeDeletionCopy(actualRole, 'building').confirmLabel}</button>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}
        </>
      )}
      {historyToEdit && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 700, display: 'grid', placeItems: 'center', padding: '0 20px' }}
          onClick={() => setHistoryToEdit(null)}
        >
          <div
            style={{ background: 'var(--surface)', borderRadius: 16, padding: '20px', width: '100%', maxWidth: 340 }}
            onClick={e => e.stopPropagation()}
          >
            <h3 style={{ margin: '0 0 16px', fontSize: 15, fontWeight: 700, color: 'var(--ink)' }}>{t(language, 'map.editHistory')}</h3>

            {/* 상태 */}
            <p style={{ margin: '0 0 4px', fontSize: 11, fontWeight: 600, color: 'var(--muted)' }}>{t(language, 'map.status')}</p>
            <select
              value={historyToEdit.result}
              onChange={e => setHistoryToEdit({ ...historyToEdit, result: e.target.value as any })}
              style={{ width: '100%', padding: '8px 10px', marginBottom: 12, borderRadius: 8, border: '1px solid var(--line)', background: 'var(--bg)', color: 'var(--ink)', fontSize: 13, boxSizing: 'border-box' }}
            >
              <option value="미방문">{t(language, 'map.unvisited')}</option>
              <option value="만남">{t(language, 'map.met')}</option>
              <option value="부재">{t(language, 'map.absent')}</option>
              <option value="대상외">{t(language, 'map.notTarget')}</option>
            </select>

            {/* 시간대 + 날짜 나란히 */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
              <div style={{ flex: 1 }}>
                <p style={{ margin: '0 0 4px', fontSize: 11, fontWeight: 600, color: 'var(--muted)' }}>{t(language, 'map.timeSlot')}</p>
                <select
                  value={historyToEdit.timeSlot}
                  onChange={e => setHistoryToEdit({ ...historyToEdit, timeSlot: e.target.value as any })}
                  style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--line)', background: 'var(--bg)', color: 'var(--ink)', fontSize: 13, boxSizing: 'border-box' }}
                >
                  <option value="오전">{t(language, 'map.morning')}</option>
                  <option value="오후">{t(language, 'map.afternoon')}</option>
                  <option value="저녁">{t(language, 'map.evening')}</option>
                </select>
              </div>
              <div style={{ flex: 1 }}>
                <p style={{ margin: '0 0 4px', fontSize: 11, fontWeight: 600, color: 'var(--muted)' }}>{msg('날짜')}</p>
                <input
                  type="date"
                  value={historyToEdit.visitedAt}
                  onChange={e => setHistoryToEdit({ ...historyToEdit, visitedAt: e.target.value })}
                  style={{ width: '100%', padding: '8px 6px', borderRadius: 8, border: '1px solid var(--line)', background: 'var(--bg)', color: 'var(--ink)', fontSize: 12, boxSizing: 'border-box' }}
                />
              </div>
            </div>

            {/* 방문자 — 관리자·인도자만. 대신 입력한 기록을 실제 방문자로 돌려 놓는다 */}
            {canEditVisitorHere && visitorNameOptions.length > 0 && (
              <>
                <p style={{ margin: '0 0 4px', fontSize: 11, fontWeight: 600, color: 'var(--muted)' }}>{msg('방문자')}</p>
                <select
                  value={historyToEdit.visitor || ''}
                  onChange={e => setHistoryToEdit({ ...historyToEdit, visitor: e.target.value })}
                  style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--line)', background: 'var(--bg)', color: 'var(--ink)', fontSize: 13, boxSizing: 'border-box', marginBottom: 12 }}
                >
                  {/* 목록에 없는 이름(탈퇴·개명)은 utils/visitorPicker 가 끼워 넣는다 —
                      빠지면 창을 열었다 닫기만 해도 남의 기록이 된다 */}
                  {visitorOptionsWithCurrent(visitorNameOptions, historyToEdit.visitor).map((name) => (
                    <option key={name} value={name}>{name}</option>
                  ))}
                </select>
              </>
            )}

            {/* 메모 (그날 방문에 대한 것 — 세대 메모와 구분되게 라벨을 다르게) */}
            <p style={{ margin: '0 0 4px', fontSize: 11, fontWeight: 600, color: 'var(--muted)' }}>{t(language, 'map.visitMemoLabel')}</p>
            <textarea
              value={historyToEdit.memo || ''}
              onChange={e => setHistoryToEdit({ ...historyToEdit, memo: e.target.value })}
              style={{ width: '100%', padding: '8px 10px', height: 64, borderRadius: 8, border: '1px solid var(--line)', background: 'var(--bg)', color: 'var(--ink)', fontSize: 13, boxSizing: 'border-box', resize: 'none', fontFamily: 'inherit', marginBottom: 12 }}
            />

            {/* 특별봉사 시즌 */}
            {getActivePeriodForDate(historyToEdit.visitedAt) && (
              <div style={{ marginBottom: 12, padding: '8px 10px', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: '#92400e', marginBottom: 5 }}>
                  🟠 {getActivePeriodForDate(historyToEdit.visitedAt)?.label}
                </div>
                <label style={{ display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer', fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>
                  <input
                    type="checkbox"
                    checked={historyToEdit.invitationLeft ?? false}
                    onChange={e => setHistoryToEdit({ ...historyToEdit, invitationLeft: e.target.checked })}
                    style={{ width: 16, height: 16, accentColor: '#f59e0b', cursor: 'pointer' }}
                  />
                  {msg('초대장 남김')}
                </label>
              </div>
            )}

            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={() => setHistoryToEdit(null)}
                style={{ flex: 1, padding: '9px', border: '1px solid var(--line)', borderRadius: 8, background: 'var(--surface)', color: 'var(--muted)', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
              >{t(language, 'map.cancel')}</button>
              <button
                onClick={async () => {
                  const ok = await onUpdateVisitHistory(historyToEdit.id, historyToEdit.unitId, {
                    result: historyToEdit.result,
                    timeSlot: historyToEdit.timeSlot,
                    memo: historyToEdit.memo || '',
                    visitedAt: historyToEdit.visitedAt,
                    invitationLeft: historyToEdit.invitationLeft ?? false,
                    // ⚠ 고칠 수 있는 사람이 아닐 때는 아예 안 넘긴다.
                    //   넘기면(빈 값이라도) 이름이 지워질 수 있다.
                    ...(canEditVisitorHere ? { visitor: historyToEdit.visitor } : {}),
                  })
                  // ⚠ **성공해야 닫는다.** 예전에는 결과를 안 기다리고 닫아서,
                  //   저장이 실패하면 고른 방문자가 조용히 사라졌다.
                  if (ok !== false) setHistoryToEdit(null)
                }}
                style={{ flex: 2, padding: '9px', border: 'none', borderRadius: 8, background: 'var(--ink)', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}
              >{t(language, 'map.save')}</button>
            </div>
          </div>
        </div>
      )}

      {/* ── 세대 상세 풀스크린 오버레이 ── */}
      {liveFullScreenUnit && (
        <div style={{
          position: 'fixed', top: 0, right: 0, bottom: sheetHeight, left: 0, zIndex: 600,
          background: 'var(--bg, #f5f6f8)',
          display: 'flex', flexDirection: 'column',
          overflowY: 'auto',
          transition: isDragging ? 'none' : 'bottom 0.35s cubic-bezier(0.25, 0.46, 0.45, 0.94)',
        }}>
          {/* 헤더 — 지도 헤더(.mobile-map-header) 스타일 일치 */}
          <div style={{
            position: 'sticky', top: 0, zIndex: 10,
            background: 'var(--bg)',
            borderBottom: '1px solid var(--line)',
            padding: '10px 12px',
            display: 'flex', alignItems: 'flex-start', gap: 10,
          }}>
            <button
              onClick={closeUnitDetail}
              type="button"
              style={{ width: 36, height: 36, padding: 0, border: 'none', borderRadius: 8, background: 'transparent', color: 'var(--text)', cursor: 'pointer', fontSize: 22, lineHeight: 1, marginLeft: -4, flexShrink: 0 }}
              aria-label={msg('닫기')}
            >‹</button>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ margin: 0, fontWeight: 700, fontSize: 20, letterSpacing: '-0.015em', color: 'var(--ink)', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                {liveFullScreenUnit.building.name
                  ? `${liveFullScreenUnit.building.name} ${liveFullScreenUnit.unit.number}`
                  : liveFullScreenUnit.unit.number}
                {liveFullScreenUnit.unit.isChinese && <span style={{ fontSize: 11, padding: '1px 5px', borderRadius: 4, background: '#fef2f2', color: '#dc2626', fontWeight: 700 }}>中</span>}
                {liveFullScreenUnit.unit.isForbidden && <span style={{ fontSize: 11, padding: '1px 5px', borderRadius: 4, background: '#fee2e2', color: '#dc2626', fontWeight: 700 }}>{t(language, 'map.forbidden')}</span>}
              </div>
              <div style={{ margin: '0 0 4px', fontSize: 12.5, fontWeight: 500, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {placeLabel(shortenAddress(liveFullScreenUnit.building.address))}
              </div>
            </div>
            {/* 헤더 ⋮ 메뉴 */}
            <div style={{ position: 'relative', flexShrink: 0 }}>
              <button
                type="button"
                onClick={() => setShowUnitHeaderMenu(v => !v)}
                style={{ width: 36, height: 36, padding: 0, border: 'none', borderRadius: 8, background: 'transparent', color: 'var(--muted)', cursor: 'pointer', fontSize: 20, lineHeight: 1 }}
              >⋯</button>
              {showUnitHeaderMenu && (
                <>
                  <div onClick={() => setShowUnitHeaderMenu(false)} style={{ position: 'fixed', inset: 0, zIndex: 9 }} />
                  <div style={{
                    position: 'absolute', right: 0, top: '100%', zIndex: 10,
                    background: 'var(--surface)', borderRadius: 10,
                    boxShadow: '0 4px 16px rgba(0,0,0,0.14)', border: '1px solid var(--line)',
                    overflow: 'hidden', minWidth: 120,
                  }}>
                    <button
                      type="button"
                      onClick={() => {
                        setShowUnitHeaderMenu(false)
                        setUnitNumberDraft(liveFullScreenUnit.unit.number)
                        setEditingUnitNumber(true)
                      }}
                      style={{ display: 'block', width: '100%', padding: '11px 16px', background: 'none', border: 'none', borderBottom: '1px solid var(--line)', cursor: 'pointer', fontSize: 13, color: 'var(--ink)', textAlign: 'left' }}
                    >{t(language, 'map.editUnit')}</button>
                    {actualRole === 'user' && (
                      <button
                        type="button"
                        onClick={() => {
                          setShowUnitHeaderMenu(false)
                          setPlaceRequestTarget({ building: liveFullScreenUnit.building, unit: liveFullScreenUnit.unit })
                        }}
                        style={{ display: 'block', width: '100%', padding: '11px 16px', background: 'none', border: 'none', borderBottom: '1px solid var(--line)', cursor: 'pointer', fontSize: 13, color: 'var(--ink)', textAlign: 'left' }}
                      >{msg('자료 수정 요청')}</button>
                    )}
                    <button
                      type="button"
                      onClick={async () => {
                        setShowUnitHeaderMenu(false)
                        const copy = placeDeletionCopy(actualRole, 'unit')
                        if (await confirmDialog({ message: `${liveFullScreenUnit.unit.number}: ${copy.description}`, danger: true, confirmLabel: copy.confirmLabel })) {
                          onDeleteUnit(liveFullScreenUnit.building.id, liveFullScreenUnit.unit.id)
                          closeUnitDetail()
                        }
                      }}
                      style={{ display: 'block', width: '100%', padding: '11px 16px', background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 700, color: '#dc2626', textAlign: 'left' }}
                    >{placeDeletionCopy(actualRole, 'unit').actionLabel}</button>
                  </div>
                </>
              )}
            </div>
          </div>
          {/* 호수 편집 인라인 */}
          {editingUnitNumber && (
            <div style={{ padding: '8px 16px', background: 'var(--surface)', borderTop: '1px solid var(--line)', display: 'flex', gap: 8 }}>
              <input
                autoFocus
                value={unitNumberDraft}
                onChange={e => setUnitNumberDraft(e.target.value)}
                placeholder={msg('호수 (예: 101)')}
                style={{ flex: 1, padding: '7px 10px', border: '1px solid var(--line)', borderRadius: 7, fontSize: 13, background: 'var(--bg)', color: 'var(--ink)' }}
              />
              <button
                type="button"
                onClick={() => setEditingUnitNumber(false)}
                style={{ padding: '7px 10px', border: '1px solid var(--line)', borderRadius: 7, background: 'var(--surface)', color: 'var(--muted)', fontSize: 12, cursor: 'pointer' }}
              >{t(language, 'map.cancel')}</button>
              <button
                type="button"
                onClick={async () => {
                  const v = unitNumberDraft.trim()
                  if (!v) return
                  const saved = await onUpdateUnitFlags(liveFullScreenUnit.unit.id, { number: v })
                  if (saved !== false) setEditingUnitNumber(false)
                }}
                style={{ padding: '7px 12px', border: 'none', borderRadius: 7, background: 'var(--ink)', color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
              >{t(language, 'map.save')}</button>
            </div>
          )}

          {/* 본문 */}
          <div style={{ flex: 1 }}>
            <UnitDetailScreen key={liveFullScreenUnit.unit.id} language={language}
              unit={liveFullScreenUnit.unit}
              building={liveFullScreenUnit.building}
              unitHistories={liveFullScreenUnit.unitHistories}
              canRecordVisits={canRecordVisits}
              editingHistoryId={editingHistoryId}
              setEditingHistoryId={setEditingHistoryId}
              setHistoryToEdit={setHistoryToEdit}
              unitMemos={unitMemos}
              setUnitMemos={setUnitMemos}
              requireRecordAccess={requireRecordAccess}
              onUpdateUnitFlags={onUpdateUnitFlags}
              onToggleRegularVisit={onToggleRegularVisit}
              onToggleChinese={onToggleChinese}
              onDeleteVisitHistory={onDeleteVisitHistory}
              onUpdateVisitHistory={onUpdateVisitHistory}
              currentVisitor={currentVisitor}
              allUsers={allUsers}
              onSetRegularVisitor={onSetRegularVisitor}
              onMemoEditingChange={handleUnitMemoEditingChange}
              canManagePlaceType={canChangeBuildingType}
              restaurantAssignments={getCurrentRestaurantAssignmentsForUnit(
                eventRestaurantAssignments,
                calendarEvents,
                liveFullScreenUnit.unit.id,
                today,
              )}
              calendarEvents={calendarEvents}
            />
          </div>
        </div>
      )}

      {/* 호수 일괄 추가 바텀시트 */}
      {bulkUnitBuildingId !== null && (() => {
        const b = buildings.find((x) => x.id === bulkUnitBuildingId)
        if (!b) return null
        return (
          <MobileBulkUnitSheet
            buildingId={b.id}
            buildingName={b.name}
            existingNumbers={new Set(b.units.map((u) => u.number))}
            onAdd={onAddUnit}
            onClose={() => setBulkUnitBuildingId(null)}
          />
        )
      })()}
      {placeRequestTarget && (
        <PlaceChangeRequestDialog
          building={placeRequestTarget.building}
          unit={placeRequestTarget.unit}
          onClose={() => setPlaceRequestTarget(null)}
        />
      )}
    </main>
  )
}

// ── 세대 상세 풀스크린 (신) ────────────────────────────────────
function UnitDetailScreen({
  language,
  unit,
  building,
  unitHistories,
  canRecordVisits,
  editingHistoryId,
  setEditingHistoryId,
  setHistoryToEdit,
  unitMemos,
  setUnitMemos,
  requireRecordAccess,
  onUpdateUnitFlags,
  onToggleRegularVisit,
  onToggleChinese,
  onDeleteVisitHistory,
  onUpdateVisitHistory,
  currentVisitor,
  allUsers = [],
  onSetRegularVisitor,
  onMemoEditingChange,
  canManagePlaceType = false,
  restaurantAssignments = [],
  calendarEvents = [],
}: {
  language: AppLanguage
  unit: Unit
  building: Building
  unitHistories: VisitHistory[]
  canRecordVisits: boolean
  editingHistoryId: number | null
  setEditingHistoryId: (id: number | null) => void
  setHistoryToEdit: (h: VisitHistory) => void
  unitMemos: Record<number, string>
  setUnitMemos: React.Dispatch<React.SetStateAction<Record<number, string>>>
  requireRecordAccess: () => boolean
  onUpdateUnitFlags: (unitId: number, flags: Partial<Unit>) => void | Promise<boolean>
  onToggleRegularVisit: (buildingId: number, unitId: number, visitorName?: string) => void
  onToggleChinese: (buildingId: number, unitId: number) => void
  onDeleteVisitHistory: (historyId: number, unitId: number) => void
  onUpdateVisitHistory?: (historyId: number, unitId: number, input: { result: UnitStatus; timeSlot: TimeSlot; memo: string; visitedAt: string; invitationLeft?: boolean; visitor?: string }) => void | Promise<boolean>
  currentVisitor?: string
  allUsers?: { id: number; name: string }[]
  onSetRegularVisitor?: (unitId: number, visitorName: string, registeredAt?: string) => Promise<void>
  onMemoEditingChange?: (editing: boolean) => void
  canManagePlaceType?: boolean
  restaurantAssignments?: EventRestaurantAssignment[]
  calendarEvents?: CalendarEvent[]
}) {
  const [memoEditing, setMemoEditing] = useState(false)
  const [memoDraft, setMemoDraft] = useState<string | null>(null)
  const [inlineMemoHistoryId, setInlineMemoHistoryId] = useState<number | null>(null)
  const [inlineMemoDraft, setInlineMemoDraft] = useState('')
  const [showRegularPopup, setShowRegularPopup] = useState(false)
  const [regularNameDraft, setRegularNameDraft] = useState('')
  const [regularDateDraft, setRegularDateDraft] = useState('')
  const [historyGridOpen, setHistoryGridOpen] = useState(false)

  const TIME_SLOTS = ['오전', '오후', '저녁'] as const
  type RowKey = '평일' | '주말'

  // Build visit history grid
  const visitGrid: Record<RowKey, Record<string, { total: number; lastResult: string }>> = {
    평일: Object.fromEntries(TIME_SLOTS.map(s => [s, { total: 0, lastResult: '' }])),
    주말: Object.fromEntries(TIME_SLOTS.map(s => [s, { total: 0, lastResult: '' }])),
  }
  for (const h of unitHistories) {
    const d = new Date(h.visitedAt).getDay()
    const row: RowKey = d === 0 || d === 6 ? '주말' : '평일'
    const slot = h.timeSlot
    if (!(slot in visitGrid[row])) continue
    visitGrid[row][slot].total++
    if (!visitGrid[row][slot].lastResult) visitGrid[row][slot].lastResult = h.result
  }

  const absenceCounts: Record<RowKey, Record<string, number>> = {
    평일: Object.fromEntries(TIME_SLOTS.map((slot) => [slot, 0])),
    주말: Object.fromEntries(TIME_SLOTS.map((slot) => [slot, 0])),
  }
  unitHistories.forEach((history) => {
    if (history.result !== '부재') return
    const day = new Date(history.visitedAt).getDay()
    const row: RowKey = day === 0 || day === 6 ? '주말' : '평일'
    if (history.timeSlot in absenceCounts[row]) absenceCounts[row][history.timeSlot] += 1
  })
  const absenceBuckets = (['평일', '주말'] as RowKey[]).flatMap((row) =>
    TIME_SLOTS.flatMap((slot) => {
      const count = absenceCounts[row][slot]
      if (count === 0) return []
      const rowLabel = row === '평일' ? t(language, 'map.weekday') : t(language, 'map.weekend')
      const slotLabel = slot === '오전' ? t(language, 'map.morning') : slot === '오후' ? t(language, 'map.afternoon') : t(language, 'map.evening')
      return [{ label: `${rowLabel} ${slotLabel}${count > 1 ? ` ${count}${t(language, 'map.cases')}` : ''}`, count }]
    }),
  ).sort((a, b) => b.count - a.count)
  const latestResult = unitHistories[0]?.result
  const latestResultLabel = latestResult === '만남'
    ? t(language, 'map.met')
    : latestResult === '부재'
      ? t(language, 'map.absent')
      : latestResult === '대상외'
        ? t(language, 'map.notTarget')
        : latestResult === '미방문'
          ? t(language, 'map.unvisited')
          : latestResult === '확인필요'
            ? t(language, 'map.needsCheck')
            : latestResult
  const historySummary = unitHistories.length === 0
    ? msg('기록 없음')
    : absenceBuckets.length > 0
      ? `${msg('못 만난 시간')} · ${absenceBuckets.slice(0, 2).map((bucket) => bucket.label).join(' · ')}`
      : `${msg('못 만난 기록 없음')}${latestResultLabel ? ` · ${msg('최근')} ${latestResultLabel}` : ''}`

  const resultColor = (r: string) => r === '만남' ? '#4F7A4B' : r === '부재' ? '#C44536' : '#94a3b8'

  const memo = unitMemos[unit.id] ?? unit.memo ?? ''

  const sectionStyle: React.CSSProperties = {
    padding: '12px',
    marginBottom: 6,
    background: 'var(--surface)',
    border: '1px solid var(--line)',
    borderRadius: 10,
    boxShadow: '0 1px 2px rgba(15, 23, 42, 0.035)',
  }
  const sectionTitleStyle: React.CSSProperties = { margin: '0 0 8px', fontSize: 14, fontWeight: 700, color: 'var(--ink)' }

  return (
    <div style={{ background: 'var(--bg)', minHeight: '100%', paddingBottom: 40 }}>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '12px 14px 0' }}>

        {/* 식당 봉사 배정 (이 세대) */}
        {restaurantAssignments.length > 0 && (
          <div style={{ padding: '12px 14px', background: '#fef3e7', border: '1px solid #f5cfa1', borderRadius: 12 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#b4621f', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
              {msg('식당 봉사 배정')}
            </div>
            {restaurantAssignments.map((asn) => {
              const ev = calendarEvents.find((e) => e.id === asn.eventId)
              return (
                <div key={asn.id} style={{ fontSize: 13, color: 'var(--ink)', marginTop: 2 }}>
                  <b>{asn.userName}</b>
                  {ev ? <span style={{ color: 'var(--muted)' }}> · {ev.date} {ev.time} {ev.title}</span> : null}
                </div>
              )
            })}
          </div>
        )}

        {/* 플래그 */}
        <div style={sectionStyle}>
          <div style={{ display: 'flex', gap: 8 }}>
            {/* 방문금지 */}
            {[
              { label: t(language, 'map.forbidden'), active: unit.isForbidden ?? false, onToggle: () => onUpdateUnitFlags(unit.id, { isForbidden: !unit.isForbidden }) },
              { label: t(language, 'map.chinese'), active: unit.isChinese ?? false, onToggle: () => onToggleChinese(building.id, unit.id) },
            ].map(flag => (
              <button
                key={flag.label}
                type="button"
                onClick={() => { if (!requireRecordAccess()) return; flag.onToggle() }}
                disabled={!canRecordVisits}
                style={{
                  flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 3,
                  padding: '5px 2px', borderRadius: 6,
                  border: flag.active ? 'none' : '1px solid var(--line)',
                  background: flag.active ? 'var(--ink)' : 'var(--surface)',
                  color: flag.active ? '#fff' : 'var(--muted)',
                  fontSize: 11, fontWeight: 600,
                  cursor: canRecordVisits ? 'pointer' : 'default',
                }}
              >
                {flag.active && <span style={{ fontSize: 11 }}>✓</span>}
                {flag.label}
              </button>
            ))}
            {/* 정기방문 — 팝업으로 담당자 지정 */}
            <button
              type="button"
              disabled={!canRecordVisits}
              onClick={() => {
                if (!requireRecordAccess()) return
                if (unit.isRegularVisit) {
                  onToggleRegularVisit(building.id, unit.id)
                } else {
                  setRegularNameDraft(currentVisitor ?? '')
                  setRegularDateDraft(getLocalDateString())
                  setShowRegularPopup(true)
                }
              }}
              style={{
                flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
                padding: '6px 4px', borderRadius: 7,
                border: unit.isRegularVisit ? 'none' : '1px solid var(--line)',
                background: unit.isRegularVisit ? '#B8862A' : 'var(--surface)',
                color: unit.isRegularVisit ? '#fff' : 'var(--muted)',
                fontSize: 11, fontWeight: 600,
                cursor: canRecordVisits ? 'pointer' : 'default',
              }}
            >
              {unit.isRegularVisit && <span style={{ fontSize: 11 }}>✓</span>}
              {t(language, 'map.regularVisit')}
            </button>
          </div>
          {unit.isRegularVisit && (
            <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              {unit.regularVisitor && (
                <span style={{ fontSize: 11, color: '#B8862A', fontWeight: 600 }}>
                  {t(currentLang(), 'app.manager', { defaultValue: msg('담당') })}: {unit.regularVisitor}
                </span>
              )}
              {unit.regularVisitStart && (
                <span style={{ fontSize: 11, color: 'var(--muted)' }}>
                  {t(currentLang(), 'app.start', { defaultValue: msg('시작') })}: {unit.regularVisitStart.slice(0, 10).replace(/-/g, '/')}
                </span>
              )}
              {canRecordVisits && (
                <button
                  type="button"
                  onClick={() => {
                    setRegularNameDraft(unit.regularVisitor ?? '')
                    setRegularDateDraft(unit.regularVisitStart ? unit.regularVisitStart.slice(0, 10) : '')
                    setShowRegularPopup(true)
                  }}
                  style={{ background: 'none', border: 'none', color: 'var(--muted)', fontSize: 11, cursor: 'pointer', textDecoration: 'underline', padding: 0 }}
                >{t(language, 'map.change')}</button>
              )}
            </div>
          )}
        </div>

        {/* 방문 이력 표 */}
        <div style={sectionStyle}>
          <button
            type="button"
            aria-expanded={historyGridOpen}
            onClick={() => setHistoryGridOpen((open) => !open)}
            style={{
              width: '100%', minHeight: 40, padding: 0, border: 0, background: 'none',
              display: 'grid', gridTemplateColumns: 'auto minmax(0, 1fr) auto',
              alignItems: 'center', gap: 8, textAlign: 'left', cursor: 'pointer',
            }}
          >
            <strong style={{ fontSize: 14, color: 'var(--ink)' }}>{msg('방문 시간')}</strong>
            <span style={{ overflow: 'hidden', color: 'var(--muted)', fontSize: 11.5, textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {historySummary}
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: 'var(--muted)', fontSize: 11.5 }}>
              {unitHistories.length}{t(language, 'map.cases')} {historyGridOpen ? '⌃' : '⌄'}
            </span>
          </button>
          {historyGridOpen && <div style={{ marginTop: 8, borderRadius: 8, overflow: 'hidden', border: '1px solid var(--line)' }}>
            {/* Header */}
            <div style={{ display: 'grid', gridTemplateColumns: '52px repeat(3, 1fr)', background: 'var(--bg)' }}>
              <div />
              {TIME_SLOTS.map(s => (
                <div key={s} style={{ textAlign: 'center', padding: '7px 4px', fontSize: 11, fontWeight: 600, color: 'var(--muted)' }}>{s === '오전' ? t(language, 'map.morning') : s === '오후' ? t(language, 'map.afternoon') : t(language, 'map.evening')}</div>
              ))}
            </div>
            {/* Rows */}
            {(['평일', '주말'] as RowKey[]).map((row) => (
              <div key={row} style={{
                display: 'grid', gridTemplateColumns: '52px repeat(3, 1fr)',
                borderTop: '1px solid var(--line)',
                background: 'var(--surface)',
              }}>
                <div style={{ padding: '8px 4px', fontSize: 11, fontWeight: 600, color: 'var(--muted)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{row === '평일' ? t(language, 'map.weekday') : t(language, 'map.weekend')}</div>
                {TIME_SLOTS.map(slot => {
                  const cell = visitGrid[row][slot]
                  const c = resultColor(cell.lastResult)
                  return (
                    <div key={slot} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '8px 4px', background: '#fff' }}>
                      {cell.total > 0 ? (
                        <span style={{
                          minWidth: 32, height: 24, padding: '0 5px', borderRadius: 5,
                          background: c + '22', color: c,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: 10, fontWeight: 700,
                        }}>{cell.lastResult === '만남' ? t(language, 'map.met') : cell.lastResult === '부재' ? t(language, 'map.absent') : cell.lastResult === '대상외' ? t(language, 'map.notTarget') : cell.lastResult} {cell.total}</span>
                      ) : (
                        <span style={{ color: 'var(--line)', fontSize: 14 }}>—</span>
                      )}
                    </div>
                  )
                })}
              </div>
            ))}
          </div>}
        </div>

        {/* 기록 */}
        {unitHistories.length > 0 && (
          <div style={sectionStyle}>
            <h3 style={{ ...sectionTitleStyle, marginBottom: 4 }}>{t(language, 'map.records')} {unitHistories.length}</h3>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {unitHistories.map((h, index) => {
                const c = resultColor(h.result)
                const isMenuOpen = editingHistoryId === h.id
                const isMemoOpen = inlineMemoHistoryId === h.id
                const dayNames = [t(language, 'map.sun'), t(language, 'map.mon'), t(language, 'map.tue'), t(language, 'map.wed'), t(language, 'map.thu'), t(language, 'map.fri'), t(language, 'map.sat')]
                const dow = dayNames[new Date(h.visitedAt).getDay()]
                const dateStr = `${h.visitedAt.slice(5).replace('-', '/')}(${dow})`
                return (
                  <div key={h.id} style={{
                    borderTop: index === 0 ? 'none' : '1px solid var(--line)',
                    padding: '6px 2px',
                    overflow: 'hidden',
                  }}>
                    {/* 메인 행 */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 4 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, flex: 1 }}>
                        <span style={{ fontWeight: 700, color: c, fontSize: 12, flexShrink: 0 }}>{h.result === '만남' ? t(language, 'map.met') : h.result === '부재' ? t(language, 'map.absent') : h.result === '대상외' ? t(language, 'map.notTarget') : h.result}</span>
                        <span style={{ fontSize: 11, color: 'var(--muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {dateStr} {h.timeSlot === '오전' ? t(language, 'map.morning') : h.timeSlot === '오후' ? t(language, 'map.afternoon') : h.timeSlot === '저녁' ? t(language, 'map.evening') : h.timeSlot}{h.visitor ? ` · ${h.visitor}` : ''}
                        </span>
                      </div>
                      {isMenuOpen ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                          <button onClick={() => { setHistoryToEdit(h); setEditingHistoryId(null) }}
                            style={{ padding: '2px 8px', border: '1px solid var(--line)', borderRadius: 5, background: 'var(--surface)', color: 'var(--ink)', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}
                            type="button">{t(language, 'common.edit')}</button>
                          <button onClick={async () => { if (await confirmDialog({ message: t(language, 'map.deleteHistoryConfirm'), danger: true, confirmLabel: msg('잘못 기록함') })) onDeleteVisitHistory(h.id, unit.id); setEditingHistoryId(null) }}
                            style={{ padding: '2px 8px', border: '1px solid #fecaca', borderRadius: 5, background: '#fef2f2', color: '#dc2626', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}
                            type="button">{t(language, 'common.delete')}</button>
                          <button onClick={() => setEditingHistoryId(null)}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', fontSize: 13, padding: '0 2px', lineHeight: 1 }}
                            type="button">✕</button>
                        </div>
                      ) : (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0 }}>
                          {canRecordVisits && onUpdateVisitHistory && (
                            <button
                              aria-expanded={isMemoOpen}
                              onClick={() => {
                                if (isMemoOpen) {
                                  setInlineMemoHistoryId(null)
                                  setInlineMemoDraft('')
                                  return
                                }
                                setInlineMemoHistoryId(h.id)
                                setInlineMemoDraft(h.memo ?? '')
                              }}
                              style={{
                                border: `1px solid ${isMemoOpen ? `${c}55` : 'var(--line)'}`,
                                borderRadius: 6,
                                background: isMemoOpen ? `${c}12` : 'var(--bg)',
                                cursor: 'pointer', color: isMemoOpen ? c : 'var(--muted)',
                                fontSize: 10.5, fontWeight: 600, padding: '3px 6px',
                              }}
                              type="button"
                            >{t(language, 'map.memo')}</button>
                          )}
                          {canRecordVisits && (
                            <button onClick={() => setEditingHistoryId(h.id)}
                              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', fontSize: 15, padding: '0 2px', lineHeight: 1 }}
                              type="button">⋮</button>
                          )}
                        </div>
                      )}
                    </div>
                    {/* 메모가 있는 기록만 둘째 줄을 쓴다. 빈 기록은 오른쪽의 작은 메모 버튼으로 연다. */}
                    {!isMemoOpen && h.memo && (
                      canRecordVisits && onUpdateVisitHistory ? (
                        <button
                          onClick={() => { setInlineMemoHistoryId(h.id); setInlineMemoDraft(h.memo ?? '') }}
                          style={{
                            display: 'block', width: '100%', textAlign: 'left',
                            margin: '3px 0 0', padding: 0, border: 'none', background: 'none',
                            fontSize: 11, lineHeight: 1.4, fontFamily: 'inherit', cursor: 'pointer',
                            color: 'var(--muted)',
                            whiteSpace: 'pre-wrap',
                          }}
                          type="button"
                        >{h.memo}</button>
                      ) : (
                        <p style={{ margin: '3px 0 0', fontSize: 11, color: 'var(--muted)', lineHeight: 1.4, paddingRight: 4 }}>{h.memo}</p>
                      )
                    )}
                    {/* 인라인 메모 입력 */}
                    {isMemoOpen && (
                      <div style={{ marginTop: 6, display: 'flex', gap: 5 }}>
                        <input
                          autoFocus
                          value={inlineMemoDraft}
                          onChange={e => setInlineMemoDraft(e.target.value)}
                          onKeyDown={e => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                              e.preventDefault()
                              onUpdateVisitHistory!(h.id, unit.id, { result: h.result as UnitStatus, timeSlot: h.timeSlot as TimeSlot, memo: inlineMemoDraft, visitedAt: h.visitedAt, invitationLeft: h.invitationLeft })
                              setInlineMemoHistoryId(null)
                            }
                            if (e.key === 'Escape') setInlineMemoHistoryId(null)
                          }}
                          placeholder={t(currentLang(), 'map.memoPlaceholder')}
                          style={{ flex: 1, padding: '5px 8px', border: `1px solid ${c}40`, borderRadius: 6, fontSize: 12, fontFamily: 'inherit', background: 'var(--bg)', color: 'var(--ink)', outline: 'none' }}
                        />
                        <button
                          onClick={() => {
                            onUpdateVisitHistory!(h.id, unit.id, { result: h.result as UnitStatus, timeSlot: h.timeSlot as TimeSlot, memo: inlineMemoDraft, visitedAt: h.visitedAt, invitationLeft: h.invitationLeft })
                            setInlineMemoHistoryId(null)
                          }}
                          style={{ padding: '5px 10px', border: 0, borderRadius: 6, background: c, color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer', flexShrink: 0 }}
                          type="button">{t(language, 'map.save')}</button>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* 세대 정보: 장소 종류는 관리자·인도자만 보고, 메모는 같은 카드에서 다룬다. */}
        <div style={sectionStyle}>
          <h3 style={{ ...sectionTitleStyle, marginBottom: 6 }}>{t(language, 'map.unitMemoLabel')}</h3>
          {canManagePlaceType && (
            <div className="mm-unit-info-row has-next">
              <span>{t(language, 'map.placeKind')}</span>
              <select
                aria-label={t(language, 'map.placeKind')}
                className="mm-place-kind-select"
                disabled={Boolean(unit.isRestaurant)}
                value={effectiveUnitUsage(building, unit)}
                onChange={(event) => {
                  const usage = event.target.value as Building['type']
                  onUpdateUnitFlags(unit.id, { usageType: usage === building.type ? null : usage })
                }}
              >
                <option value="주택">{t(language, 'map.house')}</option>
                <option value="상가">{t(language, 'map.shop')}</option>
              </select>
            </div>
          )}
          {memoEditing ? (
            <div className={canManagePlaceType ? 'mm-unit-info-memo has-divider' : 'mm-unit-info-memo'}>
              <textarea
                autoFocus
                aria-label={t(language, 'map.unitMemoLabel')}
                value={memoDraft ?? ''}
                onChange={e => setMemoDraft(e.target.value)}
                placeholder={t(language, 'map.unitInfoPlaceholder')}
                onFocus={(event) => {
                  const target = event.currentTarget
                  window.setTimeout(() => target.scrollIntoView({ block: 'center', behavior: 'smooth' }), 120)
                }}
                style={{
                  width: '100%', minHeight: 72, padding: '8px 10px',
                  border: '1px solid var(--line)', borderRadius: 8,
                  background: 'var(--bg)', color: 'var(--ink)',
                  fontSize: 13, lineHeight: 1.5, fontFamily: 'inherit',
                  resize: 'none', boxSizing: 'border-box',
                }}
              />
              <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                <button
                  onClick={() => {
                    // ⚠ 예전에는 화면 상태만 바꿔 새로고침하면 메모가 사라졌다 — DB 에도 저장한다
                    const next = memoDraft ?? ''
                    onUpdateUnitFlags(unit.id, { memo: next })
                    setUnitMemos(prev => ({ ...prev, [unit.id]: next }))
                    setMemoEditing(false)
                    onMemoEditingChange?.(false)
                  }}
                  style={{ flex: 1, padding: '8px', border: 'none', borderRadius: 8, background: 'var(--ink)', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}
                  type="button"
                >{t(language, 'map.save')}</button>
                <button
                  onClick={() => { setMemoEditing(false); setMemoDraft(null); onMemoEditingChange?.(false) }}
                  style={{ flex: 1, padding: '8px', border: '1px solid var(--line)', borderRadius: 8, background: 'var(--surface)', color: 'var(--muted)', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
                  type="button"
                >{t(language, 'map.cancel')}</button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => {
                if (!requireRecordAccess()) return
                setMemoDraft(memo)
                setMemoEditing(true)
                onMemoEditingChange?.(true)
              }}
              className={canManagePlaceType ? 'mm-unit-info-row mm-unit-info-memo-button has-divider' : 'mm-unit-info-row mm-unit-info-memo-button'}
              style={{
                width: '100%', minHeight: 40, textAlign: 'left',
                color: memo ? 'var(--ink)' : 'var(--muted)',
                cursor: canRecordVisits ? 'pointer' : 'default',
                display: 'grid', gridTemplateColumns: 'auto minmax(0, 1fr) auto',
                alignItems: 'center', gap: 10, fontFamily: 'inherit',
              }}
              type="button"
            >
              <strong style={{ fontSize: 13, color: 'var(--ink)' }}>{t(language, 'map.memoLabel')}</strong>
              <span style={{ overflow: 'hidden', fontSize: 12.5, lineHeight: 1.4, textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {memo || t(language, 'map.addUnitInfo')}
              </span>
              <span aria-hidden="true" style={{ fontSize: 16 }}>›</span>
            </button>
          )}
          <p className="mm-unit-info-privacy">{t(language, 'map.unitInfoPrivacy')}</p>
        </div>

        {/* 정기방문 담당자 팝업 */}
        {showRegularPopup && (
          <div
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 700, display: 'grid', placeItems: 'center', padding: '0 24px' }}
            onClick={() => setShowRegularPopup(false)}
          >
            <div
              style={{ background: 'var(--surface)', borderRadius: 16, padding: '20px', width: '100%', maxWidth: 340 }}
              onClick={e => e.stopPropagation()}
            >
              <h3 style={{ margin: '0 0 12px', fontSize: 15, fontWeight: 700, color: 'var(--ink)' }}>{t(language, 'map.manager')}</h3>
              {/* 검색 입력 */}
              <input
                autoFocus
                value={regularNameDraft}
                onChange={e => setRegularNameDraft(e.target.value)}
                placeholder={t(currentLang(), 'map.searchName')}
                style={{
                  width: '100%', padding: '9px 12px', border: '1px solid var(--line)',
                  borderRadius: 8, fontSize: 13, background: 'var(--bg)', color: 'var(--ink)',
                  boxSizing: 'border-box',
                }}
              />
              {/* 시작 날짜 */}
              <p style={{ margin: '10px 0 4px', fontSize: 11, fontWeight: 600, color: 'var(--muted)' }}>{t(language, 'map.startDate')}</p>
              <input
                type="date"
                value={regularDateDraft}
                onChange={e => setRegularDateDraft(e.target.value)}
                style={{
                  width: '100%', padding: '8px 10px', border: '1px solid var(--line)',
                  borderRadius: 8, fontSize: 13, background: 'var(--bg)', color: 'var(--ink)',
                  boxSizing: 'border-box',
                }}
              />
              {/* 검색 결과 목록 */}
              {(() => {
                const q = regularNameDraft.trim()
                const matched = q
                  ? allUsers.filter(u => u.name.includes(q))
                  : allUsers.slice(0, 6)
                return matched.length > 0 ? (
                  <div style={{ marginTop: 6, borderRadius: 8, border: '1px solid var(--line)', overflow: 'hidden', maxHeight: 180, overflowY: 'auto' }}>
                    {matched.map((u, i) => (
                      <button
                        key={u.id}
                        type="button"
                        onClick={() => setRegularNameDraft(u.name)}
                        style={{
                          display: 'block', width: '100%', textAlign: 'left',
                          padding: '9px 12px', background: regularNameDraft === u.name ? '#B8862A1a' : 'var(--surface)',
                          border: 'none', borderTop: i > 0 ? '1px solid var(--line)' : 'none',
                          color: regularNameDraft === u.name ? '#B8862A' : 'var(--ink)',
                          fontSize: 13, fontWeight: regularNameDraft === u.name ? 700 : 400, cursor: 'pointer',
                        }}
                      >{u.name}</button>
                    ))}
                  </div>
                ) : null
              })()}
              <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
                <button
                  type="button"
                  onClick={() => setShowRegularPopup(false)}
                  style={{ flex: 1, padding: '9px', border: '1px solid var(--line)', borderRadius: 8, background: 'var(--surface)', color: 'var(--muted)', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
                >{t(language, 'map.cancel')}</button>
                <button
                  type="button"
                  onClick={async () => {
                    const name = regularNameDraft.trim()
                    if (!name) return
                    const dateIso = regularDateDraft ? new Date(regularDateDraft).toISOString() : undefined
                    if (unit.isRegularVisit && onSetRegularVisitor) {
                      await onSetRegularVisitor(unit.id, name, dateIso)
                    } else {
                      onToggleRegularVisit(building.id, unit.id, name)
                      if (dateIso && onSetRegularVisitor) {
                        await onSetRegularVisitor(unit.id, name, dateIso)
                      }
                    }
                    setShowRegularPopup(false)
                  }}
                  style={{ flex: 2, padding: '9px', border: 'none', borderRadius: 8, background: '#B8862A', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}
                >{t(language, 'map.register')}</button>
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  )
}
