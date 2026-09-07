import { t } from '../i18n'
import { kindToFilters, filtersToKind, type BuildingKind } from '../utils/buildingKindFilter'
import { canEditVisitor, visitorOptionsFrom } from '../utils/visitorPicker'
import type { AppLanguage } from '../i18n'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '../hooks/useAuth'
import { getRegionNames } from '../lib/regions'
import { getAreaFilterOptions } from '../utils/areaOptions'
import { planDuplicateBuildingMerge } from '../utils/duplicateBuildingMerge'
import { getGeocodeCandidates } from '../utils/geocodeCandidates'
import { chooseCardForBuilding } from '../utils/chooseCardForBuilding'
import { visibleSelection, hasHiddenSelection } from '../utils/visibleSelection'
import { showToast } from '../lib/toast'
import { confirmDialog } from '../lib/confirm'
import { geocodeFirstMatch } from '../lib/naverGeocode'
import { findCardForCoordinates, formatDisplayAddress, isValidMapCoordinate } from '../utils/mapUtils'
import { mergeCardBoundaryPoints } from '../utils/boundaryMerge'
import { useCardBoundaryBackup } from '../hooks/useCardBoundaryBackup'
import { getTerritoryCardOperationalState } from '../utils/cardSearch'
import { filterTerritoryCards } from '../utils/filterTerritoryCards'
import { filterBuildingsByScope, filterBuildingsByTraits, hasText } from '../utils/filterBuildings'
import { buildPointRows } from '../utils/buildPointRows'
import type { CardMergeUndoSnapshot } from '../hooks/storeMutations/cardBoundaries'
import { compareUnitNumbers } from '../utils/unitNumber'
import type { Building, CardBoundary, GeoPoint, InformalAsset, InformalGroup, InformalKind, Role, TerritoryCard, TerritoryRegion, TimeSlot, Unit, UnitStatus, VisitHistory } from '../types'
import { InformalCardsTab } from './InformalCardsTab'
import { countInformalCards } from '../utils/informalAssets'
import { RestaurantsTab } from './RestaurantsTab'
import type { CsvBuildingImport } from '../utils/csvBuildingImport'
import { AddUnitRow } from './AddUnitRow'
import { useSessionState } from '../hooks/useSessionState'
import { BuildingEditCells, UnitEditForm, type BuildingEditDraft } from './BuildingEditRows'
import { CardCreateModal } from './DesktopTerritoryCardModal'
import { BoundaryDrawPrompt } from './BoundaryDrawPrompt'
import { CsvImportModal } from './CsvImportModal'
import { DuplicateBuildingMergeModal } from './DuplicateBuildingMergeModal'
import { TerritoryDetailPane } from './TerritoryDetailPane'
import { AddBuildingModal, type AddBuildingForm } from './AddBuildingModal'
import { PointVisitEditor, type VisitDraft } from './PointVisitEditor'
import type { MergeResult } from '../utils/duplicateBuildingMerge'
import { msg } from '../lib/msg'
import { getRestaurantUnits } from '../utils/restaurants'
import { placeDeletionCopy } from '../utils/placeDeletion'
import { compareBuildingsForTable, comparePointRowsForTable, type BuildingSortKey, type PointSortKey } from '../utils/territoryTableSort'

// 상대 날짜 표시: "오늘", "어제", "N일 전", "N주 전", "N개월 전", "YYYY-MM-DD"
function formatRelativeDate(iso: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const target = new Date(d)
  target.setHours(0, 0, 0, 0)
  const diffDays = Math.floor((today.getTime() - target.getTime()) / 86400000)
  if (diffDays === 0) return '오늘'
  if (diffDays === 1) return '어제'
  if (diffDays < 7) return `${diffDays}일 전`
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}주 전`
  if (diffDays < 365) return `${Math.floor(diffDays / 30)}개월 전`
  return iso.slice(0, 10)
}

function getDefaultTimeSlot(): TimeSlot {
  const hour = new Date().getHours()
  if (hour < 12) return '오전'
  if (hour < 18) return '오후'
  return '저녁'
}

function getTodayDateInputValue() {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

type CardStatusFilter = TerritoryCard['status'] | '전체' | '완료·제외'

export function DesktopTerritory({
  language,
  buildings,
  cardBoundaries,
  cards,
  role,
  onSetCardLeaders,
  onSetMultipleCardLeaders,
  onCreateCard,
  onCreateTerritoryRegion,
  onCreateInformalPlace,
  onUpdateInformalPlace,
  onOpenInformalOnMap,
  onDeleteBuildings,
  onDeleteCards,
  onMergeDuplicateBuildings,
  onImportBuildings,
  onMoveBuildingToCard,
  onReassignBuildingsToCards,
  onUpdateBuilding,
  onToggleChinese,
  onToggleRegularVisit,
  onSetRegularVisitor,
  onAddUnit,
  onSetUnitsSurveyed,
  onDeleteUnit,
  onUpdateUnitFlags,
  onUpdateUnitStatus,
  onAddVisitHistory,
  onUpdateVisitHistory,
  onDeleteVisitHistory,
  onRestoreCardBoundaries,
  onMergeCardBoundaries,
  onUndoMergeCardBoundaries,
  onOpenCardMap,
  onOpenBuildingMap,
  visitHistories,
  onCreateBuilding,
  onSwitchToMap,
  // v2 신 배정 모델
  currentVisitor = '',
  informalAssets = [],
  informalGroups = [],
  onUploadInformalAsset,
  onDeleteInformalAsset,
  onDeleteInformalAssets,
  onCreateInformalGroup,
  onRenameInformalGroup,
  onDeleteInformalGroup,
  onMoveAssetToGroup,
  onMoveAssetsToGroup,
  onToggleBuildingRestaurant,
  onRemoveRestaurantUnit,
  onBulkSetRestaurant,
  restaurantRequests = [],
  onRegisterRestaurant,
  onApproveRestaurantRequest,
  onRejectRestaurantRequest,
}: {
  language: AppLanguage
  buildings: Building[]
  cardBoundaries: CardBoundary[]
  cards: TerritoryCard[]
  role: Role
  onSetCardLeaders: (cardId: number, leaderNames: string[], options?: { silentSuccess?: boolean }) => Promise<void> | void
  onSetMultipleCardLeaders: (cardIds: number[], leaderNames: string[], options?: { silentSuccess?: boolean }) => Promise<void> | void
  onDeleteBuildings: (buildingIds: number[]) => void
  onDeleteCards: (cardIds: number[]) => void
  onMergeDuplicateBuildings: (scopeCardId?: number, nameOverrides?: Record<number, string>, selectedPrimaryIds?: number[]) => Promise<MergeResult>
  onImportBuildings: (inputs: CsvBuildingImport[]) => Promise<{ inserted: number; skipped: number }>
  onMoveBuildingToCard: (buildingId: number, cardId: number) => Promise<boolean>
  onReassignBuildingsToCards: (updates: Array<{ buildingId: number; cardId: number }>) => Promise<{ updated: number; failed: number }>
  onUpdateBuilding: (buildingId: number, name: string, address: string, lat?: number, lng?: number, type?: Building['type'], memo?: string) => Promise<boolean>
  onToggleChinese: (buildingId: number, unitId: number) => void
  onToggleRegularVisit: (buildingId: number, unitId: number, visitorName?: string) => void
  onSetRegularVisitor: (unitId: number, visitorName: string) => void
  onAddUnit: (buildingId: number, unitNumber: string | string[], usageType?: Building['type']) => Promise<number[] | false>
  /** 건물의 '세대 확인 완료' 표시 (utils/buildingPin — 없으면 완료로 안 친다) */
  onSetUnitsSurveyed?: (buildingId: number, surveyed: boolean) => Promise<boolean> | void
  onDeleteUnit: (buildingId: number, unitId: number) => void
  onUpdateUnitFlags: (unitId: number, flags: Partial<Unit>) => void | Promise<boolean>
  onUpdateUnitStatus: (buildingId: number, unitId: number, status: UnitStatus, memo?: string) => void
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
  onDeleteVisitHistory?: (historyId: number, unitId: number) => void
  onRestoreCardBoundaries?: (boundaries: CardBoundary[]) => Promise<void> | void
  onMergeCardBoundaries?: (input: {
    targetCardId: number
    sourceCardIds: number[]
    mergedPoints: GeoPoint[]
  }) => Promise<void> | void
  onUndoMergeCardBoundaries?: (snapshot: CardMergeUndoSnapshot) => Promise<void>
  onOpenCardMap: (cardId: number, editBoundary?: boolean) => void
  onOpenBuildingMap: (buildingId: number) => void
  visitHistories: VisitHistory[]
  onCreateCard: (input: {
    area: string
    region: string
    index: number
    pinCount: number
  }) => Promise<number | null> | number | null
  /** 지역 추가 — 관리자·개발자만 호출된다 (모달에서 canAddRegion 으로 막는다) */
  onCreateInformalPlace?: (input: { name: string; createdBy: string; groupId?: number | null; lat: number; lng: number; memo?: string; zoom?: number | null; kind?: InformalKind; parentId?: number | null }) => Promise<boolean>
  /** 만든 뒤에 종류·이름을 고친다 */
  onUpdateInformalPlace?: (
    assetId: number,
    input: { name?: string; memo?: string; lat?: number; lng?: number; zoom?: number | null; kind?: InformalKind },
  ) => Promise<boolean>
  onOpenInformalOnMap?: (assetId: number) => void
  onCreateTerritoryRegion?: (input: { name: string; city?: string }) => Promise<boolean>
  onCreateBuilding?: (input: { cardId: number; name: string; address: string; type: Building['type']; lat: number; lng: number }) => Promise<boolean>
  onSwitchToMap?: () => void
  currentVisitor?: string
  informalAssets?: InformalAsset[]
  informalGroups?: InformalGroup[]
  onUploadInformalAsset?: (input: { file: File; name: string; uploadedBy: string; groupId?: number | null }) => Promise<{ ok: boolean; assetId?: number; error?: string }>
  onDeleteInformalAsset?: (assetId: number) => Promise<boolean>
  onDeleteInformalAssets?: (assetIds: number[]) => Promise<{ failed: number[] }>
  onCreateInformalGroup?: (input: { name: string; createdBy: string }) => Promise<number | null>
  onRenameInformalGroup?: (groupId: number, name: string) => Promise<boolean>
  onDeleteInformalGroup?: (groupId: number) => Promise<boolean>
  onMoveAssetToGroup?: (assetId: number, groupId: number | null) => Promise<boolean>
  onMoveAssetsToGroup?: (assetIds: number[], groupId: number | null) => Promise<{ failed: number[] }>
  onToggleBuildingRestaurant?: (buildingId: number, isRestaurant: boolean) => Promise<void>
  onRemoveRestaurantUnit?: (unitId: number, buildingId: number) => Promise<void>
  onBulkSetRestaurant?: (buildingIds: number[], nameUpdates?: { id: number; name: string }[]) => Promise<void>
  restaurantRequests?: import('../types').RestaurantRequest[]
  onRegisterRestaurant?: import('../types/restaurantRegistration').RegisterRestaurant
  onApproveRestaurantRequest?: (id: number, opts: { name: string; address: string; reviewer: string; existingBuildingId?: number | null; lat?: number; lng?: number }) => Promise<void>
  onRejectRestaurantRequest?: (id: number, reviewer: string) => Promise<void>
}) {
  const { allUsers, fetchAllUsers } = useAuth()
  const isAdmin = role === 'admin'

  // 방문자를 고칠 수 있는 사람: 관리자·개발자·인도자.
  // ⚠ 일반 사용자에게는 칸 자체를 안 보여준다 — 자기 기록만 적는 사람에게
  //   남의 이름을 고를 수단을 주면 실수로 엉뚱하게 남는다.
  const canEditVisitorHere = canEditVisitor(role)
  const [selectedCardId, setSelectedCardId] = useState<number | null>(null)
  const [checkedCardIds, setCheckedCardIds] = useState<Set<number>>(new Set())
  const [checkedBuildingIds, setCheckedBuildingIds] = useState<Set<number>>(new Set())
  const [cardMergeModalOpen, setCardMergeModalOpen] = useState(false)
  const [cardMergeTargetId, setCardMergeTargetId] = useState<number | null>(null)
  const [cardMergeUndo, setCardMergeUndo] = useState<CardMergeUndoSnapshot | null>(null)
  const [detailPaneOpen, setDetailPaneOpen] = useState(false)
  // 탭·필터는 세션에 보존 — 지도 등 다른 화면 갔다 뒤로 와도 보던 상태 유지
  const [activeTab, setActiveTab] = useSessionState<'카드 관리' | '건물 관리'>('dt.activeTab', '카드 관리')
  // v2: 종류 sub-tab
  type ZoneKind = 'territory' | 'informal' | 'restaurant'
  const [zoneKind, setZoneKind] = useSessionState<ZoneKind>('dt.zoneKind', 'territory')
  const informalCount = countInformalCards(informalAssets)
  const restaurantCount = buildings.reduce((acc, b) => {
    const units = getRestaurantUnits(b).length
    if (units === 0) return acc + (b.isRestaurant ? 1 : 0)
    return acc + units
  }, 0)
  const [buildingSubTab, setBuildingSubTab] = useSessionState<'건물 목록' | '세대 목록'>('dt.buildingSubTab', '건물 목록')
  const [showCardModal, setShowCardModal] = useState(false)
  const [pendingBoundaryCard, setPendingBoundaryCard] = useState<{ id: number; name: string } | null>(null)
  const [regionFilter, setRegionFilter] = useSessionState<TerritoryRegion | '전체'>('dt.regionFilter', '전체')
  const [areaFilter, setAreaFilter] = useSessionState('dt.areaFilter', '전체')
  const [areaExpanded, setAreaExpanded] = useState(false)
  const AREA_CHIP_LIMIT = 10
  const [assignmentFilter, setAssignmentFilter] = useSessionState<'전체' | '배정' | '미배정'>('dt.assignmentFilter', '전체')
  const [leaderFilter, setLeaderFilter] = useSessionState('dt.leaderFilter', '전체')
  const [regularVisitFilter, setRegularVisitFilter] = useSessionState<'전체' | '있음' | '없음'>('dt.regularVisitFilter', '전체')
  const [cardStatusFilter, setCardStatusFilter] = useSessionState<CardStatusFilter>('dt.cardStatusFilter', '전체')
  const [doneExcludedOpen, setDoneExcludedOpen] = useState(false)
  const [cardFilterPanelOpen, setCardFilterPanelOpen] = useState(false)
  const [buildingFilterPanelOpen, setBuildingFilterPanelOpen] = useState(false)
  const [pointFilterPanelOpen, setPointFilterPanelOpen] = useState(false)
  const [buildingCardFilter, setBuildingCardFilter] = useSessionState<number | '전체'>('dt.buildingCardFilter', '전체')
  const [buildingTypeFilter, setBuildingTypeFilter] = useSessionState<Building['type'] | '전체'>('dt.buildingTypeFilter', '전체')
  const [pointStatusFilter, setPointStatusFilter] = useSessionState<UnitStatus | '전체'>('dt.pointStatusFilter', '전체')
  // 세대 목록의 구분 — 예전에는 "중국어 또는 정기방문" 으로 고정이라 일반 세대를 볼 수 없었다.
  // 기본값은 '중국어' 로 두어 이 화면을 쓰던 방식이 그대로 유지되게 한다.
  // PointSortKey / BuildingSortKey 는 utils/territoryTableSort 한 곳에서만 정한다
  const [pointSort, setPointSort] = useSessionState<{ key: PointSortKey; dir: 'asc' | 'desc' }>('dt.pointSort', { key: '카드', dir: 'asc' })
  type PointKindFilter = '전체' | '중국어' | '정기방문' | '식당'
  const [pointKindFilter, setPointKindFilter] = useSessionState<PointKindFilter>('dt.pointKindFilter', '중국어')
  const [buildingRegularFilter, setBuildingRegularFilter] = useSessionState<'전체' | '있음' | '없음'>('dt.buildingRegularFilter', '전체')
  const [buildingMemoFilter, setBuildingMemoFilter] = useSessionState<'전체' | '있음' | '없음'>('dt.buildingMemoFilter', '전체')
  // 식당 등록 여부 — 상가 중 어디가 식당인지 골라 보기 위함
  const [buildingRestaurantFilter, setBuildingRestaurantFilter] = useSessionState<'전체' | '식당' | '식당 아님'>('dt.buildingRestaurantFilter', '전체')
  const [buildingSurveyedFilter, setBuildingSurveyedFilter] = useSessionState<'전체' | '확인필요' | '확인됨'>('dt.buildingSurveyedFilter', '전체')
  const [pointRegularFilter, setPointRegularFilter] = useSessionState<'전체' | '있음' | '없음'>('dt.pointRegularFilter', '전체')
  const [pointMemoFilter, setPointMemoFilter] = useSessionState<'전체' | '있음' | '없음'>('dt.pointMemoFilter', '전체')
  const [buildingSort, setBuildingSort] = useSessionState<{ key: BuildingSortKey; dir: 'asc' | 'desc' }>('dt.buildingSort', { key: '카드', dir: 'asc' })
  const [editingBuildingId, setEditingBuildingId] = useState<number | null>(null)
  const [editingUnitId, setEditingUnitId] = useState<number | null>(null)
  // 건물/세대 편집 draft 는 BuildingEditRows 의 자식 컴포넌트가 로컬로 보유.
  // (여기 두면 타이핑마다 이 거대 페이지 전체가 재렌더돼 입력이 끊김)
  const [showCsvModal, setShowCsvModal] = useState(false)
  // 중복 주소 합치기 이름 선택 모달
  const [mergeModalGroups, setMergeModalGroups] = useState<Array<{ primaryId: number; address: string; cardName: string; buildingCount: number; unitCount: number; names: string[] }> | null>(null)
  /** 병합 중에는 창을 닫지 않는다. 닫아도 작업은 계속돼 결과를 아무도 못 본다 */
  const [pendingChineseToggle, setPendingChineseToggle] = useState<{
    buildingId: number
    unitId: number
    cardName: string
    buildingName: string
    unitNumber: string
  } | null>(null)
  // 건물 추가 모달
  const [addBuildingOpen, setAddBuildingOpen] = useState(false)
  const [reassigningByBoundary, setReassigningByBoundary] = useState(false)
  const [reassigningChecked, setReassigningChecked] = useState(false)
  // "미배정 건물" 카드 ID (이 카드에 속한 건물 = 아직 구역 미지정)
  const unassignedCardId = useMemo(
    () => cards.find((c) => c.name === '미배정 건물')?.id ?? null,
    [cards],
  )
  const [bulkLeaderNames, setBulkLeaderNames] = useState<string[]>([])
  const [bulkAssigning, setBulkAssigning] = useState(false)
  const [pointVisitEditor, setPointVisitEditor] = useState<{
    mode: 'add' | 'edit'
    buildingId: number
    unitId: number
    historyId?: number
    label: string
    /** 폼 초기값. 이후 값은 모달이 들고 있다 */
    draft: VisitDraft
  } | null>(null)
  const [selectedPointDetail, setSelectedPointDetail] = useState<{ buildingId: number; unitId: number } | null>(null)
  const [selectedPointDetailOffset, setSelectedPointDetailOffset] = useState(386)
  const [openHistoryActionId, setOpenHistoryActionId] = useState<number | null>(null)
  const pointTableRef = useRef<HTMLDivElement | null>(null)
  const pointDetailPaneRef = useRef<HTMLElement | null>(null)
  const pointRowRefs = useRef<Map<string, HTMLDivElement>>(new Map())
  const boundaryImportInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    // ⚠ 인도자도 방문자를 고칠 수 있으므로 목록이 필요하다.
    //   예전엔 관리자일 때만 받아서, 인도자에게는 고를 이름이 없었다.
    if (canEditVisitorHere && allUsers.length === 0) {
      fetchAllUsers()
    }
  }, [allUsers.length, fetchAllUsers, canEditVisitorHere])

  const cardMap = useMemo(() => new Map(cards.map((card) => [card.id, card])), [cards])
  const buildingsByCardId = useMemo(() => {
    const map = new Map<number, Building[]>()
    buildings.forEach((building) => {
      const list = map.get(building.cardId)
      if (list) list.push(building)
      else map.set(building.cardId, [building])
    })
    return map
  }, [buildings])
  const visitHistoriesByUnitId = useMemo(() => {
    const map = new Map<number, VisitHistory[]>()
    visitHistories.forEach((history) => {
      const list = map.get(history.unitId)
      if (list) list.push(history)
      else map.set(history.unitId, [history])
    })
    map.forEach((list) => {
      list.sort((a, b) => {
        const at = new Date(a.visitedAt).getTime()
        const bt = new Date(b.visitedAt).getTime()
        if (bt !== at) return bt - at
        return b.id - a.id
      })
    })
    return map
  }, [visitHistories])

  const openPointVisitEditor = (input: {
    building: Building
    unit: Unit
    history?: VisitHistory
  }) => {
    const { building, unit, history } = input
    setPointVisitEditor({
      mode: history ? 'edit' : 'add',
      buildingId: building.id,
      unitId: unit.id,
      historyId: history?.id,
      label: `${building.name || formatDisplayAddress(building.address)} · ${unit.number}`,
      draft: {
        result: history?.result ?? unit.status,
        timeSlot: history?.timeSlot ?? getDefaultTimeSlot(),
        visitedAt: history?.visitedAt?.slice(0, 10) ?? getTodayDateInputValue(),
        // 세대 메모를 방문 기록 메모에 미리 채우지 않는다 —
        // 그대로 저장되면 같은 문장이 방문할 때마다 기록에 복제된다
        memo: history?.memo ?? '',
        // ⚠ 이 줄이 빠지면 편집기가 **첫 항목을 고른 것처럼** 보이고,
        //   열었다 저장만 해도 남의 기록이 된다. 실제로 한 번 빠뜨렸다.
        visitor: history?.visitor ?? '',
      },
    })
  }

  const savePointVisitEditor = async (payload: VisitDraft): Promise<boolean> => {
    if (!pointVisitEditor) return false
    const ok = pointVisitEditor.mode === 'edit' && pointVisitEditor.historyId
      ? await onUpdateVisitHistory(pointVisitEditor.historyId, pointVisitEditor.unitId, payload)
      : await onAddVisitHistory(pointVisitEditor.buildingId, pointVisitEditor.unitId, payload)
    // 닫는 것은 편집기가 한다. 두 곳에서 닫으면 책임이 겹친다.
    return ok
  }


  const deletePointVisitHistory = async (history: VisitHistory) => {
    if (!onDeleteVisitHistory) return
    if (!(await confirmDialog({ message: msg('잘못 기록한 방문으로 처리할까요? 원본은 관리자 기록에 보존됩니다.'), danger: true, confirmLabel: msg('잘못 기록함') }))) return
    onDeleteVisitHistory(history.id, history.unitId)
    setOpenHistoryActionId(null)
  }

  // 실제 카드에서 뽑는다. 예전에는 지역을 좁히면 하드코딩된 5개만 남아
  // 백암면·양지면처럼 카드가 수십 장인 동이 필터에서 사라졌다.
  const areaFilterOptions = getAreaFilterOptions(cards, regionFilter === '전체' ? '' : regionFilter)

  const getAreaCardCount = (area: string) =>
    cards.filter((card) => {
      if (card.area !== area) return false
      if (regionFilter !== '전체' && card.region !== regionFilter) return false
      return true
    }).length

  const getAreaMetricCount = (area: string) => {
    if (activeTab === '건물 관리' && buildingSubTab === '세대 목록') {
      return buildings.reduce((sum, building) => {
        const card = cardMap.get(building.cardId)
        if (!card || card.area !== area) return sum
        if (regionFilter !== '전체' && card.region !== regionFilter) return sum
        return sum + building.units.filter((unit) => unit.isChinese || unit.isRegularVisit).length
      }, 0)
    }

    if (activeTab === '건물 관리') {
      return buildings.reduce((sum, building) => {
        const card = cardMap.get(building.cardId)
        if (!card || card.area !== area) return sum
        if (regionFilter !== '전체' && card.region !== regionFilter) return sum
        return sum + 1
      }, 0)
    }

    return getAreaCardCount(area)
  }


  // ⚠ useCallback 으로 감싼다. 안 그러면 매 렌더마다 새 함수가 되고,
  //   이걸 의존성으로 쓰는 filteredCards 의 useMemo 가 **매번 다시 계산된다**
  //   (memo 를 붙여놓고 안 걸리는 상태가 된다).
  const getCardLeaderList = useCallback((card: TerritoryCard) =>
    (card.assignedLeaders && card.assignedLeaders.length > 0)
      ? card.assignedLeaders
      : card.assignedLeader
        ? [card.assignedLeader]
        : [], [])

  const cardHasRegularVisit = useCallback((card: TerritoryCard) =>
    card.regularVisits > 0 ||
    card.regularVisitPoints.length > 0 ||
    (buildingsByCardId.get(card.id) ?? []).some((building) => building.units.some((unit) => unit.isRegularVisit)),
    [buildingsByCardId])

  const leaderFilterOptions = Array.from(
    new Set(cards.flatMap((card) => getCardLeaderList(card))),
  ).sort((a, b) => a.localeCompare(b, 'ko'))

  // 조건 여덟 개가 얽혀 있어 utils/filterTerritoryCards 로 뺐다.
  // "왜 이 카드가 목록에 없지" 를 시험이 대답한다 ('대상없음' 규칙이 특히 헷갈린다).
  const filteredCards = useMemo(
    () => filterTerritoryCards(cards, {
      region: regionFilter,
      area: areaFilter,
      assignment: assignmentFilter,
      leader: leaderFilter,
      regularVisit: regularVisitFilter,
      status: cardStatusFilter,
    }, {
      leadersOf: getCardLeaderList,
      hasRegularVisit: cardHasRegularVisit,
    }),
    [cards, regionFilter, areaFilter, assignmentFilter, leaderFilter,
     regularVisitFilter, cardStatusFilter,
     getCardLeaderList, cardHasRegularVisit],
  )
  const isDoneExcludedCard = (card: TerritoryCard) => {
    const state = getTerritoryCardOperationalState(card)
    return state === '완료' || state === '대상없음'
  }
  const doneExcludedCards = cardStatusFilter === '완료·제외'
    ? []
    : filteredCards.filter(isDoneExcludedCard)
  const renderedCards = cardStatusFilter === '완료·제외' || doneExcludedOpen
    ? filteredCards
    : filteredCards.filter((card) => !isDoneExcludedCard(card))
  // ⚠ 일괄 작업과 표시는 **보이는 것만** 쓴다.
  //   예전에는 전체선택이 보이는 것만 더하고 뺐는데 삭제는 고른 것 전부를 지워,
  //   확인창의 개수 안에 화면에 없는 카드가 섞였다 (카드를 지우면 건물이 딸려 죽는다).
  //   ⚠ 기준은 `filteredCards` 가 아니라 **실제로 그리는 `renderedCards`** 다.
  //     완료·제외 카드를 접으면 화면에서 사라지는데 filteredCards 에는 남는다.
  //     (유틸 시험은 전부 통과했는데 배선이 틀렸던 자리다)
  const visibleCheckedCardIds = useMemo(
    () => visibleSelection(checkedCardIds, renderedCards),
    [checkedCardIds, renderedCards],
  )

  // 두 번째 방어: 안 보이게 된 선택은 아예 버린다.
  // 파생값만으로도 안전하지만, 버튼의 숫자와 실제 대상이 어긋나 보이지 않게 한다.
  useEffect(() => {
    if (hasHiddenSelection(checkedCardIds, renderedCards)) {
      setCheckedCardIds(new Set(visibleCheckedCardIds))
    }
  }, [checkedCardIds, renderedCards, visibleCheckedCardIds])

  const selectedMergeCards = renderedCards.filter((card) => checkedCardIds.has(card.id))

  const activeAdvancedCardFilterCount =
    (leaderFilter !== '전체' ? 1 : 0) +
    (regularVisitFilter !== '전체' ? 1 : 0) +
    (cardStatusFilter !== '전체' ? 1 : 0)
  const activeAdvancedBuildingFilterCount =
    (buildingRegularFilter !== '전체' ? 1 : 0) +
    (buildingMemoFilter !== '전체' ? 1 : 0) +
    (buildingSurveyedFilter !== '전체' ? 1 : 0)
  const activeAdvancedPointFilterCount =
    (pointRegularFilter !== '전체' ? 1 : 0) +
    (pointMemoFilter !== '전체' ? 1 : 0)

  const selectedCard =
    filteredCards.find((card) => card.id === selectedCardId) ??
    filteredCards[0] ??
    cards.find((card) => card.id === selectedCardId) ??
    cards[0] ??
    null
  const selectedCardBuildings = useMemo(
    () => (selectedCard ? buildingsByCardId.get(selectedCard.id) ?? [] : []),
    [selectedCard, buildingsByCardId],
  )
  const selectedChinesePointCount = selectedCardBuildings.reduce(
    (sum, building) => sum + building.units.filter((unit) => unit.isChinese).length,
    0,
  )
  const selectedHasBoundary = selectedCard
    ? cardBoundaries.some((boundary) => boundary.cardId === selectedCard.id)
    : false
  // 마지막 방문 정보 (선택한 카드 내의 모든 unit 방문 중 가장 최근)
  const selectedLastVisit = useMemo(() => {
    if (!selectedCard) return null
    const cardUnitIds = new Set(
      selectedCardBuildings.flatMap((b) => b.units.map((u) => u.id))
    )
    let latest: VisitHistory | null = null
    for (const v of visitHistories) {
      if (!cardUnitIds.has(v.unitId)) continue
      if (!latest || v.visitedAt > latest.visitedAt) latest = v
    }
    return latest
  }, [selectedCard, selectedCardBuildings, visitHistories])
  // 방문자로 고를 수 있는 이름. 승인·활성인 사람만.
  // ⚠ 지금 기록에 적힌 이름이 목록에 없을 수 있다(탈퇴·개명). 그건 편집기가
  //   따로 살려 둔다 — 목록에 없다고 조용히 다른 사람으로 바뀌면 안 된다.
  const visitorNameOptions = visitorOptionsFrom(allUsers)

  const leaderOptions = Array.from(
    new Set(
      allUsers
        .filter((user) => user.role === 'leader' || user.role === 'admin')
        .map((user) => user.name)
        .concat(
          cards.flatMap((card) => getCardLeaderList(card)),
        ),
    ),
  ).sort((a, b) => a.localeCompare(b, 'ko'))

  const toggleCardLeader = async (cardId: number, leaderName: string) => {
    const targetCard = cards.find((card) => card.id === cardId)
    if (!targetCard) return
    const current = getCardLeaderList(targetCard)
    const next = current.includes(leaderName)
      ? current.filter((name) => name !== leaderName)
      : [...current, leaderName]
    await Promise.resolve(onSetCardLeaders(cardId, next))
  }

  const toggleBulkLeaderName = (leaderName: string) => {
    setBulkLeaderNames((current) =>
      current.includes(leaderName)
        ? current.filter((name) => name !== leaderName)
        : [...current, leaderName],
    )
  }

  const handleAssignLeaderBulk = async () => {
    const targetIds = visibleCheckedCardIds
    if (targetIds.length === 0) {
      showToast(msg('먼저 카드를 선택해 주세요.'), 'error')
      return
    }
    const actionLabel = bulkLeaderNames.length > 0
      ? `'${bulkLeaderNames.join(', ')}' 인도자로 배정`
      : '인도자 배정 해제'
    const confirmed = await confirmDialog({ message: msg('선택한 카드 {length}개를 {actionLabel}할까요?', { length: targetIds.length, actionLabel: actionLabel }) })
    if (!confirmed) return

    setBulkAssigning(true)
    try {
      await Promise.resolve(onSetMultipleCardLeaders(targetIds, bulkLeaderNames, { silentSuccess: true }))
      showToast(
        bulkLeaderNames.length > 0
          ? `선택 카드 ${targetIds.length}개에 인도자를 배정했습니다.`
          : `선택 카드 ${targetIds.length}개의 인도자 배정을 해제했습니다.`,
        'success',
      )
      setCheckedCardIds(new Set())
    } finally {
      setBulkAssigning(false)
    }
  }

  // 건물 필터는 두 단계다 (utils/filterBuildings):
  //   ① 범위 — 지역·동·카드·유형. **세대 목록의 뿌리이기도 하다**
  //   ② 속성 — 정기방문·메모·중국어세대·식당
  // 합치면 세대 화면이 건물 조건에 끌려간다.
  const baseFilteredBuildings = useMemo(
    () => filterBuildingsByScope(buildings, {
      region: regionFilter, area: areaFilter,
      card: buildingCardFilter, type: buildingTypeFilter,
    }, (id) => cardMap.get(id)),
    [buildings, regionFilter, areaFilter, buildingCardFilter, buildingTypeFilter, cardMap],
  )
  const filteredBuildings = useMemo(
    () => filterBuildingsByTraits(baseFilteredBuildings, {
      regularVisit: buildingRegularFilter, memo: buildingMemoFilter,
      restaurant: buildingRestaurantFilter,
      surveyed: buildingSurveyedFilter,
    }),
    [baseFilteredBuildings, buildingRegularFilter, buildingMemoFilter,
     buildingRestaurantFilter, buildingSurveyedFilter],
  )


  const visibleCheckedBuildingIds = useMemo(
    () => visibleSelection(checkedBuildingIds, filteredBuildings),
    [checkedBuildingIds, filteredBuildings],
  )
  useEffect(() => {
    if (hasHiddenSelection(checkedBuildingIds, filteredBuildings)) {
      setCheckedBuildingIds(new Set(visibleCheckedBuildingIds))
    }
  }, [checkedBuildingIds, filteredBuildings, visibleCheckedBuildingIds])

  const handleAddBuildingSubmit = async (
    form: AddBuildingForm,
    latLng: { lat: number; lng: number } | null,
  ): Promise<boolean> => {
    if (!onCreateBuilding) return false

    // ⚠ 화면 필터를 보지 않는다. 예전에는 filteredCards 를 봐서
    //   기흥구로 걸러놓고 건물을 추가하면 저장되는 카드가 달라졌고,
    //   필터 결과가 비면 주소가 멀쩡해도 자동 배정이 통째로 실패했다.
    const picked = chooseCardForBuilding({
      chosen: form.cardId,
      latLng,
      address: form.address,
      cards,
      cardBoundaries,
      unassignedCardId,
    })
    if (picked.cardId === null) {
      showToast(msg('어느 카드에 넣을지 정하지 못했습니다. 카드를 직접 고르거나, 구역선을 먼저 그려 주세요.'), 'error')
      return false
    }
    // 어디로 갔는지 알려 준다 — 조용히 엉뚱한 카드에 들어가는 게 문제였다
    if (picked.how === 'boundary' || picked.how === 'unassigned') {
      const matched = cards.find((c) => c.id === picked.cardId)
      if (matched) showToast(msg('"{name}" 카드에 자동 배정됐습니다', { name: matched.name }), 'success')
    }
    const cardId = picked.cardId

    return onCreateBuilding({
      cardId,
      name: form.name,
      address: form.address,
      type: form.type,
      lat: latLng?.lat ?? 0,
      lng: latLng?.lng ?? 0,
    })
  }


  const sortedBuildings = [...filteredBuildings].sort((a, b) =>
    compareBuildingsForTable(a, b, {
      sort: buildingSort,
      cardName: (id) => cardMap.get(id)?.name ?? '',
      unassignedFirst: buildingCardFilter === '전체',
      unassignedCardId: unassignedCardId ?? null,
    }))

  // 미배정 필터의 추천 카드 배지 — 구역선 폴리곤 판정이라 렌더마다 돌면 무거움.
  // (건물/구역선이 바뀔 때만 계산 → 편집 중 타이핑 시 재계산 없음)
  const recommendationBadges = useMemo(() => {
    const map = new Map<number, { label: string; color: string; bg: string }>()
    if (buildingCardFilter !== unassignedCardId || unassignedCardId === null) return map
    for (const building of filteredBuildings) {
      const lat = Number(building.lat); const lng = Number(building.lng)
      if (!isValidMapCoordinate(lat, lng)) {
        map.set(building.id, { label: '좌표없음', color: '#d97706', bg: '#fffbeb' })
        continue
      }
      const cId = findCardForCoordinates(lat, lng, cardBoundaries)
      if (!cId) {
        map.set(building.id, { label: '구역선밖', color: '#dc2626', bg: '#fef2f2' })
        continue
      }
      map.set(building.id, { label: `→ ${cardMap.get(cId)?.name ?? `카드${cId}`}`, color: '#16a34a', bg: '#f0fdf4' })
    }
    return map
  }, [filteredBuildings, buildingCardFilter, unassignedCardId, cardBoundaries, cardMap])

  // const buildingUnitsTotal = filteredBuildings.reduce((sum, building) => sum + building.units.length, 0)


  // 묶는 규칙과 충돌 판정을 utils 의 순수 함수 하나로 모은다.
  // 예전에는 여기서 따로 묶어서, 호수가 겹쳐 병합되지 않을 묶음도 그냥 보여 줬다.
  // 사용자는 고르고 눌렀는데 아무 일도 안 일어났다. 이제 미리 갈라서 보여 준다.
  // (실제 판정은 DB 안에서 다시 한다 — 화면 데이터는 낡을 수 있다)
  const mergePlan = planDuplicateBuildingMerge(filteredBuildings)
  const duplicateAddressGroups = [
    ...mergePlan.merge.map((g) => [g.primary, ...g.absorbed]),
    ...mergePlan.conflicts.map((c) => [c.primary]),
  ]
  const duplicateBuildingIds = new Set(duplicateAddressGroups.flatMap((g) => g.map((b) => b.id)))
  // 세대 목록. 뿌리는 건물의 **범위** 필터까지만이다 —
  // 건물에 메모가 없어도 그 안 세대는 여기 나와야 한다 (utils/buildPointRows).
  const pointRows = useMemo(
    () => buildPointRows(baseFilteredBuildings, {
      kind: pointKindFilter, status: pointStatusFilter,
      regularVisit: pointRegularFilter, memo: pointMemoFilter,
    }, (unitId) => visitHistoriesByUnitId.get(unitId) ?? []),
    [baseFilteredBuildings, pointKindFilter, pointStatusFilter,
     pointRegularFilter, pointMemoFilter, visitHistoriesByUnitId],
  )
  const sortedPointRows = [...pointRows].sort((a, b) =>
    comparePointRowsForTable(a, b, {
      sort: pointSort,
      cardName: (id) => cardMap.get(id)?.name ?? '',
    }))

  const selectedPointDetailData = useMemo(() => {
    if (!selectedPointDetail) return null
    const building = buildings.find((item) => item.id === selectedPointDetail.buildingId)
    const unit = building?.units.find((item) => item.id === selectedPointDetail.unitId)
    if (!building || !unit) return null
    const card = cardMap.get(building.cardId)
    const histories = visitHistoriesByUnitId.get(unit.id) ?? []
    const rowIndex = pointRows.findIndex((row) => row.building.id === building.id && row.unit.id === unit.id)
    return { building, unit, card, histories, rowIndex }
  }, [buildings, cardMap, pointRows, selectedPointDetail, visitHistoriesByUnitId])
  const selectedPointDetailKey = selectedPointDetail
    ? `${selectedPointDetail.buildingId}-${selectedPointDetail.unitId}`
    : null

  useEffect(() => {
    if (!selectedPointDetailKey || !selectedPointDetailData) return

    const updatePointDetailOffset = () => {
      const rowEl = pointRowRefs.current.get(selectedPointDetailKey)
      const tableEl = pointTableRef.current
      const paneEl = pointDetailPaneRef.current
      const layoutEl = tableEl?.closest('.territory-layout') as HTMLElement | null
      if (!rowEl || !tableEl || !paneEl || !layoutEl) return

      const rowRect = rowEl.getBoundingClientRect()
      const tableRect = tableEl.getBoundingClientRect()
      const layoutRect = layoutEl.getBoundingClientRect()
      const layoutStyle = window.getComputedStyle(layoutEl)
      const layoutPaddingTop = parseFloat(layoutStyle.paddingTop) || 0
      const layoutContentTop = layoutRect.top + layoutPaddingTop
      const paneHeight = Math.min(paneEl.scrollHeight || paneEl.getBoundingClientRect().height, window.innerHeight - 132)
      const desiredTop = rowRect.top
      const minTop = tableRect.top
      const maxTop = Math.max(minTop, tableRect.bottom - paneHeight)
      const clampedTop = Math.max(minTop, Math.min(desiredTop, maxTop))
      const nextOffset = Math.max(0, Math.round(clampedTop - layoutContentTop))
      setSelectedPointDetailOffset((current) => current === nextOffset ? current : nextOffset)
    }

    const frame = window.requestAnimationFrame(updatePointDetailOffset)
    window.addEventListener('resize', updatePointDetailOffset)
    window.addEventListener('scroll', updatePointDetailOffset, true)
    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener('resize', updatePointDetailOffset)
      window.removeEventListener('scroll', updatePointDetailOffset, true)
    }
  }, [selectedPointDetailData, selectedPointDetailKey])
  // const chinesePointTotal = pointRows.filter(({ unit }) => unit.isChinese).length
  // const regularPointTotal = pointRows.filter(({ unit }) => unit.isRegularVisit).length
  const startBuildingEdit = (building: Building) => {
    setEditingBuildingId(building.id)
  }
  const saveBuildingEdit = async (building: Building, draft: BuildingEditDraft) => {
    const nextCardId = draft.cardId || building.cardId
    const nextAddress = draft.address.trim()
    const addressChanged = nextAddress !== (building.address ?? '').trim()
    if (draft.type !== building.type) {
      const inherited = building.units.filter((unit) => unit.usageType == null && !unit.isRestaurant && unit.number.trim() !== '출입불가').length
      const ok = await confirmDialog({
        message: msg('건물 유형을 바꾸면 기본 용도를 따르는 세대 {count}개도 함께 바뀝니다. 변경할까요?', { count: inherited }),
        confirmLabel: msg('변경'),
      })
      if (!ok) return
    }

    // 주소를 고쳤으면 핀 좌표도 새 주소로 다시 찍는다.
    // (전에는 주소만 바뀌고 핀은 그대로여서, 잘못 찍힌 핀이 계속 남았음)
    let lat: number | undefined
    let lng: number | undefined
    if (addressChanged && nextAddress) {
      const geocoded = await geocodeAddress(nextAddress)
      if (geocoded) {
        lat = geocoded.lat
        lng = geocoded.lng
      } else {
        showToast(msg('주소로 위치를 찾지 못해 핀은 그대로 둡니다. 지도에서 핀을 직접 옮겨 주세요.'), 'info')
      }
    }

    const updated = await onUpdateBuilding(
      building.id,
      draft.name.trim(),
      nextAddress,
      lat,
      lng,
      draft.type,
      draft.memo,
    )
    if (!updated) return
    if (nextCardId !== building.cardId) {
      const moved = await onMoveBuildingToCard(building.id, nextCardId)
      if (!moved) return
    }
    setEditingBuildingId(null)
  }

  const totalCards = cards.length
  const assignedCards = cards.filter((card) => getCardLeaderList(card).length > 0).length
  const totalUnits = cards.reduce((sum, card) => sum + card.units, 0)
  const completedUnits = cards.reduce((sum, card) => sum + card.completed, 0)

  const geocodeAddress = (address: string) =>
    address.trim() ? geocodeFirstMatch(getGeocodeCandidates(address)) : Promise.resolve(null)


  const exportCsvCell = (value: string | number | boolean | null | undefined) => {
    const text = value == null ? '' : String(value)
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
  }

  const downloadFilteredBuildingCsv = () => {
    const isPointList = buildingSubTab === '세대 목록'
    const headers = isPointList
      // 세대ID 를 맨 앞에 — 엑셀에서 다른 파일(전화 조사 시트 등)과 이어 붙일 때 열쇠가 된다.
      // 상호·주소는 바뀌지만 세대ID 는 안 바뀐다
      ? ['세대ID', '카드명', '지역', '동', '건물명', '주소', '유형', '호수', '식당', '중국어', '정기방문', '정기방문자', '최근 방문', '메모']
      : ['카드명', '지역', '동', '건물명', '주소', '유형', '식당', '세대', '중국어', '정기방문', '건물 메모', '세대 메모']
    const rows = isPointList
      ? sortedPointRows.map(({ building, unit, latestHistory }) => {
          const card = cardMap.get(building.cardId)
          return [
            String(unit.id),
            card?.name ?? '',
            card?.region ?? '',
            card?.area ?? '',
            building.name,
            building.address,
            building.type,
            unit.number,
            unit.isRestaurant ? 'Y' : '',
            unit.isChinese ? 'Y' : '',
            unit.isRegularVisit ? 'Y' : '',
            unit.regularVisitor ?? '',
            latestHistory ? `${latestHistory.visitedAt.slice(0, 10)} ${latestHistory.timeSlot} ${latestHistory.result}` : '',
            unit.memo ?? '',
          ]
        })
      : sortedBuildings.map((building) => {
          const card = cardMap.get(building.cardId)
          const chineseCount = building.units.filter((unit) => unit.isChinese).length
          const regularCount = building.units.filter((unit) => unit.isRegularVisit).length
          const unitMemos = building.units
            .filter((unit) => hasText(unit.memo))
            .map((unit) => `${unit.number}: ${unit.memo}`)
            .join(' / ')
          return [
            card?.name ?? '',
            card?.region ?? '',
            card?.area ?? '',
            building.name,
            building.address,
            building.type,
            getRestaurantUnits(building).length || '',
            building.units.length,
            chineseCount,
            regularCount,
            building.memo ?? '',
            unitMemos,
          ]
        })
    const csvContent = [headers, ...rows].map((row) => row.map(exportCsvCell).join(',')).join('\n')
    const blob = new Blob(['﻿' + csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    const suffix = new Date().toISOString().slice(0, 10)
    link.href = url
    link.download = isPointList ? `units_${suffix}.csv` : `buildings_${suffix}.csv`
    link.style.visibility = 'hidden'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
    showToast(msg('{v1}개 항목을 내보냈습니다.', { v1: isPointList ? sortedPointRows.length : sortedBuildings.length }), 'success')
  }

  const handleReassignByBoundary = async () => {
    if (reassigningByBoundary) return
    const updates = buildings.flatMap((building) => {
      const lat = Number(building.lat)
      const lng = Number(building.lng)
      if (!isValidMapCoordinate(lat, lng)) return []
      const matchedCardId = findCardForCoordinates(lat, lng, cardBoundaries)
      if (!matchedCardId || matchedCardId === building.cardId) return []
      return [{ buildingId: building.id, cardId: matchedCardId }]
    })

    if (updates.length === 0) {
      showToast(msg('좌표 기준으로 바꿀 건물이 없습니다.'), 'info')
      return
    }

    const confirmed = await confirmDialog({ message: msg('핀 좌표 기준으로 건물 {length}개의 카드를 다시 배정할까요?', { length: updates.length }) })
    if (!confirmed) return
    setReassigningByBoundary(true)
    await onReassignBuildingsToCards(updates)
    setReassigningByBoundary(false)
  }

  // 선택된 건물만 좌표 기준 재배정 (미배정 필터 사용 시)
  const handleReassignCheckedByBoundary = async () => {
    if (reassigningChecked || visibleCheckedBuildingIds.length === 0) return
    const visible = new Set(visibleCheckedBuildingIds)
    const checkedBuildings = buildings.filter((b) => visible.has(b.id))
    const updates: Array<{ buildingId: number; cardId: number }> = []
    let noCoords = 0
    let outsideBounds = 0

    for (const building of checkedBuildings) {
      const lat = Number(building.lat)
      const lng = Number(building.lng)
      if (!isValidMapCoordinate(lat, lng)) { noCoords++; continue }
      const matchedCardId = findCardForCoordinates(lat, lng, cardBoundaries)
      if (!matchedCardId) { outsideBounds++; continue }
      if (matchedCardId !== building.cardId) updates.push({ buildingId: building.id, cardId: matchedCardId })
    }

    if (updates.length === 0) {
      const msgs = []
      if (noCoords > 0) msgs.push(`좌표 없음 ${noCoords}개`)
      if (outsideBounds > 0) msgs.push(`구역선 밖 ${outsideBounds}개`)
      showToast(msg('재배정 가능한 건물이 없습니다. ({v1})', { v1: msgs.join(', ') || '이미 올바른 카드' }), 'info')
      return
    }

    const parts = [`${updates.length}개 재배정 예정`]
    if (noCoords > 0) parts.push(`좌표없음 ${noCoords}개 건너뜀`)
    if (outsideBounds > 0) parts.push(`구역선밖 ${outsideBounds}개 건너뜀`)
    const confirmed = await confirmDialog({ message: parts.join(' · ') + '\n\n계속할까요?' })
    if (!confirmed) return

    setReassigningChecked(true)
    await onReassignBuildingsToCards(updates)
    setReassigningChecked(false)
    setCheckedBuildingIds(new Set())
  }

  const toggleCheckedCard = (cardId: number) => {
    setCheckedCardIds((current) => {
      const next = new Set(current)
      if (next.has(cardId)) next.delete(cardId)
      else next.add(cardId)
      return next
    })
  }

  const toggleCheckedBuilding = (buildingId: number) => {
    setCheckedBuildingIds((current) => {
      const next = new Set(current)
      if (next.has(buildingId)) next.delete(buildingId)
      else next.add(buildingId)
      return next
    })
  }

  const toggleAllFilteredCards = () => {
    setCheckedCardIds((current) => {
      const visibleIds = filteredCards.map((card) => card.id)
      const allVisibleChecked = visibleIds.length > 0 && visibleIds.every((id) => current.has(id))
      const next = new Set(current)
      visibleIds.forEach((id) => {
        if (allVisibleChecked) next.delete(id)
        else next.add(id)
      })
      return next
    })
  }

  const toggleAllFilteredBuildings = () => {
    setCheckedBuildingIds((current) => {
      const visibleIds = filteredBuildings.map((building) => building.id)
      const allVisibleChecked = visibleIds.length > 0 && visibleIds.every((id) => current.has(id))
      const next = new Set(current)
      visibleIds.forEach((id) => {
        if (allVisibleChecked) next.delete(id)
        else next.add(id)
      })
      return next
    })
  }

  const { exportBackup: exportCardBoundaries, importBackup: importCardBoundaries } =
    useCardBoundaryBackup(cards, cardBoundaries, onRestoreCardBoundaries)

  const handleDeleteCheckedCards = async () => {
    const ids = visibleCheckedCardIds
    if (ids.length === 0) return
    const idSet = new Set(ids)
    const relatedBuildingCount = buildings.filter((building) => idSet.has(building.cardId)).length
    const confirmed = await confirmDialog({ message: msg('선택한 카드 {length}개를 삭제할까요?\n이 카드에 속한 건물 {relatedBuildingCount}개도 함께 삭제됩니다.', { length: ids.length, relatedBuildingCount: relatedBuildingCount }), danger: true, confirmLabel: '삭제' })
    if (!confirmed) return
    onDeleteCards(ids)
    setCheckedCardIds(new Set())
    if (selectedCardId && ids.includes(selectedCardId)) setSelectedCardId(null)
  }


  const handleOpenCardMergeModal = () => {
    if (!onMergeCardBoundaries) return
    const ids = visibleCheckedCardIds
    if (ids.length < 2) {
      showToast(msg('병합할 카드를 2개 이상 선택해 주세요.'), 'error')
      return
    }
    const firstWithBoundary = ids.find((id) => cardBoundaries.some((boundary) => boundary.cardId === id))
    setCardMergeTargetId(firstWithBoundary ?? ids[0] ?? null)
    setCardMergeModalOpen(true)
  }

  const handleApplyCardMerge = async () => {
    if (!onMergeCardBoundaries || !cardMergeTargetId) return
    const selectedIds = visibleCheckedCardIds
    const targetCard = cards.find((card) => card.id === cardMergeTargetId)
    if (!targetCard || selectedIds.length < 2) return

    const selectedBoundaries = selectedIds
      .map((id) => cardBoundaries.find((boundary) => boundary.cardId === id))
      .filter((boundary): boundary is CardBoundary => Boolean(boundary))

    if (selectedBoundaries.length < 2) {
      showToast(msg('구역선이 있는 카드를 2개 이상 선택해야 병합할 수 있습니다.'), 'error')
      return
    }

    const mergeResult = mergeCardBoundaryPoints(selectedBoundaries)
    if (!mergeResult || mergeResult.points.length < 3) {
      showToast(msg('선택한 구역선을 병합하지 못했습니다.'), 'error')
      return
    }

    const confirmed = await confirmDialog({
      message: msg('{name} 카드로 {length}개 카드의 건물과 구역선을 합칠까요?\n', { name: targetCard.name, length: selectedIds.length }) +
        '원본 카드는 남기고, 원본 카드의 구역선만 비워집니다.\n병합 후 화면에서 되돌리기 버튼으로 취소할 수 있습니다.',
    })
    if (!confirmed) return

    // 되돌리기용 스냅샷 캡처 (경계선 없는 카드는 null로 기록)
    const allMergeIds = [cardMergeTargetId, ...selectedIds.filter((id) => id !== cardMergeTargetId)]
    const undoBoundaries = allMergeIds.map((id) => ({
      cardId: id,
      points: cardBoundaries.find((b) => b.cardId === id)?.points ?? null,
    }))
    const undoBuildingCards = buildings
      .filter((b) => allMergeIds.includes(b.cardId))
      .map((b) => ({ buildingId: b.id, cardId: b.cardId }))

    await Promise.resolve(onMergeCardBoundaries({
      targetCardId: cardMergeTargetId,
      sourceCardIds: selectedIds.filter((id) => id !== cardMergeTargetId),
      mergedPoints: mergeResult.points,
    }))

    setCardMergeUndo({ boundaries: undoBoundaries, buildingCards: undoBuildingCards, targetCardName: targetCard.name })
    setCardMergeModalOpen(false)
    setCheckedCardIds(new Set([cardMergeTargetId]))
    setSelectedCardId(cardMergeTargetId)
  }

  const handleUndoCardMerge = async () => {
    if (!cardMergeUndo || !onUndoMergeCardBoundaries) return
    await onUndoMergeCardBoundaries(cardMergeUndo)
    setCardMergeUndo(null)
  }

  const handleDeleteCheckedBuildings = async () => {
    const ids = visibleCheckedBuildingIds
    if (ids.length === 0) return
    const copy = placeDeletionCopy(role, 'building', ids.length)
    const confirmed = await confirmDialog({ message: copy.description, danger: true, confirmLabel: copy.confirmLabel })
    if (!confirmed) return
    onDeleteBuildings(ids)
    setCheckedBuildingIds(new Set())
  }



  const showPointDetailPane = activeTab === '건물 관리' && buildingSubTab === '세대 목록' && selectedPointDetailData
  const territoryLayoutClassName = showPointDetailPane
    ? 'territory-layout point-detail-open'
    : activeTab === '건물 관리' || !detailPaneOpen
      ? 'territory-layout building-management-only'
      : 'territory-layout'

  return (
    <section className={territoryLayoutClassName}>
      {/* ── 카드 추가 모달 ── */}
      {showCardModal && (
        <CardCreateModal
          canAddRegion={role === 'admin' || role === 'developer'}
          cards={cards}
          onClose={() => setShowCardModal(false)}
          onCreateCard={onCreateCard}
          onCreateRegion={onCreateTerritoryRegion}
          onCreated={(id, name) => {
            setSelectedCardId(id)
            setPendingBoundaryCard({ id, name })
          }}
        />
      )}

      {/* ── 구역선 그리기 제안 모달 ── */}
      {pendingBoundaryCard && (
        <BoundaryDrawPrompt
          card={pendingBoundaryCard}
          onDismiss={() => setPendingBoundaryCard(null)}
          onDraw={(cardId) => { onOpenCardMap(cardId, true); setPendingBoundaryCard(null) }}
        />
      )}

      {cardMergeUndo && (
        <div style={{
          position: 'fixed', bottom: 80, left: '50%', transform: 'translateX(-50%)',
          zIndex: 900, display: 'flex', alignItems: 'center', gap: 12,
          background: 'var(--gray-900)', color: '#fff', borderRadius: 12,
          padding: '12px 20px', boxShadow: '0 4px 20px rgba(0,0,0,.3)',
          fontSize: 14, whiteSpace: 'nowrap',
        }}>
          <span>"{cardMergeUndo.targetCardName}" 카드로 병합 완료</span>
          <button
            onClick={handleUndoCardMerge}
            style={{ background: 'var(--primary-500)', color: '#fff', border: 'none', borderRadius: 8, padding: '6px 14px', fontWeight: 700, cursor: 'pointer', fontSize: 13 }}
            type="button"
          >
            병합 취소
          </button>
          <button
            onClick={() => setCardMergeUndo(null)}
            style={{ background: 'none', border: 'none', color: 'var(--gray-400)', cursor: 'pointer', fontSize: 18, lineHeight: 1, padding: '0 2px' }}
            type="button"
            aria-label="닫기"
          >×</button>
        </div>
      )}

      {cardMergeModalOpen && (
        <div className="cal-modal-backdrop" onClick={() => setCardMergeModalOpen(false)}>
          <div className="cal-modal merge-name-modal" style={{ maxWidth: '520px' }} onClick={(e) => e.stopPropagation()}>
            <div className="cal-modal-head">
              <div className="cal-modal-title">
                <h2>카드 구역선 병합</h2>
                <p className="merge-name-modal-sub">선택한 카드의 건물은 기준 카드로 이동하고, 구역선은 하나로 합쳐집니다.</p>
              </div>
            </div>
            <div className="cal-modal-body">
              <label className="merge-name-field">
                <span>기준 카드</span>
                <select
                  value={cardMergeTargetId ?? ''}
                  onChange={(event) => setCardMergeTargetId(Number(event.target.value))}
                >
                  {selectedMergeCards.map((card) => (
                    <option key={card.id} value={card.id}>{card.name}</option>
                  ))}
                </select>
              </label>
              <div className="merge-name-list">
                {selectedMergeCards.map((card) => {
                  const buildingCount = buildingsByCardId.get(card.id)?.length ?? 0
                  const hasBoundary = cardBoundaries.some((boundary) => boundary.cardId === card.id)
                  return (
                    <div className="merge-name-row" key={card.id}>
                      <div>
                        <strong>{card.name}</strong>
                        <span>{card.region} · {card.area} · 건물 {buildingCount}개</span>
                      </div>
                      <em>{card.id === cardMergeTargetId ? '기준' : hasBoundary ? '병합' : '구역선 없음'}</em>
                    </div>
                  )
                })}
              </div>
              <p className="merge-name-modal-sub" style={{ marginTop: 12 }}>
                병합 후 원본 카드는 삭제하지 않고 남깁니다. 원본 카드의 구역선만 비우며, 토스트의 실행 취소로 되돌릴 수 있습니다.
              </p>
            </div>
            <div className="cal-modal-foot">
              <button className="cal-cancel-btn" onClick={() => setCardMergeModalOpen(false)} type="button">취소</button>
              <button className="cal-save-btn" onClick={handleApplyCardMerge} type="button">병합 실행</button>
            </div>
          </div>
        </div>
      )}

      {pendingChineseToggle && (
        <div className="cal-modal-backdrop" onClick={() => setPendingChineseToggle(null)}>
          <div className="cal-modal territory-confirm-modal" onClick={(e) => e.stopPropagation()}>
            <div className="cal-modal-head">
              <div className="cal-modal-title">
                <h2>중국어 표시 해제</h2>
                <p className="merge-name-modal-sub">해제하면 이 항목은 세대 목록의 중국어 구분에서 사라질 수 있습니다.</p>
              </div>
            </div>
            <div className="cal-modal-body">
              <div className="territory-confirm-summary">
                <strong>{pendingChineseToggle.cardName}</strong>
                <span>{pendingChineseToggle.buildingName} · {pendingChineseToggle.unitNumber}</span>
              </div>
            </div>
            <div className="cal-modal-foot">
              <button className="cal-cancel-btn" onClick={() => setPendingChineseToggle(null)} type="button">취소</button>
              <button
                className="cal-save-btn danger"
                onClick={() => {
                  onToggleChinese(pendingChineseToggle.buildingId, pendingChineseToggle.unitId)
                  setPendingChineseToggle(null)
                }}
                type="button"
              >
                해제
              </button>
            </div>
          </div>
        </div>
      )}

      {pointVisitEditor && (
        <PointVisitEditor
          /* ⚠ 관리자·인도자에게만 방문자 칸을 준다. 일반 사용자는 자기 기록만
             적으므로 고를 이유가 없고, 있으면 남의 이름으로 적기 쉬워진다.
             ⚠ **새로 적을 때(add)는 안 준다** — 그때는 내 이름으로 남고,
                다르면 저장한 뒤 수정에서 고친다. 적는 흐름을 무겁게 하지 않는다. */
          visitorOptions={pointVisitEditor.mode === 'edit' && canEditVisitorHere ? visitorNameOptions : undefined}
          initial={pointVisitEditor.draft}
          label={pointVisitEditor.label}
          mode={pointVisitEditor.mode}
          onClose={() => setPointVisitEditor(null)}
          onSave={savePointVisitEditor}
        />
      )}

      {/* 건물 추가 모달 */}
      {addBuildingOpen && (
        <AddBuildingModal
          cards={cards}
          onClose={() => setAddBuildingOpen(false)}
          onGeocode={geocodeAddress}
          onSubmit={handleAddBuildingSubmit}
        />
      )}

      {/* 중복 주소 건물 이름 선택 모달 */}
      {mergeModalGroups && (
        <DuplicateBuildingMergeModal
          groups={mergeModalGroups}
          mergePlan={mergePlan}
          cardName={(id) => cardMap.get(id)?.name ?? '카드 없음'}
          onClose={() => setMergeModalGroups(null)}
          onMerge={onMergeDuplicateBuildings}
        />
      )}

      {showCsvModal && (
        <CsvImportModal
          onClose={() => setShowCsvModal(false)}
          cards={cards}
          cardBoundaries={cardBoundaries}
          unassignedCardId={unassignedCardId ?? null}
          regionNames={getRegionNames()}
          geocodeAddress={geocodeAddress}
          onImportBuildings={onImportBuildings}
        />
      )}

      <div className="territory-main">
        {/* ── 페이지 헤더: 종류 탭이 곧 제목 (구역 카드 / 비공식 카드 / 식당) ── */}
        <header className="page-header">
          <div className="page-header-text">
            <div className="zone-kind-tabs" role="tablist" aria-label="구역 종류">
              {[
                { id: 'territory' as const, label: t(language, 'territory.zoneCard'), count: cards.length },
                { id: 'informal' as const, label: t(language, 'territory.informalTab'), count: informalCount },
                { id: 'restaurant' as const, label: t(language, 'territory.restaurantTab'), count: restaurantCount },
              ].map((t) => {
                const active = zoneKind === t.id
                return (
                  <button
                    key={t.id}
                    role="tab"
                    aria-selected={active}
                    onClick={() => setZoneKind(t.id)}
                    type="button"
                    className={`zone-kind-tab${active ? ' is-active' : ''}`}
                  >
                    {t.label}
                    <em className="zone-kind-tab-count">{t.count}</em>
                  </button>
                )
              })}
            </div>
          </div>
        </header>

        {/* 비공식 카드 탭 */}
        {zoneKind === 'informal' && (
          <div style={{ paddingTop: 4 }}>
            {onUploadInformalAsset && onDeleteInformalAsset && onCreateInformalGroup && onRenameInformalGroup && onDeleteInformalGroup && onMoveAssetToGroup ? (
              <InformalCardsTab
                role={role}
                onCreatePlace={onCreateInformalPlace}
                onUpdatePlace={onUpdateInformalPlace}
                onOpenOnMap={onOpenInformalOnMap}
                currentVisitor={currentVisitor}
                informalAssets={informalAssets}
                informalGroups={informalGroups}
                onUpload={onUploadInformalAsset}
                onDelete={onDeleteInformalAsset}
                onDeleteMany={onDeleteInformalAssets}
                onCreateGroup={onCreateInformalGroup}
                onRenameGroup={onRenameInformalGroup}
                onDeleteGroup={onDeleteInformalGroup}
                onMoveAsset={onMoveAssetToGroup}
                onMoveMany={onMoveAssetsToGroup}
                expandedStateKey="desktop.informalExpandedGroups"
              />
            ) : (
              <p style={{ padding: 24, textAlign: 'center', color: '#94a3b8' }}>
                비공식 카드 기능을 사용할 수 없습니다.
              </p>
            )}
          </div>
        )}

        {/* 식당 탭 */}
        {zoneKind === 'restaurant' && (
          <div style={{ paddingTop: 4 }}>
            <RestaurantsTab
              role={role}
              buildings={buildings}
              cardBoundaries={cardBoundaries}
              cards={cards}
              currentVisitor={currentVisitor}
              visitorNames={visitorNameOptions}
              restaurantRequests={restaurantRequests}
              onToggleRestaurantFlag={onToggleBuildingRestaurant}
              onRemoveRestaurantUnit={onRemoveRestaurantUnit}
              onBulkSetRestaurant={onBulkSetRestaurant}
              onRegisterRestaurant={onRegisterRestaurant}
              onApproveRestaurantRequest={onApproveRestaurantRequest}
              onRejectRestaurantRequest={onRejectRestaurantRequest}
              onOpenMap={(cardId) => onOpenCardMap(cardId)}
              onOpenBuildingMap={onOpenBuildingMap}
              visitHistories={visitHistories}
              onUpdateUnitFlags={onUpdateUnitFlags}
            />
          </div>
        )}

        {/* 구역 카드 탭 (기존 컨텐츠) */}
        {zoneKind === 'territory' && (<>

        {/* ── Segment Tab + 컨텍스트 액션 ── */}
        <div className="territory-toolbar">
          <div className="tbl-seg-tab" style={{ marginBottom: 0 }}>
            {(['카드 관리', '건물 관리'] as const).map((tab) => (
              <button className={activeTab === tab ? 'active' : ''} key={tab} onClick={() => setActiveTab(tab)} type="button">
                {tab}
              </button>
            ))}
          </div>
          <div className="territory-toolbar-actions">
            {activeTab === '카드 관리' ? (
              <>
                <button
                  onClick={() => setDetailPaneOpen((o) => !o)}
                  title={detailPaneOpen ? '상세 접기' : '상세 열기'}
                  type="button"
                  className={`tbl-toolbar-btn${detailPaneOpen ? ' is-active' : ''}`}
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="3" x2="9" y2="21"/>
                  </svg>
                  {detailPaneOpen ? '상세 접기' : '상세 열기'}
                </button>
                {isAdmin && (
                  <>
                    <button className="tbl-ghost-btn" onClick={exportCardBoundaries} type="button">
                      구역선 백업
                    </button>
                    {onRestoreCardBoundaries && (
                      <>
                        <input
                          ref={boundaryImportInputRef}
                          accept="application/json"
                          onChange={importCardBoundaries}
                          style={{ display: 'none' }}
                          type="file"
                        />
                        <button className="tbl-ghost-btn" onClick={() => boundaryImportInputRef.current?.click()} type="button">
                          구역선 가져오기
                        </button>
                      </>
                    )}
                    {onMergeCardBoundaries && (
                      <button className="tbl-ghost-btn" disabled={visibleCheckedCardIds.length < 2} onClick={handleOpenCardMergeModal} type="button">
                        카드 병합{visibleCheckedCardIds.length > 1 ? ` ${visibleCheckedCardIds.length}` : ''}
                      </button>
                    )}
                    <button className="tbl-ghost-btn" disabled={visibleCheckedCardIds.length === 0} onClick={handleDeleteCheckedCards} type="button">
                      선택 삭제{visibleCheckedCardIds.length > 0 ? ` ${visibleCheckedCardIds.length}` : ''}
                    </button>
                    <button className="tbl-primary-btn" onClick={() => setShowCardModal(true)} type="button">+ 카드 추가</button>
                  </>
                )}
              </>
            ) : (
              <>
                {isAdmin && (
                  <button className="tbl-ghost-btn" disabled={visibleCheckedBuildingIds.length === 0} onClick={handleDeleteCheckedBuildings} type="button">
                    선택 삭제{visibleCheckedBuildingIds.length > 0 ? ` ${visibleCheckedBuildingIds.length}` : ''}
                  </button>
                )}
                {buildingCardFilter === unassignedCardId && visibleCheckedBuildingIds.length > 0 && (
                  <button
                    className="tbl-ghost-btn"
                    style={{ color: 'var(--primary-600)', fontWeight: 600 }}
                    disabled={reassigningChecked}
                    onClick={handleReassignCheckedByBoundary}
                    type="button"
                  >
                    {reassigningChecked ? '재배정 중...' : `선택 ${visibleCheckedBuildingIds.length}개 카드 재배정`}
                  </button>
                )}
                <button className="tbl-ghost-btn" disabled={reassigningByBoundary} onClick={handleReassignByBoundary} type="button">
                  {reassigningByBoundary ? '재배정 중...' : '좌표 기준 재배정'}
                </button>
                {onCreateBuilding && (
                  <button className="tbl-ghost-btn" onClick={() => setAddBuildingOpen(true)} type="button">
                    + 건물 추가
                  </button>
                )}
                <button className="tbl-primary-btn" onClick={() => setShowCsvModal(true)} type="button">건물 CSV 업로드</button>
              </>
            )}
            {onSwitchToMap && (
              <button onClick={onSwitchToMap} type="button" className="tbl-toolbar-btn">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="3 6 9 3 15 6 21 3 21 21 15 18 9 21 3 18 3 6"/><line x1="9" y1="3" x2="9" y2="21"/><line x1="15" y1="6" x2="15" y2="18"/></svg>
                지도
              </button>
            )}
          </div>
        </div>

        {/* ── KPI (카드 관리만) ── */}
        {activeTab === '카드 관리' && (
          <div className="desk-grid-12" style={{ marginBottom: 16 }}>
            <div className="desk-kpi" style={{ gridColumn: 'span 3' }}>
              <div className="desk-kpi__num tnum">{totalCards}</div>
              <div className="desk-kpi__label">전체 카드</div>
            </div>
            <div className="desk-kpi" style={{ gridColumn: 'span 3' }}>
              <div className="desk-kpi__num tnum">{assignedCards}</div>
              <div className="desk-kpi__label">인도자 배정</div>
            </div>
            <div className="desk-kpi" style={{ gridColumn: 'span 3' }}>
              <div className="desk-kpi__num tnum">{totalUnits}</div>
              <div className="desk-kpi__label">전체 세대</div>
            </div>
            <div className="desk-kpi" style={{ gridColumn: 'span 3' }}>
              <div className="desk-kpi__num tnum">{completedUnits}</div>
              <div className="desk-kpi__label">방문 완료</div>
            </div>
          </div>
        )}

        {/* ── 건물 관리 서브탭 ── */}
        {activeTab === '건물 관리' && (
          <div className="territory-subtabs" style={{ marginBottom: 16 }}>
            {(['건물 목록', '세대 목록'] as const).map((tab) => (
              <button className={buildingSubTab === tab ? 'active' : ''} key={tab} onClick={() => setBuildingSubTab(tab)} type="button">{tab}</button>
            ))}
          </div>
        )}

        {/* ── Big Card ── */}
        <div className="desk-card" style={{ padding: 0, overflow: 'visible' }}>
          {/* Layer 1: 지역 칩 */}
          <div className="tbl-filter-layer">
            <span className="tbl-filter-label">지역</span>
            <div className="tbl-chip-row">
              {(['전체', ...getRegionNames()] as Array<TerritoryRegion | '전체'>).map((r) => {
                const count = r === '전체' ? cards.length : cards.filter((c) => c.region === r).length
                return (
                  <button key={r} className={`tbl-chip${regionFilter === r ? ' active' : ''}`} onClick={() => { setRegionFilter(r); setAreaFilter('전체'); setAreaExpanded(false) }} type="button">
                    {r}<span className="tbl-chip__count">{count}</span>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Layer 2: 동 칩 */}
          <div className="tbl-filter-layer tbl-filter-layer--area">
            <span className="tbl-filter-label">동</span>
            <div className="tbl-chip-row">
              <button className={`tbl-chip${areaFilter === '전체' ? ' active' : ''}`} onClick={() => setAreaFilter('전체')} type="button">
                전체 동<span className="tbl-chip__count">{filteredCards.length}</span>
              </button>
              {(areaExpanded ? areaFilterOptions : areaFilterOptions.slice(0, AREA_CHIP_LIMIT)).map((area) => (
                <button key={area} className={`tbl-chip${areaFilter === area ? ' active' : ''}`} onClick={() => setAreaFilter(area)} type="button">
                  {area}<span className="tbl-chip__count">{getAreaMetricCount(area)}</span>
                </button>
              ))}
              {areaFilterOptions.length > AREA_CHIP_LIMIT && (
                <button
                  className="tbl-chip"
                  onClick={() => setAreaExpanded((v) => !v)}
                  type="button"
                  style={{ color: 'var(--ink-700)', borderColor: 'var(--line-3)', background: 'var(--gray-50)' }}
                >
                  {areaExpanded ? '접기 ▴' : `더보기 ▾`}
                  {!areaExpanded && <span className="tbl-chip__count" style={{ background: 'var(--gray-200)', color: 'var(--ink-700)' }}>{areaFilterOptions.length - AREA_CHIP_LIMIT}</span>}
                </button>
              )}
            </div>
          </div>

          {/* Layer 3: 배정 필터 (카드 관리) */}
          {activeTab === '카드 관리' && (
            <div className="tbl-filter-layer tbl-filter-layer--compact">
              <div className="tbl-filter-group">
                <span className="tbl-filter-label">배정</span>
                <div className="tbl-mini-seg">
                  {(['전체', '배정', '미배정'] as const).map((f) => (
                    <button key={f} className={assignmentFilter === f ? 'active' : ''} onClick={() => setAssignmentFilter(f)} type="button">{f}</button>
                  ))}
                </div>
              </div>
              <button
                className={`tbl-filter-toggle${cardFilterPanelOpen ? ' active' : ''}`}
                onClick={() => setCardFilterPanelOpen((open) => !open)}
                type="button"
              >
                필터
                {activeAdvancedCardFilterCount > 0 && <span>{activeAdvancedCardFilterCount}</span>}
              </button>
              <div style={{ flex: 1 }} />
              {isAdmin && (
                <>
                  <details className="territory-multi-select">
                    <summary>{bulkLeaderNames.length > 0 ? `인도자 선택 ${bulkLeaderNames.length}` : '인도자 선택'}</summary>
                    <div className="territory-multi-select-menu">
                      {leaderOptions.map((name) => (
                        <label key={name} className="territory-multi-option">
                          <input type="checkbox" checked={bulkLeaderNames.includes(name)} onChange={() => toggleBulkLeaderName(name)} />
                          {name}
                        </label>
                      ))}
                      <button className="territory-multi-clear" onClick={() => setBulkLeaderNames([])} type="button">모두 해제</button>
                    </div>
                  </details>
                  <button className="tbl-ghost-btn sm" disabled={checkedCardIds.size === 0 || bulkAssigning} onClick={handleAssignLeaderBulk} type="button">
                    {bulkAssigning ? '적용 중...' : `일괄 적용${checkedCardIds.size > 0 ? ` ${checkedCardIds.size}` : ''}`}
                  </button>
                </>
              )}
              {cardFilterPanelOpen && (
                <div className="tbl-advanced-filter-panel">
                  <div className="tbl-filter-group">
                    <span className="tbl-filter-label">인도자</span>
                    <select className="tbl-filter-select" value={leaderFilter} onChange={(e) => setLeaderFilter(e.target.value)}>
                      <option value="전체">전체</option>
                      {leaderFilterOptions.map((leaderName) => (
                        <option key={leaderName} value={leaderName}>{leaderName}</option>
                      ))}
                    </select>
                  </div>
                  <div className="tbl-filter-group">
                    <span className="tbl-filter-label">정기방문</span>
                    <div className="tbl-mini-seg">
                      {(['전체', '있음', '없음'] as const).map((f) => (
                        <button key={f} className={regularVisitFilter === f ? 'active' : ''} onClick={() => setRegularVisitFilter(f)} type="button">{f}</button>
                      ))}
                    </div>
                  </div>
                  <div className="tbl-filter-group">
                    <span className="tbl-filter-label">상태</span>
                    <div className="tbl-mini-seg">
                      {(['전체', '미배정', '완료·제외', '보류'] as CardStatusFilter[]).map((f) => (
                        <button key={f} className={cardStatusFilter === f ? 'active' : ''} onClick={() => setCardStatusFilter(f)} type="button">{f}</button>
                      ))}
                    </div>
                  </div>
                  <button
                    className="tbl-filter-reset"
                    disabled={activeAdvancedCardFilterCount === 0}
                    onClick={() => {
                      setLeaderFilter('전체')
                      setRegularVisitFilter('전체')
                      setCardStatusFilter('전체')
                    }}
                    type="button"
                  >
                    초기화
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Layer 3: 건물 관리 필터 */}
          {activeTab === '건물 관리' && buildingSubTab === '건물 목록' && (
            <div className="tbl-filter-layer" style={{ gap: 12 }}>
              {/* 두 화면의 필터 순서를 같게 둔다: 구분 → 유형 → (카드|상태) → 필터 → 정렬 */}
              {/* ⚠ '구분(식당)' 과 '유형(상가·주택)' 을 **한 줄로 합쳤다.**
                  실측: 상가 565개 중 식당이 360개(64%), 주택 502개 중 식당은 7개(1%).
                  **식당은 거의 상가다** — 따로 고를 일이 드문데 필터가 일곱 줄이었다.
                  ⚠ 상태는 둘로 유지한다. `buildingTypeFilter` 는 세대 목록과 함께 쓰는
                     값이라 없애면 그 화면의 유형 필터가 죽는다. (utils/buildingKindFilter) */}
              <span className="tbl-filter-label">구분</span>
              <div className="tbl-mini-seg">
                {(['전체', '주택', '상가', '식당'] as BuildingKind[]).map((f) => (
                  <button
                    key={f}
                    className={filtersToKind(buildingTypeFilter, buildingRestaurantFilter) === f ? 'active' : ''}
                    onClick={() => {
                      const next = kindToFilters(f)
                      setBuildingTypeFilter(next.type)
                      setBuildingRestaurantFilter(next.restaurant)
                    }}
                    type="button"
                  >{f}</button>
                ))}
              </div>
              <span className="tbl-filter-label">카드</span>
              <select className="tbl-filter-select" value={buildingCardFilter} onChange={(e) => setBuildingCardFilter(e.target.value === '전체' ? '전체' : Number(e.target.value))}>
                <option value="전체">전체 카드</option>
                {unassignedCardId && (
                  <option value={unassignedCardId}>⚠ 미배정 건물</option>
                )}
                {filteredCards.filter((c) => c.id !== unassignedCardId).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <button
                className={`tbl-filter-toggle${buildingFilterPanelOpen ? ' active' : ''}`}
                onClick={() => setBuildingFilterPanelOpen((open) => !open)}
                type="button"
              >
                필터
                {activeAdvancedBuildingFilterCount > 0 && <span>{activeAdvancedBuildingFilterCount}</span>}
              </button>
              {buildingFilterPanelOpen && (
                <div className="tbl-advanced-filter-panel">
                  <div className="tbl-filter-group">
                    <span className="tbl-filter-label">정기방문</span>
                    <div className="tbl-mini-seg">
                      {(['전체', '있음', '없음'] as const).map((f) => (
                        <button key={f} className={buildingRegularFilter === f ? 'active' : ''} onClick={() => setBuildingRegularFilter(f)} type="button">{f}</button>
                      ))}
                    </div>
                  </div>
                  <div className="tbl-filter-group">
                    <span className="tbl-filter-label">메모</span>
                    <div className="tbl-mini-seg">
                      {(['전체', '있음', '없음'] as const).map((f) => (
                        <button key={f} className={buildingMemoFilter === f ? 'active' : ''} onClick={() => setBuildingMemoFilter(f)} type="button">{f}</button>
                      ))}
                    </div>
                    <div className="tbl-filter-group">
                      {/* ⚠ **세대를 다 파악했다고 표시한 건물인가.** 표시가 없으면 등록된 세대를
                          다 방문해도 지도에서 '완료' 가 아니다 — 호수가 더 있는지 아무도 모른다.
                          PC 는 **몰아서 확인하는** 자리라 여기에 필터를 둔다. */}
                      <span className="tbl-filter-label">세대 확인</span>
                      <div className="tbl-mini-seg">
                        {(['전체', '확인필요', '확인됨'] as const).map((f) => (
                          <button key={f} className={buildingSurveyedFilter === f ? 'active' : ''} onClick={() => setBuildingSurveyedFilter(f)} type="button">{f}</button>
                        ))}
                      </div>
                    </div>
                  </div>
                  <button
                    className="tbl-filter-reset"
                    disabled={activeAdvancedBuildingFilterCount === 0}
                    onClick={() => {
                      setBuildingRegularFilter('전체')
                      setBuildingMemoFilter('전체')
                    }}
                    type="button"
                  >
                    초기화
                  </button>
                </div>
              )}
            </div>
          )}
          {activeTab === '건물 관리' && buildingSubTab === '건물 목록' && (
            <div className="tbl-filter-layer tbl-filter-layer--sort">
              <span className="tbl-filter-label">정렬</span>
              <div className="tbl-mini-seg">
                {(['카드', '건물', '주소', '유형', '식당'] as BuildingSortKey[]).map((key) => (
                  <button key={key} className={buildingSort.key === key ? 'active' : ''} onClick={() => setBuildingSort((prev) => prev.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' })} type="button">
                    {key}{buildingSort.key === key ? (buildingSort.dir === 'asc' ? ' ↑' : ' ↓') : ''}
                  </button>
                ))}
              </div>
            </div>
          )}
          {activeTab === '건물 관리' && buildingSubTab === '세대 목록' && (
            <div className="tbl-filter-layer" style={{ gap: 12 }}>
              <span className="tbl-filter-label">구분</span>
              <div className="tbl-mini-seg">
                {(['전체', '중국어', '정기방문', '식당'] as const).map((f) => (
                  <button key={f} className={pointKindFilter === f ? 'active' : ''} onClick={() => setPointKindFilter(f)} type="button">{f}</button>
                ))}
              </div>
              {/* 건물 유형은 두 화면에 함께 걸린다. 여기서 안 보이면
                  "왜 개수가 적지?" 하고 원인을 못 찾는다 (실제로 그런 일이 있었다) */}
              <span className="tbl-filter-label">유형</span>
              <div className="tbl-mini-seg">
                {(['전체', '상가', '주택'] as Array<Building['type'] | '전체'>).map((f) => (
                  <button key={f} className={buildingTypeFilter === f ? 'active' : ''} onClick={() => setBuildingTypeFilter(f)} type="button">{f}</button>
                ))}
              </div>
              <span className="tbl-filter-label">상태</span>
              <select className="tbl-filter-select" value={pointStatusFilter} onChange={(e) => setPointStatusFilter(e.target.value as UnitStatus | '전체')}>
                <option value="전체">전체 상태</option>
                <option value="미방문">미방문</option>
                <option value="만남">만남</option>
                <option value="부재">부재</option>
                <option value="대상외">대상외</option>
              </select>
              <button
                className={`tbl-filter-toggle${pointFilterPanelOpen ? ' active' : ''}`}
                onClick={() => setPointFilterPanelOpen((open) => !open)}
                type="button"
              >
                필터
                {activeAdvancedPointFilterCount > 0 && <span>{activeAdvancedPointFilterCount}</span>}
              </button>
              {pointFilterPanelOpen && (
                <div className="tbl-advanced-filter-panel">
                  <div className="tbl-filter-group">
                    <span className="tbl-filter-label">정기방문</span>
                    <div className="tbl-mini-seg">
                      {(['전체', '있음', '없음'] as const).map((f) => (
                        <button key={f} className={pointRegularFilter === f ? 'active' : ''} onClick={() => setPointRegularFilter(f)} type="button">{f}</button>
                      ))}
                    </div>
                  </div>
                  <div className="tbl-filter-group">
                    <span className="tbl-filter-label">메모</span>
                    <div className="tbl-mini-seg">
                      {(['전체', '있음', '없음'] as const).map((f) => (
                        <button key={f} className={pointMemoFilter === f ? 'active' : ''} onClick={() => setPointMemoFilter(f)} type="button">{f}</button>
                      ))}
                    </div>
                  </div>
                  <button
                    className="tbl-filter-reset"
                    disabled={activeAdvancedPointFilterCount === 0}
                    onClick={() => {
                      setPointRegularFilter('전체')
                      setPointMemoFilter('전체')
                    }}
                    type="button"
                  >
                    초기화
                  </button>
                </div>
              )}
            </div>
          )}
          {activeTab === '건물 관리' && buildingSubTab === '세대 목록' && (
            <div className="tbl-filter-layer tbl-filter-layer--sort">
              <span className="tbl-filter-label">정렬</span>
              <div className="tbl-mini-seg">
                {(['카드', '건물', '세대', '상태', '최근 방문'] as PointSortKey[]).map((key) => (
                  <button key={key} className={pointSort.key === key ? 'active' : ''} onClick={() => setPointSort((prev) => prev.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' })} type="button">
                    {key}{pointSort.key === key ? (pointSort.dir === 'asc' ? ' ↑' : ' ↓') : ''}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Layer 4: 결과 카운트 */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '10px 18px', fontSize: 12, color: 'var(--gray-500)', borderBottom: '1px solid var(--border-subtle)' }}>
            <span>
              {regionFilter === '전체' ? '전체 지역' : regionFilter}
              {' · '}{areaFilter === '전체' ? '전체 동' : areaFilter}
              {' · 표시 '}
              {activeTab === '카드 관리' ? `${filteredCards.length}개 카드` : buildingSubTab === '건물 목록' ? `${filteredBuildings.length}개 건물` : `${pointRows.length}개 세대`}
            </span>
            {activeTab === '건물 관리' && (
              <button className="tbl-ghost-btn sm" onClick={downloadFilteredBuildingCsv} type="button">
                엑셀 내보내기
              </button>
            )}
          </div>

          {/* ── 카드 관리 테이블 ── */}
          {activeTab === '카드 관리' ? (
          <table className="tbl">
            <thead>
              <tr>
                {isAdmin && (
                  <th style={{ width: 52, paddingLeft: 18 }}>
                    <input type="checkbox" checked={filteredCards.length > 0 && filteredCards.every((c) => checkedCardIds.has(c.id))} onChange={toggleAllFilteredCards} />
                  </th>
                )}
                <th>카드</th>
                <th style={{ width: 140 }}>진행</th>
                <th>인도자</th>
                <th style={{ width: 150 }}>유형</th>
                <th style={{ width: 80, textAlign: 'right' }}>중국어</th>
                <th style={{ width: 90, textAlign: 'right' }}>정기방문</th>
                <th style={{ width: 80 }}>구역선</th>
                <th style={{ width: 80 }}>상태</th>
                <th style={{ width: 160, textAlign: 'right', paddingRight: 18 }}>작업</th>
              </tr>
            </thead>
            <tbody>
              {renderedCards.map((card) => {
                const cardBuildings = buildingsByCardId.get(card.id) ?? []
                const operationalState = getTerritoryCardOperationalState(card)
                const chinesePointCount = cardBuildings.reduce((sum, b) => sum + b.units.filter((u) => u.isChinese).length, 0)
                const storeCount = cardBuildings.filter((building) => building.type === '상가').length
                const houseCount = cardBuildings.filter((building) => building.type === '주택').length
                const hasBoundary = cardBoundaries.some((b) => b.cardId === card.id)
                const leaders = getCardLeaderList(card)
                // 인도자가 많아 이름을 다 나열하면 길어짐 → 인원수만 표시 (미배정/N명)
                const leaderLabel = leaders.length > 0 ? `${leaders.length}명` : '미배정'
                return (
                  <tr key={card.id} onClick={() => setSelectedCardId(card.id)} style={{ cursor: 'pointer' }}>
                    {isAdmin && (
                      <td style={{ width: 52, paddingLeft: 18 }} onClick={(e) => e.stopPropagation()}>
                        <input type="checkbox" checked={checkedCardIds.has(card.id)} onChange={() => toggleCheckedCard(card.id)} />
                      </td>
                    )}
                    <td>
                      <div className="tbl__title">{card.name}</div>
                      <div className="tbl__sub">{card.region} {card.area}</div>
                    </td>
                    <td style={{ width: 140 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{ flex: 1, height: 6, background: 'var(--gray-100)', borderRadius: 'var(--radius-full)', overflow: 'hidden' }}>
                          <div style={{ height: '100%', width: `${card.progress}%`, background: card.progress >= 100 ? 'var(--success-500)' : card.progress > 0 ? 'var(--warning-500)' : 'var(--gray-300)', borderRadius: 'var(--radius-full)' }} />
                        </div>
                        <span className="tnum" style={{ fontSize: 12, color: 'var(--gray-600)', minWidth: 32, textAlign: 'right' }}>{card.progress}%</span>
                      </div>
                    </td>
                    <td onClick={(e) => e.stopPropagation()}>
                      {isAdmin ? (
                        <details style={{ position: 'relative' }}>
                          <summary style={{ listStyle: 'none', cursor: 'pointer', fontSize: 13, color: leaders.length > 0 ? 'var(--gray-900)' : '#B45309', fontWeight: leaders.length > 0 ? 500 : 600 }}>
                            {leaderLabel}
                          </summary>
                          <div style={{ position: 'absolute', zIndex: 15, top: 'calc(100% + 4px)', left: 0, minWidth: 200, maxHeight: 200, overflow: 'auto', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-lg)', background: '#fff', padding: 8, boxShadow: 'var(--shadow-md)' }}>
                            {leaderOptions.map((name) => (
                              <label key={name} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 4px', fontSize: 13, cursor: 'pointer' }}>
                                <input type="checkbox" checked={getCardLeaderList(card).includes(name)} onChange={() => void toggleCardLeader(card.id, name)} />
                                {name}
                              </label>
                            ))}
                            <button type="button" style={{ marginTop: 8, width: '100%', minHeight: 32, borderRadius: 8, border: '1px solid var(--border-default)', background: '#fff', fontSize: 12, fontWeight: 600 }} onClick={() => void onSetCardLeaders(card.id, [])}>모두 해제</button>
                          </div>
                        </details>
                      ) : (
                        <span style={{ fontSize: 13, color: leaders.length > 0 ? 'var(--gray-900)' : '#B45309', fontWeight: leaders.length > 0 ? 500 : 600 }}>
                          {leaderLabel}
                        </span>
                      )}
                    </td>
                    <td style={{ width: 150 }}>
                      <div className="card-building-type-summary">
                        <span><b>전체</b> <em className="tnum">{card.buildings}</em></span>
                        <span>주택 <em className="tnum">{houseCount}</em></span>
                        <span>상가 <em className="tnum">{storeCount}</em></span>
                      </div>
                    </td>
                    <td className="tnum" style={{ width: 80, textAlign: 'right', fontSize: 13 }}>
                      <div className="card-chinese-summary">
                        <span>{chinesePointCount}건</span>
                      </div>
                    </td>
                    <td className="tnum" style={{ width: 90, textAlign: 'right', fontSize: 13 }}>{card.regularVisits}건</td>
                    <td style={{ width: 80 }}>
                      <span style={{ padding: '2px 8px', borderRadius: 'var(--radius-sm)', background: hasBoundary ? 'var(--gray-100)' : 'transparent', color: hasBoundary ? 'var(--gray-600)' : 'var(--gray-400)', fontSize: 11, fontWeight: 600 }}>
                        {hasBoundary ? '있음' : '없음'}
                      </span>
                    </td>
                    <td style={{ width: 80 }}>
                      <span style={{ padding: '2px 8px', borderRadius: 'var(--radius-sm)', fontSize: 11, fontWeight: 600,
                        background: operationalState === '대상없음' ? 'var(--gray-100)' : card.status === '진행중' ? 'var(--primary-100)' : card.status === '미배정' ? 'var(--warning-100)' : 'var(--success-100)',
                        color: operationalState === '대상없음' ? 'var(--gray-500)' : card.status === '진행중' ? 'var(--primary-700)' : card.status === '미배정' ? 'var(--warning-700)' : 'var(--success-700)',
                      }}>
                        {operationalState === '대상없음' ? '완료·제외' : card.status === '완료' ? '완료' : card.status}
                      </span>
                    </td>
                    <td style={{ width: 160, textAlign: 'right', paddingRight: 18 }} onClick={(e) => e.stopPropagation()}>
                      <div style={{ display: 'inline-flex', gap: 6 }}>
                        <button className="tbl-ghost-btn sm" onClick={() => onOpenCardMap(card.id)} type="button">지도</button>
                        {isAdmin && (
                          <button className="tbl-soft-btn sm" onClick={() => onOpenCardMap(card.id, true)} type="button">수정</button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
              {doneExcludedCards.length > 0 && (
                <tr>
                  <td colSpan={isAdmin ? 10 : 9} style={{ padding: '10px 18px', background: 'var(--bg-subtle)', borderTop: '1px solid var(--border-subtle)' }}>
                    <button
                      className="tbl-ghost-btn sm"
                      onClick={() => setDoneExcludedOpen((open) => !open)}
                      type="button"
                      style={{ width: '100%', justifyContent: 'center', minHeight: 36 }}
                    >
                      완료·제외 {doneExcludedCards.length}개 {doneExcludedOpen ? '접기' : '펼치기'}
                    </button>
                  </td>
                </tr>
              )}
              {filteredCards.length === 0 && (
                <tr><td colSpan={isAdmin ? 10 : 9} style={{ textAlign: 'center', padding: '32px 18px', color: 'var(--gray-400)', fontSize: 13 }}>
                  {cards.length === 0 ? '카드가 없습니다. 위의 + 카드 추가 버튼으로 첫 카드를 만들어보세요.' : '조건에 맞는 카드가 없습니다.'}
                </td></tr>
              )}
            </tbody>
          </table>
          ) : buildingSubTab === '건물 목록' ? (
          <>
          {duplicateAddressGroups.length > 0 && (
            <div className="dup-address-banner">
              <span className="dup-address-icon">⚠️</span>
              <span className="dup-address-text">
                중복 주소 건물 <strong>{duplicateAddressGroups.length}그룹</strong> ({duplicateAddressGroups.reduce((s, g) => s + g.length, 0)}개 건물) 발견
              </span>
              <button
                className="dup-address-merge-btn"
                onClick={() => {
                  // 각 그룹의 이름 목록 수집
                  // 합칠 수 있는 것만 보여 준다. 겹치는 것은 아래에서 따로 알린다
                  const groups = mergePlan.merge.map((g) => {
                    const sorted = [g.primary, ...g.absorbed]
                    return {
                      primaryId: g.primary.id,
                      address: g.primary.address,
                      cardName: cardMap.get(g.primary.cardId)?.name ?? '카드 없음',
                      buildingCount: sorted.length,
                      unitCount: sorted.reduce((sum, building) => sum + building.units.length, 0),
                      names: sorted.map((b) => b.name),
                    }
                  })
                  setMergeModalGroups(groups)
                }}
                type="button"
              >
                중복 주소 합치기
              </button>
            </div>
          )}
          <div className="building-management-table" role="table" aria-label="건물 관리 목록">
            <div className="building-management-head" role="row">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-start', paddingLeft: 6 }}>
                <input
                  checked={filteredBuildings.length > 0 && filteredBuildings.every((building) => checkedBuildingIds.has(building.id))}
                  onChange={toggleAllFilteredBuildings}
                  type="checkbox"
                />
              </div>
              <span>건물</span>
              <span>주소</span>
              <span>카드</span>
              <span>유형</span>
              <span>세대</span>
              <span>중국어</span>
              <span>작업</span>
            </div>
            {sortedBuildings.map((building) => {
              const card = cardMap.get(building.cardId)
              const chineseCount = building.units.filter((unit) => unit.isChinese).length
              const isEditing = editingBuildingId === building.id
              const isDuplicate = duplicateBuildingIds.has(building.id)
              const recommendationBadge = recommendationBadges.get(building.id) ?? null
              return (
                <div className={`building-management-block${isDuplicate ? ' dup-address-row' : ''}`} key={building.id}>
                  <div className={`building-management-row${isEditing ? ' is-editing' : ''}`} role="row">
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-start', paddingLeft: 6 }}>
                      <input
                        checked={checkedBuildingIds.has(building.id)}
                        onChange={() => toggleCheckedBuilding(building.id)}
                        type="checkbox"
                      />
                    </div>
                    {isEditing ? (
                      <BuildingEditCells
                        key={building.id}
                        building={building}
                        cards={cards}
                        chineseCount={chineseCount}
                        onSave={(draft) => saveBuildingEdit(building, draft)}
                        onCancel={() => setEditingBuildingId(null)}
                      />
                    ) : (
                      <>
                        <button
                          className="building-name-link"
                          onClick={() => onOpenBuildingMap(building.id)}
                          type="button"
                        >
                          {building.name || '건물명 없음'}
                        </button>
                        {/* 건물관리는 주소 편집 화면이라 저장한 그대로 보여준다
                            (요약 표시는 수정 결과가 반영 안 된 것처럼 보임) */}
                        <span title={building.address}>{building.address}</span>
                        <span>
                          {card?.name ?? '카드 없음'}
                          {recommendationBadge && (
                            <span style={{
                              display: 'inline-block', marginLeft: 6, fontSize: 10.5, fontWeight: 600,
                              color: recommendationBadge.color, background: recommendationBadge.bg,
                              border: `1px solid ${recommendationBadge.color}30`,
                              borderRadius: 5, padding: '1px 5px', verticalAlign: 'middle',
                            }}>{recommendationBadge.label}</span>
                          )}
                        </span>
                        <span>
                          {building.type}
                          {getRestaurantUnits(building).length > 0 && (
                            <span className="building-type-restaurant">
                              식당{getRestaurantUnits(building).length > 1 ? ` ${getRestaurantUnits(building).length}` : ''}
                            </span>
                          )}
                        </span>
                        <span>{building.units.length}개</span>
                        <span>{chineseCount}건</span>
                        <span className="building-row-actions">
                          <button onClick={() => startBuildingEdit(building)} type="button">수정</button>
                          <button onClick={() => onOpenBuildingMap(building.id)} type="button">지도</button>
                        </span>
                      </>
                    )}
                  </div>
                  {/* 수정 모드: 세대 목록 */}
                  {isEditing && (
                    <div className="building-units-panel">
                      <div className="building-units-panel-head">
                        <strong>세대 목록</strong>
                        <span className="building-units-count">{building.units.length}개</span>
                      </div>
                      <div className="building-units-list">
                        {[...building.units].sort((a, b) => compareUnitNumbers(a.number, b.number)).map((unit) => {
                          const isEditingThisUnit = editingUnitId === unit.id
                          return (
                            <div className="building-unit-row" key={unit.id}>
                              {isEditingThisUnit ? (
                                <UnitEditForm
                                  key={unit.id}
                                  unit={unit}
                                  buildingType={building.type}
                                  onSave={async (draft) => {
                                    const saved = await onUpdateUnitFlags(unit.id, {
                                        // 호수 이름도 저장한다. 폼에 칸은 있는데
                                        // 여기서 안 넘겨서 아무리 고쳐도 그대로였다
                                        // (식당을 '전체' 에서 가게 이름으로 못 바꿨다)
                                        number: draft.number.trim() || unit.number,
                                      isChinese: draft.isChinese,
                                      isRegularVisit: draft.isRegularVisit,
                                      isForbidden: draft.isForbidden,
                                      isRestaurant: draft.isRestaurant,
                                      usageType: draft.usageType === building.type ? null : draft.usageType,
                                      memo: draft.memo,
                                    })
                                    if (saved === false) return
                                    onUpdateUnitStatus(building.id, unit.id, draft.status, draft.memo)
                                    setEditingUnitId(null)
                                  }}
                                  onCancel={() => setEditingUnitId(null)}
                                />
                              ) : (
                                <>
                                  <span className="unit-number">{unit.number}</span>
                                  <span className={`unit-status unit-status-${unit.status}`}>{unit.status}</span>
                                  <div className="unit-flags-display">
                                    {unit.isForbidden && <span className="unit-flag-chip forbidden">방문금지</span>}
                                    {unit.isRegularVisit && <span className="unit-flag-chip regular">정기</span>}
                                    {unit.isChinese && <span className="unit-flag-chip chinese">中</span>}
                                    {unit.isRestaurant && <span className="unit-flag-chip restaurant">식당</span>}
                                  </div>
                                  <span className="unit-memo">{unit.memo || '-'}</span>
                                  <span className="unit-row-actions">
                                    <button
                                      onClick={() => setEditingUnitId(unit.id)}
                                      type="button"
                                    >수정</button>
                                    <button
                                      onClick={async () => {
                                        const copy = placeDeletionCopy(role, 'unit')
                                        if (await confirmDialog({ message: `${unit.number}: ${copy.description}`, danger: true, confirmLabel: copy.confirmLabel })) onDeleteUnit(building.id, unit.id)
                                      }}
                                      type="button"
                                    >{placeDeletionCopy(role, 'unit').actionLabel}</button>
                                  </span>
                                </>
                              )}
                            </div>
                          )
                        })}
                        {/* 새 세대 추가 행 */}
                        <AddUnitRow
                          buildingId={building.id}
                          buildingType={building.type}
                          existingNumbers={new Set(building.units.map((u) => u.number))}
                          onAdd={onAddUnit}
                          unitsSurveyed={building.unitsSurveyed}
                          onSetUnitsSurveyed={onSetUnitsSurveyed}
                        />
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
            {filteredBuildings.length === 0 && (
              <div className="empty-card-row">
                조건에 맞는 건물이 없습니다. 건물 CSV 업로드 또는 지도 탭에서 건물을 추가해 주세요.
              </div>
            )}
          </div>
          </>
        ) : (
          <div className="point-management-table" ref={pointTableRef} role="table" aria-label="세대 목록">
            <div className="point-management-head" role="row">
              <span>카드</span>
              <span>건물/주소</span>
              <span>세대</span>
              <span>정기</span>
              <span>최근 방문</span>
              <span>메모</span>
              <span>지도</span>
            </div>
            {sortedPointRows.map(({ building, unit, latestHistory }) => {
              const card = cardMap.get(building.cardId)
              return (
                <div
	                  className={`point-management-row${selectedPointDetail?.buildingId === building.id && selectedPointDetail?.unitId === unit.id ? ' selected' : ''}`}
	                  key={`${building.id}-${unit.id}`}
	                  onClick={() => setSelectedPointDetail({ buildingId: building.id, unitId: unit.id })}
	                  ref={(node) => {
	                    const key = `${building.id}-${unit.id}`
	                    if (node) pointRowRefs.current.set(key, node)
	                    else pointRowRefs.current.delete(key)
	                  }}
	                  role="row"
	                >
                  <span>{card?.name ?? '카드 없음'}</span>
                  <span title={building.address}>{building.name || formatDisplayAddress(building.address)}</span>
                  <strong title={unit.number} style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 }}>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{unit.number}</span>
                    {/* 구분 칩 — 전체 보기에서 어떤 세대인지 알 수 있게 */}
                    {unit.isRestaurant && <span className="unit-flag-chip restaurant">식당</span>}
                    {unit.isChinese && !unit.isRestaurant && <span className="unit-flag-chip chinese">中</span>}
                  </strong>
	                  {unit.isRegularVisit ? (
	                    <input
	                      aria-label={`${unit.number} 정기방문자`}
	                      className="regular-visitor-input"
	                      defaultValue={unit.regularVisitor ?? ''}
                        onClick={(event) => event.stopPropagation()}
	                      onBlur={(event) => onSetRegularVisitor(unit.id, event.currentTarget.value)}
	                      placeholder="방문자"
	                    />
	                  ) : (
	                    <button
	                      className="point-toggle"
	                      onClick={(event) => {
                          event.stopPropagation()
                          onToggleRegularVisit(building.id, unit.id)
                        }}
	                      type="button"
	                    >
	                      등록
                    </button>
                  )}
                  <span className="point-visit-cell">
                    <span title={latestHistory ? `${latestHistory.visitedAt} ${latestHistory.timeSlot} ${latestHistory.result}` : undefined}>
                      {latestHistory ? `${latestHistory.visitedAt.slice(5)} ${latestHistory.timeSlot} ${latestHistory.result}` : '-'}
                    </span>
	                    <button
	                      className="point-visit-edit-btn"
	                      onClick={(event) => {
                          event.stopPropagation()
                          openPointVisitEditor({ building, unit, history: latestHistory })
                        }}
	                      type="button"
	                    >
	                      {latestHistory ? '수정' : '등록'}
	                    </button>
	                    <button
	                      className="point-visit-edit-btn"
	                      onClick={(event) => {
                          event.stopPropagation()
                          setSelectedPointDetail({ buildingId: building.id, unitId: unit.id })
                        }}
	                      type="button"
	                    >
	                      기록
	                    </button>
	                  </span>
	                  <input
	                    aria-label={`${unit.number} 메모`}
	                    defaultValue={unit.memo ?? ''}
                      onClick={(event) => event.stopPropagation()}
	                    onBlur={(event) => onUpdateUnitFlags(unit.id, { memo: event.currentTarget.value })}
	                  />
	                  <button
                      onClick={(event) => {
                        event.stopPropagation()
                        onOpenBuildingMap(building.id)
                      }}
                      type="button"
                    >지도</button>
	                </div>
              )
            })}
            {pointRows.length === 0 && (
              <div className="empty-card-row">
                조건에 맞는 세대가 없습니다. 위 구분·필터를 바꿔 보세요.
              </div>
            )}
          </div>
        )}
        </div>{/* /desk-card */}
        </>)}
      </div>{/* /territory-main */}

      {showPointDetailPane && selectedPointDetailData && (
	        <aside
	          className="territory-side point-detail-pane"
	          ref={pointDetailPaneRef}
	          style={{ '--point-detail-offset': `${selectedPointDetailOffset}px` } as React.CSSProperties}
	        >
          <div className="point-detail-scroll">
            <div className="point-detail-head">
              <div>
                <p>{selectedPointDetailData.card?.name ?? '카드 없음'}</p>
                <h3>{selectedPointDetailData.unit.number}</h3>
                <span>{selectedPointDetailData.building.name || formatDisplayAddress(selectedPointDetailData.building.address)}</span>
              </div>
              <button onClick={() => setSelectedPointDetail(null)} type="button">닫기</button>
            </div>

            <div className="point-detail-summary">
              <div>
                <strong>{selectedPointDetailData.histories[0] ? `${selectedPointDetailData.histories[0].visitedAt.slice(5)} ${selectedPointDetailData.histories[0].timeSlot} ${selectedPointDetailData.histories[0].result}` : '아직 없음'}</strong>
                <span>최근 방문</span>
              </div>
              <div>
                <strong>{selectedPointDetailData.histories.length}건</strong>
                <span>누적 기록</span>
              </div>
            </div>

            <div className="point-detail-actions">
              <button
                className="primary"
                onClick={() => openPointVisitEditor({ building: selectedPointDetailData.building, unit: selectedPointDetailData.unit })}
                type="button"
              >
                + 방문 기록 추가
              </button>
              <button onClick={() => onOpenBuildingMap(selectedPointDetailData.building.id)} type="button">지도</button>
            </div>

            {selectedPointDetailData.unit.isRegularVisit && (
              <div className="point-detail-info">
                <span>정기방문</span>
                <strong>{selectedPointDetailData.unit.regularVisitor || '방문자 미지정'}</strong>
              </div>
            )}

            <div className="point-history-list">
              <div className="point-history-title">방문 기록</div>
              {selectedPointDetailData.histories.length > 0 ? (
                selectedPointDetailData.histories.map((history) => (
                  <div className="point-history-item" key={history.id}>
                    <div className="point-history-main">
                      <div className="point-history-date-line">
                        <strong>{history.visitedAt.slice(0, 10)} {history.timeSlot}</strong>
                        <span className={`point-history-result result-${history.result}`}>{history.result}</span>
                      </div>
                      <div className="point-history-menu">
                        <button
                          aria-label="방문 기록 작업"
                          className="point-history-menu-btn"
                          onClick={() => setOpenHistoryActionId((current) => current === history.id ? null : history.id)}
                          type="button"
                        >
                          ...
                        </button>
                        {openHistoryActionId === history.id && (
                          <div className="point-history-menu-popover">
                            <button
                              onClick={() => {
                                setOpenHistoryActionId(null)
                                openPointVisitEditor({
                                  building: selectedPointDetailData.building,
                                  unit: selectedPointDetailData.unit,
                                  history,
                                })
                              }}
                              type="button"
                            >
                              수정
                            </button>
                            {onDeleteVisitHistory && (
                              <button className="danger" onClick={() => deletePointVisitHistory(history)} type="button">삭제</button>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                    {history.memo && <p>{history.memo}</p>}
                  </div>
                ))
              ) : (
                <div className="point-history-empty">등록된 방문 기록이 없습니다.</div>
              )}
            </div>

            <div className="point-detail-info">
              <span>메모</span>
              <strong>{selectedPointDetailData.unit.memo || '메모 없음'}</strong>
            </div>
          </div>
        </aside>
      )}

        {zoneKind === 'territory' && activeTab === '카드 관리' && detailPaneOpen && (
          <TerritoryDetailPane
            card={selectedCard}
            summary={{
              chinesePointCount: selectedChinesePointCount,
              hasBoundary: selectedHasBoundary,
              lastVisit: selectedLastVisit,
            }}
            isAdmin={isAdmin}
            leaderOptions={leaderOptions}
            leadersOf={getCardLeaderList}
            onToggleLeader={toggleCardLeader}
            onSetCardLeaders={(cardId, names) => { void onSetCardLeaders?.(cardId, names) }}
            formatRelativeDate={formatRelativeDate}
          />
        )}
    </section>
  )
}
