import { useNavigate } from 'react-router-dom'
import type { TerritoryCard, CalendarEvent, Role } from '../types'
import type { AppLanguage } from '../i18n'
import { t, formatPeriod, formatLeadSub, formatLeaderOf, formatApplied } from '../i18n'

import { compareTerritoryCardsByOperationalPriority } from '../utils/cardSearch'
import { ServiceSuggestionsSection } from './ServiceSuggestionsSection'
import { MeetingHome } from '../features/meetingNotes/MeetingHome'

export function UserMobileHome({
  language,
  myTodayEvents,
  leaderCards,
  role,
  onOpenEventDetail,
  onOpenZone,
  globalSettings = {},
}: {
  language: AppLanguage
  myTodayEvents: Array<{ event: CalendarEvent; kind: 'lead' | 'join' | 'avail' }>
  leaderCards: TerritoryCard[]
  role: Role
  onOpenEventDetail: (eventId: number) => void
  onOpenZone: () => void
  globalSettings?: Record<string, string>
}) {
  const navigate = useNavigate()


  return (
    <div className="mh-page">
      <MeetingHome language={language} position="top" />

      {/* ─── 오늘 봉사 — 디자인 24/25 ─── */}
      <section className="mobile-home-section">
        <div className="mh-sec-head">
          <h2>
            {t(language, 'home.todayService')}
            {myTodayEvents.length > 0 && <span className="mh-cnt">{myTodayEvents.length}</span>}
          </h2>
        </div>
        {myTodayEvents.length === 0 ? (
          <div className="mh-empty-line">
            <span>{t(language, 'home.noTodayServiceShort')}</span>
          </div>
        ) : (
          <div className="mh-today-list">
            {myTodayEvents.map(({ event, kind }) => {
              const hour = Number(event.time.split(':')[0] ?? 0)
              const period = formatPeriod(language, hour)
              const hideParticipants = globalSettings?.hide_participants_from_users === 'true' && role === 'user'
              const applicantsCountText = hideParticipants ? '' : formatApplied(language, event.applicants.length)
              const applicantsSubText = applicantsCountText ? ` · ${applicantsCountText}` : ''

              const leaderText = event.leader ? formatLeaderOf(language, event.leader) : (t(language, 'territory.leaderTbd') || '인도자 미정')

              const sub = kind === 'lead'
                ? (hideParticipants ? '' : formatLeadSub(language, event.applicants.length, event.cardAssignments.length))
                : kind === 'join'
                  ? `${leaderText}${applicantsSubText}`
                  : `${leaderText}${applicantsSubText}${event.allowApplications ? ` · ${t(language, 'home.signupOpen')}` : ''}`
              return (
                <button
                  key={event.id}
                  type="button"
                  className={`mh-today-serving${kind === 'lead' ? ' is-lead' : ''}${kind === 'join' ? ' is-join' : ''}${kind === 'avail' ? ' is-avail' : ''}`}
                  onClick={() => onOpenEventDetail(event.id)}
                >
                  <span className="mh-today-time" style={{ width: 'auto', minWidth: 64, padding: '0 12px', height: 50 }}>
                    <span className="mh-today-time-hour" style={{ fontSize: event.time.includes(':') ? 14 : 16 }}>
                      {event.endTime ? `${event.time}~${event.endTime}` : event.time}
                    </span>
                    {!event.endTime && (
                      <span className="mh-today-time-period">{period}</span>
                    )}
                  </span>
                  <span className="mh-today-body">
                    <span className="mh-today-title-row">
                      <span className="mh-today-title">{event.title}</span>
                      {kind === 'lead' && <span className="mh-today-pill-lead">{t(language, 'home.leadPill')}</span>}
                      {kind === 'join' && <span className="mh-today-pill-join">{t(language, 'home.joinPill')}</span>}
                    </span>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginTop: 2 }}>
                      {event.place && (
                        <span className="mh-today-where" style={{ margin: 0 }}>
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M12 21s6-5.2 6-11a6 6 0 0 0-12 0c0 5.8 6 11 6 11Z"/><circle cx="12" cy="10" r="2"/></svg>
                          {event.place}
                        </span>
                      )}
                      {event.place && sub && <span style={{ color: 'var(--muted-3)', fontSize: 12 }}>·</span>}
                      {sub && (
                        <span className="mh-today-sub" style={{ margin: 0, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          {kind !== 'lead' && (
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                          )}
                          {sub}
                        </span>
                      )}
                    </span>
                  </span>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><polyline points="9 6 15 12 9 18"/></svg>
                </button>
              )
            })}
          </div>
        )}
      </section>

      <MeetingHome language={language} position="after_service" />
      <ServiceSuggestionsSection language={language} />

      {/* ─── 인도자 전용 — 담당 카드 진행 (미니 카드 그리드) ─── */}
      {role === 'leader' && leaderCards.length > 0 && (
        <section className="mobile-home-section">
          <div className="mh-sec-head">
            <h2>
              {t(language, 'home.assignedCards')}
              <span className="mh-cnt">{leaderCards.length}</span>
            </h2>
            {leaderCards.length > 8 && (
              <button className="mh-all" onClick={() => {
                navigate('/zone?reset=true')
                onOpenZone()
              }} type="button">
                {t(language, 'home.viewAllBtn')}
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden><polyline points="9 6 15 12 9 18"/></svg>
              </button>
            )}
          </div>
          <div className="mh-card-grid">
            {[...leaderCards].sort(compareTerritoryCardsByOperationalPriority).slice(0, 8).map((card) => {
              const pct = Math.min(100, Math.max(0, card.progress ?? 0))
              const colorClass = pct >= 70 ? 'high' : pct >= 30 ? 'mid' : 'low'
              return (
                <button
                  key={card.id}
                  type="button"
                  className="mh-card-tile"
                  onClick={() => {
                    navigate(`/zone?region=${encodeURIComponent(card.region)}&dong=${encodeURIComponent(card.area)}`)
                    onOpenZone()
                  }}
                >
                  <span className="mh-card-tile-name">{card.name}</span>
                  <span className="mh-card-tile-bottom">
                    <span className={`mh-card-tile-pct ${colorClass}`}>{pct}%</span>
                    <span className="mh-card-tile-meta">{card.completed}/{card.units}</span>
                  </span>
                </button>
              )
            })}
          </div>
        </section>
      )}
    </div>
  )
}
