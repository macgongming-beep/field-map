import { useEffect, useState } from 'react'
import type { CalendarEvent } from '../types'
import { t, type AppLanguage } from '../i18n'
import { toLocalDateString } from '../utils/dateUtils'
import { attendanceMeetings, attendanceAverages, attendanceCsv } from '../utils/serviceAttendance'
import { downloadCSV } from '../hooks/useServiceLogs'
import './ServiceAttendanceStats.css'
import { AttendanceCalendar } from './AttendanceCalendar'
import { AttendancePrint } from './AttendancePrint'
import { AttendanceOverview } from './AttendanceOverview'
import { readAttendancePreferences, saveAttendancePreferences } from '../lib/attendancePreferences'

export function ServiceAttendanceStats({ events, language: appLanguage, now = new Date(), userId, onLanguageChange }: {
  events: CalendarEvent[]; language: AppLanguage; now?: Date; userId?: number; onLanguageChange?: (language: AppLanguage) => void
}) {
  const currentMonth = toLocalDateString(now).slice(0, 7)
  const [languageOverride, setLanguageOverride] = useState<AppLanguage | null>(null)
  const language = languageOverride ?? appLanguage
  const [printOpen, setPrintOpen] = useState(false)
  const [savedPreferences] = useState(() => readAttendancePreferences(userId))
  const [excludeVisit, setExcludeVisit] = useState(savedPreferences.enabled)
  const [excludeStart, setExcludeStart] = useState(savedPreferences.start)
  const [excludeEnd, setExcludeEnd] = useState(savedPreferences.end)
  useEffect(() => {
    saveAttendancePreferences(userId, { enabled: excludeVisit, start: excludeStart, end: excludeEnd })
  }, [userId, excludeVisit, excludeStart, excludeEnd])
  const exclusion = excludeVisit && excludeStart && excludeEnd && excludeStart <= excludeEnd ? `${excludeStart} ~ ${excludeEnd}` : undefined
  const [month, setMonth] = useState(currentMonth)
  const [extraMonths, setExtraMonths] = useState<string[]>([])
  const months = [...new Set([month, ...extraMonths])]
  const reports = months.map(value => ({ month: value, meetings: attendanceMeetings(events, value, now).filter(meeting => !exclusion || meeting.date < excludeStart || meeting.date > excludeEnd) }))
  const scale = Math.max(1, ...reports.flatMap(report => [0, 1, 2, 3, 4, 5, 6].flatMap(day => attendanceAverages(report.meetings.filter(row => row.weekday === day)).map(row => row.average))))
  const [weekday, setWeekday] = useState(1)
  const [mode, setMode] = useState<'overview' | 'average' | 'daily'>('overview')
  const locale = language === 'zh' ? 'zh-CN' : language === 'ko' ? 'ko-KR' : 'en-US'
  const dayLabel = (day: number) => new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(new Date(2026, 9, 4 + day))
  const monthMeetings = reports[0].meetings
  const days = [1, 2, 3, 4, 5, 6, 0]
  const format = (number: number) => new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(number)
  const timeLabel = (time: string) => time || t(language, 'attendance.unknownTime')
  const exportCsv = () => {
    const rows = reports.flatMap(report => {
      const month = report.month
      const meetings = mode === 'average' ? report.meetings.filter(row => row.weekday === weekday) : report.meetings
      const averages = attendanceAverages(meetings)
      const times = averages.map(row => row.time)
      const dayAverages = days.map(day => new Map(attendanceAverages(meetings.filter(meeting => meeting.weekday === day)).map(row => [row.time, row])))
      return mode === 'overview'
      ? [[t(language, 'attendance.month'), t(language, 'attendance.time'), ...days.map(dayLabel)],
        ...times.map(time => [month, timeLabel(time), ...dayAverages.map(group => group.has(time) ? Number(group.get(time)!.average.toFixed(1)) : '—')])]
      : mode === 'average'
      ? [[t(language, 'attendance.month'), t(language, 'attendance.weekday'), t(language, 'attendance.time'), t(language, 'attendance.averageCount'), t(language, 'attendance.meetings')],
        ...averages.map(row => [month, dayLabel(weekday), timeLabel(row.time), Number(row.average.toFixed(1)), row.meetings])]
      : [[t(language, 'attendance.date'), t(language, 'attendance.weekday'), t(language, 'attendance.time'), t(language, 'attendance.event'), t(language, 'attendance.count')],
        ...meetings.map(row => [row.date, dayLabel(row.weekday), timeLabel(row.time), row.title, row.count])]
    })
    downloadCSV(`attendance-${month}-${mode !== 'average' ? 'all' : weekday}-${mode}.csv`, attendanceCsv(exclusion ? [[t(language, 'attendance.excluded'), exclusion], ...rows] : rows))
  }
  return <div className="attendance-stats">
    <div className="attendance-toolbar">
      <label className="attendance-month">{t(language, 'attendance.month')}
        <input type="month" value={month} max={currentMonth} onChange={event => {
          if (/^\d{4}-\d{2}$/.test(event.target.value)) setMonth(event.target.value)
        }} />
      </label>
      {extraMonths.map((value, index) => <div className="attendance-extra-month" key={index}>
        <label className="attendance-month">{t(language, 'attendance.month')} {index + 2}<input type="month" value={value} max={currentMonth} onChange={event => {
          const next = event.target.value
          if (/^\d{4}-\d{2}$/.test(next) && next <= currentMonth && !months.includes(next)) setExtraMonths(values => values.map((item, i) => i === index ? next : item))
        }} /></label>
        <button type="button" className="attendance-export" title={t(language, 'attendance.removeMonth')} aria-label={`${t(language, 'attendance.removeMonth')} ${value}`} onClick={() => setExtraMonths(values => values.filter((_, i) => i !== index))}>×</button>
      </div>)}
      <button type="button" className="attendance-add-month" onClick={() => {
        const date = new Date(`${months[months.length - 1]}-01T12:00:00`)
        do { date.setMonth(date.getMonth() - 1) } while (months.includes(toLocalDateString(date).slice(0, 7)))
        setExtraMonths(values => [...values, toLocalDateString(date).slice(0, 7)])
      }}>+ {t(language, 'attendance.addMonth')}</button>
      <label className="attendance-month">{t(language, 'attendance.language')}
        <select value={language} onChange={event => { const value = event.target.value as AppLanguage; if (onLanguageChange) onLanguageChange(value); else setLanguageOverride(value) }}>
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
        disabled={!reports.some(report => report.meetings.some(row => mode !== 'average' || row.weekday === weekday))} onClick={exportCsv}>
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
    {printOpen && <AttendancePrint month={month} meetings={monthMeetings} reports={reports} exclusion={exclusion} today={toLocalDateString(now)} language={language} initialView={mode} onClose={() => setPrintOpen(false)} />}
    {mode === 'average' && <div className="attendance-weekdays" role="group" aria-label={t(language, 'attendance.weekday')}>
      {[1, 2, 3, 4, 5, 6, 0].map(day => <button type="button" key={day} aria-pressed={weekday === day}
        onClick={() => setWeekday(day)}>{dayLabel(day)}</button>)}
    </div>}
    {reports.map(report => {
      const month = report.month
      const meetings = mode === 'average' ? report.meetings.filter(row => row.weekday === weekday) : report.meetings
      const averages = attendanceAverages(meetings)
      const monthLabel = new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'long' }).format(new Date(`${month}-01T12:00:00`))
      return <section className="attendance-month-report" key={month} aria-label={monthLabel}><div className="attendance-report-heading">
      <time className="attendance-report-month" dateTime={month}>{monthLabel}</time>
      <h2 className="attendance-heading">{mode === 'overview' ? t(language, 'attendance.overviewHeading') : mode === 'daily' ? t(language, 'attendance.daily') : `${dayLabel(weekday)} · ${t(language, 'attendance.byTime')}`}</h2>
    </div>
    {mode === 'daily' ? <AttendanceCalendar key={month} month={month} meetings={meetings} language={language} today={toLocalDateString(now)} />
      : !meetings.length ? <div className="attendance-empty" role="status">{t(language, 'attendance.empty')}</div>
      : mode === 'overview' ? <AttendanceOverview meetings={meetings} language={language} scale={scale} /> : <div className="attendance-table-wrap"><table className="attendance-table">
        <caption className="attendance-sr-only">{month} · {dayLabel(weekday)} · {t(language, `attendance.${mode}`)}</caption>
        <thead><tr>{(['time', 'averageCount', 'meetings'] as const)
          .map(key => <th scope="col" key={key}>{t(language, `attendance.${key}`)}</th>)}</tr></thead>
        <tbody>{averages.map(row => <tr key={row.time}>
          <th scope="row">{timeLabel(row.time)}</th><td className="attendance-emphasis">{format(row.average)}</td><td>{row.meetings}</td>
        </tr>)}</tbody>
      </table></div>}</section>
    })}
  </div>
}
