import { useState } from 'react'
import type { CalendarEvent } from '../types'
import { t, type AppLanguage } from '../i18n'
import { toLocalDateString } from '../utils/dateUtils'
import { attendanceMeetings, attendanceAverages, attendanceCsv } from '../utils/serviceAttendance'
import { downloadCSV } from '../hooks/useServiceLogs'
import './ServiceAttendanceStats.css'

export function ServiceAttendanceStats({ events, language, now = new Date() }: {
  events: CalendarEvent[]; language: AppLanguage; now?: Date
}) {
  const currentMonth = toLocalDateString(now).slice(0, 7)
  const [month, setMonth] = useState(currentMonth)
  const [weekday, setWeekday] = useState(1)
  const [mode, setMode] = useState<'overview' | 'average' | 'daily'>('overview')
  const locale = language === 'zh' ? 'zh-CN' : language === 'ko' ? 'ko-KR' : 'en-US'
  const dayLabel = (day: number) => new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(new Date(2026, 9, 4 + day))
  const monthMeetings = attendanceMeetings(events, month, now)
  const days = [1, 2, 3, 4, 5, 6, 0]
  const times = attendanceAverages(monthMeetings).map(row => row.time)
  const dayAverages = days.map(day => new Map(attendanceAverages(monthMeetings.filter(meeting => meeting.weekday === day)).map(row => [row.time, row])))
  const meetings = mode === 'overview' ? monthMeetings : monthMeetings.filter(meeting => meeting.weekday === weekday)
  const averages = attendanceAverages(meetings)
  const total = meetings.reduce((sum, meeting) => sum + meeting.count, 0)
  const format = (number: number) => new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(number)
  const timeLabel = (time: string) => time || t(language, 'attendance.unknownTime')
  const exportCsv = () => {
    const rows = mode === 'overview'
      ? [[t(language, 'attendance.month'), t(language, 'attendance.time'), ...days.map(dayLabel)],
        ...times.map(time => [month, timeLabel(time), ...dayAverages.map(group => group.has(time) ? Number(group.get(time)!.average.toFixed(1)) : '—')])]
      : mode === 'average'
      ? [[t(language, 'attendance.month'), t(language, 'attendance.weekday'), t(language, 'attendance.time'), t(language, 'attendance.averageCount'), t(language, 'attendance.meetings')],
        ...averages.map(row => [month, dayLabel(weekday), timeLabel(row.time), Number(row.average.toFixed(1)), row.meetings])]
      : [[t(language, 'attendance.date'), t(language, 'attendance.weekday'), t(language, 'attendance.time'), t(language, 'attendance.event'), t(language, 'attendance.count')],
        ...meetings.map(row => [row.date, dayLabel(weekday), timeLabel(row.time), row.title, row.count])]
    downloadCSV(`attendance-${month}-${mode === 'overview' ? 'all' : weekday}-${mode}.csv`, attendanceCsv(rows))
  }
  return <div className="attendance-stats">
    <div className="attendance-toolbar">
      <label className="attendance-month">{t(language, 'attendance.month')}
        <input type="month" value={month} max={currentMonth} onChange={event => {
          if (/^\d{4}-\d{2}$/.test(event.target.value)) setMonth(event.target.value)
        }} />
      </label>
      <div className="attendance-modes" role="group" aria-label={t(language, 'attendance.view')}>
        {(['overview', 'average', 'daily'] as const).map(value => <button type="button" key={value} aria-pressed={mode === value}
          onClick={() => setMode(value)}>{t(language, `attendance.${value}`)}</button>)}
      </div>
      <button type="button" className="attendance-export" title={t(language, 'attendance.export')} aria-label={t(language, 'attendance.export')}
        disabled={!meetings.length} onClick={exportCsv}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M12 3v12m-4-4 4 4 4-4M4 16v5h16v-5" /></svg>
      </button>
    </div>
    {mode !== 'overview' && <div className="attendance-weekdays" role="group" aria-label={t(language, 'attendance.weekday')}>
      {[1, 2, 3, 4, 5, 6, 0].map(day => <button type="button" key={day} aria-pressed={weekday === day}
        onClick={() => setWeekday(day)}>{dayLabel(day)}</button>)}
    </div>}
    <dl className="attendance-summary">
      <div><dt>{t(language, 'attendance.meetings')}</dt><dd>{format(meetings.length)}</dd></div>
      <div><dt>{t(language, 'attendance.averageCount')}</dt><dd>{meetings.length ? format(total / meetings.length) : '—'}</dd></div>
    </dl>
    <h2 className="attendance-heading">{mode === 'overview' ? t(language, 'attendance.overviewHeading') : `${dayLabel(weekday)} · ${t(language, mode === 'average' ? 'attendance.byTime' : 'attendance.daily')}`}</h2>
    {!meetings.length ? <div className="attendance-empty" role="status">{t(language, 'attendance.empty')}</div>
      : mode === 'overview' ? <div className="attendance-table-wrap"><table className="attendance-table attendance-matrix">
        <caption className="attendance-sr-only">{month} · {t(language, 'attendance.overviewHeading')}</caption>
        <thead><tr><th scope="col">{t(language, 'attendance.time')}</th>{days.map(day => <th scope="col" key={day}>{dayLabel(day)}</th>)}</tr></thead>
        <tbody>{times.map(time => <tr key={time}><th scope="row">{timeLabel(time)}</th>{dayAverages.map((group, index) => <td key={days[index]} className="attendance-emphasis">{group.has(time) ? format(group.get(time)!.average) : '—'}</td>)}</tr>)}</tbody>
      </table></div> : <div className="attendance-table-wrap"><table className="attendance-table">
        <caption className="attendance-sr-only">{month} · {dayLabel(weekday)} · {t(language, `attendance.${mode}`)}</caption>
        <thead><tr>{(mode === 'average'
          ? ['time', 'averageCount', 'meetings'] as const : ['date', 'time', 'event', 'count'] as const)
          .map(key => <th scope="col" key={key}>{t(language, `attendance.${key}`)}</th>)}</tr></thead>
        <tbody>{mode === 'average' ? averages.map(row => <tr key={row.time}>
          <th scope="row">{timeLabel(row.time)}</th><td className="attendance-emphasis">{format(row.average)}</td><td>{row.meetings}</td>
        </tr>) : meetings.map(row => <tr key={row.id}>
          <th scope="row">{row.date.slice(5).replace('-', '/')}</th><td>{timeLabel(row.time)}</td><td className="attendance-event">{row.title}</td><td className="attendance-emphasis">{row.count}</td>
        </tr>)}</tbody>
      </table></div>}
  </div>
}
