import { useEffect, useMemo, useRef, useState } from 'react'
import { askNotifyOnEventEdit } from '../lib/askNotify'
import { countEventNotifyTargets, countEventNotifyTargetsMany } from '../utils/eventNotify'
import { useSearchParams } from 'react-router-dom'
import { confirmDialog } from '../lib/confirm'
import { showToast } from '../lib/toast'
import { findActivePeriod } from '../utils/specialPeriod'
import type { Building, CalendarEvent, CardBoundary, EventInformalAssignment, EventRestaurantAssignment, InformalAsset, InformalGroup, Role, SpecialPeriod, TerritoryCard, VisitHistory } from '../types'
import { PERIOD_COLORS } from '../types'
import { ChatRoom } from './ChatRoom'
import { CommentSection, type MentionUser } from './CommentSection'
import { savePlacePresets, normalizePlacePresets, resolvePlacePresets, parsePlacePresetsValue, PLACE_PRESET_SETTING_KEY } from '../lib/placePresets'
import type { PlacePreset } from '../lib/placePresets'
import { saveTimePresets, normalizeTimePresets, resolveTimePresets, parseTimePresetsValue, TIME_PRESET_SETTING_KEY, addMinutesToTime } from '../lib/timePresets'
import type { TimePreset } from '../lib/timePresets'
import { PlacePresetEditor, TimePresetEditor } from './admin/AdminMobileCalendar'
import { ExportEventsModal } from './calendar/ExportEventsModal'
import { ImportEventsModal } from './calendar/ImportEventsModal'
import { msg } from '../lib/msg'
import { AssignmentEditor } from './assignment/AssignmentEditor'
import { buildSharedAssignmentTeams } from './admin/sharedAssignmentTeams'
import { ParticipantAddContent } from './calendar/ParticipantAddContent'
import type { EventParticipantUser } from '../utils/eventParticipantUsers'


function getCalendarDays(year: number, month: number): (number | null)[] {
  const firstDay = new Date(year, month - 1, 1).getDay()
  const daysInMonth = new Date(year, month, 0).getDate()
  const total = Math.ceil((firstDay + daysInMonth) / 7) * 7
  return Array.from({ length: total }, (_, i) => {
    const day = i - firstDay + 1
    return day >= 1 && day <= daysInMonth ? day : null
  })
}

function toDateStr(year: number, month: number, day: number) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function getWeeklyDates(startDate: string, endDate: string): string[] {
  const dates: string[] = []
  const current = new Date(startDate)
  const end = new Date(endDate)
  while (current <= end) {
    dates.push(current.toISOString().slice(0, 10))
    current.setDate(current.getDate() + 7)
  }
  return dates
}


function eventTimeClass(time: string) {
  const h = parseInt(time.split(':')[0], 10)
  if (h < 12) return 'event-pill--am'
  if (h < 17) return 'event-pill--pm'
  return 'event-pill--eve'
}

// TimePreset / addMinutesToTime / 기본 프리셋은 ../lib/timePresets 로 이동 (모바일 공용)

type EventInput = { time: string; endTime?: string; title: string; place: string; mapLink?: string; leader: string; memo: string; hasMeeting: boolean; allowApplications: boolean }
type EditDraft = EventInput

type ScopeModal =
  | { kind: 'edit'; id: number; date: string; seriesId: string; draft: EditDraft }
  | { kind: 'delete'; id: number; date: string; seriesId: string; title: string }

export function DesktopCalendar({
  buildings = [],
  cardBoundaries = [],
  visitHistories = [],
  informalAssets = [],
  informalGroups = [],
  eventInformalAssignments = [],
  eventRestaurantAssignments = [],
  currentVisitor,
  currentUserId,
  leaderNames = [],
  cards,
  events,
  role = 'user',
  actualRole = role,
  participantUsers = [],
  mentionUsers = [],
  onApplyToEvent,
  onAssignCardToEventParticipant: _onAssignCardToEventParticipant,
  onAssignCardsToEventParticipantsBulk,
  onAssignInformalToUser,
  onRemoveInformalAssignment,
  onAssignRestaurantToUser,
  onRemoveRestaurantAssignment,
  onAddParticipant,
  onCreateEvent,
  onCreateRepeatEvents,
  onDeleteEvent,
  onDeleteEventSeries,
  onLinkEventsToSeries,
  onRemoveParticipant,
  onUpdateEvent,
  onUpdateEventSeries,
  onCreateSpecialPeriod,
  onDeleteSpecialPeriod,
  specialPeriods,
  globalSettings = {},
  onUpsertGlobalSetting,
}: {
  buildings?: Building[]
  cardBoundaries?: CardBoundary[]
  visitHistories?: VisitHistory[]
  informalAssets?: InformalAsset[]
  informalGroups?: InformalGroup[]
  eventInformalAssignments?: EventInformalAssignment[]
  eventRestaurantAssignments?: EventRestaurantAssignment[]
  currentVisitor: string
  currentUserId?: number | null
  leaderNames?: string[]
  cards: TerritoryCard[]
  events: CalendarEvent[]
  role?: Role
  actualRole?: Role
  participantUsers?: EventParticipantUser[]
  mentionUsers?: MentionUser[]
  onApplyToEvent: (eventId: number) => void
  onAssignCardToEventParticipant: (eventId: number, userName: string, cardId: number | null) => void
  onAssignCardsToEventParticipantsBulk?: (
    eventId: number,
    assignments: Array<{ userName: string; cardId?: number | null; cardIds?: number[] | null; teamKey?: string | null }>,
    options?: {
      silentSuccess?: boolean
      status?: 'confirmed' | 'shared'
      expectedSharedAt?: string | null
      onConflict?: (serverSharedAt: string | null) => void
    },
  ) => Promise<void> | void
  onAssignInformalToUser?: (input: { eventId: number; userName: string; assetId: number; assignedBy: string }) => Promise<boolean>
  onRemoveInformalAssignment?: (assignmentId: number) => Promise<void>
  onAssignRestaurantToUser?: (input: { eventId: number; userName: string; buildingId: number; unitId?: number | null; assignedBy: string }) => Promise<boolean>
  onRemoveRestaurantAssignment?: (assignmentId: number) => Promise<void>
  onAddParticipant?: (eventId: number, userName: string, participantRole?: '신청' | '게스트') => boolean | void | Promise<boolean | void>
  onCreateEvent: (input: EventInput & { date: string }) => void
  onCreateRepeatEvents: (dates: string[], input: EventInput) => void
  onDeleteEvent: (eventId: number) => void
  onDeleteEventSeries: (seriesId: string, fromDate: string) => void
  onLinkEventsToSeries: (eventIds: number[]) => void
  onRemoveParticipant: (eventId: number, userName: string) => void
  onUpdateEvent: (eventId: number, input: EditDraft, notify?: boolean) => void | Promise<boolean>
  onUpdateEventSeries: (seriesId: string, fromDate: string, input: EditDraft, notify?: boolean) => void | Promise<boolean>
  onCreateSpecialPeriod: (input: { label: string; startDate: string; endDate: string; color: string }) => Promise<boolean | void> | boolean | void
  onDeleteSpecialPeriod: (id: number) => void
  specialPeriods: SpecialPeriod[]
  globalSettings?: Record<string, string>
  onUpsertGlobalSetting?: (key: string, value: string) => Promise<boolean>
}) {
  const today = new Date()
  const [year, setYear] = useState(today.getFullYear())
  const [month, setMonth] = useState(today.getMonth() + 1)
  const [selectedDay, setSelectedDay] = useState(today.getDate())
  const [searchParams, setSearchParams] = useSearchParams()
  const [chatEvent, setChatEvent] = useState<CalendarEvent | null>(null)
  const [isExportOpen, setIsExportOpen] = useState(false)
  const [isImportOpen, setIsImportOpen] = useState(false)
  const [assignEventId, setAssignEventId] = useState<number | null>(null)

  // openChat=<eventId> 쿼리 처리: 해당 일정 날짜로 이동 + 채팅방 열기
  useEffect(() => {
    const openChatId = searchParams.get('openChat')
    if (!openChatId) return
    const targetEvent = events.find((ev: CalendarEvent) => ev.id === Number(openChatId))
    if (!targetEvent) return

    const d = new Date(targetEvent.date)
    setYear(d.getFullYear())
    setMonth(d.getMonth() + 1)
    setSelectedDay(d.getDate())
    setChatEvent(targetEvent)

    // 다음 tick에 스크롤
    setTimeout(() => {
      const el = document.getElementById(`event-card-${openChatId}`)
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 200)

    // 쿼리 제거
    const next = new URLSearchParams(searchParams)
    next.delete('openChat')
    setSearchParams(next, { replace: true })
  }, [events, searchParams, setSearchParams])
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [newDate, setNewDate] = useState(() => toDateStr(today.getFullYear(), today.getMonth() + 1, today.getDate()))
  const [newTitle, setNewTitle] = useState('传道')
  const [placePresets, setPlacePresets] = useState<PlacePreset[]>(() => resolvePlacePresets(globalSettings[PLACE_PRESET_SETTING_KEY]))
  const [placeSettingsOpen, setPlaceSettingsOpen] = useState(false)
  const [timePresets, setTimePresets] = useState<TimePreset[]>(() => resolveTimePresets(globalSettings[TIME_PRESET_SETTING_KEY]))
  const [timeSettingsOpen, setTimeSettingsOpen] = useState(false)
  const placePresetSaveVersionRef = useRef(0)
  const timePresetSaveVersionRef = useRef(0)
  const [newTime, setNewTime] = useState('10:00')
  const [newEndTime, setNewEndTime] = useState('12:00')
  const [newPlace, setNewPlace] = useState('')
  const [newMapLink, setNewMapLink] = useState('')
  const [newLeaders, setNewLeaders] = useState<string[]>([])
  const toggleNewLeader = (name: string) => setNewLeaders((prev) => prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name])
  const [newMemo, setNewMemo] = useState('')
  const [newHasMeeting, setNewHasMeeting] = useState(false)
  const [newAllowApplications, setNewAllowApplications] = useState(true)
  const [isRepeat, setIsRepeat] = useState(false)
  const [repeatEnd, setRepeatEnd] = useState('')
  const [editingEventId, setEditingEventId] = useState<number | null>(null)
  const [editDraft, setEditDraft] = useState<EditDraft | null>(null)
  const [scopeModal, setScopeModal] = useState<ScopeModal | null>(null)

  // 알림 보낼지 묻고 저장한다. 모바일과 **같은 lib/askNotify** 를 쓴다
  // (각자 만들면 한쪽만 고쳐져 갈라진다 — 이 앱에서 여러 번 그랬다)
  const saveWithNotifyAsk = async (
    ev: CalendarEvent,
    draft: EditDraft,
    /** 저장. 실패(false)면 화면을 닫지 않는다 — 입력이 사라지지 않게 */
    save: (notify: boolean) => void | Promise<void>,
    /** 반복 수정이면 바뀌는 일정 전부. 회차마다 신청자가 달라 합집합으로 센다 */
    affected?: CalendarEvent[],
  ) => {
    const notify = await askNotifyOnEventEdit({
      before: ev,
      after: { ...draft, date: ev.date },
      recipientCount: affected ? countEventNotifyTargetsMany(affected) : countEventNotifyTargets(ev),
      seriesCount: affected?.length,
      affectedDates: affected?.map((e) => e.date),
    })
    await save(notify)
  }

  const [deleteConfirmEvent, setDeleteConfirmEvent] = useState<CalendarEvent | null>(null)
  const [showPeriodForm, setShowPeriodForm] = useState(false)
  const [periodLabel, setPeriodLabel] = useState('')
  const [periodStart, setPeriodStart] = useState('')
  const [periodEnd, setPeriodEnd] = useState('')
  const [periodColor, setPeriodColor] = useState(PERIOD_COLORS[0].value)
  const [addParticipantEventId, setAddParticipantEventId] = useState<number | null>(null)
  const [selectedEventId, setSelectedEventId] = useState<number | null>(null)

  const calendarDays = getCalendarDays(year, month)
  const selectedDateStr = toDateStr(year, month, selectedDay)
  const allEventsForDay = events.filter((e) => e.date === selectedDateStr)
  const explicitSelected = selectedEventId ? allEventsForDay.find(e => e.id === selectedEventId) : null
  const activeEvent = explicitSelected || (allEventsForDay.length > 0 ? allEventsForDay[0] : null)
  const selectedEvents = activeEvent ? [activeEvent] : []

  // Compute daily stats from all events of the day
  const dailyApplicationEvents = allEventsForDay.filter((event) => event.allowApplications)
  const allApplicants = dailyApplicationEvents.reduce((t, e) => t + e.applicants.length, 0)
  const allAssigned = dailyApplicationEvents.reduce((t, e) => t + e.assigned.length, 0)

  const prevMonth = () => {
    if (month === 1) { setYear((y) => y - 1); setMonth(12) } else setMonth((m) => m - 1)
    setSelectedDay(1); setShowCreateForm(false)
  }
  const nextMonth = () => {
    if (month === 12) { setYear((y) => y + 1); setMonth(1) } else setMonth((m) => m + 1)
    setSelectedDay(1); setShowCreateForm(false)
  }
  const goToday = () => {
    setYear(today.getFullYear()); setMonth(today.getMonth() + 1); setSelectedDay(today.getDate())
    setShowCreateForm(false)
  }

  const updatePlacePresets = async (next: PlacePreset[]) => {
    const normalized = normalizePlacePresets(next)
    const previous = placePresets
    const version = ++placePresetSaveVersionRef.current
    setPlacePresets(normalized)
    savePlacePresets(normalized)  // 로컬 캐시
    const saved = await onUpsertGlobalSetting?.(PLACE_PRESET_SETTING_KEY, JSON.stringify(normalized))
    if (saved === false && placePresetSaveVersionRef.current === version) {
      setPlacePresets(previous)
      savePlacePresets(previous)
    }
  }

  const updateTimePresets = async (next: TimePreset[]) => {
    const normalized = normalizeTimePresets(next)
    const previous = timePresets
    const version = ++timePresetSaveVersionRef.current
    setTimePresets(normalized)
    saveTimePresets(normalized)  // 로컬 캐시
    const saved = await onUpsertGlobalSetting?.(TIME_PRESET_SETTING_KEY, JSON.stringify(normalized))
    if (saved === false && timePresetSaveVersionRef.current === version) {
      setTimePresets(previous)
      saveTimePresets(previous)
    }
  }

  // 다른 기기에서 바뀐 서버 프리셋이 fetch 되면 반영 (편집 중 아닐 때)
  useEffect(() => {
    if (timeSettingsOpen) return
    const parsed = parseTimePresetsValue(globalSettings[TIME_PRESET_SETTING_KEY])
    if (parsed) setTimePresets(parsed)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [globalSettings[TIME_PRESET_SETTING_KEY]])
  useEffect(() => {
    if (placeSettingsOpen) return
    const parsed = parsePlacePresetsValue(globalSettings[PLACE_PRESET_SETTING_KEY])
    if (parsed) setPlacePresets(parsed)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [globalSettings[PLACE_PRESET_SETTING_KEY]])

  const applyPlacePreset = (preset: PlacePreset) => {
    setNewPlace(preset.name)
    setNewMapLink(preset.mapLink)
  }

  const resetCreateForm = () => {
    setNewDate(selectedDateStr); setNewTitle('传道'); setNewTime('10:00'); setNewEndTime('12:00'); setNewPlace('')
    setNewMapLink(''); setNewLeaders([]); setNewMemo(''); setNewHasMeeting(false); setNewAllowApplications(true)
    setIsRepeat(false); setRepeatEnd('')
  }

  const handleCreate = () => {
    if (!newTitle.trim()) return
    const input: EventInput = { time: newTime, endTime: newEndTime || undefined, title: newTitle, place: newPlace, mapLink: newMapLink || undefined, leader: newLeaders.join(', '), memo: newMemo, hasMeeting: newHasMeeting, allowApplications: newAllowApplications }
    if (isRepeat) {
      // 반복 켰는데 종료일 없음 → 조용히 단일 생성되던 문제 방지
      if (!repeatEnd) { showToast(msg('반복 종료일을 선택해 주세요'), 'error'); return }
      onCreateRepeatEvents(getWeeklyDates(newDate, repeatEnd), input)
    } else {
      onCreateEvent({ date: newDate, ...input })
    }
    setShowCreateForm(false)
    resetCreateForm()
  }

  const clearEdit = () => { setEditingEventId(null); setEditDraft(null) }
  const closeCreate = () => { setShowCreateForm(false); resetCreateForm() }
  const openCreate = () => { setNewDate(selectedDateStr); setShowCreateForm(true) }

  const repeatCount = isRepeat && repeatEnd ? getWeeklyDates(newDate, repeatEnd).length : 0

  return (
    <>
      <ExportEventsModal isOpen={isExportOpen} onClose={() => setIsExportOpen(false)} events={events} />
      <ImportEventsModal isOpen={isImportOpen} onClose={() => setIsImportOpen(false)} onCreateEvent={onCreateEvent} />

      {/* ── 단일 일정 삭제 확인 모달 ───────────────────── */}
      {deleteConfirmEvent && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 1100, background: 'rgba(0,0,0,0.4)', display: 'grid', placeItems: 'center' }}>
          <div style={{ background: '#fff', borderRadius: 'var(--r-lg)', padding: '24px 28px', width: '400px', boxShadow: '0 20px 60px rgba(0,0,0,0.2)', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <h2 style={{ fontSize: '17px', fontWeight: 700, margin: 0 }}>일정 삭제</h2>
            <div>
              <p style={{ margin: 0, fontSize: 14, fontWeight: 700, color: '#1e293b' }}>"{deleteConfirmEvent.title}"</p>
              <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--ink-500)' }}>{deleteConfirmEvent.date} {deleteConfirmEvent.time}</p>
            </div>
            <div style={{ padding: '12px 14px', background: '#fef3c7', border: '1px solid #fde68a', borderRadius: 10 }}>
              <p style={{ margin: '0 0 6px', fontSize: 13, fontWeight: 700, color: '#92400e' }}>⚠️ 함께 삭제됩니다</p>
              <ul style={{ margin: 0, padding: 0, listStyle: 'none', fontSize: 12, color: '#78350f', lineHeight: 1.8 }}>
                <li>· 채팅방 (메시지 전체)</li>
                <li>· 신청자 {deleteConfirmEvent.applicants.length}명</li>
                <li>· 봉사자 카드 배정 {deleteConfirmEvent.cardAssignments.length}건</li>
                <li>· 일정에 달린 댓글</li>
              </ul>
            </div>
            <p style={{ margin: 0, fontSize: 12, color: '#dc2626', fontWeight: 600 }}>이 작업은 되돌릴 수 없습니다.</p>
            <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
              <button onClick={() => setDeleteConfirmEvent(null)} style={{ flex: 1, padding: '10px', borderRadius: 'var(--r-md)', border: '1px solid #d1d5db', background: '#f9fafb', fontSize: 14, fontWeight: 600, cursor: 'pointer' }} type="button">취소</button>
              <button onClick={() => { onDeleteEvent(deleteConfirmEvent.id); clearEdit(); setDeleteConfirmEvent(null) }} style={{ flex: 1, padding: '10px', borderRadius: 'var(--r-md)', border: 'none', background: '#dc2626', color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer' }} type="button">삭제</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Scope modal (edit or delete series) ───────────────────── */}
      {scopeModal && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 1100, background: 'rgba(0,0,0,0.4)', display: 'grid', placeItems: 'center' }}>
          <div style={{ background: '#fff', borderRadius: 'var(--r-lg)', padding: '28px 32px', width: '360px', boxShadow: '0 20px 60px rgba(0,0,0,0.2)', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {scopeModal.kind === 'edit' && (
              <>
                <h2 style={{ fontSize: '16px', fontWeight: 700, margin: 0 }}>수정 범위 선택</h2>
                <p style={{ fontSize: '13px', color: 'var(--ink-500)', margin: 0 }}>반복 시리즈 일정입니다. 어떤 범위로 수정할까요?</p>
                <button onClick={() => { const ev = events.find((e) => e.id === scopeModal.id); const done = async (notify: boolean) => { const ok = await onUpdateEvent(scopeModal.id, scopeModal.draft, notify); if (ok !== false) { clearEdit(); setScopeModal(null) } }; if (ev) void saveWithNotifyAsk(ev, scopeModal.draft, done); else done(true) }} style={{ padding: '12px', borderRadius: 'var(--r-md)', border: '1px solid #d1d5db', background: '#f9fafb', fontSize: '14px', fontWeight: 600, cursor: 'pointer', textAlign: 'left' }} type="button">
                  <strong style={{ display: 'block' }}>이 일정만 수정 ({scopeModal.date})</strong>
                  <span style={{ fontSize: '12px', color: 'var(--ink-500)', fontWeight: 400 }}>나머지 반복 일정은 그대로</span>
                </button>
                <button onClick={() => { const ev = events.find((e) => e.id === scopeModal.id); const affected = events.filter((e) => e.seriesId && e.seriesId === scopeModal.seriesId && e.date >= scopeModal.date); const done = async (notify: boolean) => { const ok = await onUpdateEventSeries(scopeModal.seriesId, scopeModal.date, scopeModal.draft, notify); if (ok !== false) { clearEdit(); setScopeModal(null) } }; if (ev) void saveWithNotifyAsk(ev, scopeModal.draft, done, affected); else done(true) }} style={{ padding: '12px', borderRadius: 'var(--r-md)', border: '1px solid var(--border-default)', background: 'var(--gray-50)', fontSize: '14px', fontWeight: 600, cursor: 'pointer', textAlign: 'left' }} type="button">
                  <strong style={{ display: 'block', color: 'var(--gray-900)' }}>이 날 포함 이후 모두 수정</strong>
                  <span style={{ fontSize: '12px', color: 'var(--ink-500)', fontWeight: 400 }}>{scopeModal.date} 부터 이후 일정만 변경 (지난 일정은 그대로)</span>
                </button>
              </>
            )}
            {scopeModal.kind === 'delete' && (
              <>
                <h2 style={{ fontSize: '16px', fontWeight: 700, margin: 0 }}>삭제 범위 선택</h2>
                <p style={{ fontSize: '13px', color: 'var(--ink-500)', margin: 0 }}>반복 시리즈 일정입니다. 어떤 범위로 삭제할까요?</p>
                <button onClick={() => { onDeleteEvent(scopeModal.id); clearEdit(); setScopeModal(null) }} style={{ padding: '12px', borderRadius: 'var(--r-md)', border: '1px solid #d1d5db', background: '#f9fafb', fontSize: '14px', fontWeight: 600, cursor: 'pointer', textAlign: 'left' }} type="button">
                  <strong style={{ display: 'block' }}>이 일정만 삭제 ({scopeModal.date})</strong>
                  <span style={{ fontSize: '12px', color: 'var(--ink-500)', fontWeight: 400 }}>나머지 반복 일정은 그대로</span>
                </button>
                <button onClick={() => { onDeleteEventSeries(scopeModal.seriesId, scopeModal.date); clearEdit(); setScopeModal(null) }} style={{ padding: '12px', borderRadius: 'var(--r-md)', border: '1px solid var(--danger-600)', background: '#fef2f2', fontSize: '14px', fontWeight: 600, cursor: 'pointer', textAlign: 'left' }} type="button">
                  <strong style={{ display: 'block', color: 'var(--danger-600)' }}>이 날 포함 이후 모두 삭제</strong>
                  <span style={{ fontSize: '12px', color: 'var(--ink-500)', fontWeight: 400 }}>{scopeModal.date} 부터 이후 일정 모두 (지난 일정은 그대로)</span>
                </button>
              </>
            )}
            <button onClick={() => setScopeModal(null)} style={{ padding: '8px', borderRadius: 'var(--r-md)', border: 'none', background: 'none', color: 'var(--ink-500)', fontSize: '13px', cursor: 'pointer' }} type="button">취소</button>
          </div>
        </div>
      )}

      {/* ── Create event modal ───────────────────── */}
      {showCreateForm && (
        <div className="cal-modal-backdrop" onClick={closeCreate}>
          <div className="cal-modal" onClick={(e) => e.stopPropagation()}>
            <div className="cal-modal-head">
              <div className="cal-modal-title">
                <h2>새 일정 추가</h2>
              </div>
              <button className="cal-modal-close" onClick={closeCreate} type="button">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            <div className="cal-modal-body">
              {/* 제목 */}
              <div className="cal-field">
                <label>제목 *</label>
                <input className="cal-input" placeholder="传道" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} />
              </div>

              {/* 날짜 + 매주 반복 토글 */}
              <div className="cal-field">
                <label>날짜와 시간</label>
                <div className="cal-box-section">
                  <input className="cal-input" type="date" value={newDate} onChange={(e) => setNewDate(e.target.value)} style={{ marginBottom: 10 }} />
                  <label className="cal-toggle-row">
                    <div>
                      <span className="cal-toggle-label">매주 반복</span>
                      <span className="cal-toggle-desc">같은 요일로 반복 일정을 생성합니다.</span>
                    </div>
                    <button
                      type="button"
                      className={`cal-toggle-switch${isRepeat ? ' on' : ''}`}
                      onClick={() => setIsRepeat(v => !v)}
                      aria-pressed={isRepeat}
                    />
                  </label>
                  {isRepeat && (
                    <div style={{ marginTop: 10 }}>
                      <div className="cal-field">
                        <label>반복 종료일</label>
                        <input className="cal-input" type="date" value={repeatEnd} min={newDate} onChange={(e) => setRepeatEnd(e.target.value)} />
                      </div>
                      {repeatEnd && <p className="cal-repeat-hint" style={{ marginTop: 6 }}>{repeatCount}개 일정 생성 예정</p>}
                    </div>
                  )}
                  {/* 시간 프리셋 */}
                  <div style={{ marginTop: 12 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <div className="cal-preset-label">자주 쓰는 시간</div>
                      <button type="button" className="cal-preset-edit-btn"
                        onClick={() => setTimeSettingsOpen((v) => !v)}
                        style={{ minHeight: 0, border: 'none', background: 'transparent', color: 'var(--ink)', fontSize: 12, fontWeight: 700, padding: '4px 2px', cursor: 'pointer' }}>
                        {timeSettingsOpen ? '설정 닫기' : '시간 설정'}
                      </button>
                    </div>
                    <div className="cal-time-presets">
                      {timePresets.map((p) => (
                        <button
                          key={`${p.label}-${p.time}`}
                          type="button"
                          className={`cal-time-preset-btn${newTime === p.time ? ' active' : ''}`}
                          onClick={() => {
                            setNewTime(p.time)
                            setNewTitle(p.title)
                            setNewEndTime(addMinutesToTime(p.time, p.durationMinutes))
                          }}
                        >
                          <span className="cal-preset-name">{p.label}</span>
                          <span className="cal-preset-time">{p.time} - {addMinutesToTime(p.time, p.durationMinutes)}</span>
                        </button>
                      ))}
                    </div>
                    {timeSettingsOpen && (
                      <div style={{ marginTop: 8 }}>
                        <TimePresetEditor language={'ko'} presets={timePresets} onChange={updateTimePresets} />
                      </div>
                    )}
                    <div style={{ marginTop: 8, display: 'flex', gap: 6, alignItems: 'center' }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 11, color: 'var(--gray-400)', marginBottom: 3 }}>시작</div>
                        <input className="cal-input" type="time" value={newTime} onChange={(e) => setNewTime(e.target.value)} />
                      </div>
                      <span style={{ color: 'var(--gray-300)', marginTop: 18, fontSize: 14 }}>—</span>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 11, color: 'var(--gray-400)', marginBottom: 3 }}>종료</div>
                        <input className="cal-input" type="time" value={newEndTime} onChange={(e) => setNewEndTime(e.target.value)} />
                      </div>
                    </div>
                  </div>
                </div>
              </div>


              {/* 장소 + 지도 링크 */}
              <div className="cal-field">
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                  <label style={{ marginBottom: 0 }}>모임 장소</label>
                  <button
                    type="button"
                    onClick={() => setPlaceSettingsOpen(v => !v)}
                    style={{
                      border: 'none', background: 'transparent',
                      color: 'var(--ink)', fontSize: 13, fontWeight: 600,
                      cursor: 'pointer', padding: 0
                    }}
                  >
                    {placeSettingsOpen ? '설정 닫기' : '장소 설정'}
                  </button>
                </div>

                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
                  {placePresets.filter(p => p.name.trim()).map((preset, idx) => (
                    <button
                      key={`${idx}-${preset.name}`}
                      type="button"
                      onClick={() => applyPlacePreset(preset)}
                      className={`cal-time-preset-btn${newPlace === preset.name ? ' active' : ''}`}
                    >
                      {preset.name}
                    </button>
                  ))}
                </div>

                {placeSettingsOpen && (
                  <div style={{ marginBottom: 12 }}>
                    <PlacePresetEditor language={'ko'} presets={placePresets} onChange={updatePlacePresets} />
                  </div>
                )}

                <input className="cal-input" placeholder="장소 입력" value={newPlace} onChange={(e) => setNewPlace(e.target.value)} style={{ marginBottom: 8 }} />
                <input className="cal-input" inputMode="url" placeholder="네이버 지도 링크 (선택)" value={newMapLink} onChange={(e) => setNewMapLink(e.target.value)} />
              </div>


              {/* 인도자 (다중 선택) */}
              <div className="cal-field">
                <label>인도자</label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {leaderNames.length === 0 && <span style={{ fontSize: 13, color: 'var(--muted)' }}>선택 안함</span>}
                  {leaderNames.map((name) => {
                    const on = newLeaders.includes(name)
                    return (
                      <button key={name} type="button" onClick={() => toggleNewLeader(name)}
                        style={{ minHeight: 0, padding: '7px 14px', borderRadius: 999, fontSize: 13, fontWeight: on ? 700 : 500, cursor: 'pointer',
                          border: on ? '1.5px solid var(--ink)' : '1px solid var(--line)', background: on ? 'var(--ink)' : 'var(--surface)', color: on ? '#fff' : 'var(--ink)' }}>
                        {on ? '✓ ' : ''}{name}
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* 상세설명 */}
              <div className="cal-field">
                <label>상세설명 <span style={{ fontWeight: 400, color: 'var(--gray-400)' }}>(선택)</span></label>
                <textarea className="cal-textarea" placeholder="봉사 전에 알아야 할 내용, 주의사항 등" value={newMemo} onChange={(e) => setNewMemo(e.target.value)} />
              </div>

              {/* 설정 토글 */}
              <div className="cal-field">
                <label>설정</label>
                <div className="cal-box-section">
                  <label className="cal-toggle-row">
                    <div>
                      <span className="cal-toggle-label">봉사모임</span>
                      <span className="cal-toggle-desc">모임 일정이면 카드에 표시됩니다.</span>
                    </div>
                    <button
                      type="button"
                      className={`cal-toggle-switch${newHasMeeting ? ' on' : ''}`}
                      onClick={() => setNewHasMeeting(v => !v)}
                      aria-pressed={newHasMeeting}
                    />
                  </label>
                  <div className="cal-toggle-divider" />
                  <label className="cal-toggle-row">
                    <div>
                      <span className="cal-toggle-label">봉사 신청 받기</span>
                      <span className="cal-toggle-desc">봉사자들이 이 일정에 신청할 수 있습니다.</span>
                    </div>
                    <button
                      type="button"
                      className={`cal-toggle-switch${newAllowApplications ? ' on' : ''}`}
                      onClick={() => setNewAllowApplications(v => !v)}
                      aria-pressed={newAllowApplications}
                    />
                  </label>
                </div>
              </div>
            </div>

            <div className="cal-modal-foot">
              <button className="cal-cancel-btn" onClick={closeCreate} type="button">취소</button>
              <button className="cal-save-btn" disabled={!newTitle.trim()} onClick={handleCreate} type="button">
                {isRepeat && repeatEnd ? `${repeatCount}개 일정 저장` : '저장'}
              </button>
            </div>
          </div>
        </div>
      )}

      <section className="desktop-content calendar-layout">
        <div className="calendar-pane">
          <header className="page-header">
            <div className="page-header-text">
              <h1 className="page-header-title">{year}년 {month}월</h1>
            </div>
            <div className="page-header-actions">
              <button className="cal-today-btn" type="button" onClick={() => setIsExportOpen(true)}>일정 내보내기</button>
              <button className="cal-today-btn" type="button" onClick={() => setIsImportOpen(true)}>일정 가져오기</button>
              <button className="cal-nav-btn" onClick={prevMonth} type="button">‹</button>
              <button className="cal-today-btn" onClick={goToday} type="button">오늘</button>
              <button className="cal-nav-btn" onClick={nextMonth} type="button">›</button>
              {(role === 'admin' || role === 'developer') && (
                <button className="cal-add-event-btn" onClick={openCreate} type="button">+ 일정 추가</button>
              )}
            </div>
          </header>

          {/* ── Special period management ── */}
          <div style={{ padding: '2px 16px', borderBottom: '1px solid var(--border-default)', display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', minHeight: '22px' }}>
            {specialPeriods.map((p) => (
              <span key={p.id} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '1px 8px 1px 6px', borderRadius: 'var(--radius-sm)', background: p.color + '18', border: `1px solid ${p.color}50`, borderLeft: `3px solid ${p.color}`, fontSize: '11px', fontWeight: 600, color: p.color, flexShrink: 0, whiteSpace: 'nowrap' }}>
                <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: p.color, flexShrink: 0 }} />
                {p.label} · {p.startDate.slice(5)} ~ {p.endDate.slice(5)}
                <button onClick={() => onDeleteSpecialPeriod(p.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: p.color, fontWeight: 700, fontSize: '13px', lineHeight: 1, padding: '0 1px', opacity: 0.6 }} type="button">×</button>
              </span>
            ))}
            {!showPeriodForm && (
              <button onClick={() => setShowPeriodForm(true)} style={{ padding: '2px', border: 'none', background: 'none', color: '#9ca3af', cursor: 'pointer', display: 'grid', placeItems: 'center' }} title="특별기간 추가" type="button">
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"><path d="M12.127 22H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v5.125"/><path d="M14.62 18.8A2.25 2.25 0 1 1 18 15.836a2.25 2.25 0 1 1 3.38 2.966l-2.626 2.856a.998.998 0 0 1-1.507 0zM16 2v4M3 10h18M8 2v4"/></g></svg>
              </button>
            )}
            {showPeriodForm && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                <input placeholder="기간 이름" value={periodLabel} onChange={(e) => setPeriodLabel(e.target.value)} style={{ padding: '3px 8px', borderRadius: 'var(--r-sm)', border: '1px solid #d1d5db', fontSize: '12px', width: '100px' }} />
                <input type="date" value={periodStart} onChange={(e) => { const next = e.target.value; setPeriodStart(next); if (periodEnd && periodEnd < next) setPeriodEnd(next) }} style={{ padding: '3px 6px', borderRadius: 'var(--r-sm)', border: '1px solid #d1d5db', fontSize: '12px' }} />
                <span style={{ fontSize: '12px', color: '#9ca3af' }}>~</span>
                <input type="date" value={periodEnd} min={periodStart} onChange={(e) => setPeriodEnd(e.target.value)} style={{ padding: '3px 6px', borderRadius: 'var(--r-sm)', border: '1px solid #d1d5db', fontSize: '12px' }} />
                <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                  {PERIOD_COLORS.map((c) => (
                    <button key={c.value} onClick={() => setPeriodColor(c.value)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }} type="button" title={c.label}>
                      <span style={{ display: 'block', width: '18px', height: '18px', borderRadius: 'var(--radius-sm)', background: c.value, opacity: periodColor === c.value ? 1 : 0.35, transition: 'opacity 0.15s', outline: periodColor === c.value ? `2px solid ${c.value}` : 'none', outlineOffset: '2px' }} />
                    </button>
                  ))}
                </div>
                <button disabled={!periodLabel.trim() || !periodStart || !periodEnd || periodEnd < periodStart} onClick={async () => { const saved = await onCreateSpecialPeriod({ label: periodLabel.trim(), startDate: periodStart, endDate: periodEnd, color: periodColor }); if (saved === false) return; setPeriodLabel(''); setPeriodStart(''); setPeriodEnd(''); setShowPeriodForm(false) }} style={{ padding: '3px 10px', borderRadius: 'var(--r-sm)', border: 'none', background: 'var(--ink-900)', color: '#fff', fontSize: '12px', cursor: 'pointer' }} type="button">저장</button>
                <button onClick={() => setShowPeriodForm(false)} style={{ padding: '3px 8px', borderRadius: 'var(--r-sm)', border: '1px solid #e5e7eb', background: 'none', fontSize: '12px', cursor: 'pointer' }} type="button">취소</button>
              </div>
            )}
          </div>

          <div className="calendar-grid" aria-label={`${year}년 ${month}월 일정`}>
            {['일', '월', '화', '수', '목', '금', '토'].map((weekDay) => (
              <div className="weekday-cell" key={weekDay}>{weekDay}</div>
            ))}
            {calendarDays.map((day, index) => {
              const dayStr = day ? toDateStr(year, month, day) : null
              const dayEvents = dayStr ? events.filter((e) => e.date === dayStr) : []
              const activePeriod = dayStr ? findActivePeriod(specialPeriods, dayStr) : null
              return (
                <button
                  className={['day-cell', day === selectedDay ? 'selected' : '', !day ? 'muted' : '', activePeriod ? 'in-period' : ''].join(' ')}
                  disabled={!day}
                  key={`${day ?? 'blank'}-${index}`}
                  onClick={() => {
                    if (day) {
                      setSelectedDay(day)
                      setSelectedEventId(null)
                      setShowCreateForm(false)
                      setEditingEventId(null)
                    }
                  }}
                  type="button"
                >
                  <div className="day-head">
                    <span className="day-number">{day ?? ''}</span>
                  </div>
                  {activePeriod && <span className="period-full-bar" style={{ background: activePeriod.color }} aria-hidden="true" />}
                  <div className="day-events">
                    {dayEvents.map((event) => (
                      <small 
                        className={`event-pill ${eventTimeClass(event.time)}${event.hasMeeting ? ' has-meeting' : ''} ${selectedEventId === event.id ? 'active' : ''}`} 
                        key={event.id}
                        onClick={(e) => {
                          e.stopPropagation()
                          if (day) {
                            setSelectedDay(day)
                            setSelectedEventId(event.id)
                            setShowCreateForm(false)
                          }
                        }}
                        style={selectedEventId === event.id ? { outline: '2px solid var(--ink)', outlineOffset: -1 } : undefined}
                      >
                        {event.time} {event.title}
                      </small>
                    ))}
                  </div>
                </button>
              )
            })}
          </div>
        </div>

        <aside className="detail-pane" aria-label={`${selectedDay}일 일정 상세`}>
          <div className="detail-header">
            <p>{month}월 {selectedDay}일 일정</p>
            {dailyApplicationEvents.length > 0 && <strong>신청 {allApplicants}명 · 배정 {allAssigned}명</strong>}
          </div>

          <div className="detail-body">
            {selectedEvents.length === 0 && (
              <div className="cal-empty-state">
                <div className="cal-empty-icon">
                  <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
                  </svg>
                </div>
                <h3>{month}월 {selectedDay}일 일정이 없습니다</h3>
                <p>새로운 일정을 추가해보세요</p>
                {(role === 'admin' || role === 'developer') && (
                  <button className="cal-empty-add-btn" onClick={openCreate} type="button">+ 일정 추가</button>
                )}
              </div>
            )}

            <div className="detail-stack">
              {selectedEvents.map((event) => {
                const isApplied = event.applicants.includes(currentVisitor)
                const canAccessChat =
                  role === 'admin' ||
                  role === 'developer' ||
                  role === 'leader' ||
                  event.applicants.includes(currentVisitor) ||
                  event.assigned.includes(currentVisitor) ||
                  event.leaders.includes(currentVisitor)
                const isEditing = editingEventId === event.id

                if (isEditing && editDraft) {
                  return (
                    <EditCard
                      key={event.id}
                      draft={editDraft}
                      event={event}
                      events={events}
                      leaderNames={leaderNames}
                      globalSettings={globalSettings}
                      canDelete={actualRole === 'admin' || actualRole === 'developer'}
                      onClearEdit={clearEdit}
                      onDelete={(id) => {
                        if (event.seriesId) {
                          setScopeModal({ kind: 'delete', id, date: event.date, seriesId: event.seriesId, title: event.title })
                        } else {
                          setDeleteConfirmEvent(event)
                        }
                      }}
                      onLinkEventsToSeries={onLinkEventsToSeries}
                      onSave={(id, draft) => {
                        if (!draft.title.trim()) return
                        if (event.seriesId) {
                          setScopeModal({ kind: 'edit', id, date: event.date, seriesId: event.seriesId, draft })
                        } else {
                          void saveWithNotifyAsk(event, draft, async (notify) => { const ok = await onUpdateEvent(id, draft, notify); if (ok !== false) clearEdit() })
                        }
                      }}
                      setDraft={setEditDraft}
                    />
                  )
                }

                // 편집/참가자 관리: 관리자·개발자 또는 본인이 인도자인 일정만 (모바일 정책과 통일)
                const canEdit = role === 'admin' || role === 'developer' || event.leaders.includes(currentVisitor)
                const canManage = role === 'admin' || role === 'developer'
                const canManageParticipants = canEdit

                return (
                  <EventDetailCard
                    buildings={buildings}
                    informalAssets={informalAssets}
                    eventInformalAssignments={eventInformalAssignments}
                    eventRestaurantAssignments={eventRestaurantAssignments}
                    key={event.id}
                    event={event}
                    cards={cards}
                    role={role}
                    globalSettings={globalSettings}
                    canEdit={canEdit}
                    canManage={canManage}
                    canManageParticipants={canManageParticipants}
                    canAccessChat={canAccessChat}
                    isApplied={isApplied}
                    currentUserId={currentUserId}
                    currentVisitor={currentVisitor}
                    mentionUsers={mentionUsers}
                    participantUsers={participantUsers}
                    addParticipantEventId={addParticipantEventId}
                    onAddParticipant={onAddParticipant}
                    onApply={() => onApplyToEvent(event.id)}
                    onRemoveParticipant={onRemoveParticipant}
                    onOpenChat={() => setChatEvent(event)}
                    onOpenAssignment={
                      onAssignCardsToEventParticipantsBulk && (actualRole === 'admin' || actualRole === 'developer' || event.leaders.includes(currentVisitor))
                        ? () => setAssignEventId(event.id)
                        : undefined
                    }
                    onEdit={() => {
                      setEditingEventId(event.id)
                      setEditDraft({ time: event.time, endTime: event.endTime ?? '', title: event.title, place: event.place, mapLink: event.mapLink ?? '', leader: event.leader, memo: event.memo, hasMeeting: event.hasMeeting, allowApplications: event.allowApplications })
                    }}
                    onDelete={() => {
                      if (event.seriesId) {
                        setScopeModal({ kind: 'delete', id: event.id, date: event.date, seriesId: event.seriesId, title: event.title })
                      } else {
                        setDeleteConfirmEvent(event)
                      }
                    }}
                    setAddParticipantEventId={setAddParticipantEventId}
                  />
                )
              })}
            </div>
          </div>

          {(role === 'admin' || role === 'developer') && (
            <div className="cal-pane-footer">
              <button className="cal-add-btn" onClick={openCreate} type="button">
                + 일정 추가
              </button>
            </div>
          )}
        </aside>
      </section>
      {chatEvent && (
        <div className="chat-room-modal-backdrop" onClick={() => setChatEvent(null)}>
          <div className="chat-room-modal" onClick={(event) => event.stopPropagation()}>
            <div className="chat-room-modal__head">
              <div>
                <strong>{chatEvent.title}</strong>
                <span>{chatEvent.date} · {chatEvent.time || '시간 미정'}</span>
              </div>
              <button onClick={() => setChatEvent(null)} type="button">닫기</button>
            </div>
            <ChatRoom
              canAccess
              compact
              currentUserId={currentUserId}
              currentVisitor={currentVisitor}
              eventId={chatEvent.id}
              eventTitle={chatEvent.title}
              role={role}
              users={mentionUsers}
            />
          </div>
        </div>
      )}
      {assignEventId !== null && onAssignCardsToEventParticipantsBulk && (() => {
        const assignmentEvent = events.find((event) => event.id === assignEventId)
        if (!assignmentEvent) return null
        const isAdminLike = actualRole === 'admin' || actualRole === 'developer'
        const assignmentCards = isAdminLike
          ? cards
          : cards.filter((card) => {
              const leaders = card.assignedLeaders?.length
                ? card.assignedLeaders
                : card.assignedLeader ? [card.assignedLeader] : []
              return leaders.includes(currentVisitor)
            })
        const canEditAssignment = isAdminLike || assignmentEvent.leaders.includes(currentVisitor)
        return (
          <AssignmentEditor
            event={assignmentEvent}
            cards={assignmentCards}
            allCards={cards}
            buildings={buildings}
            visitHistories={visitHistories}
            cardBoundaries={cardBoundaries}
            currentVisitor={currentVisitor}
            canEdit={canEditAssignment}
            registeredUsers={participantUsers}
            informalAssets={informalAssets}
            informalGroups={informalGroups}
            eventInformalAssignments={eventInformalAssignments}
            eventRestaurantAssignments={eventRestaurantAssignments}
            onAssignInformalToUser={onAssignInformalToUser}
            onRemoveInformalAssignment={onRemoveInformalAssignment}
            onAssignRestaurantToUser={onAssignRestaurantToUser}
            onRemoveRestaurantAssignment={onRemoveRestaurantAssignment}
            onAddGuest={onAddParticipant ? (eventId, name) => onAddParticipant(eventId, name, '게스트') : undefined}
            onClose={() => setAssignEventId(null)}
            onShare={(eventId, assignments, options) => onAssignCardsToEventParticipantsBulk(eventId, assignments, {
              status: 'shared',
              expectedSharedAt: options.expectedSharedAt,
              onConflict: options.onConflict,
            })}
          />
        )
      })()}
    </>
  )
}

function SharedAssignmentTeams({ event, cards, informalAssets = [], eventInformalAssignments = [], buildings = [], eventRestaurantAssignments = [] }: {
  event: CalendarEvent
  cards: TerritoryCard[]
  informalAssets?: InformalAsset[]
  eventInformalAssignments?: EventInformalAssignment[]
  buildings?: Building[]
  eventRestaurantAssignments?: EventRestaurantAssignment[]
}) {
  if (event.assignmentStatus !== 'shared') return null

  const teams = buildSharedAssignmentTeams(event, cards, informalAssets, eventInformalAssignments, buildings, eventRestaurantAssignments)
  if (teams.length === 0) return null

  return (
    <section className="shared-assignment-section">
      <div className="cal-section-head">
        <h3>확정된 팀</h3>
      </div>
      <div className="shared-assignment-list">
        {teams.map((team) => {
          const primaryCard = team.cardNames[0] ?? '카드 미배정'
          const extraCount = Math.max(0, team.cardNames.length - 1)
          return (
            <div className="shared-assignment-card" key={team.id}>
              <div className="shared-assignment-card__top">
                <div className="shared-assignment-card__summary">
                  <strong>{team.label}</strong>
                  <span>{team.members.join(', ') || '팀원 없음'}</span>
                </div>
                <span>{team.members.length}명</span>
              </div>
              <div className="shared-assignment-card__cards">
                {primaryCard}{extraCount > 0 ? ` 외 ${extraCount}개` : ''}
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}

function EventDetailCard({
  event,
  cards,
  buildings = [],
  informalAssets = [],
  eventInformalAssignments = [],
  eventRestaurantAssignments = [],
  role,
  globalSettings,
  canEdit,
  canManage,
  canManageParticipants,
  canAccessChat,
  isApplied,
  currentUserId,
  currentVisitor,
  mentionUsers,
  participantUsers,
  addParticipantEventId,
  onAddParticipant,
  onApply,
  onRemoveParticipant,
  onOpenChat,
  onOpenAssignment,
  onEdit,
  onDelete,
  setAddParticipantEventId,
}: {
  /** 비공식 봉사 배정 — 구역이 없어도 맡은 일이 있으면 보여 준다 */
  informalAssets?: InformalAsset[]
  eventInformalAssignments?: EventInformalAssignment[]
  eventRestaurantAssignments?: EventRestaurantAssignment[]
  event: CalendarEvent
  cards: TerritoryCard[]
  buildings?: Building[]
  role: import('../types').Role
  globalSettings: Record<string, string>
  canEdit: boolean
  canManage: boolean
  canManageParticipants: boolean
  canAccessChat: boolean
  isApplied: boolean
  currentUserId?: number | null
  currentVisitor: string
  mentionUsers: import('./CommentSection').MentionUser[]
  participantUsers: EventParticipantUser[]
  addParticipantEventId: number | null
  onAddParticipant?: (eventId: number, userName: string, participantRole?: '신청' | '게스트') => boolean | void | Promise<boolean | void>
  onApply: () => void
  onRemoveParticipant: (eventId: number, userName: string) => void
  onOpenChat: () => void
  onOpenAssignment?: () => void
  onEdit: () => void
  onDelete: () => void
  setAddParticipantEventId: (id: number | null) => void
}) {
  const [dotsOpen, setDotsOpen] = useState(false)
  const [isParticipantRemoveMode, setIsParticipantRemoveMode] = useState(false)

  return (
    <article className="detail-card" id={`event-card-${event.id}`}>
      {/* 헤더: ⋮ 메뉴 (admin/leader) */}
      <div className="detail-title-row" style={{ marginBottom: 0 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
          {event.card && <span className="event-card-badge">{event.card}</span>}
          {!event.allowApplications && <span className="event-closed-tag">신청 마감</span>}
        </div>
        {canEdit && (
          <div className="event-dots-menu-wrap">
            <button className="event-dots-btn" type="button" onClick={() => setDotsOpen((v) => !v)} aria-label="더보기">
              <svg width={16} height={16} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                <circle cx="12" cy="5" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="12" cy="19" r="1.5" />
              </svg>
            </button>
            {dotsOpen && (
              <>
                <div onClick={() => setDotsOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 30 }} />
                <div className="event-dots-dropdown">
                  <button className="event-dots-item" type="button" onClick={() => { setDotsOpen(false); onEdit() }}>수정</button>
                  {canManage && <button className="event-dots-item danger" type="button" onClick={() => { setDotsOpen(false); onDelete() }}>삭제</button>}
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* Hero 섹션 */}
      <div className="event-hero">
        <div className="event-hero-time">
          {event.endTime ? `${event.time} — ${event.endTime}` : (event.time || '시간 미정')}
          {event.hasMeeting && <span className="event-hero-meeting-pill">봉사 모임</span>}
        </div>
        <h2 className="event-hero-title">{event.title}</h2>
        {event.leader && (
          <div className="event-hero-leader">
            <span className="event-hero-leader-avatar">{event.leader.slice(0, 1)}</span>
            <span className="event-hero-leader-name">{event.leader}</span>
            <span className="event-hero-leader-label">인도자</span>
          </div>
        )}
      </div>

      {/* 신청 버튼 */}
      {event.allowApplications && (
        <button
          className={`cal-apply-big-btn${isApplied ? ' applied' : ''}`}
          onClick={onApply}
          type="button"
          style={{ marginBottom: 14 }}
        >
          {isApplied ? '신청 취소' : '신청하기'}
        </button>
      )}

      {/* 상세설명 */}
      {event.memo && (
        <div style={{ marginBottom: 12 }}>
          <div className="cal-section-head"><h3>상세 설명</h3></div>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--gray-700)', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{event.memo}</p>
        </div>
      )}

      {/* 위치 카드 */}
      {event.place && (
        <div style={{ marginBottom: 12 }}>
          <div className="cal-section-head"><h3>위치</h3></div>
          {event.mapLink ? (
            <a href={event.mapLink} target="_blank" rel="noopener noreferrer" className="event-location-card">
              <span className="event-location-icon">
                <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M12 21s6-5.2 6-11a6 6 0 0 0-12 0c0 5.8 6 11 6 11Z" /><circle cx="12" cy="10" r="2" />
                </svg>
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="event-location-name">{event.place}</div>
                <div className="event-location-sub">네이버 지도에서 보기</div>
              </div>
              <span className="event-location-arrow">
                <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M7 17 17 7"/><path d="M8 7h9v9"/>
                </svg>
              </span>
            </a>
          ) : (
            <div className="event-location-card" style={{ cursor: 'default' }}>
              <span className="event-location-icon">
                <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M12 21s6-5.2 6-11a6 6 0 0 0-12 0c0 5.8 6 11 6 11Z" /><circle cx="12" cy="10" r="2" />
                </svg>
              </span>
              <span className="event-location-name">{event.place}</span>
            </div>
          )}
        </div>
      )}

      {!(globalSettings?.hide_participants_from_users === 'true' && role === 'user') && (
        <div className="event-applicants-section">
          <div className="cal-section-head">
            <h3>신청자 <span style={{ fontWeight: 500, color: 'var(--gray-400)', fontSize: 12, marginLeft: 4 }}>{event.applicants.length}</span></h3>
            {(canManageParticipants || onAddParticipant) && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                {(role === 'leader' || role === 'admin' || role === 'developer') && onAddParticipant && (
                  <div className="cal-add-participant-wrap">
                    <button
                      className="cal-add-participant-chip-btn"
                      type="button"
                      onClick={() => {
                        if (addParticipantEventId === event.id) {
                          setAddParticipantEventId(null)
                        } else {
                          setAddParticipantEventId(event.id)
                        }
                      }}
                    >
                      <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" aria-hidden>
                        <line x1="12" y1="5" x2="12" y2="19" />
                        <line x1="5" y1="12" x2="19" y2="12" />
                      </svg>
                      추가
                    </button>
                    {addParticipantEventId === event.id && (
                      <div className="cal-add-participant-dropdown">
                        <ParticipantAddContent
                          existingNames={event.applicants}
                          onAdd={(name, participantRole) => onAddParticipant(event.id, name, participantRole)}
                          onAdded={() => setAddParticipantEventId(null)}
                          users={participantUsers}
                        />
                      </div>
                    )}
                  </div>
                )}
                {canManageParticipants && event.applicants.length > 0 && (
                  <div className="cal-add-participant-wrap">
                    <button
                      className="cal-add-participant-chip-btn"
                      type="button"
                      onClick={() => setIsParticipantRemoveMode((v) => !v)}
                      style={isParticipantRemoveMode ? {
                        color: 'var(--danger-600)',
                        background: 'var(--danger-50)',
                        borderColor: 'var(--danger-100)',
                      } : undefined}
                    >
                      {isParticipantRemoveMode ? '제외 닫기' : '- 제외'}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        <div className="event-applicants-strip">
          {event.applicants.map((name) => (
            <span
              aria-label={event.guests.includes(name) ? `${name}, ${msg('손님')}` : name}
              className={`event-applicant-chip${event.guests.includes(name) ? ' is-guest' : ''}`}
              key={name}
            >
              <span className={`event-applicant-avatar${event.assigned.includes(name) ? ' assigned' : ''}`}>{name.slice(0, 1)}</span>
              <span className="event-applicant-name">{name}</span>
              {canManageParticipants && isParticipantRemoveMode && (
                <button
                  className="event-applicants-remove-btn"
                  type="button"
                  aria-label={`${name} 참가자 제외`}
                  onClick={async () => {
                    if (await confirmDialog({ message: msg('{name}님을 이 일정에서 제외할까요?\n이미 팀이나 카드에 배정되어 있으면 배정에서도 제외됩니다.', { name: name }), danger: true, confirmLabel: '제외' })) {
                      onRemoveParticipant(event.id, name)
                    }
                  }}
                >
                  ×
                </button>
              )}
            </span>
          ))}
          {/* "+ 추가" 칩 제거 — 상단 신청하기 버튼과 동일 기능으로 중복 */}
          {event.applicants.length === 0 && !event.allowApplications && (
            <span style={{ fontSize: 12, color: 'var(--gray-400)', padding: '6px 2px' }}>신청자가 없습니다</span>
          )}
        </div>
      </div>
      )}

      {onOpenAssignment && (
        <button className="cal-assignment-open-btn" type="button" onClick={onOpenAssignment}>
          <span>팀 구성 및 배정</span>
          <span aria-hidden>›</span>
        </button>
      )}

      <SharedAssignmentTeams
        event={event}
        cards={cards}
        buildings={buildings}
        informalAssets={informalAssets}
        eventInformalAssignments={eventInformalAssignments}
        eventRestaurantAssignments={eventRestaurantAssignments}
      />

      {/* 댓글 + 채팅 열기 — 모바일 방식: CommentSection headerRight 로 통합 */}
      <div className="event-collab-grid">
        <CommentSection
          compact
          currentUserId={currentUserId}
          currentVisitor={currentVisitor}
          role={role}
          targetId={event.id}
          targetType="calendar_event"
          users={mentionUsers}
          headerRight={
            <button
              type="button"
              onClick={canAccessChat ? onOpenChat : undefined}
              disabled={!canAccessChat}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                fontSize: 12,
                fontWeight: 500,
                color: canAccessChat ? 'var(--gray-500)' : 'var(--gray-300)',
                background: 'transparent',
                border: 'none',
                cursor: canAccessChat ? 'pointer' : 'default',
                minHeight: 0,
                padding: '3px 2px',
              }}
            >
              <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
              </svg>
              채팅 열기
            </button>
          }
        />
      </div>
    </article>
  )
}

function EditCard({
  draft,
  event,
  events,
  leaderNames = [],
  globalSettings = {},
  canDelete,
  onClearEdit,
  onDelete,
  onLinkEventsToSeries,
  onSave,
  setDraft,
}: {
  draft: EditDraft
  event: CalendarEvent
  events: CalendarEvent[]
  leaderNames?: string[]
  globalSettings?: Record<string, string>
  canDelete: boolean
  onClearEdit: () => void
  onDelete: (id: number) => void
  onLinkEventsToSeries: (ids: number[]) => void
  onSave: (id: number, draft: EditDraft) => void
  setDraft: (d: EditDraft) => void
}) {
  const eventWeekday = new Date(event.date).getDay()

  const linkableIds = useMemo(() => {
    if (event.seriesId) return []
    return events
      .filter((e) => e.title === event.title && new Date(e.date).getDay() === eventWeekday && !e.seriesId)
      .map((e) => e.id)
  }, [event, events, eventWeekday])

  return (
    <article className="detail-card">
      <div className="detail-title-row">
        <div>
          <h2>일정 편집</h2>
          <span style={{ fontSize: '13px', color: 'var(--ink-500)' }}>{event.date}</span>
        </div>
        <button className="edit-btn" onClick={onClearEdit} type="button">취소</button>
      </div>

      {event.seriesId && (
        <div style={{ marginBottom: '12px', padding: '6px 10px', background: 'var(--gray-100)', borderRadius: 'var(--r-md)', fontSize: '12px', color: 'var(--gray-600)' }}>
          반복 시리즈 일정 — 저장 또는 삭제 시 범위를 선택할 수 있습니다
        </div>
      )}

      {!event.seriesId && linkableIds.length > 1 && (
        <div style={{ marginBottom: '12px', padding: '8px 10px', background: 'var(--gray-50)', borderRadius: 'var(--r-md)', fontSize: '12px', color: 'var(--gray-600)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', border: '1px solid var(--border-subtle)' }}>
          <span>같은 제목의 일정 {linkableIds.length}개 발견</span>
          <button onClick={() => onLinkEventsToSeries(linkableIds)} style={{ fontSize: '12px', padding: '3px 10px', borderRadius: 'var(--r-sm)', border: '1px solid var(--border-default)', background: 'var(--bg-card)', color: 'var(--gray-700)', cursor: 'pointer' }} type="button">
            시리즈로 묶기
          </button>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <div className="cal-field">
          <label>제목</label>
          <input className="cal-input" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
        </div>
        {/* 시간 — 프리셋 */}
        <div className="cal-field">
          <label>시간</label>
          <div className="cal-time-presets" style={{ marginBottom: 8 }}>
            {resolveTimePresets(globalSettings?.[TIME_PRESET_SETTING_KEY]).map((p) => (
              <button
                key={`${p.label}-${p.time}`}
                type="button"
                className={`cal-time-preset-btn${draft.time === p.time ? ' active' : ''}`}
                onClick={() => setDraft({ ...draft, time: p.time, title: p.title, endTime: addMinutesToTime(p.time, p.durationMinutes) })}
              >
                <span className="cal-preset-name">{p.label}</span>
                <span className="cal-preset-time">{p.time} - {addMinutesToTime(p.time, p.durationMinutes)}</span>
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 11, color: 'var(--gray-400)', marginBottom: 3 }}>시작</div>
              <input className="cal-input" type="time" value={draft.time} onChange={(e) => setDraft({ ...draft, time: e.target.value })} />
            </div>
            <span style={{ color: 'var(--gray-300)', marginTop: 14, fontSize: 14 }}>—</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 11, color: 'var(--gray-400)', marginBottom: 3 }}>종료</div>
              <input className="cal-input" type="time" value={draft.endTime ?? ''} onChange={(e) => setDraft({ ...draft, endTime: e.target.value })} />
            </div>
          </div>
        </div>
        {/* 장소 + 지도 링크 */}
        <div className="cal-field">
          <label>모임 장소</label>
          <input className="cal-input" placeholder="장소 입력" value={draft.place} onChange={(e) => setDraft({ ...draft, place: e.target.value })} style={{ marginBottom: 8 }} />
          <input className="cal-input" inputMode="url" placeholder="네이버 지도 링크 (선택)" value={draft.mapLink ?? ''} onChange={(e) => setDraft({ ...draft, mapLink: e.target.value })} />
        </div>
        {/* 인도자 (다중 선택) */}
        <div className="cal-field">
          <label>인도자</label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {leaderNames.length === 0 && <span style={{ fontSize: 13, color: 'var(--muted)' }}>선택 안함</span>}
            {leaderNames.map((name) => {
              const current = draft.leader.split(',').map((s) => s.trim()).filter(Boolean)
              const on = current.includes(name)
              return (
                <button key={name} type="button"
                  onClick={() => setDraft({ ...draft, leader: (on ? current.filter((n) => n !== name) : [...current, name]).join(', ') })}
                  style={{ minHeight: 0, padding: '7px 14px', borderRadius: 999, fontSize: 13, fontWeight: on ? 700 : 500, cursor: 'pointer',
                    border: on ? '1.5px solid var(--ink)' : '1px solid var(--line)', background: on ? 'var(--ink)' : 'var(--surface)', color: on ? '#fff' : 'var(--ink)' }}>
                  {on ? '✓ ' : ''}{name}
                </button>
              )
            })}
          </div>
        </div>
        {/* 상세설명 */}
        <div className="cal-field">
          <label>상세설명 <span style={{ fontWeight: 400, color: 'var(--gray-400)' }}>(선택)</span></label>
          <textarea className="cal-textarea" placeholder="봉사 전에 알아야 할 내용, 주의사항 등" value={draft.memo} onChange={(e) => setDraft({ ...draft, memo: e.target.value })} />
        </div>
        {/* 설정 토글 */}
        <div className="cal-field">
          <label>설정</label>
          <div className="cal-box-section">
            <label className="cal-toggle-row">
              <div>
                <span className="cal-toggle-label">봉사모임</span>
                <span className="cal-toggle-desc">모임 일정이면 카드에 표시됩니다.</span>
              </div>
              <button
                type="button"
                className={`cal-toggle-switch${draft.hasMeeting ? ' on' : ''}`}
                onClick={() => setDraft({ ...draft, hasMeeting: !draft.hasMeeting })}
                aria-pressed={draft.hasMeeting}
              />
            </label>
            <div className="cal-toggle-divider" />
            <label className="cal-toggle-row">
              <div>
                <span className="cal-toggle-label">봉사 신청 받기</span>
                <span className="cal-toggle-desc">봉사자들이 이 일정에 신청할 수 있습니다.</span>
              </div>
              <button
                type="button"
                className={`cal-toggle-switch${draft.allowApplications ? ' on' : ''}`}
                onClick={() => setDraft({ ...draft, allowApplications: !draft.allowApplications })}
                aria-pressed={draft.allowApplications}
              />
            </label>
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '8px', marginTop: '18px' }}>
        <button className="cal-save-btn" onClick={() => onSave(event.id, draft)} type="button">저장</button>
        {canDelete && <button className="danger-action" onClick={() => onDelete(event.id)} style={{ borderRadius: 'var(--r-sm)', minHeight: '40px', padding: '0 16px' }} type="button">삭제</button>}
      </div>
    </article>
  )
}
