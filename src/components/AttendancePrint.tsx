import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { t, type AppLanguage } from '../i18n'
import { attendanceAverages, type AttendanceMeeting } from '../utils/serviceAttendance'
import { AttendanceCalendar } from './AttendanceCalendar'
import { AttendanceOverview } from './AttendanceOverview'

type View = 'daily' | 'overview' | 'average'
const views: View[] = ['daily', 'overview', 'average']

export function AttendancePrint({ month, meetings, today, language, initialView, onClose, exclusion }: {
  month: string; meetings: AttendanceMeeting[]; today: string; language: AppLanguage;
  initialView: View; onClose: () => void; exclusion?: string
}) {
  const [languages, setLanguages] = useState<('ko' | 'zh')[]>([language === 'zh' ? 'zh' : 'ko'])
  const [selected, setSelected] = useState<View[]>([initialView])
  useEffect(() => {
    document.body.classList.add('attendance-print-active')
    return () => { document.body.classList.remove('attendance-print-active') }
  }, [])
  return <>
    <section className="attendance-print-options" aria-label={t(language, 'attendance.printOptions')}>
      <fieldset><legend>{t(language, 'attendance.language')}</legend>
        {(['ko', 'zh'] as const).map(lang => <label key={lang}><input type="checkbox" checked={languages.includes(lang)}
          onChange={event => setLanguages(current => event.target.checked ? [...current, lang] : current.filter(value => value !== lang))} />{lang === 'ko' ? '한국어' : '中文'}</label>)}
      </fieldset>
      <fieldset><legend>{t(language, 'attendance.printViews')}</legend>
        {views.map(view => <label key={view}><input type="checkbox" checked={selected.includes(view)}
          onChange={event => setSelected(current => event.target.checked ? [...current, view] : current.filter(value => value !== view))} />{t(language, `attendance.${view}`)}</label>)}
      </fieldset>
      <div className="attendance-print-actions">
        <button type="button" disabled={!languages.length || !selected.length} onClick={() => window.print()}>{t(language, 'attendance.print')}</button>
        <button type="button" onClick={onClose}>{t(language, 'attendance.close')}</button>
      </div>
    </section>
    {createPortal(<div className="attendance-print-root" aria-hidden="true">
      {(['ko', 'zh'] as const).filter(lang => languages.includes(lang)).flatMap(lang => views.filter(view => selected.includes(view)).map(view =>
        <AttendancePrintPage key={`${lang}-${view}`} month={month} meetings={meetings} exclusion={exclusion} today={today} language={lang} view={view} />))}
    </div>, document.body)}
  </>
}

export function AttendancePrintPage({ month, meetings, today, language, view, exclusion }: {
  month: string; meetings: AttendanceMeeting[]; today: string; language: AppLanguage; view: View; exclusion?: string
}) {
  const days = [1, 2, 3, 4, 5, 6, 0]
  const locale = language === 'zh' ? 'zh-CN' : 'ko-KR'
  const label = (day: number) => new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(new Date(2026, 9, 4 + day))
  const format = (value: number) => new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value)
  const timeLabel = (time: string) => time || t(language, 'attendance.unknownTime')
  const groups = days.map(day => new Map(attendanceAverages(meetings.filter(meeting => meeting.weekday === day)).map(row => [row.time, row])))
  return <article className="attendance-print-page" lang={language} data-view={view}>
    <header><h1>{t(language, 'attendance.tab.attendance')}</h1><p>{month} · {t(language, `attendance.${view}`)}</p></header>
    {exclusion && <p className="attendance-exclusion-note">{t(language, 'attendance.excluded')}: {exclusion}</p>}
    {view === 'daily' ? <AttendanceCalendar month={month} meetings={meetings} today={today} language={language} printOnly />
      : view === 'overview' ? <><h2 className="attendance-heading">{t(language, 'attendance.overviewHeading')}</h2><AttendanceOverview meetings={meetings} language={language} /></> : <table className="attendance-table">
        <thead><tr>{(['weekday', 'time', 'averageCount', 'meetings'] as const).map(key => <th key={key}>{t(language, `attendance.${key}`)}</th>)}</tr></thead>
        <tbody>{days.flatMap((day, index) => [...groups[index].values()].map(row => <tr key={`${day}-${row.time}`}><th>{label(day)}</th><td>{timeLabel(row.time)}</td><td>{format(row.average)}</td><td>{row.meetings}</td></tr>))}</tbody>
      </table>}
    {!meetings.length && <p>{t(language, 'attendance.empty')}</p>}
  </article>
}
