// 관리자 모바일 홈 — design_handoff_admin_redesign 01 화면
// 구조: 공지 → 오늘의 봉사 → 운영 현황
//
// 헤더는 상위(MobileHome.tsx)의 AppHeader 가 그림.

import type { CalendarEvent, TerritoryCard } from '../../types'
import type { AppLanguage } from '../../i18n'
import { t, formatPeriod } from '../../i18n'

type ChevRIconProps = { size?: number; color?: string }
function ChevR({ size = 14, color = 'var(--muted-2)' }: ChevRIconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <polyline points="9 6 15 12 9 18" />
    </svg>
  )
}

function PinIcon() {
  return (
    <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 21s6-5.2 6-11a6 6 0 0 0-12 0c0 5.8 6 11 6 11Z" />
      <circle cx="12" cy="10" r="2" />
    </svg>
  )
}

function UserIcon() {
  return (
    <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="8" r="3.2" />
      <path d="M5.8 19c.8-3.4 3-5.2 6.2-5.2s5.4 1.8 6.2 5.2" />
    </svg>
  )
}

type Props = {
  language: AppLanguage
  todayEvents: CalendarEvent[]
  cards: TerritoryCard[]
  totalUnits: number
  completedUnits: number
  inProgressCount: number
  unassignedCount: number
  onOpenZone: () => void
  onOpenEventDetail: (eventId: number) => void
}

function timeBlock(time: string, lang: AppLanguage) {
  const [hh] = time.split(':')
  const hour = Number(hh)
  if (!Number.isFinite(hour)) return { display: time, period: '' }
  return { display: String(hour), period: formatPeriod(lang, hour) }
}

import { ServiceSuggestionsSection } from '../ServiceSuggestionsSection'
import { MeetingHome } from '../../features/meetingNotes/MeetingHome'

export function AdminMobileHome({
  language,
  todayEvents,
  cards,
  totalUnits,
  completedUnits,
  inProgressCount,
  unassignedCount,
  onOpenZone,
  onOpenEventDetail,
}: Props) {

  const completedPct = totalUnits > 0 ? (completedUnits / totalUnits) * 100 : 0
  const completedPctText = completedPct >= 10 ? completedPct.toFixed(1) : completedPct.toFixed(2)

  return (
    <div className="mh-page">
      <MeetingHome language={language} position="top" />

      {/* ── 오늘의 봉사 ──────────────────── */}
      <section className="mobile-home-section">
        <div className="mh-sec-head">
          <h2>
            {t(language, 'home.todayService')}
            <span className="mh-cnt">{todayEvents.length}</span>
          </h2>
        </div>
        {todayEvents.length === 0 ? (
          <div className="mh-empty-line">
            <span>{t(language, 'home.noTodayServiceShort')}</span>
          </div>
        ) : (
          <div className="mh-today-list">
            {todayEvents.map((event) => {
              const tb = timeBlock(event.time || '', language)
              return (
                <button
                  key={event.id}
                  type="button"
                  className="mh-today-serving"
                  onClick={() => onOpenEventDetail(event.id)}
                >
                  <span className="mh-today-time" style={{ width: 'auto', minWidth: 64, padding: '0 12px', height: 50 }}>
                    <span className="mh-today-time-hour" style={{ fontSize: event.time.includes(':') ? 14 : 16 }}>
                      {event.endTime ? `${event.time}~${event.endTime}` : event.time}
                    </span>
                    {!event.endTime && (
                      <span className="mh-today-time-period">{tb.period}</span>
                    )}
                  </span>
                  <span className="mh-today-body">
                    <span className="mh-today-title-row">
                      <span className="mh-today-title">{event.title}</span>
                    </span>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginTop: 2 }}>
                      {event.place && (
                        <span className="mh-today-where" style={{ margin: 0 }}>
                          <PinIcon />
                          {event.place}
                        </span>
                      )}
                      {event.place && event.leader && <span style={{ color: 'var(--muted-3)', fontSize: 12 }}>·</span>}
                      {event.leader && (
                        <span className="mh-today-sub" style={{ margin: 0, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          <UserIcon />
                          {event.leader}
                        </span>
                      )}
                    </span>
                  </span>
                  <ChevR size={14} color="currentColor" />
                </button>
              )
            })}
          </div>
        )}
      </section>

      <MeetingHome language={language} position="after_service" />
      <ServiceSuggestionsSection language={language} />

      {/* ── 운영 현황 ────────────────────── */}
      <section className="mobile-home-section">
        <div className="mh-sec-head">
          <h2>{t(language, 'home.operationStatus')}</h2>
          <button type="button" onClick={onOpenZone} className="mh-all">
            {t(language, 'home.viewAllBtn')} <ChevR size={14} color="currentColor" />
          </button>
        </div>
        <div className="mh-card-grid" style={{ marginTop: 0 }}>
          <StatTile num={cards.length} sub={t(language, 'home.totalCards')} />
          <StatTile num={inProgressCount} sub={t(language, 'home.inProgress')} />
          <StatTile num={unassignedCount} sub={t(language, 'zone.unassigned')} danger />
          <StatTile num={completedPctText} unit="%" sub={`${t(language, 'home.completedUnits')} ${completedUnits} / ${totalUnits}`} />
        </div>
      </section>
    </div>
  )
}

function StatTile({ num, unit, sub, danger }: { num: number | string; unit?: string; sub: string; danger?: boolean }) {
  return (
    <div className="mh-card-tile" style={{ padding: '16px 14px', alignItems: 'center', textAlign: 'center', background: 'var(--surface)' }}>
      <div
        style={{
          fontSize: 26,
          fontWeight: 700,
          color: danger ? 'var(--status-danger)' : 'var(--ink)',
          letterSpacing: '-0.02em',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {num}
        {unit && <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--muted)' }}>{unit}</span>}
      </div>
      <div style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 500, marginTop: 4 }}>{sub}</div>
    </div>
  )
}
