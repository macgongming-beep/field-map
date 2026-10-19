import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import type { CalendarEvent } from '../types'
import { ServiceAttendanceStats } from './ServiceAttendanceStats'
import { DesktopStats } from './DesktopStats'
import { downloadCSV } from '../hooks/useServiceLogs'

vi.mock('../hooks/useServiceLogs', () => ({ downloadCSV: vi.fn() }))
afterEach(() => { cleanup(); vi.clearAllMocks() })
const events = [
  { id: 1, date: '2026-10-07', time: '10:00', title: 'Morning', applicants: ['A', 'B'], hasMeeting: true },
  { id: 2, date: '2026-10-14', time: '10:00', title: 'Morning', applicants: [], hasMeeting: true },
  { id: 3, date: '2026-10-07', time: '13:30', title: 'Afternoon', applicants: ['A'], hasMeeting: true },
  { id: 4, date: '2026-10-21', time: '10:00', title: 'Future', applicants: ['A'], hasMeeting: true },
] as CalendarEvent[]

test('weekday, average/date switch, month and export use the same filtered meetings', () => {
  render(<ServiceAttendanceStats events={events} language="ko" now={new Date(2026, 9, 20, 12)} />)
  expect(screen.getByRole('status').textContent).toContain('없습니다')
  fireEvent.click(screen.getByRole('button', { name: '수', exact: true }))
  const rows = within(screen.getByRole('table')).getAllByRole('row')
  expect(rows).toHaveLength(3)
  expect(within(rows[1]).getAllByRole('cell').map(cell => cell.textContent)).toEqual(['1', '2', '2'])
  fireEvent.click(screen.getByRole('button', { name: '날짜별', exact: true }))
  expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(4)
  expect(screen.queryByText('Future')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '참석 통계 CSV 다운로드' }))
  expect(downloadCSV).toHaveBeenCalledWith('attendance-2026-10-3-daily.csv', expect.stringContaining('2026-10-14'))
  fireEvent.change(screen.getByLabelText('집계 월'), { target: { value: '2026-09' } })
  expect(screen.getByRole('status').textContent).toContain('없습니다')
  expect((screen.getByRole('button', { name: '참석 통계 CSV 다운로드' }) as HTMLButtonElement).disabled).toBe(true)
})

test('attendance is a separate statistics panel, not affected by visit scope controls', () => {
  render(<MemoryRouter><DesktopStats calendarEvents={events} cards={[]} buildings={[]} visitHistories={[]}
    serviceSessions={[]} specialPeriods={[]} actualRole="admin" language="ko" /></MemoryRouter>)
  expect(screen.getByText('분석 범위')).toBeTruthy()
  fireEvent.click(screen.getByRole('tab', { name: '봉사 참석' }))
  expect(screen.queryByText('분석 범위')).toBeNull()
  expect(screen.getByLabelText('집계 월')).toBeTruthy()
  fireEvent.click(screen.getByRole('tab', { name: '방문 · 구역' }))
  expect(screen.getByText('분석 범위')).toBeTruthy()
})
