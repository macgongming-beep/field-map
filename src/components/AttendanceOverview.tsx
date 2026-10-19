import { t, type AppLanguage } from '../i18n'
import { attendanceAverages, type AttendanceMeeting } from '../utils/serviceAttendance'

export function AttendanceOverview({ meetings, language }: { meetings: AttendanceMeeting[]; language: AppLanguage }) {
  const locale = language === 'zh' ? 'zh-CN' : language === 'ko' ? 'ko-KR' : 'en-US'
  const groups = [1, 2, 3, 4, 5, 6, 0].map(day => ({ day, rows: attendanceAverages(meetings.filter(row => row.weekday === day)) }))
  const maximum = Math.max(1, ...groups.flatMap(group => group.rows.map(row => row.average)))
  return <div className="attendance-overview">{groups.map(({ day, rows }) => <section key={day} className="attendance-day">
    <h3>{new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(new Date(2026, 9, 4 + day))}</h3>
    {!rows.length && <p className="attendance-no-meeting">{t(language, 'attendance.noMeeting')}</p>}
    {rows.map(row => <div className="attendance-bar-row" key={row.time}>
      <div><span>{row.time || t(language, 'attendance.unknownTime')}</span><strong>{new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(row.average)}</strong></div>
      <div className="attendance-bar-track" aria-hidden="true"><span style={{ width: `${row.average / maximum * 100}%` }} /></div>
    </div>)}
  </section>)}</div>
}
