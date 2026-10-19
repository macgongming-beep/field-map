import { useState } from 'react'
import type { AttendanceMeeting } from '../utils/serviceAttendance'
import { t, type AppLanguage } from '../i18n'

export function AttendanceCalendar({ month, meetings, language, today }: {
  month: string; meetings: AttendanceMeeting[]; language: AppLanguage; today: string
}) {
  const [selected, setSelected] = useState(meetings[0]?.date ?? `${month}-01`)
  const [year, monthNumber] = month.split('-').map(Number)
  const first = new Date(year, monthNumber - 1, 1)
  const offset = (first.getDay() + 6) % 7
  const length = new Date(year, monthNumber, 0).getDate()
  const locale = language === 'zh' ? 'zh-CN' : language === 'ko' ? 'ko-KR' : 'en-US'
  const label = (day: number) => new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(new Date(2026, 9, 5 + day))
  const time = (value: string) => value || t(language, 'attendance.unknownTime')
  const detail = meetings.filter(meeting => meeting.date === selected)
  return <>
    <div className="attendance-calendar" role="group" aria-label={`${month} ${t(language, 'attendance.daily')}`}>
      {Array.from({ length: 7 }, (_, day) => <div className="attendance-calendar-weekday" key={`day-${day}`}>{label(day)}</div>)}
      {Array.from({ length: Math.ceil((offset + length) / 7) * 7 }, (_, cell) => {
        const day = cell - offset + 1
        if (day < 1 || day > length) return <div className="attendance-calendar-blank" aria-hidden="true" key={cell} />
        const date = `${month}-${String(day).padStart(2, '0')}`
        const rows = meetings.filter(meeting => meeting.date === date)
        return <button type="button" className="attendance-calendar-date" key={date}
          aria-label={date} aria-pressed={selected === date} aria-current={date === today ? 'date' : undefined}
          aria-controls="attendance-date-detail" disabled={date > today} onClick={() => setSelected(date)}>
          <span className="attendance-calendar-number">{day}</span>
          {rows.map(row => <span className="attendance-calendar-meeting" key={row.id}>
            <span>{time(row.time)}</span><strong>{row.count}{t(language, 'attendance.peopleSuffix')}</strong>
          </span>)}
        </button>
      })}
    </div>
    <section id="attendance-date-detail" aria-labelledby="attendance-date-title" aria-live="polite">
      <h3 id="attendance-date-title" className="attendance-heading">{selected}</h3>
      {!detail.length ? <p className="attendance-empty">{t(language, 'attendance.emptyDate')}</p>
        : <table className="attendance-table"><caption className="attendance-sr-only">{selected}</caption>
          <thead><tr>{(['time', 'event', 'count'] as const).map(key => <th scope="col" key={key}>{t(language, `attendance.${key}`)}</th>)}</tr></thead>
          <tbody>{detail.map(row => <tr key={row.id}><th scope="row">{time(row.time)}</th><td className="attendance-event">{row.title}</td><td className="attendance-emphasis">{row.count}</td></tr>)}</tbody>
        </table>}
    </section>
  </>
}
