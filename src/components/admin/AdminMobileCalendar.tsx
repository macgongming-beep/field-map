// 관리자 모바일 캘린더 — design_handoff 02 / 02b / 03 화면
import { t, weekdayShortLabels } from '../../i18n'
import { confirmDialog } from '../../lib/confirm'
import { pushBackHandler } from '../../lib/backStack'
import { showToast } from '../../lib/toast'
import { findActivePeriod } from '../../utils/specialPeriod'
//
// 구조:
//   - 월 카드 (헤더 + nav + grid)
//   - 그 날 일정 섹션 (헤더 + "+ 일정 추가" ghost)
//   - 다가오는 일정 섹션 (3개)
//   - 일정 카드 탭 → 상세 시트
//   - "+ 일정 추가" → 바텀 시트
//
// 헤더는 상위 MobileHome.tsx 의 AppHeader 가 그림.

import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useDeepLinkBack } from '../../hooks/useDeepLinkBack'
import { askNotifyOnEventEdit } from '../../lib/askNotify'
import { countEventNotifyTargets, countEventNotifyTargetsMany } from '../../utils/eventNotify'
import type { Building, CalendarEvent, CardBoundary, EventInformalAssignment, EventRestaurantAssignment, InformalAsset, InformalGroup, Role, SpecialPeriod, TerritoryCard, VisitHistory } from '../../types'
import type { AppLanguage } from '../../i18n'
import { AssignmentEditor } from '../assignment/AssignmentEditor'
import type { EventParticipantUser } from '../../utils/eventParticipantUsers'
import { savePlacePresets, normalizePlacePresets, resolvePlacePresets, parsePlacePresetsValue, PLACE_PRESET_SETTING_KEY, PLACE_PRESETS_MAX } from '../../lib/placePresets'
import type { PlacePreset } from '../../lib/placePresets'
import {
  TIME_PRESETS_MAX,
  TIME_PRESET_SETTING_KEY,
  addMinutesToTime,
  normalizeTimePresets,
  resolveTimePresets,
  parseTimePresetsValue,
  saveTimePresets,
} from '../../lib/timePresets'
import type { TimePreset } from '../../lib/timePresets'
import { Card } from '../ui'
import { AdminEventDetailSheet } from './AdminEventDetailSheet'
import type { MentionUser } from '../CommentSection'
import { msg } from '../../lib/msg'

// WEEKDAYS / WEEKDAY_LABELS defined inside component now via i18n
// 시간 프리셋(TimePreset, 기본값, load/save 등)은 ../../lib/timePresets 로 이동 (PC 공용)

type EventInput = {
  time: string
  endTime?: string
  title: string
  place: string
  leader: string
  memo: string
  hasMeeting: boolean
  allowApplications: boolean
  mapLink?: string
}

type EventSheetInput = EventInput & {
  date: string
  repeat?: boolean
  repeatEnd?: string
}

type Props = {
  language: AppLanguage
  translatePlaceNames?: boolean
  currentVisitor: string
  currentUserId?: number | null
  role: Role
  events: CalendarEvent[]
  cards?: TerritoryCard[]
  buildings?: Building[]
  visitHistories?: VisitHistory[]
  cardBoundaries?: CardBoundary[]
  leaderNames?: string[]
  mentionUsers?: MentionUser[]
  participantUsers?: EventParticipantUser[]
  onAssignCardsToEventParticipantsBulk?: (
    eventId: number,
    assignments: Array<{ userName: string; cardId?: number | null; cardIds?: number[] | null }>,
    options?: { silentSuccess?: boolean; status?: 'confirmed' | 'shared'; expectedSharedAt?: string | null; onConflict?: (serverSharedAt: string | null) => void },
  ) => Promise<void> | void
  informalAssets?: InformalAsset[]
  informalGroups?: InformalGroup[]
  eventInformalAssignments?: EventInformalAssignment[]
  eventRestaurantAssignments?: EventRestaurantAssignment[]
  onAssignInformalToUser?: (input: { eventId: number; userName: string; assetId: number; assignedBy: string }) => Promise<boolean>
  onRemoveInformalAssignment?: (assignmentId: number) => Promise<void>
  onAssignRestaurantToUser?: (input: { eventId: number; userName: string; buildingId: number; unitId?: number | null; assignedBy: string }) => Promise<boolean>
  onRemoveRestaurantAssignment?: (assignmentId: number) => Promise<void>
  onCreateEvent?: (input: EventInput & { date: string }) => void
  onCreateRepeatEvents?: (dates: string[], input: EventInput) => void
  onDeleteEvent?: (id: number) => void
  onDeleteEventSeries?: (seriesId: string, fromDate: string) => void
  onUpdateEvent?: (id: number, input: EventInput, notify?: boolean) => void | Promise<boolean>
  onUpdateEventSeries?: (seriesId: string, fromDate: string, input: EventInput, notify?: boolean) => void | Promise<boolean>
  onApplyToEvent?: (eventId: number) => void
  onAddParticipantToEvent?: (eventId: number, userName: string, role?: '신청' | '게스트') => boolean | void | Promise<boolean | void>
  onRemoveParticipantFromEvent?: (eventId: number, userName: string) => void
  specialPeriods?: SpecialPeriod[]
  globalSettings?: Record<string, string>
  onUpsertGlobalSetting?: (key: string, value: string) => Promise<boolean>
}

function pad2(n: number) {
  return String(n).padStart(2, '0')
}

function toDateStr(year: number, month: number, day: number) {
  return `${year}-${pad2(month)}-${pad2(day)}`
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


function buildCalendarDays(year: number, month: number): (number | null)[] {
  const firstDow = new Date(year, month - 1, 1).getDay()
  const total = new Date(year, month, 0).getDate()
  const cells: (number | null)[] = []
  for (let i = 0; i < firstDow; i++) cells.push(null)
  for (let d = 1; d <= total; d++) cells.push(d)
  while (cells.length % 7 !== 0) cells.push(null)
  return cells
}

function formatMonthHeader(year: number, month: number, language: AppLanguage) {
  return language === 'zh' ? `${year}年 ${month}月` : `${year}년 ${month}월`
}

// ── 아이콘 ─────────────────────────────
function ChevR({ size = 14, color = 'var(--muted-2)' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <polyline points="9 6 15 12 9 18" />
    </svg>
  )
}
function ChevL({ size = 14, color = 'var(--text)' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <polyline points="15 6 9 12 15 18" />
    </svg>
  )
}
function PlusIcon({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" aria-hidden>
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  )
}

const WEEKDAY_LABELS: Record<AppLanguage, string[]> = {
  ko: ['일', '월', '화', '수', '목', '금', '토'],
  zh: ['日', '一', '二', '三', '四', '五', '六'],
  en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
}

function CalendarEmptyIcon() { return <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>; }

export function AdminMobileCalendar({
  language,
  translatePlaceNames = false,
  events,
  cards = [],
  buildings = [],
  visitHistories = [],
  cardBoundaries = [],
  role,
  currentVisitor,
  currentUserId,
  leaderNames = [],
  mentionUsers = [],
  participantUsers = [],
  onAssignCardsToEventParticipantsBulk,
  informalAssets = [],
  informalGroups = [],
  eventInformalAssignments = [],
  eventRestaurantAssignments = [],
  onAssignInformalToUser,
  onRemoveInformalAssignment,
  onAssignRestaurantToUser,
  onRemoveRestaurantAssignment,
  onCreateEvent,
  onCreateRepeatEvents,
  onDeleteEvent,
  onDeleteEventSeries,
  onUpdateEvent,
  onUpdateEventSeries,
  onApplyToEvent,
  onAddParticipantToEvent,
  onRemoveParticipantFromEvent,
  specialPeriods = [],
  globalSettings = {},
  onUpsertGlobalSetting,
}: Props) {
  const today = useMemo(() => new Date(), [])
  const [year, setYear] = useState(today.getFullYear())
  const [month, setMonth] = useState(today.getMonth() + 1)
  const [selectedDay, setSelectedDay] = useState(today.getDate())
  const [addOpen, setAddOpen] = useState(false)
  const [editingEventId, setEditingEventId] = useState<number | null>(null)
  const [scopeAction, setScopeAction] = useState<
    | { kind: 'edit'; event: CalendarEvent; input: EventInput }
    | { kind: 'delete'; event: CalendarEvent }
    | null
  >(null)
  const [detailEventId, setDetailEventId] = useState<number | null>(null)
  // 배정 에디터(풀스크린) 대상 이벤트
  const [assignEventId, setAssignEventId] = useState<number | null>(null)
  const detailEvent = detailEventId !== null ? events.find((e) => e.id === detailEventId) ?? null : null
  const editingEvent = editingEventId !== null ? events.find((e) => e.id === editingEventId) ?? null : null

  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  // 홈에서 일정을 누르면 /calendar?openEvent=X 로 **넘어와서** 상세를 연다.
  // 그래서 상세만 닫으면 홈이 아니라 캘린더가 남았다.
  // 딥링크로 열린 상세는 닫을 때 한 발짝 더 물러난다.
  const { markDeepLink } = useDeepLinkBack(detailEventId, () => navigate(-1))
  // 알림/딥링크 진입: ?openChat=X → 그 일정 채팅 열기,
  //                  ?openEvent=X → 그 일정 상세 시트 열기
  useEffect(() => {
    const openChatId = searchParams.get('openChat')
    const openEventId = searchParams.get('openEvent')
    if (!openChatId && !openEventId) return

    const targetIdRaw = openChatId ?? openEventId
    const targetId = Number(targetIdRaw)
    if (!Number.isFinite(targetId)) return
    const targetEvent = events.find((e) => e.id === targetId)
    if (!targetEvent) return

    // 해당 일정 날짜로 이동
    const d = new Date(targetEvent.date)
    setYear(d.getFullYear())
    setMonth(d.getMonth() + 1)
    setSelectedDay(d.getDate())

    if (openChatId) {
      window.dispatchEvent(new CustomEvent('app:open-event-chat', {
        detail: {
          eventId: targetEvent.id,
          eventTitle: targetEvent.title,
          eventDate: targetEvent.date,
          eventTime: targetEvent.time,
        },
      }))
    } else if (openEventId) {
      setDetailEventId(targetEvent.id)
      markDeepLink()
    }

    const next = new URLSearchParams(searchParams)
    next.delete('openChat')
    next.delete('openEvent')
    setSearchParams(next, { replace: true })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, events])

  // 풀스크린 오버레이(일정 상세 / 배정 에디터)가 열린 동안 OS·스와이프 뒤로가기를
  // 가로채 "오버레이만 닫기" (홈으로 튕기지 않도록).
  // 상세 → 배정 전환 때는 오버레이가 계속 열린 상태라 더미 히스토리를 그대로 재사용한다.
  // (각각 push/back 하면 서로 경쟁해 배정 화면이 즉시 닫히는 문제가 생김)
  const overlayOpen = detailEventId !== null || assignEventId !== null
  const overlayIdsRef = useRef({ detailEventId, assignEventId })
  overlayIdsRef.current = { detailEventId, assignEventId }
  useEffect(() => {
    if (!overlayOpen) return
    return pushBackHandler(() => {
      // 위에 떠 있는 것부터 닫는다 (배정 에디터 → 일정 상세)
      if (overlayIdsRef.current.assignEventId !== null) setAssignEventId(null)
      else setDetailEventId(null)
    })
  }, [overlayOpen])

  const cells = useMemo(() => buildCalendarDays(year, month), [year, month])
  const selectedDateStr = toDateStr(year, month, selectedDay)
  const monthEvents = useMemo(
    () => events.filter((e) => e.date.startsWith(`${year}-${pad2(month)}`)),
    [events, year, month],
  )
  const monthPeriods = useMemo(() => {
    const monthStart = toDateStr(year, month, 1)
    const monthEnd = toDateStr(year, month, new Date(year, month, 0).getDate())
    return specialPeriods
      .filter((period) => period.startDate <= monthEnd && period.endDate >= monthStart)
      .sort((a, b) => a.startDate.localeCompare(b.startDate))
  }, [month, specialPeriods, year])
  const selectedEvents = useMemo(
    () =>
      events
        .filter((e) => e.date === selectedDateStr)
        .sort((a, b) => a.time.localeCompare(b.time)),
    [events, selectedDateStr],
  )
  const prevMonth = () => {
    if (month === 1) {
      setYear(year - 1)
      setMonth(12)
    } else setMonth(month - 1)
    setSelectedDay(1)
  }
  const nextMonth = () => {
    if (month === 12) {
      setYear(year + 1)
      setMonth(1)
    } else setMonth(month + 1)
    setSelectedDay(1)
  }
  const goToday = () => {
    setYear(today.getFullYear())
    setMonth(today.getMonth() + 1)
    setSelectedDay(today.getDate())
  }

  const selectedDow = new Date(selectedDateStr).getDay()

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, padding: '20px 16px 24px' }}>
      {/* ── 월 카드 ───────────────────── */}
      <Card padding="14px 14px 8px">
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            paddingBottom: 12,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <NavButton onClick={prevMonth}>
              <ChevL />
            </NavButton>
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: 'var(--ink)' }}>
              {formatMonthHeader(year, month, language)}
            </h3>
            <NavButton onClick={nextMonth}>
              <ChevR size={14} color="var(--text)" />
            </NavButton>
          </div>
          <button
            type="button"
            onClick={goToday}
            style={{
              border: 'none',
              background: 'transparent',
              font: 'inherit',
              fontSize: 13,
              fontWeight: 500,
              color: 'var(--muted)',
              padding: '0 10px',
              height: 32,
              minHeight: 32,
              cursor: 'pointer',
            }}
          >
            {msg('오늘')}
          </button>
        </div>
        {monthPeriods.length > 0 && (
          <div className="mobile-calendar-period-row" aria-label={monthPeriods.map((period) => period.label).join(', ')}>
            {monthPeriods.map((period) => (
              <div className="mobile-calendar-period-key" key={period.id}>
                <span className="mobile-calendar-period-dot" style={{ background: period.color }} aria-hidden="true" />
                <strong>{period.label}</strong>
                <span>{period.startDate.slice(5).replace('-', '.')}–{period.endDate.slice(5).replace('-', '.')}</span>
              </div>
            ))}
          </div>
        )}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(7, 1fr)',
            textAlign: 'center',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {weekdayShortLabels[language].map((d) => (
            <div
              key={d}
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: d === '일' ? 'var(--status-danger)' : 'var(--muted)',
                paddingBottom: 8,
              }}
            >
              {d}
            </div>
          ))}
          {cells.map((day, idx) => {
            if (day === null) {
              return <div key={`empty-${idx}`} style={{ height: 40 }} />
            }
            const dayStr = toDateStr(year, month, day)
            const isToday = day === today.getDate() && month === today.getMonth() + 1 && year === today.getFullYear()
            const isSelected = day === selectedDay
            const isSun = idx % 7 === 0
            const hasEvent = monthEvents.some((e) => e.date === dayStr)
            const activePeriod = findActivePeriod(specialPeriods, dayStr)
            return (
              <button
                key={`d-${day}-${idx}`}
                type="button"
                onClick={() => setSelectedDay(day)}
                className="mobile-calendar-day"
                style={{
                  height: 40,
                  position: 'relative',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 3,
                  background: 'transparent',
                  border: 'none',
                  padding: 0,
                  cursor: 'pointer',
                  fontSize: 14,
                  color: isSun ? 'var(--status-danger)' : 'var(--text)',
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                <span
                  style={{
                    width: 28,
                    height: 28,
                    display: 'grid',
                    placeItems: 'center',
                    borderRadius: '50%',
                    background: isToday ? 'var(--ink)' : isSelected ? 'var(--tint)' : 'transparent',
                    color: isToday ? '#fff' : isSun ? 'var(--status-danger)' : 'var(--text)',
                    fontWeight: isToday || isSelected ? 600 : 500,
                  }}
                >
                  {day}
                </span>
                {activePeriod && (
                  <span
                    className="mobile-calendar-period-mark"
                    style={{ background: activePeriod.color }}
                    aria-hidden="true"
                  />
                )}
                {hasEvent && (
                  <span
                    className="mobile-calendar-event-dot"
                    style={{
                      width: 4,
                      height: 4,
                      borderRadius: 99,
                      background: isToday ? 'var(--ink)' : 'var(--muted)',
                    }}
                  />
                )}
              </button>
            )
          })}
        </div>
      </Card>

      {/* ── 그 날 일정 ─────────────────── */}
      <section>
        <SectionHead
          title={
            <>
              {t(language, 'calendar.dateHeader', { month, day: selectedDay, dow: WEEKDAY_LABELS[language][selectedDow] })}
              {selectedEvents.length > 0 && (
                <span style={{ fontWeight: 500, color: 'var(--muted)', fontSize: 13, marginLeft: 6 }}>
                  {selectedEvents.length}
                </span>
              )}
            </>
          }
          right={
            onCreateEvent ? (
              <button
                type="button"
                onClick={() => setAddOpen(true)}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  height: 30,
                  minHeight: 30,
                  padding: '0 10px',
                  border: '1px solid var(--line-2)',
                  background: 'var(--surface)',
                  borderRadius: 8,
                  font: 'inherit',
                  fontSize: 12,
                  fontWeight: 600,
                  color: 'var(--text)',
                  cursor: 'pointer',
                }}
              >
                <PlusIcon /> {t(language, 'calendar.addEvent')}
              </button>
            ) : null
          }
        />
        {selectedEvents.length === 0 ? (
          <div className="cal-selected-empty">
            <CalendarEmptyIcon />
            <p>{t(language, 'calendar.noEvents')}</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
            {selectedEvents.map((event) => (
              <DayEventCard language={language} key={event.id} event={event} role={role} globalSettings={globalSettings} onClick={() => setDetailEventId(event.id)} />
            ))}
          </div>
        )}
      </section>

      {/* ── 일정 추가/편집 시트 ─────────── */}
      {(addOpen || editingEvent) && (
        <EventAddSheet language={language}
          defaultDate={selectedDateStr}
          editingEvent={editingEvent}
          leaderNames={leaderNames}
          globalSettings={globalSettings}
          onUpsertGlobalSetting={onUpsertGlobalSetting}
          onClose={() => {
            setAddOpen(false)
            setEditingEventId(null)
          }}
          onSubmit={(input) => {
            if (editingEvent && onUpdateEvent) {
              const { date: _date, repeat: _repeat, repeatEnd: _repeatEnd, ...editInput } = input
              void _date
              void _repeat
              void _repeatEnd
              if (editingEvent.seriesId && onUpdateEventSeries) {
                setScopeAction({ kind: 'edit', event: editingEvent, input: editInput })
              } else {
                // 알림이 실제로 나갈 변경일 때만 묻는다 (메모만 고치면 안 묻는다)
                void (async () => {
                  const notify = await askNotifyOnEventEdit({
                    before: editingEvent,
                    after: { ...editInput, date: editingEvent.date },
                    recipientCount: countEventNotifyTargets(editingEvent),
                  })
                  onUpdateEvent(editingEvent.id, editInput, notify)
                })()
              }
            } else if (onCreateEvent) {
              const { date: eventDate, repeat, repeatEnd, ...eventInput } = input
              if (repeat) {
                // 반복 켰는데 종료일 없음 → 조용히 단일 생성되던 문제 방지
                if (!repeatEnd) { showToast(msg('반복 종료일을 선택해 주세요'), 'error'); return }
                if (!onCreateRepeatEvents) { showToast(msg('반복 일정 권한이 없습니다'), 'error'); return }
                onCreateRepeatEvents(getWeeklyDates(eventDate, repeatEnd), eventInput)
              } else {
                onCreateEvent(input)
              }
            }
            setAddOpen(false)
            setEditingEventId(null)
          }}
        />
      )}

      {/* ── 일정 상세 시트 ─────────────── */}
      {detailEvent && assignEventId === null && (
        <AdminEventDetailSheet
            buildings={buildings}
            informalAssets={informalAssets}
            eventInformalAssignments={eventInformalAssignments}
            eventRestaurantAssignments={eventRestaurantAssignments}
          language={language}
          translatePlaceNames={translatePlaceNames}
          event={detailEvent}
          cards={cards}
          role={role}
          currentVisitor={currentVisitor}
          currentUserId={currentUserId}
          mentionUsers={mentionUsers}
          participantUsers={participantUsers}
          onAddParticipant={(userName, participantRole) => onAddParticipantToEvent?.(detailEvent.id, userName, participantRole)}
          onRemoveParticipant={(userName) => onRemoveParticipantFromEvent?.(detailEvent.id, userName)}
          onClose={() => {
            // setDetailEventId(null) → 위 useEffect cleanup 이 더미 히스토리 정리
            setDetailEventId(null)
          }}
          onApply={onApplyToEvent ? () => onApplyToEvent(detailEvent.id) : undefined}
          onCancelApply={onApplyToEvent ? () => onApplyToEvent(detailEvent.id) : undefined}
          onOpenAssignment={
            onAssignCardsToEventParticipantsBulk && (role === 'admin' || role === 'developer' || role === 'leader')
              // 상세를 닫지 않는다. 닫아버리면 배정에서 뒤로 갈 때
              // 돌아갈 상세가 없어 캘린더까지 튀어나갔다.
              // (화면에 겹치지 않게 아래 렌더에서 배정 중엔 상세를 감춘다)
              ? () => { setAssignEventId(detailEvent.id) }
              : undefined
          }
          onEdit={
            onUpdateEvent
              ? () => {
                  setEditingEventId(detailEvent.id)
                  setDetailEventId(null)
                }
              : undefined
          }
          onDelete={
            onDeleteEvent
              ? async () => {
                  if (detailEvent.seriesId && onDeleteEventSeries) {
                    setScopeAction({ kind: 'delete', event: detailEvent })
                    setDetailEventId(null)
                  } else if (await confirmDialog({ message: t(language, 'calendar.deleteConfirm'), danger: true, confirmLabel: msg('삭제') })) {
                    onDeleteEvent(detailEvent.id)
                    setDetailEventId(null)
                  }
                }
              : undefined
          }
        />
      )}

      {/* 배정 에디터 (풀스크린) — 인도자/관리자 */}
      {assignEventId !== null && onAssignCardsToEventParticipantsBulk && (() => {
        const assignEvent = events.find((e) => e.id === assignEventId)
        if (!assignEvent) return null
        // 인도자는 본인 담당 카드만, 관리자/개발자는 전체
        const myCards = (role === 'admin' || role === 'developer')
          ? cards
          : cards.filter((c) => c.assignedLeader === currentVisitor || c.assignedLeaders?.includes(currentVisitor))
        const canEdit = role === 'admin' || role === 'developer' || assignEvent.leaders.includes(currentVisitor)
        return (
          <AssignmentEditor
            onAddGuest={onAddParticipantToEvent ? (eventId, name) => onAddParticipantToEvent(eventId, name, '게스트') : undefined}
            event={assignEvent}
            cards={myCards}
            buildings={buildings}
            visitHistories={visitHistories}
            cardBoundaries={cardBoundaries}
            currentVisitor={currentVisitor}
            canEdit={canEdit}
            registeredUsers={participantUsers}
            allCards={cards}
            informalAssets={informalAssets}
            informalGroups={informalGroups}
            eventInformalAssignments={eventInformalAssignments}
            eventRestaurantAssignments={eventRestaurantAssignments}
            onAssignInformalToUser={onAssignInformalToUser}
            onRemoveInformalAssignment={onRemoveInformalAssignment}
            onAssignRestaurantToUser={onAssignRestaurantToUser}
            onRemoveRestaurantAssignment={onRemoveRestaurantAssignment}
            onClose={() => setAssignEventId(null)}
            onShare={(eventId, assignments, opts) =>
              onAssignCardsToEventParticipantsBulk(eventId, assignments, {
                status: 'shared',
                expectedSharedAt: opts.expectedSharedAt,
                onConflict: opts.onConflict,
              })
            }
          />
        )
      })()}

      {scopeAction && (
        <SeriesScopeSheet language={language}
          seriesEvents={events.filter((e) => e.seriesId && e.seriesId === scopeAction.event.seriesId && e.date >= scopeAction.event.date)}
          action={scopeAction}
          onClose={() => setScopeAction(null)}
          onDeleteEvent={onDeleteEvent}
          onDeleteEventSeries={onDeleteEventSeries}
          onUpdateEvent={onUpdateEvent}
          onUpdateEventSeries={onUpdateEventSeries}
        />
      )}
    </div>
  )
}

// ── 섹션 헤더 ──────────────────────────
function SectionHead({ title, right }: { title: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'baseline',
        padding: '0 4px',
      }}
    >
      <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: 'var(--ink)', letterSpacing: '-0.01em' }}>
        {title}
      </h2>
      {right}
    </div>
  )
}

function SeriesScopeSheet({ language,
  seriesEvents,
  action,
  onClose,
  onDeleteEvent,
  onDeleteEventSeries,
  onUpdateEvent,
  onUpdateEventSeries,
}: {
  language: AppLanguage
  seriesEvents: CalendarEvent[]
  action: { kind: 'edit'; event: CalendarEvent; input: EventInput } | { kind: 'delete'; event: CalendarEvent }
  onClose: () => void
  onDeleteEvent?: (id: number) => void
  onDeleteEventSeries?: (seriesId: string, fromDate: string) => void
  onUpdateEvent?: (id: number, input: EventInput, notify?: boolean) => void | Promise<boolean>
  onUpdateEventSeries?: (seriesId: string, fromDate: string, input: EventInput, notify?: boolean) => void | Promise<boolean>
}) {
  const isEdit = action.kind === 'edit'
  const seriesId = action.event.seriesId
  const handleOnly = () => {
    if (isEdit) {
      // 반복 일정의 '이 일정만' 도 알림이 나간다 — 여기서도 묻는다.
      // 저장이 **성공했을 때만** 닫는다. 실패하면 입력이 사라졌었다.
      void (async () => {
        const notify = await askNotifyOnEventEdit({
          before: action.event,
          after: { ...action.input, date: action.event.date },
          recipientCount: countEventNotifyTargets(action.event),
        })
        const ok = await onUpdateEvent?.(action.event.id, action.input, notify)
        if (ok !== false) onClose()
      })()
      return
    }
    onDeleteEvent?.(action.event.id)
    onClose()
  }
  const handleSeries = () => {
    if (!seriesId) return
    if (isEdit) {
      void (async () => {
        const notify = await askNotifyOnEventEdit({
          before: action.event,
          after: { ...action.input, date: action.event.date },
          // 회차마다 신청자가 다르다 — 바뀌는 일정 전부의 합집합을 센다
          recipientCount: countEventNotifyTargetsMany(seriesEvents),
          seriesCount: seriesEvents.length,
          affectedDates: seriesEvents.map((e) => e.date),
        })
        const ok = await onUpdateEventSeries?.(seriesId, action.event.date, action.input, notify)
        if (ok !== false) onClose()
      })()
      return
    }
    onDeleteEventSeries?.(seriesId, action.event.date)
    onClose()
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 260,
        display: 'grid',
        placeItems: 'center',
        padding: 20,
        background: 'rgba(26,26,24,0.34)',
      }}
    >
      <div
        onClick={(event) => event.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: 360,
          padding: 18,
          borderRadius: 18,
          background: 'var(--bg)',
          border: '1px solid var(--line)',
          boxShadow: '0 20px 50px rgba(0,0,0,0.18)',
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 4 }}>
          <strong style={{ color: 'var(--ink)', fontSize: 17, fontWeight: 750 }}>
            {isEdit ? t(language, 'calendar.editRepeatTitle') : t(language, 'calendar.deleteRepeatTitle')}
          </strong>
          <span style={{ color: 'var(--muted)', fontSize: 12.5, lineHeight: 1.35 }}>
            {t(language, 'calendar.repeatScopeDesc')}
          </span>
        </div>

        <ScopeButton
          description={t(language, 'calendar.onlyThisInstance', { date: action.event.date })}
          label={t(language, isEdit ? 'calendar.onlyThisEdit' : 'calendar.onlyThisDelete')}
          onClick={handleOnly}
        />
        <ScopeButton
          danger={!isEdit}
          description={t(language, 'calendar.fromThisInstance', { date: action.event.date })}
          label={t(language, isEdit ? 'calendar.allFutureEdit' : 'calendar.allFutureDelete')}
          onClick={handleSeries}
          primary={isEdit}
        />

        <button
          type="button"
          onClick={onClose}
          style={{
            height: 40,
            minHeight: 40,
            border: 'none',
            borderRadius: 10,
            background: 'transparent',
            color: 'var(--muted)',
            fontSize: 13,
            fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          {t(language, 'common.cancel')}
        </button>
      </div>
    </div>
  )
}

function ScopeButton({
  danger = false,
  description,
  label,
  onClick,
  primary = false,
}: {
  danger?: boolean
  description: string
  label: string
  onClick: () => void
  primary?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        minHeight: 58,
        padding: '12px 14px',
        border: primary ? '1px solid var(--ink)' : danger ? '1px solid var(--status-danger)' : '1px solid var(--line)',
        borderRadius: 12,
        background: primary ? 'var(--ink)' : danger ? 'rgba(220,38,38,0.08)' : 'var(--surface)',
        color: primary ? '#fff' : danger ? 'var(--status-danger)' : 'var(--text)',
        textAlign: 'left',
        cursor: 'pointer',
      }}
    >
      <strong style={{ display: 'block', color: primary ? '#fff' : danger ? 'var(--status-danger)' : 'var(--ink)', fontSize: 14 }}>
        {label}
      </strong>
      <span style={{ display: 'block', marginTop: 3, opacity: 0.72, fontSize: 12 }}>{description}</span>
    </button>
  )
}

function NavButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        width: 32,
        height: 32,
        minHeight: 32,
        display: 'grid',
        placeItems: 'center',
        background: 'transparent',
        border: 'none',
        color: 'var(--text)',
        borderRadius: 8,
        cursor: 'pointer',
      }}
    >
      {children}
    </button>
  )
}

// ── 그 날 일정 카드 ────────────────────
function DayEventCard({ language, event, role, globalSettings, onClick }: { event: CalendarEvent; role: Role; globalSettings: Record<string, string>; onClick?: () => void ; language: AppLanguage }) {
  const meta: string[] = []
  if (event.place) meta.push(event.place)
  if (event.leader) meta.push(event.leader)

  const hideParticipants = globalSettings.hide_participants_from_users === 'true' && role === 'user'
  if (!hideParticipants && event.applicants && event.applicants.length > 0) {

    meta.push(t(language, 'home.appliedLabel') + ` ${event.applicants.length}`)
  }
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'block',
        width: '100%',
        padding: 0,
        border: 'none',
        background: 'transparent',
        cursor: 'pointer',
        textAlign: 'left',
        minHeight: 0,
      }}
    >
    <Card padding={14}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            minWidth: 48,
            flexShrink: 0,
            gap: 2,
          }}
        >
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', fontVariantNumeric: 'tabular-nums' }}>
            {event.time || t(language, 'calendar.timeTbd')}
          </span>
          {event.endTime && (
            <span style={{ fontSize: 12, color: 'var(--muted)', fontVariantNumeric: 'tabular-nums' }}>
              {event.endTime}
            </span>
          )}
        </div>
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink)' }}>{event.title}</span>
            {event.hasMeeting && (
              <span className="cal-badge meeting-badge"
                style={{
                  fontSize: 10.5,
                  padding: '2px 7px',
                  borderRadius: 999,
                  background: 'var(--tint)',
                  color: 'var(--text)',
                  fontWeight: 500,
                }}
              >
                {t(language, 'calendar.meeting')}
              </span>
            )}
          </div>
          {meta.length > 0 && (
            <span style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 500 }}>
              {meta.join(' · ')}
            </span>
          )}
        </div>
        <ChevR />
      </div>
    </Card>
    </button>
  )
}


// ── 일정 추가/편집 바텀 시트 ────────────────
function EventAddSheet({ language,
  defaultDate,
  editingEvent,
  leaderNames,
  globalSettings = {},
  onUpsertGlobalSetting,
  onClose,
  onSubmit,
}: {
  defaultDate: string
  editingEvent?: CalendarEvent | null
  leaderNames: string[]
  globalSettings?: Record<string, string>
  onUpsertGlobalSetting?: (key: string, value: string) => Promise<boolean>
  onClose: () => void
  onSubmit: (input: EventSheetInput) => void
; language: AppLanguage }) {
  const [date, setDate] = useState(editingEvent?.date ?? defaultDate)
  const [time, setTime] = useState(editingEvent?.time ?? '')
  const [endTime, setEndTime] = useState(editingEvent?.endTime ?? '')
  const [title, setTitle] = useState(editingEvent?.title ?? '传道')
  const [memo, setMemo] = useState(editingEvent?.memo ?? '')
  const [place, setPlace] = useState(editingEvent?.place ?? '')
  const [mapLink, setMapLink] = useState(editingEvent?.mapLink ?? '')
  const [leaders, setLeaders] = useState<string[]>(
    editingEvent?.leaders?.length ? editingEvent.leaders : (editingEvent?.leader ? editingEvent.leader.split(',').map((s) => s.trim()).filter(Boolean) : []),
  )
  const toggleLeader = (name: string) => setLeaders((prev) => prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name])
  const leader = leaders.join(', ')
  const [hasMeeting, setHasMeeting] = useState(editingEvent?.hasMeeting ?? false)
  const [allowApplications, setAllowApplications] = useState(editingEvent?.allowApplications ?? true)
  const [repeat, setRepeat] = useState(false)
  const [repeatEnd, setRepeatEnd] = useState('')
  const [timePresets, setTimePresets] = useState<TimePreset[]>(() => resolveTimePresets(globalSettings[TIME_PRESET_SETTING_KEY]))
  const [timeSettingsOpen, setTimeSettingsOpen] = useState(false)
  const [placePresets, setPlacePresets] = useState<PlacePreset[]>(() => resolvePlacePresets(globalSettings[PLACE_PRESET_SETTING_KEY]))
  const [placeSettingsOpen, setPlaceSettingsOpen] = useState(false)
  const timePresetSaveVersionRef = useRef(0)
  const placePresetSaveVersionRef = useRef(0)
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
  const canSubmit = title.trim().length > 0
  const isEditing = !!editingEvent
  const repeatCount = repeat && repeatEnd ? getWeeklyDates(date, repeatEnd).length : 0
  const selectedPreset = timePresets.find((preset) => preset.time === time)?.label ?? ''

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

  const applyPlacePreset = (preset: PlacePreset) => {
    setPlace(preset.name)
    setMapLink(preset.mapLink)
  }

  const applyTimePreset = (preset: TimePreset) => {
    setTime(preset.time)
    setEndTime(addMinutesToTime(preset.time, preset.durationMinutes))
    if (!title.trim() || timePresets.some((item) => item.title === title)) {
      setTitle(preset.title)
    }
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 200,
        background: 'rgba(26,26,24,0.34)',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'flex-end',
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--bg)',
          borderTopLeftRadius: 18,
          borderTopRightRadius: 18,
          width: '100%',
          maxWidth: '100vw',
          boxSizing: 'border-box',
          padding: '8px 12px max(14px, env(safe-area-inset-bottom))',
          boxShadow: '0 -12px 40px rgba(0,0,0,0.18)',
          maxHeight: 'calc(90vh / var(--app-zoom, 1))',
          display: 'flex',
          flexDirection: 'column',
          overflowX: 'hidden',
        }}
      >
        {/* 핸들 */}
        <div style={{ width: 30, height: 4, borderRadius: 99, background: 'var(--line-2)', margin: '4px auto 12px' }} />

        {/* 제목 */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            <span style={{ fontSize: 18, fontWeight: 700, color: 'var(--ink)' }}>{t(language, isEditing ? 'calendar.editEvent' : 'calendar.addEvent')}</span>
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>{date.replace(/-/g, '.')}</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              width: 36,
              height: 36,
              minHeight: 36,
              border: 'none',
              background: 'transparent',
              cursor: 'pointer',
              color: 'var(--text)',
              fontSize: 20,
            }}
          >
            ✕
          </button>
        </div>

        {/* 폼 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, overflowY: 'auto', overflowX: 'hidden', flex: 1, minWidth: 0 }}>
          <Field
            label={
              <>
                {t(language, 'calendar.eventTitle')} <span style={{ color: 'var(--status-danger)' }}>*</span>
              </>
            }
          >
            <TextInput value={title} onChange={setTitle} placeholder={t(language, 'calendar.eventTitle')} />
          </Field>

          <Field
            label={
              <>
                {t(language, 'calendar.eventDesc')} <span style={{ color: 'var(--muted)', fontWeight: 500 }}>({t(language, 'common.optional')})</span>
              </>
            }
          >
            <TextArea value={memo} onChange={setMemo} placeholder={t(language, 'calendar.eventDescPlaceholder')} />
          </Field>

          <Field label={t(language, 'calendar.dateAndTime')}>
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
                padding: 10,
                border: '1px solid var(--line)',
                borderRadius: 12,
                background: 'var(--surface)',
                boxSizing: 'border-box',
                minWidth: 0,
              }}
            >
              <TextInput type="date" value={date} onChange={setDate} subtle />
              {!isEditing && (
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                    padding: '9px 10px',
                    border: '1px solid var(--line)',
                    borderRadius: 10,
                    background: 'var(--bg)',
                    minWidth: 0,
                    boxSizing: 'border-box',
                  }}
                >
                  <SettingToggle
                    checked={repeat}
                    compact
                    description={t(language, 'calendar.repeatDesc')}
                    label={t(language, 'calendar.repeatWeekly')}
                    onChange={setRepeat}
                  />
                  {repeat && (
                    <div style={{ display: 'grid', gridTemplateColumns: 'auto minmax(0, 1fr)', gap: 8, alignItems: 'center', minWidth: 0 }}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', whiteSpace: 'nowrap' }}>{t(language, 'calendar.endDate')}</span>
                      <TextInput type="date" value={repeatEnd} onChange={setRepeatEnd} subtle />
                      {repeatEnd && (
                        <span style={{ gridColumn: '1 / -1', color: 'var(--muted)', fontSize: 11.5, fontWeight: 600 }}>
                          {t(language, 'calendar.repeatCount', { count: repeatCount })}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              )}

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)' }}>{t(language, 'calendar.timePresets')}</span>
                <button
                  type="button"
                  onClick={() => setTimeSettingsOpen((value) => !value)}
                  style={{
                    minHeight: 0,
                    border: 'none',
                    background: 'transparent',
                    color: 'var(--text)',
                    fontSize: 12,
                    fontWeight: 700,
                    padding: '4px 2px',
                    cursor: 'pointer',
                  }}
                >
                  {timeSettingsOpen ? t(language, 'calendar.closeSettings') : t(language, 'calendar.editTimeSettings')}
                </button>
              </div>

              <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 4, scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch', minWidth: 0 }}>
                {timePresets.map((preset) => {
                  const active = selectedPreset === preset.label
                  return (
                    <button
                      key={`${preset.label}-${preset.time}`}
                      type="button"
                      onClick={() => applyTimePreset(preset)}
                      style={{
                        flex: '0 0 auto',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'flex-start',
                        justifyContent: 'center',
                        padding: '8px 12px',
                        background: active ? 'var(--ink)' : 'var(--bg)',
                        color: active ? '#fff' : 'var(--text)',
                        border: active ? '1px solid var(--ink)' : '1px solid var(--line)',
                        borderRadius: 10,
                        cursor: 'pointer',
                        minWidth: 90,
                      }}
                    >
                      <span style={{ fontSize: 12.5, fontWeight: 750, lineHeight: 1.2 }}>{preset.label}</span>
                      <span style={{ marginTop: 2, fontSize: 11, fontWeight: 650, opacity: active ? 0.85 : 0.68 }}>
                        {preset.time} - {addMinutesToTime(preset.time, preset.durationMinutes)}
                      </span>
                    </button>
                  )
                })}
              </div>

              {timeSettingsOpen && (
                <TimePresetEditor language={language} presets={timePresets} onChange={updateTimePresets} />
              )}

              <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto minmax(0, 1fr)', gap: 6, alignItems: 'center', minWidth: 0 }}>
                <TimeBox label={t(language, 'calendar.timeStart')} value={time} onChange={setTime} />
                <span style={{ color: 'var(--muted-2)', fontSize: 13, fontWeight: 700 }}>—</span>
                <TimeBox label={t(language, 'calendar.timeEnd')} value={endTime} onChange={setEndTime} placeholder={t(language, 'common.select')} />
              </div>
            </div>
          </Field>


          <Field label={t(language, 'calendar.location')}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 2 }}>
              <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 4, flex: 1, minWidth: 0, scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch' }}>
                {placePresets.filter(p => p.name.trim()).map((preset, idx) => (
                  <button
                    key={`${idx}-${preset.name}`}
                    type="button"
                    onClick={() => applyPlacePreset(preset)}
                    style={{
                      flex: '0 0 auto',
                      padding: '5px 12px',
                      background: place === preset.name ? 'var(--ink)' : 'var(--tint)',
                      color: place === preset.name ? '#fff' : 'var(--text)',
                      border: place === preset.name ? '1px solid var(--ink)' : '1px solid var(--line-2)',
                      borderRadius: 10,
                      fontSize: 12,
                      fontWeight: 650,
                      cursor: 'pointer',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {preset.name}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => setPlaceSettingsOpen((v) => !v)}
                style={{
                  minHeight: 0,
                  border: 'none',
                  background: 'transparent',
                  color: 'var(--text)',
                  fontSize: 12,
                  fontWeight: 700,
                  padding: '4px 2px',
                  cursor: 'pointer',
                  flexShrink: 0,
                }}
              >
                {placeSettingsOpen ? t(language, 'calendar.closeSettings') : t(language, 'calendar.editPlaceSettings')}
              </button>
            </div>
            
            {placeSettingsOpen && (
              <PlacePresetEditor language={language} presets={placePresets} onChange={updatePlacePresets} />
            )}

            <TextInput value={place} onChange={setPlace} placeholder={t(language, 'calendar.location')} />
            <TextInput value={mapLink} onChange={setMapLink} placeholder={t(language, 'calendar.mapLinkPlaceholder')} type="url" />
          </Field>


          <Field label={t(language, 'calendar.leader')}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {leaderNames.length === 0 && (
                <span style={{ fontSize: 13, color: 'var(--muted)' }}>{t(language, 'common.selectNone')}</span>
              )}
              {leaderNames.map((name) => {
                const on = leaders.includes(name)
                return (
                  <button
                    key={name}
                    type="button"
                    onClick={() => toggleLeader(name)}
                    style={{ minHeight: 0, padding: '8px 14px', borderRadius: 999, fontSize: 13.5, fontWeight: on ? 700 : 500, cursor: 'pointer',
                      border: on ? '1.5px solid var(--ink)' : '1px solid var(--line)',
                      background: on ? 'var(--ink)' : 'var(--surface)', color: on ? '#fff' : 'var(--ink)' }}
                  >
                    {on ? '✓ ' : ''}{name}
                  </button>
                )
              })}
            </div>
          </Field>

          <Field label={t(language, 'calendar.settings')}>
            <SettingToggle
              checked={hasMeeting}
              description={t(language, 'calendar.meetingDesc')}
              label={t(language, 'calendar.meeting')}
              onChange={setHasMeeting}
            />
            <SettingToggle
              checked={allowApplications}
              description={t(language, 'calendar.allowApplicationsDesc')}
              label={t(language, 'calendar.allowApplications')}
              onChange={setAllowApplications}
            />
          </Field>
        </div>

        {/* 저장 */}
        <button
          type="button"
          disabled={!canSubmit}
          onClick={() => onSubmit({ date, time, endTime: endTime || undefined, title: title.trim(), memo: memo.trim(), place: place.trim(), mapLink: mapLink.trim() || undefined, leader, hasMeeting, allowApplications, repeat: !isEditing && repeat, repeatEnd })}
          style={{
            marginTop: 14,
            height: 46,
            width: '100%',
            background: canSubmit ? 'var(--ink)' : 'var(--tint)',
            color: canSubmit ? '#fff' : 'var(--muted-2)',
            border: 'none',
            borderRadius: 8,
            fontSize: 15,
            fontWeight: 600,
            cursor: canSubmit ? 'pointer' : 'not-allowed',
            letterSpacing: '-0.005em',
          }}
        >
          {t(language, 'common.save')}
        </button>
      </div>
    </div>
  )
}

// ── 폼 헬퍼 ─────────────────────────────
function Field({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5, minWidth: 0 }}>
      {label && (
        <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>{label}</label>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 7, minWidth: 0 }}>{children}</div>
    </div>
  )
}

function TextInput({
  value,
  onChange,
  placeholder,
  type = 'text',
  subtle = false,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  type?: string
  subtle?: boolean
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      style={{
        display: 'block',
        background: subtle ? 'var(--bg)' : 'var(--surface)',
        border: subtle ? '1px solid transparent' : '1px solid var(--line)',
        borderRadius: 10,
        padding: '10px 12px',
        fontSize: 14,
        color: 'var(--text)',
        font: 'inherit',
        outline: 'none',
        width: '100%',
        maxWidth: '100%',
        minWidth: 0,
        minHeight: 42,
        boxSizing: 'border-box',
        accentColor: 'var(--ink)',
        // iOS Safari: date/time 인풋이 콘텐츠 폭에 맞춰지지 않는 문제 방지
        WebkitAppearance: type === 'date' || type === 'time' ? 'none' : undefined,
        appearance: type === 'date' || type === 'time' ? 'none' : undefined,
        textAlign: type === 'date' || type === 'time' ? 'left' : undefined,
      }}
    />
  )
}

function TimeBox({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
}) {
  return (
    <label
      style={{
        display: 'grid',
        gridTemplateColumns: 'auto 1fr',
        alignItems: 'center',
        gap: 8,
        minWidth: 0,
        padding: '8px 9px',
        border: '1px solid var(--line)',
        borderRadius: 10,
        background: 'var(--bg)',
        boxSizing: 'border-box',
        minHeight: 40,
      }}
    >
      <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', whiteSpace: 'nowrap' }}>{label}</span>
      <input
        type="time"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        style={{
          minWidth: 0,
          width: '100%',
          border: 'none',
          background: 'transparent',
          color: value ? 'var(--ink)' : 'var(--muted-2)',
          font: 'inherit',
          fontSize: 14,
          fontWeight: 700,
          outline: 'none',
          padding: 0,
          accentColor: 'var(--ink)',
        }}
      />
    </label>
  )
}

export function PlacePresetEditor({ language, 
  presets,
  onChange,
}: {
  presets: PlacePreset[]
  onChange: (presets: PlacePreset[]) => void
; language: AppLanguage }) {
  const updatePreset = (index: number, patch: Partial<PlacePreset>) => {
    onChange(presets.map((preset, i) => i === index ? { ...preset, ...patch } : preset))
  }

  const addPreset = () => {
    if (presets.length >= PLACE_PRESETS_MAX) return
    onChange([
      ...presets,
      {
        name: t(language, 'calendar.placePresetLabel', { count: presets.length + 1 }),
        mapLink: '',
      },
    ])
  }

  const removePreset = (index: number) => {
    onChange(presets.filter((_, i) => i !== index))
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        padding: 8,
        border: '1px solid var(--line)',
        borderRadius: 12,
        background: 'var(--bg)',
        minWidth: 0,
        boxSizing: 'border-box',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 750, color: 'var(--ink)' }}>{t(language, 'calendar.editPlaceSettings')}</span>
        <button
          type="button"
          disabled={presets.length >= PLACE_PRESETS_MAX}
          onClick={addPreset}
          style={{
            minHeight: 0,
            border: '1px solid var(--line)',
            borderRadius: 8,
            background: presets.length >= PLACE_PRESETS_MAX ? 'var(--surface)' : '#fff',
            color: presets.length >= PLACE_PRESETS_MAX ? 'var(--muted-2)' : 'var(--text)',
            cursor: presets.length >= PLACE_PRESETS_MAX ? 'not-allowed' : 'pointer',
            fontSize: 12,
            fontWeight: 750,
            padding: '6px 9px',
          }}
        >
          {t(language, 'common.add')}
        </button>
      </div>

      {presets.map((preset, index) => (
        <div
          key={index}
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 5,
            minWidth: 0,
          }}
        >
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(0, 1fr) 24px',
              gap: 5,
              alignItems: 'center',
              minWidth: 0,
            }}
          >
            <MiniInput
              ariaLabel={t(language, 'calendar.location')}
              value={preset.name}
              onChange={(value) => updatePreset(index, { name: value })}
              placeholder={t(language, 'calendar.location')}
            />
            <button
              type="button"
              
              onClick={() => removePreset(index)}
              style={{
                width: 24,
                height: 24,
                minHeight: 24,
                border: 'none',
                borderRadius: 6,
                background: 'transparent',
                color: 'var(--status-danger)',
                cursor: 'pointer',
                fontSize: 16,
                lineHeight: 1,
                padding: 0,
                display: 'grid',
                placeItems: 'center',
              }}
              aria-label={t(language, 'common.delete')}
            >
              ×
            </button>
          </div>
          <MiniInput
            ariaLabel={t(language, 'calendar.mapLinkPlaceholder')}
            value={preset.mapLink}
            onChange={(value) => updatePreset(index, { mapLink: value })}
            placeholder={t(language, 'calendar.mapLinkPlaceholder')}
            type="url"
          />
        </div>
      ))}
    </div>
  )
}


export function TimePresetEditor({ language, 
  presets,
  onChange,
}: {
  presets: TimePreset[]
  onChange: (presets: TimePreset[]) => void
; language: AppLanguage }) {
  const updatePreset = (index: number, patch: Partial<TimePreset>) => {
    onChange(presets.map((preset, i) => i === index ? { ...preset, ...patch } : preset))
  }

  const addPreset = () => {
    if (presets.length >= TIME_PRESETS_MAX) return
    const baseHour = 10 + presets.length * 2
    const time = `${pad2(Math.min(baseHour, 21))}:00`
    onChange([
      ...presets,
      {
        label: t(language, 'calendar.timePresetLabel', { count: presets.length + 1 }),
        time,
        durationMinutes: 120,
        title: t(language, 'calendar.defaultEventTitle'),
      },
    ])
  }

  const removePreset = (index: number) => {
    if (presets.length <= 1) return
    onChange(presets.filter((_, i) => i !== index))
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        padding: 8,
        border: '1px solid var(--line)',
        borderRadius: 12,
        background: 'var(--bg)',
        minWidth: 0,
        boxSizing: 'border-box',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 750, color: 'var(--ink)' }}>{t(language, 'calendar.editTimeSettings')}</span>
        <button
          type="button"
          disabled={presets.length >= TIME_PRESETS_MAX}
          onClick={addPreset}
          style={{
            minHeight: 0,
            border: '1px solid var(--line)',
            borderRadius: 8,
            background: presets.length >= TIME_PRESETS_MAX ? 'var(--surface)' : '#fff',
            color: presets.length >= TIME_PRESETS_MAX ? 'var(--muted-2)' : 'var(--text)',
            cursor: presets.length >= TIME_PRESETS_MAX ? 'not-allowed' : 'pointer',
            fontSize: 12,
            fontWeight: 750,
            padding: '6px 9px',
          }}
        >
          {t(language, 'common.add')}
        </button>
      </div>

      {presets.map((preset, index) => (
        <div
          key={index}
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 5,
            minWidth: 0,
          }}
        >
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(0, 1.1fr) minmax(0, 1fr) minmax(0, 0.7fr) 24px',
              gap: 5,
              alignItems: 'center',
              minWidth: 0,
            }}
          >
            <MiniInput
              ariaLabel={t(language, 'calendar.timePresetLabelField')}
              value={preset.label}
              onChange={(value) => updatePreset(index, { label: value })}
              placeholder={t(language, 'calendar.label')}
            />
            <MiniInput
              ariaLabel={t(language, 'calendar.startTime')}
              type="time"
              value={preset.time}
              onChange={(value) => updatePreset(index, { time: value })}
            />
            <MiniInput
              ariaLabel={t(language, 'calendar.duration')}
              type="number"
              value={String(preset.durationMinutes)}
              onChange={(value) => updatePreset(index, { durationMinutes: Number(value) || 120 })}
              suffix={t(language, 'common.minutes')}
            />
            <button
              type="button"
              disabled={presets.length <= 1}
              onClick={() => removePreset(index)}
              style={{
                width: 24,
                height: 24,
                minHeight: 24,
                border: 'none',
                borderRadius: 6,
                background: 'transparent',
                color: presets.length <= 1 ? 'var(--muted-2)' : 'var(--status-danger)',
                cursor: presets.length <= 1 ? 'not-allowed' : 'pointer',
                fontSize: 16,
                lineHeight: 1,
                padding: 0,
                display: 'grid',
                placeItems: 'center',
              }}
              aria-label={t(language, 'common.delete')}
            >
              ×
            </button>
          </div>
          <MiniInput
            ariaLabel={t(language, 'calendar.defaultTitle')}
            value={preset.title}
            onChange={(value) => updatePreset(index, { title: value })}
            placeholder={msg('기본 제목')}
          />
        </div>
      ))}

      <p style={{ margin: 0, color: 'var(--muted)', fontSize: 11.5, lineHeight: 1.35 }}>
        {msg('시간을 누르면 종료시간은 소요시간만큼 자동 입력됩니다. 기본 소요시간은 120분입니다.')}
      </p>
    </div>
  )
}

function MiniInput({
  ariaLabel,
  onChange,
  placeholder,
  suffix,
  type = 'text',
  value,
}: {
  ariaLabel: string
  onChange: (value: string) => void
  placeholder?: string
  suffix?: string
  type?: string
  value: string
}) {
  return (
    <label
      style={{
        display: 'flex',
        alignItems: 'center',
        minWidth: 0,
        height: 32,
        border: '1px solid var(--line)',
        borderRadius: 8,
        background: '#fff',
        padding: '0 7px',
        boxSizing: 'border-box',
      }}
    >
      <input
        aria-label={ariaLabel}
        type={type}
        min={type === 'number' ? 15 : undefined}
        max={type === 'number' ? 480 : undefined}
        step={type === 'number' ? 15 : undefined}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        style={{
          display: 'block',
          minWidth: 0,
          width: '100%',
          maxWidth: '100%',
          border: 'none',
          background: 'transparent',
          color: 'var(--ink)',
          font: 'inherit',
          fontSize: 11.5,
          fontWeight: 650,
          outline: 'none',
          padding: 0,
          boxSizing: 'border-box',
          accentColor: 'var(--ink)',
          WebkitAppearance: type === 'time' ? 'none' : undefined,
          appearance: type === 'time' ? 'none' : undefined,
        }}
      />
      {suffix && <span style={{ flex: '0 0 auto', color: 'var(--muted)', fontSize: 11, fontWeight: 700 }}>{suffix}</span>}
    </label>
  )
}

function TextArea({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      rows={3}
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--line)',
        borderRadius: 10,
        padding: '12px 14px',
        fontSize: 14,
        color: 'var(--text)',
        font: 'inherit',
        outline: 'none',
        width: '100%',
        resize: 'vertical',
        minHeight: 64,
      }}
    />
  )
}

function SettingToggle({
  checked,
  compact = false,
  description,
  label,
  onChange,
}: {
  checked: boolean
  compact?: boolean
  description: string
  label: string
  onChange: (v: boolean) => void
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        width: '100%',
        minHeight: compact ? 0 : 58,
        padding: compact ? '2px 0' : '11px 12px',
        border: compact ? 'none' : '1px solid var(--line)',
        borderRadius: compact ? 0 : 12,
        background: compact ? 'transparent' : 'var(--surface)',
        color: 'var(--text)',
        textAlign: 'left',
        cursor: 'pointer',
      }}
    >
      <span style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
        <strong style={{ fontSize: compact ? 13 : 14, fontWeight: 600, color: 'var(--ink)', letterSpacing: '-0.005em' }}>{label}</strong>
        <small style={{ fontSize: compact ? 11.5 : 12, fontWeight: 500, color: 'var(--muted)', lineHeight: 1.3 }}>{description}</small>
      </span>
      <span
        aria-hidden
        style={{
          position: 'relative',
          flex: '0 0 auto',
          width: 42,
          height: 24,
          borderRadius: 999,
          background: checked ? 'var(--ink)' : 'var(--line-2)',
          transition: 'background 0.15s ease',
        }}
      >
        <span
          style={{
            position: 'absolute',
            top: 3,
            left: checked ? 21 : 3,
            width: 18,
            height: 18,
            borderRadius: '50%',
            background: '#fff',
            boxShadow: '0 1px 3px rgba(0,0,0,0.14)',
            transition: 'left 0.15s ease',
          }}
        />
      </span>
    </button>
  )
}
