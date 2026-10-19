import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import type { CalendarEvent } from '../types'
import { ServiceAttendanceStats } from './ServiceAttendanceStats'
import { DesktopStats } from './DesktopStats'
import { downloadCSV } from '../hooks/useServiceLogs'

vi.mock('../hooks/useServiceLogs', () => ({ downloadCSV: vi.fn() }))
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.clearAllMocks() })
const events = [
  { id: 1, date: '2026-10-07', time: '10:00', title: 'Morning', applicants: ['A', 'B'], hasMeeting: true },
  { id: 2, date: '2026-10-14', time: '10:00', title: 'Morning', applicants: [], hasMeeting: true },
  { id: 3, date: '2026-10-07', time: '13:30', title: 'Afternoon', applicants: ['A'], hasMeeting: true },
  { id: 4, date: '2026-10-21', time: '10:00', title: 'Future', applicants: ['A'], hasMeeting: true },
] as CalendarEvent[]

test('visit exclusion is inclusive across months, changes denominators and matches print and CSV without mutating events', () => {
  const source = ['2026-09-22', '2026-09-29', '2026-09-30', '2026-10-03', '2026-10-10'].map((date, index) => ({
    id: index + 20, date, time: '18:30', title: 'Meeting', hasMeeting: true,
    applicants: Array.from({ length: index === 0 ? 2 : 10 }, (_, i) => `Person${i}`),
  })) as CalendarEvent[]
  const snapshot = JSON.stringify(source)
  render(<ServiceAttendanceStats events={source} language="ko" now={new Date(2026, 9, 20)} />)
  expect(document.querySelector('.attendance-day:nth-child(6) strong')?.textContent).toBe('10')
  fireEvent.change(screen.getByLabelText('집계 월'), { target: { value: '2026-09' } })
  expect(document.querySelector('.attendance-day:nth-child(2) strong')?.textContent).toBe('2')
  expect(document.querySelector('.attendance-day:nth-child(3) strong')).toBeNull()
  expect(document.querySelector('.attendance-summary')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'PDF 출력 설정' }))
  const paper = document.querySelector('.attendance-print-root')!
  expect(paper.textContent).toContain('2026-09-29 ~ 2026-10-03')
  expect(paper.querySelector('.attendance-day:nth-child(2) strong')?.textContent).toBe('2')
  fireEvent.click(screen.getByRole('button', { name: '참여 통계 CSV 다운로드' }))
  expect(downloadCSV).toHaveBeenLastCalledWith(expect.any(String), expect.stringContaining('"2026-09","18:30","—","2","—"'))
  fireEvent.click(screen.getByLabelText('순회 방문 기간 제외'))
  expect(document.querySelector('.attendance-day:nth-child(2) strong')?.textContent).toBe('6')
  expect(paper.querySelector('.attendance-day:nth-child(3) strong')?.textContent).toBe('10')
  expect(paper.textContent).not.toContain('2026-09-29 ~ 2026-10-03')
  expect(JSON.stringify(source)).toBe(snapshot)
})

test('weekday, average/date switch, month and export use the same filtered meetings', () => {
  render(<ServiceAttendanceStats events={events} language="ko" now={new Date(2026, 9, 20, 12)} />)
  expect([...document.querySelectorAll('.attendance-day h3')].map(node => node.textContent)).toEqual(['월', '화', '수', '목', '금', '토', '일'])
  expect([...document.querySelectorAll('.attendance-day:nth-child(3) strong')].map(node => node.textContent)).toEqual(['1', '1'])
  expect(screen.queryByText('누적 참석 (명)')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '참여 통계 CSV 다운로드' }))
  expect(downloadCSV).toHaveBeenCalledWith('attendance-2026-10-all-overview.csv', expect.stringContaining('"월","화","수","목","금","토","일"'))
  fireEvent.click(screen.getByRole('button', { name: '요일별 상세', exact: true }))
  expect(screen.getByRole('status').textContent).toContain('없습니다')
  fireEvent.click(screen.getByRole('button', { name: '수', exact: true }))
  const rows = within(screen.getByRole('table')).getAllByRole('row')
  expect(rows).toHaveLength(3)
  expect(within(rows[1]).getAllByRole('cell').map(cell => cell.textContent)).toEqual(['1', '2'])
  fireEvent.click(screen.getByRole('button', { name: '날짜별', exact: true }))
  expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(3)
  fireEvent.click(screen.getByRole('button', { name: '2026-10-14', exact: true }))
  expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(2)
  expect(screen.queryByText('Future')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '참여 통계 CSV 다운로드' }))
  expect(downloadCSV).toHaveBeenCalledWith('attendance-2026-10-all-daily.csv', expect.stringContaining('2026-10-14'))
  fireEvent.change(screen.getByLabelText('집계 월'), { target: { value: '2026-09' } })
  expect(screen.getByText('이 날짜에 집계된 봉사 모임이 없습니다.')).toBeTruthy()
  expect((screen.getByRole('button', { name: '참여 통계 CSV 다운로드' }) as HTMLButtonElement).disabled).toBe(true)
})

test('calendar includes all weekdays, uses Monday-first placement and exports every date', () => {
  render(<ServiceAttendanceStats events={[...events,
    { id: 5, date: '2026-10-05', time: '19:00', title: 'Monday meeting', applicants: ['C'], hasMeeting: true } as CalendarEvent,
  ]} language="ko" now={new Date(2026, 9, 20, 12)} />)
  fireEvent.click(screen.getByRole('button', { name: '요일별 상세', exact: true }))
  fireEvent.click(screen.getByRole('button', { name: '수', exact: true }))
  fireEvent.click(screen.getByRole('button', { name: '날짜별', exact: true }))
  expect(screen.queryByRole('group', { name: '요일', exact: true })).toBeNull()
  const calendar = screen.getByRole('group', { name: '2026-10 날짜별' })
  expect(within(calendar).getAllByRole('button')).toHaveLength(31)
  const first = screen.getByRole('button', { name: '2026-10-01' })
  expect(Array.from(calendar.children).indexOf(first)).toBe(10)
  expect(screen.getByRole('button', { name: '2026-10-21' }).hasAttribute('disabled')).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: '2026-10-05' }))
  expect(screen.getByRole('table').textContent).toContain('Monday meeting')
  fireEvent.click(screen.getByRole('button', { name: '참여 통계 CSV 다운로드' }))
  expect(downloadCSV).toHaveBeenCalledWith('attendance-2026-10-all-daily.csv', expect.stringContaining('"2026-10-05","월","19:00","Monday meeting","1"'))
  fireEvent.change(screen.getByLabelText('집계 월'), { target: { value: '2024-02' } })
  expect(screen.getByRole('button', { name: '2024-02-29' })).toBeTruthy()
  expect(screen.queryByRole('button', { name: '2024-02-30' })).toBeNull()
  expect(screen.getByRole('heading', { name: '2024-02-01' })).toBeTruthy()
})

test('attendance is a separate statistics panel, not affected by visit scope controls', () => {
  render(<MemoryRouter><DesktopStats calendarEvents={events} cards={[]} buildings={[]} visitHistories={[]}
    serviceSessions={[]} specialPeriods={[]} actualRole="admin" language="ko" /></MemoryRouter>)
  expect(screen.getByText('분석 범위')).toBeTruthy()
  fireEvent.click(screen.getByRole('tab', { name: '봉사 참여' }))
  expect(screen.queryByText('분석 범위')).toBeNull()
  expect(screen.getByLabelText('집계 월')).toBeTruthy()
  fireEvent.click(screen.getByRole('tab', { name: '방문 · 구역' }))
  expect(screen.getByText('분석 범위')).toBeTruthy()
})

test('overview distinguishes zero attendance from no meeting and keeps weekdays separate', () => {
  render(<ServiceAttendanceStats events={[...events,
    { id: 5, date: '2026-10-05', time: '10:00', title: 'Monday', applicants: [], hasMeeting: true } as CalendarEvent,
    { id: 6, date: '2026-10-06', time: '10:00', title: 'Tuesday', applicants: ['A', 'B', 'C'], hasMeeting: true } as CalendarEvent,
  ]} language="ko" now={new Date(2026, 9, 20, 12)} />)
  expect([...document.querySelectorAll('.attendance-day')].map(node => node.querySelector('strong')?.textContent ?? 'none')).toEqual(['0', '3', '1', 'none', 'none', 'none', 'none'])
  expect(document.querySelector('.attendance-day:nth-child(2) .attendance-bar-track span')?.getAttribute('style')).toContain('100%')
})

test('language can switch without changing month or participation data', () => {
  render(<ServiceAttendanceStats events={events} language="ko" now={new Date(2026, 9, 20, 12)} />)
  fireEvent.change(screen.getByLabelText('언어'), { target: { value: 'zh' } })
  expect(screen.getByRole('button', { name: '每周总览' })).toBeTruthy()
  expect(screen.getByLabelText('统计月份').getAttribute('value')).toBe('2026-10')
  expect([...document.querySelectorAll('.attendance-day:nth-child(3) strong')].map(node => node.textContent)).toEqual(['1', '1'])
  fireEvent.change(screen.getByLabelText('语言'), { target: { value: 'ko' } })
  expect(screen.getByRole('button', { name: '요일 한눈에' })).toBeTruthy()
})

test('PDF selection prints only chosen languages and views, with no date detail or future rows', () => {
  const print = vi.spyOn(window, 'print').mockImplementation(() => {})
  const { unmount } = render(<ServiceAttendanceStats events={events} language="ko" now={new Date(2026, 9, 20, 12)} />)
  fireEvent.click(screen.getByRole('button', { name: 'PDF 출력 설정' }))
  const options = screen.getByRole('region', { name: 'PDF 출력 설정' })
  const pages = () => [...document.querySelectorAll('.attendance-print-page')]
  expect(pages().map(page => [page.getAttribute('lang'), page.getAttribute('data-view')])).toEqual([['ko', 'overview']])
  fireEvent.click(within(options).getByRole('checkbox', { name: '中文' }))
  fireEvent.click(within(options).getByRole('checkbox', { name: '날짜별' }))
  fireEvent.click(within(options).getByRole('checkbox', { name: '요일별 상세' }))
  expect(pages()).toHaveLength(6)
  expect(pages().filter(page => page.getAttribute('lang') === 'zh')).toHaveLength(3)
  expect(document.querySelectorAll('.attendance-print-root .attendance-calendar')).toHaveLength(2)
  expect(document.querySelectorAll('.attendance-print-root [aria-live]')).toHaveLength(0)
  const details = document.querySelector('.attendance-print-page[lang="ko"][data-view="average"]')!
  expect(details.textContent).toContain('13:30')
  expect(details.textContent).not.toContain('Future')
  fireEvent.click(within(options).getByRole('button', { name: 'PDF / 인쇄' }))
  expect(print).toHaveBeenCalledOnce()
  fireEvent.click(within(options).getByRole('checkbox', { name: '한국어' }))
  expect(pages().map(page => page.getAttribute('lang'))).toEqual(['zh', 'zh', 'zh'])
  fireEvent.click(within(options).getByRole('checkbox', { name: '中文' }))
  expect((within(options).getByRole('button', { name: 'PDF / 인쇄' }) as HTMLButtonElement).disabled).toBe(true)
  fireEvent.click(within(options).getByRole('checkbox', { name: '한국어' }))
  for (const name of ['날짜별', '요일 한눈에', '요일별 상세']) fireEvent.click(within(options).getByRole('checkbox', { name }))
  expect(pages()).toHaveLength(0)
  expect((within(options).getByRole('button', { name: 'PDF / 인쇄' }) as HTMLButtonElement).disabled).toBe(true)
  fireEvent.click(within(options).getByRole('button', { name: '닫기' }))
  expect(document.querySelector('.attendance-print-root')).toBeNull()
  expect(document.body.classList.contains('attendance-print-active')).toBe(false)
  fireEvent.click(screen.getByRole('button', { name: 'PDF 출력 설정' }))
  unmount()
  expect(document.body.classList.contains('attendance-print-active')).toBe(false)
})
