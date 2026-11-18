// 관리자 모바일 홈 — design_handoff_admin_redesign 01 화면
// 구조: 오늘의 봉사 → 봉사 모임 정리 → 대화 방법 제안
//
// 헤더는 상위(MobileHome.tsx)의 AppHeader 가 그림.

import type { CalendarEvent } from '../../types'
import type { AppLanguage } from '../../i18n'
import { t, formatPeriod } from '../../i18n'
import { groupServiceEnabled, visibleServiceEventCount } from '../../features/groupService/model'
import { ServiceEventList } from '../../features/groupService/ServiceEventList'

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
  globalSettings?: Record<string,string>
  groupName?: string
  language: AppLanguage
  todayEvents: CalendarEvent[]
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
  globalSettings,
  groupName,
  language,
  todayEvents,
  onOpenEventDetail,
}: Props) {

  return (
    <div className="mh-page">
      <MeetingHome language={language} position="top" />

      {/* ── 오늘의 봉사 ──────────────────── */}
      <section className="mobile-home-section">
        <div className="mh-sec-head">
          <h2>
            {t(language, 'home.todayService')}
            <span className="mh-cnt">{groupServiceEnabled()?visibleServiceEventCount(todayEvents):todayEvents.length}</span>
          </h2>
        </div>
        {todayEvents.length === 0 ? (
          <div className="mh-empty-line">
            <span>{t(language, 'home.noTodayServiceShort')}</span>
          </div>
        ) : groupServiceEnabled() ? <ServiceEventList events={todayEvents} groupName={groupName} language={language} globalSettings={globalSettings} onOpen={onOpenEventDetail}/> : (
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
    </div>
  )
}
