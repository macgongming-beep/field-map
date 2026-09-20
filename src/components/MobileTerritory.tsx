import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import type { ActiveRestaurantSession, Building, CalendarEvent, CardBoundary, EndReturnVisitInput, EventInformalAssignment, EventRestaurantAssignment, InformalAsset, ManualReturnVisitInput, ReturnVisit, ReturnVisitLog, Role, ServiceSession, TerritoryCard, TimeSlot, Unit, VisitHistory } from '../types'
import { buildingHasUsage } from '../utils/unitUsage'
import type { AppLanguage } from '../i18n'
import { t, translateKoreanAddress, weekdayShortLabels } from '../i18n'
import { getTerritoryCardOperationalState, sortTerritoryCardsByOperationalPriority } from '../utils/cardSearch'
import { findReturnVisitBuilding, getUserReturnVisits, normalizeVisitorName } from '../utils/returnVisits'
import { RestaurantServiceSheet } from './RestaurantServiceSheet'
import { msg } from '../lib/msg'
import { showToast } from '../lib/toast'
import { getAssignmentTeamMembers } from '../utils/assignmentTeamMembers'
import { chooseCardForBuilding } from '../utils/chooseCardForBuilding'
import { buildingAddressKey, shortAddress } from '../utils/shortAddress'
import { EndReturnVisitDialog } from './EndReturnVisitDialog'
import { searchPlacesForCongregation } from '../lib/placeSearch'
import { canonicalUnitNumber } from '../utils/unitNumber'

function assignmentCardIds(assignment?: CalendarEvent['cardAssignments'][number]) {
  if (!assignment) return []
  // 비공식 봉사만 맡은 팀은 구역 카드가 없다 (assignedCardId 가 null)
  return assignment.assignedCardIds && assignment.assignedCardIds.length > 0
    ? assignment.assignedCardIds
    : assignment.assignedCardId != null ? [assignment.assignedCardId] : []
}

function getTimeSlotFromTime(time: string): TimeSlot {
  const [hourText, minuteText] = time.split(':')
  const hour = Number(hourText)
  const minute = Number(minuteText || '0')
  const value = hour + minute / 60
  if (value < 12) return '오전'
  if (value < 16.5) return '오후'
  return '저녁'
}

function getCurrentTimeSlot(): TimeSlot {
  const hour = new Date().getHours()
  if (hour < 12) return '오전'
  if (hour < 17) return '오후'
  return '저녁'
}

function fmtDate(dateStr: string, language: AppLanguage): string {
  const today = new Date(); today.setHours(0,0,0,0)
  const d = new Date(dateStr.slice(0, 10)); d.setHours(0,0,0,0)
  const diff = Math.round((today.getTime() - d.getTime()) / 86400000)
  if (diff === 0) return t(language, 'territory.today')
  if (diff === 1) return t(language, 'territory.yesterday')
  if (diff < 30) return language === 'en' ? `${diff}d ago` : language === 'zh' ? `${diff}天前` : `${diff}일 전`
  return `${d.getMonth()+1}/${d.getDate()}`
}

/** 주소 검색 후보. 좌표는 SDK 가 안 줄 수도 있어 null 을 허용한다 */
type AddressCandidate = {
  address: string
  lat: number | null
  lng: number | null
  name?: string
  category?: string
}

function distanceMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const rad = Math.PI / 180
  const dLat = (b.lat - a.lat) * rad
  const dLng = (b.lng - a.lng) * rad
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2
  return 6371000 * 2 * Math.asin(Math.sqrt(h))
}

function matchingBuildingsForAddress(address: string, candidate: AddressCandidate | null, buildings: Building[]) {
  if (address.length < 2) return []
  const q = address.toLowerCase()
  const addressKey = buildingAddressKey(address)
  const hasSelectedCoordinates = candidate?.lat != null && candidate?.lng != null
  return buildings.filter((building) => {
    if (building.address.toLowerCase().includes(q) || building.name.toLowerCase().includes(q)) return true
    const buildingKey = buildingAddressKey(building.address)
    if (!hasSelectedCoordinates || buildingKey !== addressKey || !building.lat || !building.lng) return false
    return distanceMeters(
      { lat: candidate.lat as number, lng: candidate.lng as number },
      { lat: building.lat, lng: building.lng },
    ) <= 200
  }).slice(0, 3)
}

function normalizeUnitNumberInput(value: string) {
  return canonicalUnitNumber(value)
}

export function MobileTerritory({
  language,
  translatePlaceNames = false,
  buildings,
  cards,
  cardBoundaries = [],
  calendarEvents = [],
  currentVisitor,
  role,
  serviceSessions,
  returnVisits = [],
  returnVisitLogs = [],
  onOpenMap,
  onOpenInformalMap,
  onOpenRegularVisitMap,
  onEndServiceSession: _onEndServiceSession,  // 종료 버튼 제거 — auto_close가 처리. prop 시그니처는 후방호환 유지.
  onCreateManualReturnVisit,
  onAddReturnVisitLog,
  onUpdateReturnVisitLog,
  onDeleteReturnVisitLog,
  onDeleteReturnVisit,
  onUpdateReturnVisitNickname,
  onUpdateReturnVisitAddress,
  // v2 신 배정 모델
  informalAssets = [],
  eventInformalAssignments = [],
  eventRestaurantAssignments = [],
  // 식당봉사
  visitHistories = [],
  onAddRestaurantVisit,
  onSubmitRestaurantRequest,
  onUpdateRestaurantRequestMemo,
  restaurantRequests = [],
}: {
  language: AppLanguage
  translatePlaceNames?: boolean
  buildings: Building[]
  cards: TerritoryCard[]
  cardBoundaries?: CardBoundary[]
  calendarEvents?: CalendarEvent[]
  currentVisitor: string
  role: Role
  serviceSessions: ServiceSession[]
  returnVisits?: ReturnVisit[]
  returnVisitLogs?: ReturnVisitLog[]
  informalAssets?: InformalAsset[]
  eventInformalAssignments?: EventInformalAssignment[]
  eventRestaurantAssignments?: EventRestaurantAssignment[]
  visitHistories?: VisitHistory[]
  onAddRestaurantVisit?: (unitId: number, memo: string) => Promise<void>
  onSubmitRestaurantRequest?: import('../types/restaurantRegistration').SubmitRestaurantRequest
  onUpdateRestaurantRequestMemo?: (requestId: number, memo: string) => Promise<void>
  restaurantRequests?: import('../types').RestaurantRequest[]
  onOpenMap: (cardId: number) => void
  onOpenInformalMap?: (assetId: number) => void
  onOpenRegularVisitMap?: (returnVisitId?: number) => void
  onEndServiceSession: (sessionId: number) => void
  onCreateManualReturnVisit?: (input: ManualReturnVisitInput) => Promise<boolean>
  onAddReturnVisitLog?: (returnVisitId: number, result: '만남' | '부재' | null, memo: string) => Promise<void>
  onUpdateReturnVisitLog?: (id: number, result: '만남' | '부재' | null, memo: string) => Promise<void>
  onDeleteReturnVisitLog?: (id: number) => Promise<void>
  onDeleteReturnVisit?: (id: number, input: EndReturnVisitInput) => Promise<boolean>
  onUpdateReturnVisitNickname?: (id: number, nickname: string) => Promise<void>
  onUpdateReturnVisitAddress?: (id: number, address: string) => Promise<void>
}) {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const targetAssignmentEventId = Number(searchParams.get('assignmentEvent') ?? 0) || null
  const [filter, setFilter] = useState<'전체' | '미배정' | '내 카드'>('전체')
  const [showRegularDetail, setShowRegularDetail] = useState(false)
  const [rvCollapsed, setRvCollapsed] = useState(true)  // 기본 접힘
  const showReturnVisits = localStorage.getItem('feat_returnVisit') === '1'
  const [showRestaurantSheet, setShowRestaurantSheet] = useState(false)

  // ── 식당봉사 활성 세션 ────────────────────────────────────
  const RS_KEY = `rs:${currentVisitor}`
  const [activeRestaurantSession, setActiveRestaurantSession] = useState<ActiveRestaurantSession | null>(() => {
    try {
      const raw = localStorage.getItem(`rs:${currentVisitor}`)
      if (!raw) return null
      const s = JSON.parse(raw) as ActiveRestaurantSession
      if (Date.now() - new Date(s.startedAt).getTime() > 86400000) {
        localStorage.removeItem(`rs:${currentVisitor}`)
        return null
      }
      return s
    } catch { return null }
  })
  const [showSessionMemo, setShowSessionMemo] = useState(false)
  const [sessionMemo, setSessionMemo] = useState('')
  const [sessionSaving, setSessionSaving] = useState(false)
  const [showSessionMenu, setShowSessionMenu] = useState(false)
  const [showDoneExcludedCards, setShowDoneExcludedCards] = useState(false)

  const saveSession = (s: ActiveRestaurantSession | null) => {
    setActiveRestaurantSession(s)
    if (s) localStorage.setItem(RS_KEY, JSON.stringify(s))
    else localStorage.removeItem(RS_KEY)
  }

  const handleStartSession = (partial: Omit<ActiveRestaurantSession, 'startedAt'>) => {
    saveSession({ ...partial, startedAt: new Date().toISOString() } as ActiveRestaurantSession)
  }

  const handleCancelSession = () => {
    saveSession(null)
    setShowSessionMemo(false)
    setSessionMemo('')
    setShowSessionMenu(false)
  }

  const handleSaveSessionResult = async () => {
    if (!activeRestaurantSession) return
    setSessionSaving(true)
    if (activeRestaurantSession.kind === 'building' && onAddRestaurantVisit) {
      await onAddRestaurantVisit(activeRestaurantSession.unitId, sessionMemo)
    } else if (activeRestaurantSession.kind === 'request' && onUpdateRestaurantRequestMemo) {
      await onUpdateRestaurantRequestMemo(activeRestaurantSession.requestId, sessionMemo)
    }
    setSessionSaving(false)
    saveSession(null)
    setShowSessionMemo(false)
    setSessionMemo('')
  }

  const [colorPickId, setColorPickId] = useState<number | null>(null)
  const [rvColors, setRvColors] = useState<Record<number, string>>(() => {
    try { return JSON.parse(localStorage.getItem('rvColors') ?? '{}') } catch { return {} }
  })
  const setRvColor = (id: number, color: string | null) => {
    setRvColors((prev) => {
      const next = { ...prev }
      if (color) next[id] = color
      else delete next[id]
      localStorage.setItem('rvColors', JSON.stringify(next))
      return next
    })
  }
  // 정기방문 카드 메뉴 & 기록 시트
  const [menuOpenId, setMenuOpenId] = useState<number | null>(null)
  const [sectionMenuOpen, setSectionMenuOpen] = useState(false)
  const [nicknameEditId, setNicknameEditId] = useState<number | null>(null)
  const [nicknameEditValue, setNicknameEditValue] = useState('')
  const [nicknameSaving, setNicknameSaving] = useState(false)
  const [addressEditId, setAddressEditId] = useState<number | null>(null)
  const [addressEditValue, setAddressEditValue] = useState('')
  const [addressSaving, setAddressSaving] = useState(false)
  const [logTarget, setLogTarget] = useState<ReturnVisit | null>(null)
  const [logResult, setLogResult] = useState<'만남' | '부재' | null>(null)
  const [logMemo, setLogMemo] = useState('')
  const [logSaving, setLogSaving] = useState(false)
  const [deletingId, setDeletingId] = useState<number | null>(null)
  const [endingVisit, setEndingVisit] = useState<ReturnVisit | null>(null)
  // 꾹 누르기 → 기록 액션 팝업
  // 수동 추가 시트
  const [showAddSheet, setShowAddSheet] = useState(false)
  const [addNickname, setAddNickname] = useState('')
  const [addAddress, setAddAddress] = useState('')
  const [addMemo, setAddMemo] = useState('')
  const [addFirstResult, setAddFirstResult] = useState<'만남' | '부재' | null>(null)
  const [addSaving, setAddSaving] = useState(false)
  const [addLinked, setAddLinked] = useState<{ building: Building; unit: Unit } | null>(null)
  const [addUnitPickBuilding, setAddUnitPickBuilding] = useState<Building | null>(null)
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [confirmDialog, setConfirmDialog] = useState<{ message: string; onConfirm: () => void } | null>(null)
  const [addAddressGeocoding, setAddAddressGeocoding] = useState(false)
  const [addAddressCandidates, setAddAddressCandidates] = useState<AddressCandidate[]>([])
  const [addSelectedCandidate, setAddSelectedCandidate] = useState<AddressCandidate | null>(null)
  const [addNewUnitBuilding, setAddNewUnitBuilding] = useState<number | 'new' | null>(null)
  const [addBuildingName, setAddBuildingName] = useState('')
  const [addBuildingType, setAddBuildingType] = useState<Building['type']>('주택')
  const [addUnitUsageType, setAddUnitUsageType] = useState<Building['type']>('주택')
  const [addUnitNumber, setAddUnitNumber] = useState('')
  const [addrEditGeocoding, setAddrEditGeocoding] = useState(false)
  const [addrEditCandidates, setAddrEditCandidates] = useState<AddressCandidate[]>([])
  const [logActionId, setLogActionId] = useState<number | null>(null) // 팝업 대상 로그 id
  const [logEditMode, setLogEditMode] = useState(false)               // 팝업이 수정 모드인지
  const [logEditResult, setLogEditResult] = useState<'만남' | '부재' | null>(null)
  const [logEditMemo, setLogEditMemo] = useState('')
  const [logEditSaving, setLogEditSaving] = useState(false)
  const canCreateReturnVisitLocation = role === 'leader' || role === 'admin' || role === 'developer'
  const timeSlotLabel = (slot: TimeSlot) => {
    if (slot === '오전') return t(language, 'map.morning')
    if (slot === '오후') return t(language, 'map.afternoon')
    return t(language, 'map.evening')
  }
  const resultLabel = (result: '만남' | '부재' | null) => {
    if (result === '만남') return t(language, 'map.met')
    if (result === '부재') return t(language, 'map.absent')
    return ''
  }
  const cardStatusLabel = (status: string) => {
    if (status === '방문필요') return t(language, 'zone.summaryNeed')
    if (status === '진행중') return t(language, 'zone.summaryProgress')
    if (status === '완료') return t(language, 'zone.summaryDone')
    if (status === '대상없음') return t(language, 'zone.summaryDoneExcluded')
    return status
  }

  const cardBuildingTypeCounts = useMemo(() => {
    const map = new Map<number, { total: number; house: number; shop: number }>()
    cards.forEach((card) => map.set(card.id, { total: 0, house: 0, shop: 0 }))
    buildings.forEach((building) => {
      const current = map.get(building.cardId) ?? { total: 0, house: 0, shop: 0 }
      current.total += 1
      if (buildingHasUsage(building, '주택')) current.house += 1
      if (buildingHasUsage(building, '상가')) current.shop += 1
      map.set(building.cardId, current)
    })
    return map
  }, [buildings, cards])

  const today = useMemo(() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }, [])

  // 오늘 봉사 + 미래 배정 + (지난 배정은 펼치기 토글)
  const [showPastAssignments, setShowPastAssignments] = useState(false)
  // 지난 봉사 — 전체 기간 (월별 타임라인으로 렌더)
  const pastCutoff = useMemo(() => '0001-01-01', [])
  const myAssignmentsSplit = useMemo(() => {
    const todayEvents = calendarEvents.filter((e) => e.date === today)
    // 미래(오늘 제외) 일정 중 내 배정
    const futureAssigned = calendarEvents.filter((event) =>
      event.date > today &&
      event.cardAssignments.some((assignment) => assignment.userName === currentVisitor)
    )
    // 과거 일정 중 내 배정 (오늘 제외, 30일 이내)
    const pastAssigned = calendarEvents.filter((event) =>
      event.date < today &&
      event.date >= pastCutoff &&
      event.cardAssignments.some((assignment) => assignment.userName === currentVisitor)
    )
    const targetEvent = targetAssignmentEventId
      ? calendarEvents.find((event) => event.id === targetAssignmentEventId)
      : null
    // 활성 영역: 오늘 + 미래 + (targetEvent 강제 주입)
    const activeEvents = [
      ...(targetEvent ? [targetEvent] : []),
      ...todayEvents,
      ...futureAssigned,
    ].filter((event, index, list) => list.findIndex((item) => item.id === event.id) === index)
      .sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`))
    // 과거 영역: targetEvent 가 과거면 활성에 이미 들어갔으므로 제외
    const pastEvents = pastAssigned
      .filter((event) => !activeEvents.some((e) => e.id === event.id))
      .sort((a, b) => `${b.date} ${b.time}`.localeCompare(`${a.date} ${a.time}`))
    return { activeEvents, pastEvents }
  }, [calendarEvents, today, pastCutoff, targetAssignmentEventId, currentVisitor])

  const buildAssignment = (event: CalendarEvent) => {
    const assignment = event.cardAssignments.find((a) => a.userName === currentVisitor)
    const isParticipant =
      !!assignment ||
      event.applicants.includes(currentVisitor) ||
      event.assigned.includes(currentVisitor) ||
      event.leaders.includes(currentVisitor)
    if (!isParticipant) return null
    const cardIds = assignmentCardIds(assignment)
    const assignedCards = cardIds
      .map((id) => cards.find((c) => c.id === id))
      .filter(Boolean) as TerritoryCard[]
    const teammates = getAssignmentTeamMembers(event, currentVisitor)
    return { event, cards: assignedCards, teammates }
  }

  const myTodayAssignments = useMemo(() => {
    return myAssignmentsSplit.activeEvents
      .map(buildAssignment)
      .filter(Boolean) as Array<{ event: CalendarEvent; cards: TerritoryCard[]; teammates: string[] }>
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myAssignmentsSplit, cards, currentVisitor])

  const myPastAssignments = useMemo(() => {
    return myAssignmentsSplit.pastEvents
      .map(buildAssignment)
      .filter(Boolean) as Array<{ event: CalendarEvent; cards: TerritoryCard[]; teammates: string[] }>
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myAssignmentsSplit, cards, currentVisitor])

  // 지난 봉사 — 미니 캘린더용 데이터 구조
  // assignmentsByDate: 'YYYY-MM-DD' → 그날 참여한 항목들 (시간대순)
  const assignmentsByDate = useMemo(() => {
    const map = new Map<string, typeof myPastAssignments>()
    for (const item of myPastAssignments) {
      const list = map.get(item.event.date) ?? []
      list.push(item)
      map.set(item.event.date, list)
    }
    // 각 날짜의 항목들을 시간순 정렬
    for (const list of map.values()) {
      list.sort((a, b) => a.event.time.localeCompare(b.event.time))
    }
    return map
  }, [myPastAssignments])

  // 사용 가능한 월 목록 (최신순)
  const availableMonths = useMemo(() => {
    const set = new Set<string>()
    for (const item of myPastAssignments) set.add(item.event.date.slice(0, 7))
    return [...set].sort((a, b) => b.localeCompare(a))
  }, [myPastAssignments])

  // 현재 보고 있는 월 ('YYYY-MM'). 기본 = 가장 최근 데이터의 월, 없으면 오늘
  const [pastMonth, setPastMonth] = useState<string>(() => {
    if (availableMonths.length > 0) return availableMonths[0]
    return today.slice(0, 7)
  })
  // availableMonths 가 처음 로드된 직후에는 초기값이 오늘로 잡혀있을 수 있으므로 보정
  useEffect(() => {
    if (availableMonths.length > 0 && !availableMonths.includes(pastMonth)) {
      // pastMonth 가 데이터 없는 달이면 그대로 둠 (사용자가 빈 달도 볼 수 있게)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availableMonths])

  // 선택된 날짜 ('YYYY-MM-DD'), 인라인 상세 펼침 용
  const [selectedPastDate, setSelectedPastDate] = useState<string | null>(null)

  const pastMonthLabel = useMemo(() => {
    const [year, month] = pastMonth.split('-')
    if (language === 'zh') return `${year}年${Number(month)}月`
    if (language === 'en') return `${new Date(`${pastMonth}-01`).toLocaleString('en-US', { month: 'long' })} ${year}`
    return `${year}년 ${Number(month)}월`
  }, [pastMonth, language])

  // 현재 월의 셀 정보 — 6주 × 7일 = 42칸. null = 빈 칸
  const pastCalendarCells = useMemo(() => {
    const [yearStr, monthStr] = pastMonth.split('-')
    const year = Number(yearStr)
    const month = Number(monthStr)
    const firstDay = new Date(year, month - 1, 1)
    const lastDay = new Date(year, month, 0)
    const startWeekday = firstDay.getDay() // 0=일
    const daysInMonth = lastDay.getDate()
    const cells: Array<{ date: string; day: number; items: typeof myPastAssignments; slots: Set<TimeSlot> } | null> = []
    for (let i = 0; i < startWeekday; i += 1) cells.push(null)
    for (let day = 1; day <= daysInMonth; day += 1) {
      const dateStr = `${yearStr}-${monthStr}-${String(day).padStart(2, '0')}`
      const items = assignmentsByDate.get(dateStr) ?? []
      const slots = new Set<TimeSlot>()
      for (const it of items) slots.add(getTimeSlotFromTime(it.event.time))
      cells.push({ date: dateStr, day, items, slots })
    }
    while (cells.length % 7 !== 0) cells.push(null)
    return cells
  }, [pastMonth, assignmentsByDate])

  const pastMonthCount = useMemo(() => {
    return pastCalendarCells.reduce((sum, cell) => sum + (cell?.items.length ?? 0), 0)
  }, [pastCalendarCells])

  const navigatePastMonth = (delta: number) => {
    const [y, m] = pastMonth.split('-').map(Number)
    const d = new Date(y, m - 1 + delta, 1)
    const newYm = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    setPastMonth(newYm)
    setSelectedPastDate(null)
  }


  const [expandedEventIds, setExpandedEventIds] = useState<Set<number>>(() => {
    if (targetAssignmentEventId) return new Set([targetAssignmentEventId])
    const currentSlot = getCurrentTimeSlot()
    const currentEvent = myTodayAssignments.find(({ event }) => getTimeSlotFromTime(event.time) === currentSlot)
    return currentEvent ? new Set([currentEvent.event.id]) : new Set()
  })

  useEffect(() => {
    if (!targetAssignmentEventId) return
    setExpandedEventIds((prev) => new Set(prev).add(targetAssignmentEventId))
  }, [targetAssignmentEventId])

  // 시간대 변경 자동 펴기·접기: 현재 시간대로 진입한 일정만 펴짐, 이전 시간대는 자동 접힘.
  // (예: 13:00 봉사 펴진 상태에서 15:00 도달 → 13:00 접고 15:00 펴짐)
  // 단, 사용자가 명시적으로 다른 일정 펼친 경우는 건드리지 않음 (그건 toggleTodayEvent로 처리됨).
  const lastSlotRef = useRef<string>(getCurrentTimeSlot())
  useEffect(() => {
    const syncByTimeSlot = () => {
      const slot = getCurrentTimeSlot()
      if (slot === lastSlotRef.current) return  // 시간대 변경 없음
      const prevSlot = lastSlotRef.current
      lastSlotRef.current = slot

      const newSlotEvent = myTodayAssignments.find(({ event }) => getTimeSlotFromTime(event.time) === slot)
      const prevSlotEvents = myTodayAssignments
        .filter(({ event }) => getTimeSlotFromTime(event.time) === prevSlot)
        .map(({ event }) => event.id)

      setExpandedEventIds((prev) => {
        const next = new Set(prev)
        // 이전 시간대 일정 접기
        prevSlotEvents.forEach((id) => next.delete(id))
        // 새 시간대 일정 펴기
        if (newSlotEvent) next.add(newSlotEvent.event.id)
        return next
      })
    }

    // 1분마다 시간대 체크
    const interval = window.setInterval(syncByTimeSlot, 60_000)
    // 페이지 다시 보일 때도 체크 (백그라운드에서 시간 지난 경우)
    const onVisible = () => { if (!document.hidden) syncByTimeSlot() }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [myTodayAssignments])

  const myTodaySessions = useMemo(
    () =>
      serviceSessions
        .filter((s) => s.userName === currentVisitor && s.serviceDate === today)
        .sort((a, b) => b.startedAt.localeCompare(a.startedAt)),
    [serviceSessions, currentVisitor, today]
  )

  const activeSession = myTodaySessions.find((s) => s.status === 'active' && !s.endedAt)

  const activeSessionCardIds = useMemo(
    () =>
      new Set(
        myTodaySessions
          .filter((s) => s.status === 'active' && !s.endedAt && s.primaryCardId)
          .map((s) => s.primaryCardId as number)
      ),
    [myTodaySessions]
  )

  const myCards = useMemo(() => {
    const assigned = (() => {
      if (role === 'user') return cards.filter((c) => c.assignedUsers.includes(currentVisitor))
      if (role === 'leader') return cards.filter((c) => c.assignedLeader === currentVisitor)
      return cards.filter((c) => c.assignedLeader === currentVisitor || c.assignedUsers.includes(currentVisitor))
    })()
    const assignedIds = new Set(assigned.map((c) => c.id))
    const fromSession = cards.filter((c) => activeSessionCardIds.has(c.id) && !assignedIds.has(c.id))
    return [...assigned, ...fromSession]
  }, [cards, role, currentVisitor, activeSessionCardIds])

  const visibleCards = useMemo(() => {
    let list: TerritoryCard[]
    if (role === 'admin') {
      if (filter === '미배정') list = cards.filter((c) => !c.assignedLeader)
      else if (filter === '내 카드') list = myCards
      else list = cards
    } else {
      list = myCards
    }
    return sortTerritoryCardsByOperationalPriority(list)
  }, [cards, role, filter, myCards])

  const isDoneExcludedCard = (card: TerritoryCard) => {
    const state = getTerritoryCardOperationalState(card)
    return state === '완료' || state === '대상없음'
  }
  const doneExcludedCards = useMemo(
    () => visibleCards.filter(isDoneExcludedCard),
    [visibleCards]
  )
  const renderedVisibleCards = showDoneExcludedCards
    ? visibleCards
    : visibleCards.filter((card) => !isDoneExcludedCard(card))

  const myRegularVisits = useMemo(
    () =>
      buildings.flatMap((building) => {
        const card = cards.find((item) => item.id === building.cardId)
        const currentName = normalizeVisitorName(currentVisitor)
        return building.units
          .filter((unit) => unit.isRegularVisit && normalizeVisitorName(unit.regularVisitor) === currentName)
          .map((unit) => ({ building, card, unit }))
      }),
    [buildings, cards, currentVisitor]
  )

  // return_visits 기반 정기방문 목록 (내가 담당 or 내가 생성)
  const myReturnVisits = useMemo(() =>
    getUserReturnVisits(returnVisits, currentVisitor),
    [returnVisits, currentVisitor]
  )

  // 네이버 지도 Geocoding으로 짧은 주소 → 전체 주소 자동완성
  /**
   * 주소 후보를 찾아 온다. **입력칸을 건드리지 않는다.**
   *
   * ⚠ 예전에는 타이핑하다 800ms 멈추면 첫 번째 결과로 **칸을 덮어썼다.**
   *   '명지로' 처럼 전국에 널린 도로명이면 엉뚱한 지방 주소가 들어왔고,
   *   아직 다 안 쳤는데 칸이 바뀌어 그 뒤 입력이 엉켰다.
   *   봉사자 여러 명이 같은 증상을 신고했다 (2026-09-05).
   *   이제 사용자가 **검색을 누를 때만** 부르고, 후보를 보여 주고 고르게 한다.
   */
  const searchAddressCandidates = async (
    query: string,
    setResults: (v: AddressCandidate[]) => void,
    setLoading: (v: boolean) => void,
  ) => {
    setLoading(true)
    setResults([])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- 네이버 지도 SDK 무타입
    const naver = (window as any).naver
    const geocoded = new Promise<AddressCandidate[]>((resolve) => {
      if (!naver?.maps?.Service) { resolve([]); return }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- 네이버 지도 SDK 무타입
      naver.maps.Service.geocode({ query }, (status: any, response: any) => {
        if (status === naver.maps.Service.Status.ERROR) { resolve([]); return }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- 네이버 지도 SDK 무타입
        const items: any[] = response?.v2?.addresses ?? []
        resolve(items.map((item) => {
          const lat = Number(item.y)
          const lng = Number(item.x)
          return {
            address: String(item.roadAddress || item.jibunAddress || '').trim(),
            lat: Number.isFinite(lat) ? lat : null,
            lng: Number.isFinite(lng) ? lng : null,
          }
        }).filter((candidate) => candidate.address))
      })
    })

    const [placeResult, addressResults] = await Promise.all([
      searchPlacesForCongregation(query),
      geocoded,
    ])
    const placeResults: AddressCandidate[] = placeResult.ok
      ? placeResult.places.map((place) => ({
          name: place.name,
          address: place.address,
          category: place.category,
          lat: place.lat,
          lng: place.lng,
        }))
      : []
    const addressLike = /(로|길|동|읍|면)\s*\d|\d+(-\d+)?\s*$/.test(query)
    const combined = addressLike
      ? [...addressResults, ...placeResults]
      : [...placeResults, ...addressResults]
    const seen = new Set<string>()
    const out = combined.filter((candidate) => {
      const key = `${candidate.name ?? ''}|${candidate.address}|${candidate.lat}|${candidate.lng}`
      if (!candidate.address || seen.has(key)) return false
      seen.add(key)
      return true
    }).slice(0, 5)
    setLoading(false)
    setResults(out)
    if (out.length === 0) {
      showToast(placeResult.ok
        ? msg('장소나 주소를 찾지 못했습니다.')
        : msg('장소 검색을 쓸 수 없습니다. 잠시 뒤 다시 시도해 주세요.'), 'info')
    }
  }

  /**
   * 우리 봉사 범위 안인가. **막지 않고 표시만 한다.**
   * ⚠ 구역선 밖이라고 후보를 숨기면 안 된다 — 구역선이 실제 담당 범위보다
   *   작게 그려진 카드가 실제로 있다(화성시 송동 2). 정상 후보가 사라진다.
   */
  const serviceArea = useMemo(() => {
    const pts = buildings.filter((b) => b.lat && b.lng)
    if (pts.length === 0) return null
    const lat = pts.map((b) => b.lat)
    const lng = pts.map((b) => b.lng)
    const pad = 0.05   // 약 5km
    return {
      minLat: Math.min(...lat) - pad, maxLat: Math.max(...lat) + pad,
      minLng: Math.min(...lng) - pad, maxLng: Math.max(...lng) + pad,
    }
  }, [buildings])
  const isFarFromService = (c: AddressCandidate) => {
    if (!serviceArea || c.lat === null || c.lng === null) return false
    return c.lat < serviceArea.minLat || c.lat > serviceArea.maxLat
      || c.lng < serviceArea.minLng || c.lng > serviceArea.maxLng
  }

  // 주소 입력 시 구역 카드 건물 매칭
  const addressMatches = useMemo(() => {
    if (addLinked || !addSelectedCandidate) return []
    return matchingBuildingsForAddress(addAddress, addSelectedCandidate, buildings)
  }, [addAddress, addSelectedCandidate, buildings, addLinked])

  const activeCard = cards.find((card) => card.id === activeSession?.primaryCardId)
  const fallbackCard = myCards[0]
  const _quickMapCardId = activeCard?.id ?? fallbackCard?.id
  void _quickMapCardId
  const toggleTodayEvent = (eventId: number) => {
    setExpandedEventIds((prev) => {
      const next = new Set(prev)
      if (next.has(eventId)) next.delete(eventId)
      else next.add(eventId)
      return next
    })
  }

  if (showRegularDetail) {
    return (
      <div className="mobile-territory-page">
        <div className="mobile-territory-head compact">
          <button className="mobile-territory-back" onClick={() => setShowRegularDetail(false)} type="button">‹</button>
          <div>
            <p>{t(language, 'territory.title')}</p>
            <h2>{t(language, 'territory.regularVisitManage')}</h2>
          </div>
        </div>
        <section className="mobile-regular-section detail" aria-label={t(language, 'territory.regularVisitManage')}>
          <div className="mobile-section-title">
            <h2>{t(language, 'territory.regularVisit')} ({myRegularVisits.length}{t(language, 'calendar.countSuffix')})</h2>
          </div>
          {myRegularVisits.length === 0 ? (
            <div className="mobile-territory-empty">{t(language, 'territory.noRegularVisits')}</div>
          ) : (
            <div className="mobile-regular-list">
              {myRegularVisits.map(({ building, card, unit }) => (
                <button
                  className="mobile-regular-row"
                  key={`${building.id}-${unit.id}`}
                  onClick={() => onOpenMap(building.cardId)}
                  type="button"
                >
                  <div>
                    <strong>{building.name} {unit.number}</strong>
                    <span>{card?.name ?? t(language, 'territory.noCard')} · {building.type}</span>
                    {unit.memo && <small>{unit.memo}</small>}
                  </div>
                  <b>{t(language, 'territory.open')}</b>
                </button>
              ))}
            </div>
          )}
        </section>
      </div>
    )
  }

  return (
    <>
    <div className="mobile-territory-page">
      {role !== 'admin' && (
        <>
          {/* 활성 세션 카드 제거됨 — 자동 종료 + {msg('오늘 배정')} 안 활성 카드 강조로 대체 */}

          <section className="mobile-territory-section mobile-today-service-section">
            <div className="mt-mini-section-head">
              <h2>{t(language, 'territory.todayAssignment')}</h2>
              <span className="mt-mini-meta">{myTodayAssignments.length}{t(language, 'calendar.countSuffix')}</span>
            </div>
            {myTodayAssignments.length === 0 ? (
              <div className="mobile-territory-empty">{t(language, 'territory.noTodayService')}</div>
            ) : (
              <div className="mobile-today-service-list">
                {myTodayAssignments.map(({ event, cards: assignedCards, teammates }) => {
                  const isOpen = expandedEventIds.has(event.id)
                  // v2: 본인의 비공식/식당 배정
                  const myInformal = eventInformalAssignments.filter(
                    (a) => a.eventId === event.id && a.userName === currentVisitor,
                  )
                  const myRestaurants = eventRestaurantAssignments.filter(
                    (a) => a.eventId === event.id && a.userName === currentVisitor,
                  )
                  const totalCount = assignedCards.length + myInformal.length + myRestaurants.length
                  return (
                    <article className={`mobile-today-service-card${isOpen ? ' open' : ''}`} key={event.id}>
                      <button className="mobile-today-service-toggle" onClick={() => toggleTodayEvent(event.id)} type="button">
                        <span aria-hidden="true">{isOpen ? '⌄' : '›'}</span>
                        <strong>{event.date === today ? '' : `${fmtDate(event.date, language)} · `}{event.time} {event.title}</strong>
                        <b>{totalCount}{t(language, 'calendar.countSuffix')}</b>
                      </button>
                      {isOpen && (
                        <div className="mobile-today-service-body">
                          {/* 인도자는 생략 — 같이 도는 팀원 이름만 보이면 충분하다 */}
                          {teammates.length > 0 && (
                            <p>{t(language, 'territory.members')} {teammates.join(', ')}</p>
                          )}
                          {totalCount === 0 ? (
                            <div className="mobile-territory-empty compact">{t(language, 'territory.noAssignedCards')}</div>
                          ) : (
                            <>
                              {assignedCards.map((card) => {
                                return (
                                  <div className="mobile-today-card-row" key={`card-${card.id}`}>
                                    <span className="mobile-today-card-dot" aria-hidden="true" />
                                    <strong>
                                      {translateKoreanAddress(card.name, language, translatePlaceNames)}

                                    </strong>
                                    <em>{card.progress}%</em>
                                    <button onClick={() => onOpenMap(card.id)} type="button">{t(language, 'zone.map')}</button>
                                  </div>
                                )
                              })}
                              {myInformal.map((asn) => {
                                const asset = informalAssets.find((x) => x.id === asn.assetId)
                                return (
                                  <div className="mobile-today-card-row" key={`inf-${asn.id}`}>
                                    <span className="mobile-today-card-dot" aria-hidden="true" style={{ background: '#8e6acb' }} />
                                    <strong>{asset?.name ?? msg('비공식 자료')}</strong>
                                    <em style={{ color: '#8e6acb' }}>{msg('비공식')}</em>
                                    {asset && onOpenInformalMap ? (
                                      <button onClick={() => onOpenInformalMap(asset.id)} type="button">{msg('구역 보기')}</button>
                                    ) : asset?.imageUrl ? (
                                      <button onClick={() => window.open(asset.imageUrl, '_blank', 'noopener,noreferrer')} type="button">{msg('자료 보기')}</button>
                                    ) : null}
                                  </div>
                                )
                              })}
                              {myRestaurants.map((asn) => {
                                const b = buildings.find((x) => x.id === asn.buildingId)
                                if (!b) return null
                                const unit = asn.unitId != null ? b.units.find((u) => u.id === asn.unitId) : null
                                const restName = unit?.number || b.name || b.address
                                return (
                                  <div className="mobile-today-card-row" key={`rest-${asn.id}`}>
                                    <span className="mobile-today-card-dot" aria-hidden="true" style={{ background: '#d88a3e' }} />
                                    <strong>{restName}{unit ? ` · ${b.name || b.address}` : ''}</strong>
                                    <em style={{ color: '#d88a3e' }}>{msg('식당')}</em>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        if (b.lat && b.lng) {
                                          const dname = encodeURIComponent(b.name || b.address)
                                          window.open(`https://map.naver.com/p/search/${dname}`, '_blank', 'noopener,noreferrer')
                                        } else {
                                          onOpenMap(b.cardId)
                                        }
                                      }}
                                    >{msg('길찾기')}</button>
                                  </div>
                                )
                              })}
                            </>
                          )}
                        </div>
                      )}
                    </article>
                  )
                })}
              </div>
            )}
          </section>

          

          {/* 식당봉사 섹션 */}
          {(role === 'leader' || role === 'user') && (onAddRestaurantVisit || onSubmitRestaurantRequest) && (
            <section className="mobile-territory-section mt-restaurant-section">

              {/* 활성 세션 카드 */}
              {activeRestaurantSession && (
                <div className="mt-rs-active-card">
                  <div className="mt-rs-active-header">
                    <span className="mt-rs-active-icon">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M3 13h18"></path>
                        <path d="M4 13a8 8 0 0 0 16 0"></path>
                        <path d="M8 21h8"></path>
                        <path d="M9 9v-3"></path>
                        <path d="M12 9v-4"></path>
                        <path d="M15 9v-3"></path>
                      </svg>
                    </span>
                    <div className="mt-rs-active-info">
                      <strong className="mt-rs-active-name">{activeRestaurantSession.name}</strong>
                      <span className="mt-rs-active-addr">{activeRestaurantSession.address}</span>
                    </div>
                    {activeRestaurantSession.kind === 'request' && (
                      <span className="mt-rs-pending-badge">{t(language, 'restaurant.myPending')}</span>
                    )}
                    <div className="mt-rs-active-dots-wrap" style={{ position: 'relative' }}>
                      <button
                        type="button"
                        className="mt-rs-dots-btn"
                        onClick={() => setShowSessionMenu((v) => !v)}
                        aria-label={msg('더보기')}
                      >
                        ···
                      </button>
                      {showSessionMenu && (
                        <>
                          <div
                            style={{ position: 'fixed', inset: 0, zIndex: 40 }}
                            onClick={() => setShowSessionMenu(false)}
                          />
                          <div className="mt-rs-menu">
                            <a
                              className="mt-rs-menu-item"
                              style={{ display: 'flex', alignItems: 'center', gap: 8 }}
                              href={`https://map.naver.com/v5/search/${encodeURIComponent(activeRestaurantSession.address)}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={() => setShowSessionMenu(false)}
                            >
                              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M9 11a3 3 0 1 0 6 0 3 3 0 0 0-6 0z"/><path d="M17.657 16.657L13.414 20.9a2 2 0 0 1-2.827 0l-4.244-4.243a8 8 0 1 1 11.314 0z"/></svg>
                              {t(language, 'territory.findRoute')}
                            </a>
                            <button
                              type="button"
                              className="mt-rs-menu-item mt-rs-menu-danger"
                              style={{ display: 'flex', alignItems: 'center', gap: 8 }}
                              onClick={() => { handleCancelSession(); setShowSessionMenu(false) }}
                            >
                              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                              {t(language, 'territory.cancelService')}
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  </div>

                  {/* 메모/결과 입력 토글 */}
                  {showSessionMemo ? (
                    <div className="mt-rs-memo-form">
                      <textarea
                        className="mt-rs-memo-input"
                        placeholder={t(language, 'territory.sessionMemoPlaceholder')}
                        value={sessionMemo}
                        onChange={(e) => setSessionMemo(e.target.value)}
                        rows={2}
                        autoFocus
                      />
                      <div className="mt-rs-memo-actions">
                        <button
                          type="button"
                          className="mt-rs-save-btn"
                          onClick={handleSaveSessionResult}
                          disabled={sessionSaving}
                        >
                          {sessionSaving ? t(language, 'territory.saving') : t(language, 'territory.saveRecord')}
                        </button>
                        <button
                          type="button"
                          className="mt-rs-cancel-btn"
                          onClick={() => { setShowSessionMemo(false); setSessionMemo('') }}
                        >
                          {t(language, 'territory.cancel')}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="mt-rs-memo-toggle-btn"
                      onClick={() => setShowSessionMemo(true)}
                      style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                      {t(language, 'territory.memoResultInput')}
                    </button>
                  )}
                </div>
              )}

              {/* 식당봉사 탐색 버튼 */}
              <button
                type="button"
                className="mt-restaurant-btn"
                onClick={() => setShowRestaurantSheet(true)}
              >
                <span className="mt-restaurant-icon" aria-hidden>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 13h18"></path>
                    <path d="M4 13a8 8 0 0 0 16 0"></path>
                    <path d="M8 21h8"></path>
                    <path d="M9 9v-3"></path>
                    <path d="M12 9v-4"></path>
                    <path d="M15 9v-3"></path>
                  </svg>
                </span>
                <span className="mt-restaurant-label">{t(language, 'territory.restaurant')}</span>
                <span className="mt-restaurant-count">
                  {t(language, 'home.viewAllBtn')}
                </span>
                <span className="mt-restaurant-arrow" aria-hidden>›</span>
              </button>
            </section>
          )}

          {showReturnVisits && (
          <section className="mobile-territory-section mobile-regular-section mt-main-section" aria-label={t(language, 'territory.regularVisit')}>
            <div className="mt-main-section-head">
              <button className="mt-main-title-btn" onClick={() => setRvCollapsed((v) => !v)} type="button">
                <h2>{t(language, 'territory.regularVisit')}</h2>
                <span className="mt-main-count">{myReturnVisits.length}</span>
                <span className="mt-main-collapse-icon" aria-hidden="true">{rvCollapsed ? '›' : '⌄'}</span>
              </button>
              <div className="rv-menu-wrap">
                <button
                  className="rv-menu-btn mt-main-menu-btn"
                  onClick={(e) => {
                    e.stopPropagation()
                    setSectionMenuOpen((open) => !open)
                    setMenuOpenId(null)
                    setColorPickId(null)
                  }}
                  type="button"
                  aria-label={t(language, 'territory.more')}
                >⋯</button>
                {sectionMenuOpen && (
                  <div className="rv-menu-dropdown mt-main-menu-dropdown" onClick={(e) => e.stopPropagation()}>
                    <button
                      className="rv-menu-item"
                      onClick={() => {
                        setSectionMenuOpen(false)
                        setShowAddSheet(true)
                        setAddNickname('')
                        setAddAddress('')
                        setAddMemo('')
                        setAddFirstResult(null)
                        setAddLinked(null)
                        setAddUnitPickBuilding(null)
                        setAddSelectedCandidate(null)
                        setAddNewUnitBuilding(null)
                        setAddBuildingName('')
                        setAddBuildingType('주택')
                        setAddUnitUsageType('주택')
                        setAddUnitNumber('')
                      }}
                      type="button"
                    >{t(language, 'territory.regularVisit')} {t(language, 'common.add')}</button>
                    <button
                      className="rv-menu-item"
                      disabled={myReturnVisits.length === 0}
                      onClick={() => {
                        setSectionMenuOpen(false)
                        if (onOpenRegularVisitMap) onOpenRegularVisitMap()
                      }}
                      type="button"
                    >{t(language, 'territory.viewOnMap')}</button>
                  </div>
                )}
              </div>
            </div>

            {!rvCollapsed && (myReturnVisits.length === 0 ? (
              <div className="mobile-regular-empty-card">
                <strong>{t(language, 'territory.noRegularVisits')}</strong>
                <span>{t(language, 'territory.regularEmptyDesc')}</span>
              </div>
            ) : (
              <div className="rv-list">
                {myReturnVisits.map((rv) => {
                  const building = findReturnVisitBuilding(rv, buildings)
                  const label = rv.nickname || rv.displayName
                  const isMenuOpen = menuOpenId === rv.id
                  const isNicknameEdit = nicknameEditId === rv.id
                  const isAddressEdit = addressEditId === rv.id
                  const isColorPick = colorPickId === rv.id
                  const cardColor = rvColors[rv.id]
                  const colorStyle: React.CSSProperties = cardColor
                    ? { borderLeft: `3px solid ${cardColor}`, background: `${cardColor}14` }
                    : {}

                  return (
                    <div
                      key={rv.id}
                      className="rv-card"
                      style={colorStyle}
                      onClick={() => { if (isMenuOpen) setMenuOpenId(null); if (isColorPick) setColorPickId(null) }}
                    >
                      {/* 메인 행: 정보 + 버튼 */}
                      <div className="rv-card-main">
                        <button
                          type="button"
                          className="rv-card-info rv-card-info-btn"
                          onClick={(e) => {
                            e.stopPropagation()
                            if (isMenuOpen) { setMenuOpenId(null); return }
                            if (isColorPick) { setColorPickId(null); return }
                            navigate(`/territory/regular/${rv.id}`)
                          }}
                          aria-label={`${label} 상세`}
                        >
                          <div className="rv-card-title">
                            <strong className="rv-name">{label}</strong>
                            {rv.lastResult && (
                              <span className={`rv-status-dot rv-status-${rv.lastResult}`} />
                            )}
                          </div>
                          {rv.address && <span className="rv-address">{translateKoreanAddress(rv.address, language, translatePlaceNames)}</span>}
                          <span className="rv-meta-row">
                            {rv.lastVisitedAt
                              ? `${t(language, 'home.lastVisit')} · ${fmtDate(rv.lastVisitedAt, language)}`
                              : t(language, 'home.noVisitYet')}
                          </span>
                        </button>

                        <div className="rv-row-actions">
                          <button
                            className="rv-btn rv-btn-log"
                            onClick={(e) => { e.stopPropagation(); setLogTarget(rv); setLogResult(null); setLogMemo('') }}
                            type="button"
                          >{t(language, 'territory.log')}</button>
                          {building ? (
                            <button
                              className="rv-btn rv-btn-map"
                              onClick={(e) => {
                                e.stopPropagation()
                                if (onOpenRegularVisitMap) onOpenRegularVisitMap(rv.id)
                                else onOpenMap(building.cardId)
                              }}
                              type="button"
                            >{t(language, 'zone.map')}</button>
                          ) : rv.address ? (
                            <button
                              className="rv-btn rv-btn-map"
                              onClick={(e) => {
                                e.stopPropagation()
                                if (onOpenRegularVisitMap) onOpenRegularVisitMap(rv.id)
                                else navigate(`/map?scope=regularVisits&addr=${encodeURIComponent(rv.address)}&pinLabel=${encodeURIComponent(rv.nickname || rv.displayName)}`)
                              }}
                              type="button"
                            >{t(language, 'zone.map')}</button>
                          ) : null}
                          <div className="rv-menu-wrap">
                            <button
                              className="rv-menu-btn"
                              onClick={(e) => { e.stopPropagation(); setMenuOpenId(isMenuOpen ? null : rv.id); setColorPickId(null) }}
                              type="button"
                              aria-label={t(language, 'territory.more')}
                            >⋮</button>
                            {isMenuOpen && (
                              <div className="rv-menu-dropdown" onClick={(e) => e.stopPropagation()}>
                                <button
                                  className="rv-menu-item"
                                  onClick={() => { setColorPickId(rv.id); setMenuOpenId(null) }}
                                  type="button"
                                >{t(language, 'territory.color')}</button>
                                <button
                                  className="rv-menu-item"
                                  onClick={() => { setNicknameEditId(rv.id); setNicknameEditValue(rv.nickname || rv.displayName); setMenuOpenId(null) }}
                                  type="button"
                                >{t(language, 'territory.editNickname')}</button>
                                {rv.unitId === null && (
                                  <button
                                    className="rv-menu-item"
                                    onClick={() => { setAddressEditId(rv.id); setAddressEditValue(rv.address); setMenuOpenId(null) }}
                                    type="button"
                                  >{t(language, 'territory.editAddress')}</button>
                                )}
                                <button
                                  className="rv-menu-item rv-menu-danger"
                                  disabled={deletingId === rv.id}
                                  onClick={() => {
                                    if (!onDeleteReturnVisit) return
                                    setMenuOpenId(null)
                                    setEndingVisit(rv)
                                  }}
                                  type="button"
                                >{msg('정기방문 종료')}</button>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* 색상 피커 */}
                      {isColorPick && (
                        <div className="rv-color-picker" onClick={(e) => e.stopPropagation()}>
                          {['#94a3b8','#fca5a5','#fcd34d','#6ee7b7','#93c5fd','#c4b5fd','#f9a8d4','#d1d5db'].map((c) => (
                            <button
                              key={c}
                              className={`rv-color-dot${cardColor === c ? ' selected' : ''}`}
                              style={{ background: c }}
                              onClick={() => { setRvColor(rv.id, cardColor === c ? null : c); setColorPickId(null) }}
                              type="button"
                            />
                          ))}
                          {cardColor && (
                            <button className="rv-color-reset" onClick={() => { setRvColor(rv.id, null); setColorPickId(null) }} type="button">{t(language, 'territory.default')}</button>
                          )}
                        </div>
                      )}

                      {/* 별칭 인라인 편집 */}
                      {isNicknameEdit && (
                        <div className="rv-nickname-edit-row" onClick={(e) => e.stopPropagation()}>
                          <input
                            className="rv-nickname-input"
                            value={nicknameEditValue}
                            onChange={(e) => setNicknameEditValue(e.target.value)}
                            placeholder={rv.displayName}
                            autoFocus
                          />
                          <button
                            className="rv-nickname-save-btn"
                            disabled={nicknameSaving}
                            onClick={async () => {
                              if (!onUpdateReturnVisitNickname) return
                              setNicknameSaving(true)
                              await onUpdateReturnVisitNickname(rv.id, nicknameEditValue)
                              setNicknameSaving(false)
                              setNicknameEditId(null)
                            }}
                            type="button"
                          >{nicknameSaving ? '…' : t(language, 'common.save')}</button>
                          <button className="rv-nickname-cancel-btn" onClick={() => setNicknameEditId(null)} type="button">{t(language, 'common.cancel')}</button>
                        </div>
                      )}

                      {/* 주소 인라인 편집 */}
                      {isAddressEdit && (
                        <div className="rv-nickname-edit-row" onClick={(e) => e.stopPropagation()}>
                          <div style={{ position: 'relative', flex: 1, minWidth: 0 }}>
                            <input
                              className="rv-nickname-input"
                              value={addressEditValue}
                              onChange={(e) => {
                                // ⚠ 추가 시트와 같은 규칙 — 자동으로 덮어쓰지 않는다
                                setAddressEditValue(e.target.value)
                                setAddrEditCandidates([])
                              }}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' && addressEditValue.trim()) {
                                  e.preventDefault()
                                  void searchAddressCandidates(addressEditValue.trim(), setAddrEditCandidates, setAddrEditGeocoding)
                                }
                              }}
                              placeholder={t(language, 'territory.addressPlaceholderShort')}
                              style={{ paddingRight: 62, width: '100%', boxSizing: 'border-box' }}
                              autoFocus
                            />
                            <button
                              className="rv-addr-search-btn"
                              type="button"
                              disabled={!addressEditValue.trim() || addrEditGeocoding}
                              onClick={() => void searchAddressCandidates(addressEditValue.trim(), setAddrEditCandidates, setAddrEditGeocoding)}
                            >{addrEditGeocoding ? '…' : msg('검색')}</button>
                            {addrEditCandidates.length > 0 && (
                              <div className="rv-add-matches" style={{ marginTop: 6 }}>
                                {addrEditCandidates.map((c) => (
                                  <button
                                    key={c.address}
                                    className="rv-addr-candidate"
                                    type="button"
                                    onClick={() => { setAddressEditValue(c.address); setAddrEditCandidates([]) }}
                                  >
                                    <span>{c.address}</span>
                                    {isFarFromService(c) && <em className="rv-addr-far">{msg('봉사 범위 밖')}</em>}
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                          <button
                            className="rv-nickname-save-btn"
                            disabled={addressSaving}
                            onClick={async () => {
                              if (!onUpdateReturnVisitAddress) return
                              setAddressSaving(true)
                              await onUpdateReturnVisitAddress(rv.id, addressEditValue)
                              setAddressSaving(false)
                              setAddressEditId(null)
                            }}
                            type="button"
                          >{addressSaving ? '…' : t(language, 'common.save')}</button>
                          <button className="rv-nickname-cancel-btn" onClick={() => setAddressEditId(null)} type="button">{t(language, 'common.cancel')}</button>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            ))}
          </section>
          )}

          {/* 지난 봉사 — 미니 캘린더 (활동 탭 맨 아래) */}
          {myPastAssignments.length > 0 && (
            <section className="mobile-territory-section mobile-past-section">
              <button
                type="button"
                className="mt-past-toggle"
                onClick={() => setShowPastAssignments((v) => !v)}
              >
                <span className="mt-past-toggle-left">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden style={{ transform: showPastAssignments ? 'rotate(90deg)' : 'none', transition: 'transform .15s' }}><polyline points="9 6 15 12 9 18"/></svg>
                  <span className="mt-past-title">{t(language, 'territory.pastService')}</span>
                  <span className="mt-past-count">{myPastAssignments.length}{t(language, 'calendar.countSuffix')}</span>
                </span>
                <span className="mt-past-summary">{pastMonthLabel} · {pastMonthCount}{t(language, 'calendar.countSuffix')} {t(language, 'home.joinedLabel')}</span>
              </button>
              {showPastAssignments && (
                <div className="mobile-past-mini">
                  {/* 월 네비 */}
                  <div className="mobile-past-mini-nav">
                    <button
                      type="button"
                      className="mobile-past-mini-nav-btn"
                      onClick={() => navigatePastMonth(-1)}
                      aria-label={msg('이전 달')}
                    >‹</button>
                    <span className="mobile-past-mini-nav-label">{pastMonthLabel}</span>
                    <button
                      type="button"
                      className="mobile-past-mini-nav-btn"
                      onClick={() => navigatePastMonth(1)}
                      aria-label={msg('다음 달')}
                    >›</button>
                  </div>

                  {/* 요일 헤더 */}
                  <div className="mobile-past-mini-dow">
                    {weekdayShortLabels[language].map((d) => (
                      <span key={d}>{d}</span>
                    ))}
                  </div>

                  {/* 캘린더 그리드 */}
                  <div className="mobile-past-mini-grid">
                    {pastCalendarCells.map((cell, idx) => {
                      if (!cell) return <div key={`pad-${idx}`} className="mobile-past-mini-cell is-empty" />
                      const hasItems = cell.items.length > 0
                      const isSelected = selectedPastDate === cell.date
                      const isToday = cell.date === today
                      const dowNum = new Date(cell.date).getDay()
                      return (
                        <button
                          key={cell.date}
                          type="button"
                          className={`mobile-past-mini-cell${hasItems ? ' has-items' : ''}${isSelected ? ' is-selected' : ''}${isToday ? ' is-today' : ''}${dowNum === 0 ? ' is-sun' : ''}${dowNum === 6 ? ' is-sat' : ''}`}
                          onClick={() => {
                            if (!hasItems) return
                            setSelectedPastDate((prev) => prev === cell.date ? null : cell.date)
                          }}
                          disabled={!hasItems}
                        >
                          <span className="mobile-past-mini-day">{cell.day}</span>
                        </button>
                      )
                    })}
                  </div>

                  {/* 월별 요약 */}
                  <p className="mobile-past-mini-summary">
                    {pastMonthLabel} · {pastMonthCount}{t(language, 'calendar.countSuffix')} {t(language, 'home.joinedLabel')}
                  </p>

                  {/* 선택된 날짜의 인라인 상세 */}
                  {selectedPastDate && (() => {
                    const items = assignmentsByDate.get(selectedPastDate) ?? []
                    if (items.length === 0) return null
                    const d = new Date(selectedPastDate)
                    const dow = weekdayShortLabels[language][d.getDay()]
                    return (
                      <div className="mobile-past-mini-detail">
                        <header className="mobile-past-mini-detail-head">
                          <strong>{t(language, 'calendar.dateHeader', { month: String(d.getMonth() + 1), day: String(d.getDate()), dow })}</strong>
                          <button
                            type="button"
                            onClick={() => setSelectedPastDate(null)}
                            aria-label={msg('닫기')}
                          >×</button>
                        </header>
                        <ul className="mobile-past-mini-detail-list">
                          {items.map(({ event, teammates }) => {
                            const slot = getTimeSlotFromTime(event.time)
                            return (
                              <li key={event.id}>
                                <div className="mobile-past-mini-detail-row1">
                                  <span className="mobile-past-mini-slot">{timeSlotLabel(slot)}</span>
                                  <span className="mobile-past-mini-time">{event.time}</span>
                                </div>
                                <p className="mobile-past-mini-detail-row2">
                                  {event.leader
                                    ? `${t(language, 'territory.leader')} ${event.leader}`
                                    : t(language, 'territory.leaderTbd')}
                                </p>
                                {teammates.length > 0 && (
                                  <p className="mobile-past-mini-detail-row3">
                                    {t(language, 'territory.members')} {teammates.join(', ')}
                                  </p>
                                )}
                              </li>
                            )
                          })}
                        </ul>
                      </div>
                    )
                  })()}
                </div>
              )}
            </section>
          )}

        {/* ── 수동 추가 시트 ── */}
        {showAddSheet && (
          <div className="rv-log-backdrop" onClick={() => setShowAddSheet(false)}>
            <div className="rv-log-sheet rv-add-sheet" onClick={(e) => e.stopPropagation()}>
              <div className="rv-log-header">
                <strong>{t(language, 'territory.addRegularVisit')}</strong>
              </div>

              {/* 주소 */}
              <div className="rv-add-field">
                <label className="rv-add-label">{t(language, 'map.address')} <span className="rv-add-optional">{t(language, 'territory.optional')}</span></label>
                {addLinked ? (
                  <div className="rv-add-linked">
                    <span className="rv-add-linked-text">
                      <b>{addLinked.building.name} {addLinked.unit.number}</b>
                      <em>{addLinked.building.address}</em>
                    </span>
                    <button className="rv-add-unlink" type="button" onClick={() => {
                      setAddLinked(null)
                      setAddAddress('')
                      setAddSelectedCandidate(null)
                    }}>{t(language, 'territory.unlink')}</button>
                  </div>
                ) : (
                  <>
                    <div style={{ position: 'relative' }}>
                      <input
                        className="rv-add-input"
                        placeholder={t(language, 'territory.addressPlaceholderShort')}
                        value={addAddress}
                        onChange={(e) => {
                          // ⚠ 여기서 지오코딩을 부르지 않는다. 사용자가 검색을 눌러야 한다.
                          setAddAddress(e.target.value)
                          setAddUnitPickBuilding(null)
                          setAddAddressCandidates([])
                          setAddSelectedCandidate(null)
                          setAddNewUnitBuilding(null)
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && addAddress.trim()) {
                            e.preventDefault()
                            void searchAddressCandidates(addAddress.trim(), setAddAddressCandidates, setAddAddressGeocoding)
                          }
                        }}
                        style={{ paddingRight: 62 }}
                      />
                      <button
                        className="rv-addr-search-btn"
                        type="button"
                        disabled={!addAddress.trim() || addAddressGeocoding}
                        onClick={() => void searchAddressCandidates(addAddress.trim(), setAddAddressCandidates, setAddAddressGeocoding)}
                      >{addAddressGeocoding ? '…' : msg('검색')}</button>
                    </div>
                    {addAddressCandidates.length > 0 && (
                      <div className="rv-add-matches">
                        <p className="rv-add-matches-title">{msg('장소 또는 주소를 눌러 선택하세요')}</p>
                        {addAddressCandidates.map((c) => (
                          <button
                            key={`${c.name ?? ''}-${c.address}-${c.lat}-${c.lng}`}
                            className="rv-addr-candidate"
                            type="button"
                            onClick={() => {
                              const matches = matchingBuildingsForAddress(c.address, c, buildings)
                              setAddAddress(c.address)
                              setAddAddressCandidates([])
                              setAddSelectedCandidate(c)
                              if (matches.length > 0) {
                                setAddNewUnitBuilding(null)
                                setAddUnitPickBuilding(matches.length === 1 ? matches[0] : null)
                              } else if (canCreateReturnVisitLocation && c.lat !== null && c.lng !== null) {
                                setAddLinked(null)
                                setAddUnitPickBuilding(null)
                                setAddNewUnitBuilding('new')
                                setAddBuildingName(c.name || shortAddress(c.address))
                                const commercial = Boolean(c.category && /(음식점|쇼핑|생활,편의|병원|의료|학원|교육|기업|회사|숙박)/.test(c.category))
                                setAddBuildingType(commercial ? '상가' : '주택')
                                setAddUnitUsageType(commercial ? '상가' : '주택')
                                setAddUnitNumber('')
                              } else {
                                setAddNewUnitBuilding(null)
                              }
                            }}
                          >
                            <span className="rv-addr-candidate-copy">
                              {c.name && <strong>{c.name}</strong>}
                              <small>{c.address}</small>
                            </span>
                            <b className="rv-addr-select-label">{msg('선택')}</b>
                            {isFarFromService(c) && <em className="rv-addr-far">{msg('봉사 범위 밖')}</em>}
                          </button>
                        ))}
                      </div>
                    )}
                    {addSelectedCandidate && (
                      <div className="rv-address-selected">
                        <span aria-hidden="true">✓</span>
                        <div><strong>{msg('주소를 선택했습니다')}</strong><small>{addAddress}</small></div>
                      </div>
                    )}
                    {addSelectedCandidate && addressMatches.length === 0 && (
                      <p className="rv-address-resolution">
                        {canCreateReturnVisitLocation
                          ? msg('아직 등록되지 않은 건물입니다. 건물과 세대를 함께 등록합니다.')
                          : msg('아직 등록되지 않은 건물입니다. 주소는 저장되고 인도자가 나중에 건물과 연결할 수 있습니다.')}
                      </p>
                    )}
                    {/* 주소 매칭 결과 */}
                    {addressMatches.length > 0 && (
                      <div className="rv-add-matches">
                        <p className="rv-add-matches-title">{msg('등록된 건물을 찾았습니다. 방문할 세대를 선택하세요.')}</p>
                        {addressMatches.map((b) => (
                          <div key={b.id} className="rv-add-match-item">
                            <div className="rv-add-match-info">
                              <strong>{b.name}</strong>
                              <span>{b.address}</span>
                            </div>
                            <button
                              className="rv-add-connect-btn"
                              type="button"
                              onClick={() => {
                                setAddNewUnitBuilding(null)
                                if (b.units.length === 1) {
                                  setAddLinked({ building: b, unit: b.units[0] })
                                  setAddUnitPickBuilding(null)
                                } else {
                                  setAddUnitPickBuilding(addUnitPickBuilding?.id === b.id ? null : b)
                                }
                              }}
                            >{t(language, 'territory.connect')}</button>
                            {canCreateReturnVisitLocation && (
                              <button
                                className="rv-add-connect-btn rv-add-connect-secondary"
                                type="button"
                                onClick={() => {
                                  setAddLinked(null)
                                  setAddUnitPickBuilding(null)
                                  setAddNewUnitBuilding(b.id)
                                  setAddBuildingName(b.name)
                                  setAddBuildingType(b.type)
                                  setAddUnitUsageType(b.type)
                                  setAddUnitNumber('')
                                }}
                              >{msg('새 세대')}</button>
                            )}
                          </div>
                        ))}
                        {/* 세대 선택 */}
                        {addUnitPickBuilding && (
                          <div className="rv-add-unit-picker">
                            <p className="rv-add-matches-title">{t(language, 'territory.selectUnit')}</p>
                            {addUnitPickBuilding.units.map((u) => (
                              <button
                                key={u.id}
                                className="rv-add-unit-btn"
                                type="button"
                                onClick={() => {
                                  setAddLinked({ building: addUnitPickBuilding, unit: u })
                                  setAddUnitPickBuilding(null)
                                  setAddNewUnitBuilding(null)
                                }}
                              >{u.number}</button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>

              {addNewUnitBuilding !== null && (
                <div className="rv-add-location-fields">
                  <strong>{addNewUnitBuilding === 'new' ? msg('새 건물과 세대') : msg('선택한 건물에 새 세대')}</strong>
                  {addNewUnitBuilding === 'new' && (
                    <>
                      <label className="rv-add-field">
                        <span className="rv-add-label">{msg('건물 이름')}</span>
                        <input
                          className="rv-add-input"
                          value={addBuildingName}
                          onChange={(e) => setAddBuildingName(e.target.value)}
                        />
                      </label>
                      <div className="rv-add-field">
                        <span className="rv-add-label">{msg('건물 유형')}</span>
                        <div className="rv-log-result-chips" role="group" aria-label={msg('건물 유형')}>
                          {(['주택', '상가'] as const).map((usage) => (
                            <button key={usage} type="button" className={`rv-chip${addBuildingType === usage ? ' rv-chip-selected' : ''}`} onClick={() => { setAddBuildingType(usage); setAddUnitUsageType(usage) }}>
                              {usage === '주택' ? t(language, 'map.house') : t(language, 'map.shop')}
                            </button>
                          ))}
                        </div>
                      </div>
                    </>
                  )}
                  <label className="rv-add-field">
                    <span className="rv-add-label">{msg('세대(호수)')} <span className="rv-add-required">{t(language, 'territory.required')}</span></span>
                    <input
                      className="rv-add-input"
                      value={addUnitNumber}
                      onChange={(e) => setAddUnitNumber(e.target.value)}
                      placeholder={msg('예: 201')}
                    />
                    <small className="rv-add-help">{msg('건물 안의 정확한 위치만 적어 주세요. 별칭은 적지 않습니다.')}</small>
                  </label>
                  <div className="rv-add-field">
                    <span className="rv-add-label">{msg('용도')}</span>
                    <div className="rv-log-result-chips" role="group" aria-label={msg('용도')}>
                      {(['주택', '상가'] as const).map((usage) => (
                        <button key={usage} type="button" className={`rv-chip${addUnitUsageType === usage ? ' rv-chip-selected' : ''}`} onClick={() => setAddUnitUsageType(usage)}>
                          {usage === '주택' ? t(language, 'map.house') : t(language, 'map.shop')}
                        </button>
                      ))}
                    </div>
                  </div>
                  <button className="rv-add-unlink" type="button" onClick={() => setAddNewUnitBuilding(null)}>{t(language, 'common.cancel')}</button>
                </div>
              )}

              {/* 별칭은 건물의 세대/호수와 다른, 정기방문 목록용 이름이다. */}
              <div className="rv-add-field">
                <label className="rv-add-label">{t(language, 'territory.nickname')} <span className="rv-add-required">{t(language, 'territory.required')}</span></label>
                <input
                  className="rv-add-input"
                  placeholder={msg('예: 공원 앞 댁')}
                  value={addNickname}
                  onChange={(e) => setAddNickname(e.target.value)}
                />
                <small className="rv-add-help">{msg('나중에 알아보기 쉬운 이름을 적어 주세요.')}</small>
              </div>

              {/* 첫 방문 결과 */}
              <div className="rv-add-field">
                <label className="rv-add-label">{msg('오늘 결과')} <span className="rv-add-optional">{t(language, 'territory.optional')}</span></label>
                <div className="rv-add-choice-grid" role="group" aria-label={msg('오늘 결과')}>
                  <button
                    className={`rv-add-choice rv-add-choice-none${addFirstResult === null ? ' is-active' : ''}`}
                    type="button"
                    aria-pressed={addFirstResult === null}
                    onClick={() => setAddFirstResult(null)}
                  >{msg('기록 안 함')}</button>
                  <button
                    className={`rv-add-choice rv-add-choice-meet${addFirstResult === '만남' ? ' is-active' : ''}`}
                    type="button"
                    aria-pressed={addFirstResult === '만남'}
                    onClick={() => setAddFirstResult('만남')}
                  >{t(language, 'map.met')}</button>
                  <button
                    className={`rv-add-choice rv-add-choice-absent${addFirstResult === '부재' ? ' is-active' : ''}`}
                    type="button"
                    aria-pressed={addFirstResult === '부재'}
                    onClick={() => setAddFirstResult('부재')}
                  >{t(language, 'map.absent')}</button>
                </div>
              </div>

              {/* 메모 */}
              <div className="rv-add-field">
                <label className="rv-add-label">{t(language, 'map.memo')} <span className="rv-add-optional">{t(language, 'territory.optional')}</span></label>
                <input
                  className="rv-add-input"
                  placeholder={t(language, 'territory.memoPlaceholder')}
                  value={addMemo}
                  onChange={(e) => setAddMemo(e.target.value)}
                />
              </div>

              <div className="rv-log-actions">
                <button className="rv-log-cancel" type="button" onClick={() => setShowAddSheet(false)}>{t(language, 'common.cancel')}</button>
                <button
                  className="rv-log-save"
                  disabled={!addNickname.trim() || addSaving || (addNewUnitBuilding !== null && !addUnitNumber.trim())}
                  type="button"
                  onClick={async () => {
                    if (!addNickname.trim() || !onCreateManualReturnVisit) return
                    setAddSaving(true)
                    // ⚠ **성공했을 때만 닫는다.** 예전에는 실패해도 닫아서, 오류
                    //   토스트는 뜨는데 별명·주소·연결한 세대가 통째로 날아갔다.
                    try {
                      const selectedCard = addNewUnitBuilding === 'new'
                        ? chooseCardForBuilding({
                            chosen: 'auto',
                            latLng: addSelectedCandidate?.lat != null && addSelectedCandidate?.lng != null
                              ? { lat: addSelectedCandidate.lat, lng: addSelectedCandidate.lng }
                              : null,
                            address: addAddress,
                            cards,
                            cardBoundaries,
                            unassignedCardId: cards.find((card) => card.name === '미배정 건물')?.id ?? null,
                          }).cardId
                        : null
                      const ok = await onCreateManualReturnVisit({
                        displayName: addNickname.trim(),
                        address: addLinked ? addLinked.building.address : addAddress,
                        memo: addMemo,
                        firstResult: addFirstResult,
                        unitId: addLinked?.unit.id ?? null,
                        buildingId: addLinked?.building.id ?? null,
                        newLocation: addNewUnitBuilding === null ? null : {
                          existingBuildingId: addNewUnitBuilding === 'new' ? null : addNewUnitBuilding,
                          buildingName: addBuildingName,
                          buildingType: addBuildingType,
                          unitNumber: normalizeUnitNumberInput(addUnitNumber),
                          unitUsageType: addUnitUsageType,
                          cardId: selectedCard,
                          lat: addSelectedCandidate?.lat ?? null,
                          lng: addSelectedCandidate?.lng ?? null,
                        },
                      })
                      if (ok) setShowAddSheet(false)
                    } catch (error) {
                      console.error('정기방문 저장 실패:', error)
                      showToast(msg('정기방문을 추가하지 못했습니다.'), 'error')
                    } finally {
                      setAddSaving(false)
                    }
                  }}
                >{addSaving ? t(language, 'territory.saving') : t(language, 'common.save')}</button>
              </div>
            </div>
          </div>
        )}

        {/* ── 기록 시트 ── */}
        {logTarget && (() => {
          const logs = returnVisitLogs
            .filter((l) => l.returnVisitId === logTarget.id)
            .slice(0, 12)
          const todayLabel = (() => {
            const d = new Date()
            const m = d.getMonth() + 1
            const day = d.getDate()
            if (language === 'zh') {
              const dows = ['日', '一', '二', '三', '四', '五', '六']
              return `${m}月${day}日 (周${dows[d.getDay()]})`
            }
            if (language === 'en') {
              const dows = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
              const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
              return `${months[d.getMonth()]} ${day} (${dows[d.getDay()]})`
            }
            const dows = ['일', '월', '화', '수', '목', '금', '토']
            return `${m}월 ${day}일 (${dows[d.getDay()]})`
          })()
          return (
            <div className="rv-log-backdrop" onClick={() => setLogTarget(null)}>
              <div className="rv-log-sheet" onClick={(e) => e.stopPropagation()}>
                {/* 헤더 */}
                <div className="rv-log-header">
                  <strong>{logTarget.nickname || logTarget.displayName}</strong>
                  <span className="rv-log-target-addr">{translateKoreanAddress(logTarget.address, language, translatePlaceNames)}</span>
                </div>

                {/* 방문 기록 목록 */}
                {logs.length > 0 && (
                  <div className="rv-log-history">
                    {logs.map((l) => {
                      const d = new Date(l.visitedAt)
                      const h = d.getHours()
                      const slot = h < 12 ? '오전' : h < 17 ? '오후' : '저녁'
                      const dateStr = `${d.getMonth() + 1}. ${d.getDate()}.`
                      return (
                        <div
                          key={l.id}
                          className="rv-log-history-item"
                          onTouchStart={() => {
                            longPressTimer.current = setTimeout(() => setLogActionId(l.id), 500)
                          }}
                          onTouchEnd={() => { if (longPressTimer.current) clearTimeout(longPressTimer.current) }}
                          onTouchMove={() => { if (longPressTimer.current) clearTimeout(longPressTimer.current) }}
                          onContextMenu={(e) => { e.preventDefault(); setLogActionId(l.id) }}
                        >
                          <span className="rv-h-date">{dateStr} {timeSlotLabel(slot as TimeSlot)}</span>
                          {l.result && <b className={l.result === '만남' ? 'rv-h-meet' : 'rv-h-absent'}> · {resultLabel(l.result)}</b>}
                          {l.memo && <em className="rv-h-memo"> {l.memo}</em>}
                        </div>
                      )
                    })}
                  </div>
                )}

                {/* 꾹 누르기 액션 팝업 */}
                {logActionId !== null && (() => {
                  const targetLog = returnVisitLogs.find((l) => l.id === logActionId)
                  if (!targetLog) return null
                  return (
                    <div className="rv-action-backdrop" onClick={() => { setLogActionId(null); setLogEditMode(false) }}>
                      <div className="rv-action-sheet" onClick={(e) => e.stopPropagation()}>
                        {!logEditMode ? (
                          <>
                            <p className="rv-action-title">{t(language, 'territory.manageRecord')}</p>
                            <button
                              className="rv-action-btn"
                              type="button"
                              onClick={() => {
                                setLogEditResult(targetLog.result)
                                setLogEditMemo(targetLog.memo)
                                setLogEditMode(true)
                              }}
                            >{t(language, 'territory.editContent')}</button>
                            <button
                              className="rv-action-btn rv-action-danger"
                              type="button"
                              onClick={() => {
                                if (!onDeleteReturnVisitLog) return
                                setConfirmDialog({
                                  message: t(language, 'territory.deleteRecordConfirm'),
                                  onConfirm: async () => {
                                    await onDeleteReturnVisitLog(logActionId)
                                    setLogActionId(null)
                                  },
                                })
                              }}
                            >{t(language, 'common.delete')}</button>
                            <button
                              className="rv-action-cancel"
                              type="button"
                              onClick={() => setLogActionId(null)}
                            >{t(language, 'common.cancel')}</button>
                          </>
                        ) : (
                          <>
                            <p className="rv-action-title">{t(language, 'territory.editRecord')}</p>
                            <div className="rv-log-result-chips" style={{ marginBottom: 8 }}>
                              <button
                                className={`rv-chip${logEditResult === '만남' ? ' rv-chip-meet' : ''}`}
                                onClick={() => setLogEditResult(logEditResult === '만남' ? null : '만남')}
                                type="button"
                              >{t(language, 'map.met')}</button>
                              <button
                                className={`rv-chip${logEditResult === '부재' ? ' rv-chip-absent' : ''}`}
                                onClick={() => setLogEditResult(logEditResult === '부재' ? null : '부재')}
                                type="button"
                              >{t(language, 'map.absent')}</button>
                            </div>
                            <textarea
                              className="rv-log-memo"
                              rows={2}
                              value={logEditMemo}
                              onChange={(e) => setLogEditMemo(e.target.value)}
                              placeholder={`${t(language, 'map.memo')} (${t(language, 'territory.optional')})`}
                            />
                            <div className="rv-log-actions">
                              <button
                                className="rv-log-cancel"
                                type="button"
                                onClick={() => setLogEditMode(false)}
                              >{t(language, 'common.cancel')}</button>
                              <button
                                className="rv-log-save"
                                disabled={logEditSaving || (!logEditResult && !logEditMemo.trim())}
                                type="button"
                                onClick={async () => {
                                  if (!onUpdateReturnVisitLog) return
                                  setLogEditSaving(true)
                                  await onUpdateReturnVisitLog(logActionId, logEditResult, logEditMemo)
                                  setLogEditSaving(false)
                                  setLogActionId(null)
                                  setLogEditMode(false)
                                }}
                              >{logEditSaving ? t(language, 'territory.saving') : t(language, 'common.save')}</button>
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  )
                })()}

                {/* 날짜 + 만남/부재 칩 한 줄 */}
                <div className="rv-log-date-row">
                  <span className="rv-log-date">{todayLabel}</span>
                  <div className="rv-log-result-chips">
                    <button
                      className={`rv-chip${logResult === '만남' ? ' rv-chip-meet' : ''}`}
                      onClick={() => setLogResult(logResult === '만남' ? null : '만남')}
                      type="button"
                    >{t(language, 'map.met')}</button>
                    <button
                      className={`rv-chip${logResult === '부재' ? ' rv-chip-absent' : ''}`}
                      onClick={() => setLogResult(logResult === '부재' ? null : '부재')}
                      type="button"
                    >{t(language, 'map.absent')}</button>
                  </div>
                </div>

                {/* 메모 */}
                <textarea
                  className="rv-log-memo"
                  placeholder={`${t(language, 'map.memo')} (${t(language, 'territory.optional')})`}
                  value={logMemo}
                  onChange={(e) => setLogMemo(e.target.value)}
                  rows={2}
                />

                {/* 액션 */}
                <div className="rv-log-actions">
                  <button
                    className="rv-log-cancel"
                    onClick={() => setLogTarget(null)}
                    type="button"
                  >{t(language, 'common.cancel')}</button>
                  <button
                    className="rv-log-save"
                    disabled={(!logResult && !logMemo.trim()) || logSaving}
                    onClick={async () => {
                      if ((!logResult && !logMemo.trim()) || !onAddReturnVisitLog) return
                      setLogSaving(true)
                      await onAddReturnVisitLog(logTarget.id, logResult, logMemo)
                      setLogSaving(false)
                      setLogResult(null)
                      setLogMemo('')
                    }}
                    type="button"
                  >{logSaving ? t(language, 'territory.saving') : t(language, 'common.save')}</button>
                </div>
              </div>
            </div>
          )
        })()}
        {/* ── 커스텀 확인 다이얼로그 ── */}
        {confirmDialog && (
          <div
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            onClick={() => setConfirmDialog(null)}
          >
            <div
              style={{ background: '#fff', borderRadius: 16, padding: '24px 20px 20px', width: 280, maxWidth: '88vw', boxShadow: '0 8px 32px rgba(0,0,0,0.2)' }}
              onClick={(e) => e.stopPropagation()}
            >
              <p style={{ margin: '0 0 20px', fontSize: 15, color: '#1e293b', lineHeight: 1.5, textAlign: 'center' }}>{confirmDialog.message}</p>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  onClick={() => setConfirmDialog(null)}
                  style={{ flex: 1, padding: '11px', borderRadius: 10, border: '1px solid #e2e8f0', background: '#f8fafc', fontWeight: 600, fontSize: 14, cursor: 'pointer', color: '#475569' }}
                  type="button"
                >{t(language, 'common.cancel')}</button>
                <button
                  onClick={() => { const fn = confirmDialog.onConfirm; setConfirmDialog(null); fn() }}
                  style={{ flex: 1, padding: '11px', borderRadius: 10, border: 'none', background: '#ef4444', color: '#fff', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}
                  type="button"
                >{t(language, 'common.delete')}</button>
              </div>
            </div>
          </div>
        )}
        {endingVisit && onDeleteReturnVisit && (
          <EndReturnVisitDialog
            visit={endingVisit}
            onClose={() => setEndingVisit(null)}
            onSubmit={async (input) => {
              setDeletingId(endingVisit.id)
              try {
                return await onDeleteReturnVisit(endingVisit.id, input)
              } finally {
                setDeletingId(null)
              }
            }}
          />
        )}
        </>
      )}

      {role === 'admin' && (
        <>
          <div className="mobile-territory-filter" aria-label={t(language, 'zone.cardCount')}>
            {(['전체', '미배정', '내 카드'] as const).map((f) => (
              <button
                className={filter === f ? 'active' : ''}
                key={f}
                onClick={() => setFilter(f)}
                type="button"
              >
                {f === '전체' ? t(language, 'map.all') : f === '미배정' ? t(language, 'zone.unassigned') : t(language, 'territory.myCards')}
              </button>
            ))}
          </div>

          {visibleCards.length > 0 && (
            <div className="mobile-section-title mobile-territory-list-title">
              <h2>{filter === '전체' ? t(language, 'territory.allCardsList') : t(language, 'territory.myCards')}</h2>
            </div>
          )}

          {visibleCards.length === 0 && (
            <div className="mobile-territory-empty" style={{ margin: '0 20px' }}>
              {t(language, 'zone.noCards')}
            </div>
          )}

          {renderedVisibleCards.map((card) => {
              // '봉사 중' 표시는 뺐다 — 진행 상태만 말한다 (사용자 요청)
              const operationalState = getTerritoryCardOperationalState(card)
              const statusLabel = cardStatusLabel(operationalState)
              const statusClass = operationalState
            const counts = cardBuildingTypeCounts.get(card.id) ?? { total: card.buildings, house: 0, shop: 0 }
            return (
              <div className="mobile-territory-card" key={card.id}>
                <div className="mobile-territory-info">
                  <h3 className="mobile-territory-name">{translateKoreanAddress(card.name, language, translatePlaceNames)}</h3>
                  <p className="mobile-territory-sub">
                    {translateKoreanAddress(card.area, language, translatePlaceNames)} · 전체 {counts.total} · 주택 {counts.house} · 상가 {counts.shop}
                  </p>
                  <div className="mobile-territory-progress">
                    <div className="mobile-territory-bar">
                      <b style={{ width: `${card.progress}%` }} />
                    </div>
                    <span className="mobile-territory-pct">{card.progress}%</span>
                  </div>
                </div>
                <div className="mobile-territory-side">
                  <span className={`mobile-territory-status status-${statusClass}`}>
                    {statusLabel}
                  </span>
                  <button
                    className="mobile-territory-open-btn"
                    onClick={() => onOpenMap(card.id)}
                    type="button"
                  >
                    {t(language, 'territory.open')}
                  </button>
                </div>
              </div>
            )
          })}
          {doneExcludedCards.length > 0 && (
            <button
              className="mobile-done-excluded-toggle"
              onClick={() => setShowDoneExcludedCards((open) => !open)}
              type="button"
            >
              완료·제외 {doneExcludedCards.length}개 {showDoneExcludedCards ? msg('접기') : msg('펼치기')}
            </button>
          )}
        </>
      )}

    </div>

    {/* 식당봉사 시트 */}
    {showRestaurantSheet && onSubmitRestaurantRequest && (
      <RestaurantServiceSheet
        role={role}
        language={language}
        translatePlaceNames={translatePlaceNames}
        buildings={buildings}
        cards={cards}
        visitHistories={visitHistories}
        currentVisitor={currentVisitor}
        restaurantRequests={restaurantRequests}
        onStartSession={handleStartSession}
        onSubmitRequest={onSubmitRestaurantRequest}
        onClose={() => setShowRestaurantSheet(false)}
      />
    )}
    </>
  )
}
