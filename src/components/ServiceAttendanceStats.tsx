import { useState } from 'react'
import type { CalendarEvent } from '../types'
import { t, type AppLanguage } from '../i18n'
import { toLocalDateString } from '../utils/dateUtils'
import { attendanceMeetings, attendanceAverages, attendanceCsv } from '../utils/serviceAttendance'
import { downloadCSV } from '../hooks/useServiceLogs'
import './ServiceAttendanceStats.css'
import { AttendanceCalendar } from './AttendanceCalendar'
import { AttendancePrint } from './AttendancePrint'
import { AttendanceOverview } from './AttendanceOverview'

export function ServiceAttendanceStats({ events, language: appLanguage, now = new Date() }: {
  events: CalendarEvent[]; language: AppLanguage; now?: Date
}) {
  const currentMonth = toLocalDateString(now).slice(0, 7)
  const [languageOverride, setLanguageOverride] = useState<AppLanguage | null>(null)
  const language = languageOverride ?? appLanguage
  const [printOpen, setPrintOpen] = useState(false)
  const [excludeVisit, setExcludeVisit] = useState(true)
  const [excludeStart, setExcludeStart] = useState('2026-09-29')
  const [excludeEnd, setExcludeEnd] = useState('2026-10-03')
  const exclusion = excludeVisit && excludeStart && excludeEnd && excludeStart <= excludeEnd ? `${excludeStart} ~ ${excludeEnd}` : undefined
  const [month, setMonth] = useState(currentMonth)
  const [weekday, setWeekday] = useState(1)
  const [mode, setMode] = useState<'overview' | 'average' | 'daily'>('overview')
  const locale = language === 'zh' ? 'zh-CN' : language === 'ko' ? 'ko-KR' : 'en-US'
  const dayLabel = (day: number) => new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(new Date(2026, 9, 4 + day))
  const monthMeetings = attendanceMeetings(events, month, now).filter(meeting => !exclusion || meeting.date < excludeStart || meeting.date > excludeEnd)
  const days = [1, 2, 3, 4, 5, 6, 0]
  const times = attendanceAverages(monthMeetings).map(row => row.time)
  const dayAverages = days.map(day => new Map(attendanceAverages(monthMeetings.filter(meeting => meeting.weekday === day)).map(row => [row.time, row])))
  const meetings = mode !== 'average' ? monthMeetings : monthMeetings.filter(meeting => meeting.weekday === weekday)
  const averages = attendanceAverages(meetings)
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
        ...meetings.map(row => [row.date, dayLabel(row.weekday), timeLabel(row.time), row.title, row.count])]
    downloadCSV(`attendance-${month}-${mode !== 'average' ? 'all' : weekday}-${mode}.csv`, attendanceCsv(exclusion ? [[t(language, 'attendance.excluded'), exclusion], ...rows] : rows))
  }
  return <div className="attendance-stats">
    <div className="attendance-toolbar">
      <label className="attendance-month">{t(language, 'attendance.month')}
        <input type="month" value={month} max={currentMonth} onChange={event => {
          if (/^\d{4}-\d{2}$/.test(event.target.value)) setMonth(event.target.value)
        }} />
      </label>
      <label className="attendance-month">{t(language, 'attendance.language')}
        <select value={language} onChange={event => setLanguageOverride(event.target.value as AppLanguage)}>
          <option value="ko">한국어</option><option value="zh">中文</option><option value="en">English</option>
        </select>
      </label>
      <div className="attendance-modes" role="group" aria-label={t(language, 'attendance.view')}>
        {(['overview', 'average', 'daily'] as const).map(value => <button type="button" key={value} aria-pressed={mode === value}
          onClick={() => setMode(value)}>{t(language, `attendance.${value}`)}</button>)}
      </div>
      <div className="attendance-tools">
      <button type="button" className="attendance-export" title={t(language, 'attendance.printOptions')} aria-label={t(language, 'attendance.printOptions')}
        aria-expanded={printOpen} onClick={() => setPrintOpen(value => !value)}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M6 8V3h12v5M6 17H3V9h18v8h-3M6 14h12v7H6zM17 11h1" /></svg>
      </button>
      <button type="button" className="attendance-export attendance-csv" title={t(language, 'attendance.export')} aria-label={t(language, 'attendance.export')}
        disabled={!meetings.length} onClick={exportCsv}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M12 3v12m-4-4 4 4 4-4M4 16v5h16v-5" /></svg>
      </button>
      </div>
    </div>
    <div className="attendance-exclusion">
      <label><input type="checkbox" checked={excludeVisit} onChange={event => setExcludeVisit(event.target.checked)} />{t(language, 'attendance.excludeVisit')}</label>
      {excludeVisit && <><label>{t(language, 'attendance.excludeStart')}<input type="date" value={excludeStart} max={excludeEnd} onChange={event => setExcludeStart(event.target.value)} /></label>
        <label>{t(language, 'attendance.excludeEnd')}<input type="date" value={excludeEnd} min={excludeStart} onChange={event => setExcludeEnd(event.target.value)} /></label></>}
    </div>
    {excludeVisit && !exclusion && <p role="alert">{t(language, 'attendance.invalidRange')}</p>}
    {exclusion && <p className="attendance-exclusion-note">{t(language, 'attendance.excluded')}: {exclusion}</p>}
    {printOpen && <AttendancePrint month={month} meetings={monthMeetings} exclusion={exclusion} today={toLocalDateString(now)} language={language} initialView={mode} onClose={() => setPrintOpen(false)} />}
    {mode === 'average' && <div className="attendance-weekdays" role="group" aria-label={t(language, 'attendance.weekday')}>
      {[1, 2, 3, 4, 5, 6, 0].map(day => <button type="button" key={day} aria-pressed={weekday === day}
        onClick={() => setWeekday(day)}>{dayLabel(day)}</button>)}
    </div>}
    <h2 className="attendance-heading">{mode === 'overview' ? t(language, 'attendance.overviewHeading') : mode === 'daily' ? `${month} · ${t(language, 'attendance.daily')}` : `${dayLabel(weekday)} · ${t(language, 'attendance.byTime')}`}</h2>
    {mode === 'daily' ? <AttendanceCalendar key={month} month={month} meetings={meetings} language={language} today={toLocalDateString(now)} />
      : !meetings.length ? <div className="attendance-empty" role="status">{t(language, 'attendance.empty')}</div>
      : mode === 'overview' ? <AttendanceOverview meetings={meetings} language={language} /> : <div className="attendance-table-wrap"><table className="attendance-table">
        <caption className="attendance-sr-only">{month} · {dayLabel(weekday)} · {t(language, `attendance.${mode}`)}</caption>
        <thead><tr>{(['time', 'averageCount', 'meetings'] as const)
          .map(key => <th scope="col" key={key}>{t(language, `attendance.${key}`)}</th>)}</tr></thead>
        <tbody>{averages.map(row => <tr key={row.time}>
          <th scope="row">{timeLabel(row.time)}</th><td className="attendance-emphasis">{format(row.average)}</td><td>{row.meetings}</td>
        </tr>)}</tbody>
      </table></div>}
  </div>
}
