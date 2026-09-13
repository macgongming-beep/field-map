import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import type { CalendarEvent, Notice, ReturnVisit, ReturnVisitLog, Role, ServiceSession, SpecialPeriod, TerritoryCard, TimeSlot } from '../types'
import type { AppLanguage } from '../i18n'
import { SpecialPeriodBanner } from './SpecialPeriodBanner'
import { AdminMobileHome } from './admin/AdminMobileHome'
import { UserMobileHome } from './UserMobileHome'

export function DesktopHome({
  language,
  calendarEvents,
  cards,
  currentVisitor,
  role,
  specialPeriods,
  notices: _notices = [],
  onOpenSettings,
  // Other required props by DesktopApp are ignored since we no longer use them
  serviceSessions: _ss,
  returnVisits: _rv,
  returnVisitLogs: _rvl,
  onApplyToEvent: _oate,
  onStartServiceSession: _osss,
  onEndServiceSession: _oess,
  onOpenTerritory: _oot,
  globalSettings = {},
}: {
  language: AppLanguage
  calendarEvents: CalendarEvent[]
  cards: TerritoryCard[]
  currentVisitor: string
  role: Role
  serviceSessions: ServiceSession[]
  returnVisits?: ReturnVisit[]
  returnVisitLogs?: ReturnVisitLog[]
  onApplyToEvent: (eventId: number) => void
  onStartServiceSession: (input: {
    timeSlot: TimeSlot
    primaryCardId?: number | null
    calendarEventId?: number | null
    assignedCardId?: number | null
    assignmentId?: number | null
    source?: ServiceSession['source']
    memo?: string
  }) => Promise<number | null>
  onEndServiceSession: (sessionId: number) => void
  onOpenTerritory: () => void
  specialPeriods?: SpecialPeriod[]
  notices?: Notice[]
  onOpenSettings?: () => void
  globalSettings?: Record<string, string>
}) {
  const navigate = useNavigate()
  
  const today = useMemo(() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }, [])

  const todayEvents = useMemo(() =>
    calendarEvents.filter((e) => e.date === today).sort((a, b) => a.time.localeCompare(b.time)),
    [calendarEvents, today])

  const myTodayEvents = useMemo(() => {
    return todayEvents.map((event) => {
      const isLeader = event.leaders.includes(currentVisitor)
      const isApplicant = event.applicants.includes(currentVisitor)
      const isCartApplicant = event.cartApplicants?.some((applicant) => applicant.name === currentVisitor) ?? false
      const isAssigned = event.cardAssignments.some((a) => a.userName === currentVisitor)
        || (event.assigned ?? []).includes(currentVisitor)
      const kind: 'lead' | 'join' | 'avail' = isLeader
        ? 'lead'
        : (isApplicant || isCartApplicant || isAssigned) ? 'join' : 'avail'
      return { event, kind }
    })
  }, [todayEvents, currentVisitor])

  const leaderCards = useMemo(() => cards.filter((c) => c.assignedLeader === currentVisitor), [cards, currentVisitor])
  const inProgressCards = useMemo(() => cards.filter((c) => c.status === '진행중'), [cards])
  const totalUnits = useMemo(() => cards.reduce((sum, card) => sum + card.units, 0), [cards])
  const completedUnits = useMemo(() => cards.reduce((sum, card) => sum + card.completed, 0), [cards])

  return (
    <section className="la-page">
      <div style={{ margin: '0 auto', maxWidth: 640, width: '100%', paddingBottom: 40, paddingTop: 16 }}>

        {specialPeriods && specialPeriods.length > 0 && (
          <div style={{ padding: '0 16px', marginBottom: '16px' }}>
            <SpecialPeriodBanner specialPeriods={specialPeriods} variant="compact" onClick={onOpenSettings} />
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
      </div>
    </section>
  )
}
