import { expect, test } from 'vitest'
import type { CalendarEvent } from '../types'
import { attendanceAverages, attendanceCsv, attendanceMeetings } from './serviceAttendance'

export const event = (id: number, patch: Partial<CalendarEvent> = {}): CalendarEvent => ({
  id, date: '2026-10-07', time: '10:00', title: 'Service', type: '혼합', place: '', leader: '', leaders: [],
  card: '', hasMeeting: true, allowApplications: true, applicants: [], guests: [], assigned: [], cardAssignments: [], memo: '', ...patch,
})
const now = new Date(2026, 9, 20, 12)

test('uses meeting count, including zero attendees, and separates exact start times', () => {
  const rows = attendanceMeetings([
    event(1, { applicants: ['A', 'B', 'C', 'D'] }),
    event(2, { date: '2026-10-14' }),
    event(3, { time: '13:30:00', applicants: ['A', 'B'] }),
    event(4, { date: '2026-10-21', applicants: ['future'] }),
    event(5, { date: '2026-09-30', applicants: ['other month'] }),
  ], '2026-10', now)
  expect(rows.map(row => row.weekday)).toEqual([3, 3, 3])
  expect(attendanceAverages(rows)).toEqual([
    { time: '10:00', meetings: 2, total: 4, average: 2 },
    { time: '13:30', meetings: 1, total: 2, average: 2 },
  ])
})

test('counts each participant once per meeting, including guests and cart applicants', () => {
  const a = event(1, { allowApplications: false, applicants: ['A', ' A ', 'Guest', ''], guests: ['Guest'], assigned: ['A'],
    cartApplicants: [{ userId: 1, name: 'A', isTeamLead: true, createdAt: '' }, { userId: 2, name: 'B', isTeamLead: false, createdAt: '' }] })
  expect(attendanceMeetings([a, a, event(2, { time: '17:00', applicants: ['A'] })], '2026-10', now).map(row => row.count)).toEqual([3, 1])
})

test('excludes future times, non-service calendar entries and invalid dates; retains closed meetings', () => {
  const rows = attendanceMeetings([
    event(1, { date: '2026-10-20', time: '12:01' }),
    event(2, { date: '2026-10-20', time: '12:00' }),
    event(3, { date: '2026-10-20', time: '' }),
    event(4, { date: '2026-10-32' }),
    event(5, { hasMeeting: false, allowApplications: false }),
    event(6, { hasMeeting: false, allowApplications: false, applicants: ['A'] }),
    event(7, { allowApplications: false }),
    event(8, { time: '' }),
  ], '2026-10', now)
  expect(rows.map(row => row.id)).toEqual([6, 7, 8, 2])
})

test('assigns local calendar weekdays without UTC date shifting', () => {
  expect(attendanceMeetings(Array.from({ length: 7 }, (_, i) => event(i, { date: `2026-10-${String(5 + i).padStart(2, '0')}` })), '2026-10', now)
    .map(row => row.weekday)).toEqual([1, 2, 3, 4, 5, 6, 0])
  expect(attendanceAverages([])).toEqual([])
})

test('CSV preserves numeric zero, escapes titles and neutralizes spreadsheet formulas', () => {
  expect(attendanceCsv([['=SUM(A1)', 'a,"b"', 0]])).toBe('"\'=SUM(A1)","a,""b""","0"')
})
