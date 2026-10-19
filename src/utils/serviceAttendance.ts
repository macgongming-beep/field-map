import type { CalendarEvent } from '../types'
import { toLocalDateString } from './dateUtils'
import { eventParticipantNameKey } from './eventParticipantUsers'

export type AttendanceMeeting = {
  id: number; date: string; weekday: number; time: string; title: string; count: number
}
export type AttendanceAverage = {
  time: string; meetings: number; total: number; average: number
}

export function attendanceMeetings(events: CalendarEvent[], month: string, now = new Date()): AttendanceMeeting[] {
  const today = toLocalDateString(now)
  const clock = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
  const seen = new Set<number>()
  return events.flatMap((event): AttendanceMeeting[] => {
    if (seen.has(event.id) || !/^\d{4}-\d{2}-\d{2}$/.test(event.date) || event.date.slice(0, 7) !== month) return []
    const date = new Date(`${event.date}T12:00:00`)
    if (!Number.isFinite(date.getTime()) || toLocalDateString(date) !== event.date) return []
    const match = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(event.time)
    const time = match && Number(match[1]) < 24 && Number(match[2]) < 60
      ? `${match[1].padStart(2, '0')}:${match[2]}` : ''
    if (event.date > today || (event.date === today && (!time || time > clock))) return []
    const participants = new Set([
      ...event.applicants, ...(event.cartApplicants ?? []).map(person => person.name),
    ].map(eventParticipantNameKey).filter(Boolean))
    // Closed applications are not cancelled meetings. Deleted events are absent
    // from the calendar snapshot; there is no separate cancellation field.
    if (!event.hasMeeting && !event.allowApplications && !event.allowCartApplications && participants.size === 0) return []
    seen.add(event.id)
    return [{ id: event.id, date: event.date, weekday: date.getDay(), time, title: event.title, count: participants.size }]
  }).sort((a, b) => a.date.localeCompare(b.date) || (a.time || '99').localeCompare(b.time || '99') || a.id - b.id)
}

export function attendanceAverages(meetings: AttendanceMeeting[]): AttendanceAverage[] {
  const groups = new Map<string, { meetings: number; total: number }>()
  for (const meeting of meetings) {
    const group = groups.get(meeting.time) ?? { meetings: 0, total: 0 }
    group.meetings++
    group.total += meeting.count
    groups.set(meeting.time, group)
  }
  return [...groups].map(([time, group]) => ({ time, ...group, average: group.total / group.meetings }))
    .sort((a, b) => (a.time || '99').localeCompare(b.time || '99'))
}

export function attendanceCsv(rows: (string | number)[][]): string {
  return rows.map(row => row.map(value => {
    const text = String(value)
    const safe = typeof value === 'string' && /^[\s]*[=+@-]/.test(text) ? `'${text}` : text
    return `"${safe.replaceAll('"', '""')}"`
  }).join(',')).join('\r\n')
}
