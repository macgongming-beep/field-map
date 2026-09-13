import { t } from '../i18n'
import type { AppLanguage } from '../i18n'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Building, CalendarEvent, EventInformalAssignment, EventRestaurantAssignment, InformalAsset, ReturnVisit, ReturnVisitLog, Role, ServiceSession, TerritoryCard, TimeSlot } from '../types'
import { getAssignmentTeamMembers } from '../utils/assignmentTeamMembers'
import { getUserReturnVisits } from '../utils/returnVisits'
import { msg } from '../lib/msg'

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

function formatToday() {
  const date = new Date()
  const dayLabels = ['일', '월', '화', '수', '목', '금', '토']
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}.${pad(date.getMonth() + 1)}.${pad(date.getDate())} (${dayLabels[date.getDay()]})`
}

function formatDateLabel(value?: string | null) {
  if (!value) return '기록 없음'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '기록 없음'
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(date.getMonth() + 1)}/${pad(date.getDate())}`
}

// '봉사 중' 은 뺐다 — 진행 상태만 말한다 (사용자 요청)
function statusLabel(card: TerritoryCard) {
  if (card.progress >= 100) return '완료'
  if (card.progress > 0) return '진행중'
  return '방문필요'
}

function statusClass(label: string) {
  if (label === '진행중') return 'progress'
  if (label === '완료') return 'done'
  return 'need'
}

export function DesktopMyService({
  language,
  buildings,
  calendarEvents,
  cards,
  currentVisitor,
  role,
  serviceSessions,
  informalAssets = [],
  eventInformalAssignments = [],
  eventRestaurantAssignments = [],
  returnVisits = [],
  returnVisitLogs = [],
  onOpenMap,
  onOpenInformalMap,
  onOpenBuildingMap,
  onEndServiceSession: _onEndServiceSession,  // 종료 버튼 제거 — auto_close가 처리. 후방호환 유지.
  onAddReturnVisitLog,
}: {
  language: AppLanguage
  buildings: Building[]
  calendarEvents: CalendarEvent[]
  cards: TerritoryCard[]
  currentVisitor: string
  role: Role
  serviceSessions: ServiceSession[]
  informalAssets?: InformalAsset[]
  eventInformalAssignments?: EventInformalAssignment[]
  eventRestaurantAssignments?: EventRestaurantAssignment[]
  returnVisits?: ReturnVisit[]
  returnVisitLogs?: ReturnVisitLog[]
  onOpenMap: (cardId: number) => void
  onOpenInformalMap?: (assetId: number) => void
  onOpenBuildingMap?: (buildingId: number) => void
  onEndServiceSession: (sessionId: number) => void
  onAddReturnVisitLog?: (returnVisitId: number, result: '만남' | '부재' | null, memo: string) => Promise<void>
}) {
  const [expandedEventIds, setExpandedEventIds] = useState<Set<number>>(new Set())
  const [regularLogTarget, setRegularLogTarget] = useState<ReturnVisit | null>(null)
  const [regularLogResult, setRegularLogResult] = useState<'만남' | '부재' | null>(null)
  const [regularLogMemo, setRegularLogMemo] = useState('')
  const [regularLogSaving, setRegularLogSaving] = useState(false)

  const today = useMemo(() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }, [])

  const myTodayAssignments = useMemo(() => {
    const todayEvents = calendarEvents.filter((event) => event.date === today)
    return todayEvents
      .map((event) => {
        const assignment = event.cardAssignments.find((item) => item.userName === currentVisitor)
        const cartApplication = event.cartApplicants?.find((item) => item.name === currentVisitor)
        const isParticipant =
          !!assignment ||
          !!cartApplication ||
          event.applicants.includes(currentVisitor) ||
          event.assigned.includes(currentVisitor) ||
          event.leaders.includes(currentVisitor)
        if (!isParticipant) return null

        const assignedCards = assignmentCardIds(assignment)
          .map((id) => cards.find((card) => card.id === id))
          .filter(Boolean) as TerritoryCard[]
        const teammates = getAssignmentTeamMembers(event, currentVisitor)

        return { event, cards: assignedCards, teammates, cartApplication }
      })
      .filter(Boolean) as Array<{
        event: CalendarEvent
        cards: TerritoryCard[]
        teammates: string[]
        cartApplication?: NonNullable<CalendarEvent['cartApplicants']>[number]
      }>
  }, [calendarEvents, cards, currentVisitor, today])

  const currentSlot = getCurrentTimeSlot()
  // 초기 펴기: 현재 시간대 일정 자동 오픈
  useEffect(() => {
    if (expandedEventIds.size > 0 || myTodayAssignments.length === 0) return
    const currentEvent = myTodayAssignments.find(({ event }) => getTimeSlotFromTime(event.time) === currentSlot)
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 현재 시간대 일정 자동 펼침(의도적)
    if (currentEvent) setExpandedEventIds(new Set([currentEvent.event.id]))
  }, [currentSlot, expandedEventIds.size, myTodayAssignments])

  // 시간대 변경 시 자동 펴기·접기 (1분 인터벌)
  const lastSlotRef = useRef<string>(getCurrentTimeSlot())
  useEffect(() => {
    const syncByTimeSlot = () => {
      const slot = getCurrentTimeSlot()
      if (slot === lastSlotRef.current) return
      const prevSlot = lastSlotRef.current
      lastSlotRef.current = slot
      const newSlotEvent = myTodayAssignments.find(({ event }) => getTimeSlotFromTime(event.time) === slot)
      const prevSlotEventIds = myTodayAssignments
        .filter(({ event }) => getTimeSlotFromTime(event.time) === prevSlot)
        .map(({ event }) => event.id)
      setExpandedEventIds((prev) => {
        const next = new Set(prev)
        prevSlotEventIds.forEach((id) => next.delete(id))
        if (newSlotEvent) next.add(newSlotEvent.event.id)
        return next
      })
    }
    const interval = window.setInterval(syncByTimeSlot, 60_000)
    const onVisible = () => { if (!document.hidden) syncByTimeSlot() }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [myTodayAssignments])

  const myTodaySessions = useMemo(
    () => serviceSessions
      .filter((session) => session.userName === currentVisitor && session.serviceDate === today)
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt)),
    [currentVisitor, serviceSessions, today],
  )
  const activeSessionCardIds = useMemo(
    () => new Set(myTodaySessions.filter((session) => session.status === 'active' && !session.endedAt && session.primaryCardId).map((session) => session.primaryCardId as number)),
    [myTodaySessions],
  )

  const myCards = useMemo(() => {
    const assigned = role === 'leader'
      ? cards.filter((card) => card.assignedLeader === currentVisitor || card.assignedLeaders?.includes(currentVisitor))
      : cards.filter((card) => card.assignedUsers.includes(currentVisitor))
    const assignedIds = new Set(assigned.map((card) => card.id))
    const fromSession = cards.filter((card) => activeSessionCardIds.has(card.id) && !assignedIds.has(card.id))
    return [...assigned, ...fromSession]
  }, [activeSessionCardIds, cards, currentVisitor, role])

  const myReturnVisits = useMemo(() =>
    getUserReturnVisits(returnVisits, currentVisitor),
    [currentVisitor, returnVisits],
  )
  const showReturnVisits = localStorage.getItem('feat_returnVisit') === '1'

  const regularVisitPreview = myReturnVisits.slice(0, 6)
  const hasMoreRegularVisits = myReturnVisits.length > regularVisitPreview.length

  const saveRegularLog = async () => {
    if (!regularLogTarget || (!regularLogResult && !regularLogMemo.trim()) || !onAddReturnVisitLog) return
    setRegularLogSaving(true)
    await onAddReturnVisitLog(regularLogTarget.id, regularLogResult, regularLogMemo)
    setRegularLogSaving(false)
    setRegularLogResult(null)
    setRegularLogMemo('')
  }

  return (
    <section className="desktop-my-service-page">
      <header className="page-header">
        <div className="page-header-text">
          <h1 className="page-header-title">{t(language, 'territory.title')}</h1>
          <p className="page-header-subtitle">{formatToday()} · 오늘 배정 확인과 봉사 실행</p>
        </div>
      </header>

      <div className="dms-layout">
        <main className="dms-main">
          <section className="desk-card dms-section">
            <div className="desk-card__head">
              <h2 className="desk-card__title"><span className="desk-card__title-dot" />{t(language, 'home.todayService')}</h2>
              <span className="dms-count-pill">{myTodayAssignments.length}개 일정</span>
            </div>

            {myTodayAssignments.length === 0 ? (
              <div className="dms-empty">오늘 참여하는 봉사 일정이 없습니다.</div>
            ) : (
              <div className="dms-today-list">
                {myTodayAssignments.map(({ event, cards: assignedCards, teammates, cartApplication }) => {
                  const isOpen = expandedEventIds.has(event.id)
                  const myInformal = eventInformalAssignments.filter(
                    (assignment) => assignment.eventId === event.id && assignment.userName === currentVisitor,
                  )
                  const myRestaurants = eventRestaurantAssignments.filter(
                    (assignment) => assignment.eventId === event.id && assignment.userName === currentVisitor,
                  )
                  const totalAssignments = assignedCards.length + myInformal.length + myRestaurants.length
                  return (
                    <article className={`dms-today-card${isOpen ? ' open' : ''}`} key={event.id}>
                      <button
                        className="dms-today-toggle"
                        onClick={() => {
                          setExpandedEventIds((prev) => {
                            const next = new Set(prev)
                            if (next.has(event.id)) next.delete(event.id)
                            else next.add(event.id)
                            return next
                          })
                        }}
                        type="button"
                      >
                        <span>{isOpen ? '⌄' : '›'}</span>
                        <div>
                          <strong>{event.time} {event.title}</strong>
                          {/* 인도자는 생략 — 같이 도는 팀원 이름만 보이면 충분하다 */}
                          {cartApplication
                            ? <small>{t(language, 'calendar.cartService')}{cartApplication.isTeamLead ? ` · ${t(language, 'calendar.cartTeamLead')}` : ''}</small>
                            : teammates.length > 0 && <small>팀원 {teammates.join(', ')}</small>}
                        </div>
                        <b>{t(language, 'territory.assignmentCount', { count: totalAssignments })}</b>
                      </button>

                      {isOpen && (
                        <div className="dms-assigned-card-list">
                          {totalAssignments === 0 ? (
                            <div className="dms-empty compact">
                              {cartApplication ? t(language, 'calendar.cartService') : t(language, 'territory.noAssignedPlaces')}
                            </div>
                          ) : (
                            <>
                              {assignedCards.map((card) => (
                              <div className="dms-assigned-card" key={card.id}>
                                <div>
                                  <strong>
                                    {card.name}
                                  </strong>
                                  <span>{card.area} · {card.units}세대</span>
                                </div>
                                <em>{card.progress}%</em>
                                <button onClick={() => onOpenMap(card.id)} type="button">지도</button>
                              </div>
                              ))}
                              {myInformal.map((assignment) => {
                                const asset = informalAssets.find((item) => item.id === assignment.assetId)
                                if (!asset) return null
                                return (
                                  <div className="dms-assigned-card dms-assigned-card--informal" key={`informal-${assignment.id}`}>
                                    <div>
                                      <strong>{asset.name}</strong>
                                      <span>{asset.memo || t(language, 'territory.informalMaterial')}</span>
                                    </div>
                                    <em>{msg('비공식')}</em>
                                    {onOpenInformalMap ? (
                                      <button onClick={() => onOpenInformalMap(asset.id)} type="button">{msg('구역 보기')}</button>
                                    ) : asset.imageUrl ? (
                                      <button onClick={() => window.open(asset.imageUrl, '_blank', 'noopener,noreferrer')} type="button">{msg('자료 보기')}</button>
                                    ) : <span />}
                                  </div>
                                )
                              })}
                              {myRestaurants.map((assignment) => {
                                const building = buildings.find((item) => item.id === assignment.buildingId)
                                if (!building) return null
                                const unit = assignment.unitId != null
                                  ? building.units.find((item) => item.id === assignment.unitId)
                                  : null
                                const restaurantName = unit?.number || building.name || building.address
                                return (
                                  <div className="dms-assigned-card dms-assigned-card--restaurant" key={`restaurant-${assignment.id}`}>
                                    <div>
                                      <strong>{restaurantName}</strong>
                                      <span>{unit ? (building.name || building.address) : building.address}</span>
                                    </div>
                                    <em>{msg('식당')}</em>
                                    <button
                                      onClick={() => {
                                        if (building.lat && building.lng) {
                                          const destination = encodeURIComponent(building.name || building.address)
                                          window.open(`https://map.naver.com/p/search/${destination}`, '_blank', 'noopener,noreferrer')
                                        } else {
                                          onOpenBuildingMap?.(building.id)
                                        }
                                      }}
                                      type="button"
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

        </main>

        <aside className="dms-side">
          {/* 활성 세션 카드 제거 — 자동 종료 + 오늘의 봉사 안 "봉사 중" 배지로 대체 */}

          <section className="desk-card dms-section">
            <div className="desk-card__head">
              <h2 className="desk-card__title"><span className="desk-card__title-dot" />내 카드</h2>
              <span className="dms-count-pill">{myCards.length}개</span>
            </div>
            {myCards.length === 0 ? (
              <div className="dms-empty compact">배정된 카드가 없습니다.</div>
            ) : (
              <div className="dms-my-card-list">
                {myCards.map((card) => {
                    const label = statusLabel(card)
                  return (
                    <button key={card.id} onClick={() => onOpenMap(card.id)} type="button">
                      <div>
                        <strong>{card.name}</strong>
                        <span>{card.area} · {card.units}세대</span>
                      </div>
                      <em className={`status-${statusClass(label)}`}>{label}</em>
                    </button>
                  )
                })}
              </div>
            )}
          </section>

          {showReturnVisits && <section className="desk-card dms-section">
            <div className="desk-card__head">
              <h2 className="desk-card__title"><span className="desk-card__title-dot" />정기 방문</h2>
              <span className="dms-count-pill">{myReturnVisits.length}건</span>
            </div>
            {myReturnVisits.length === 0 ? (
              <div className="dms-regular-empty">
                <strong>등록된 정기 방문이 없습니다.</strong>
                <span>지도에서 세대 정기방문을 체크하면 여기에 나타납니다.</span>
              </div>
            ) : (
              <div className="dms-regular-list">
                {regularVisitPreview.map((rv) => {
                  const linkedBuilding = buildings.find((building) => building.id === rv.buildingId)
                  const logs = returnVisitLogs.filter((log) => log.returnVisitId === rv.id)
                  return (
                    <article className="dms-regular-item" key={rv.id}>
                      <div>
                        <strong>{rv.nickname || rv.displayName}</strong>
                        <span>{rv.address || linkedBuilding?.address || '주소 없음'}</span>
                        <small>최근 {formatDateLabel(rv.lastVisitedAt)}{rv.lastResult ? ` · ${rv.lastResult}` : ''} · 기록 {logs.length}개</small>
                      </div>
                      <div>
                        <button onClick={() => setRegularLogTarget(rv)} type="button">바로 기록</button>
                        {linkedBuilding && <button onClick={() => onOpenMap(linkedBuilding.cardId)} type="button">지도</button>}
                      </div>
                    </article>
                  )
                })}
                {hasMoreRegularVisits && <p className="dms-more-note">외 {myReturnVisits.length - regularVisitPreview.length}건 더 있습니다.</p>}
              </div>
            )}
          </section>}
        </aside>
      </div>

      {regularLogTarget && (
        <div className="dms-modal-backdrop" onClick={() => setRegularLogTarget(null)}>
          <div className="dms-log-modal" onClick={(event) => event.stopPropagation()}>
            <header>
              <div>
                <strong>{regularLogTarget.nickname || regularLogTarget.displayName}</strong>
                <span>{regularLogTarget.address}</span>
              </div>
              <button onClick={() => setRegularLogTarget(null)} type="button">×</button>
            </header>
            <div className="dms-log-history">
              {returnVisitLogs.filter((log) => log.returnVisitId === regularLogTarget.id).slice(0, 8).map((log) => (
                <p key={log.id}>
                  <span>{formatDateLabel(log.visitedAt)}</span>
                  <b>{log.result ?? '메모'}</b>
                  {log.memo && <em>{log.memo}</em>}
                </p>
              ))}
            </div>
            <div className="dms-log-result">
              <button className={regularLogResult === '만남' ? 'active meet' : ''} onClick={() => setRegularLogResult(regularLogResult === '만남' ? null : '만남')} type="button">만남</button>
              <button className={regularLogResult === '부재' ? 'active absent' : ''} onClick={() => setRegularLogResult(regularLogResult === '부재' ? null : '부재')} type="button">부재</button>
            </div>
            <textarea
              placeholder="메모 (선택)"
              rows={3}
              value={regularLogMemo}
              onChange={(event) => setRegularLogMemo(event.target.value)}
            />
            <footer>
              <button onClick={() => setRegularLogTarget(null)} type="button">취소</button>
              <button disabled={regularLogSaving || (!regularLogResult && !regularLogMemo.trim())} onClick={saveRegularLog} type="button">
                {regularLogSaving ? '저장 중...' : '저장'}
              </button>
            </footer>
          </div>
        </div>
      )}
    </section>
  )
}
