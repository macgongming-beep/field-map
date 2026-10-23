import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CalendarEvent } from '../../types'
import { AdminMobileCalendar } from './AdminMobileCalendar'
import { CalendarReadContext } from '../../hooks/CalendarReadContext'

vi.mock('../CommentSection', () => ({
  CommentSection: () => <div>comment area</div>,
}))

const event: CalendarEvent = {
  id: 17,
  date: '2026-09-16',
  time: '13:30',
  endTime: '16:00',
  title: '传道',
  type: '혼합',
  place: '',
  leader: '인도자',
  leaders: ['인도자'],
  card: '',
  hasMeeting: false,
  allowApplications: true,
  applicants: [],
  guests: [],
  assigned: [],
  cardAssignments: [],
  memo: '',
}

beforeEach(() => {
  vi.spyOn(window.history, 'back').mockImplementation(() => {
    window.history.replaceState({}, '', '/')
    window.dispatchEvent(new PopStateEvent('popstate', { state: {} }))
  })
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

function HomeDetail({ events = [event] }: { events?: CalendarEvent[] }) {
  const location = useLocation()
  return location.search ? <AdminMobileCalendar detailOnly language="ko" currentVisitor="봉사자" role="user" events={events} /> : <div>home screen</div>
}

describe('모바일 일정 상세 뒤로가기', () => {
  it('home detail applies to the selected event and reflects fresh participant props', () => {
    const apply = vi.fn()
    const detail = (applicants: string[]) => <MemoryRouter initialEntries={['/?openEvent=17']}>
      <AdminMobileCalendar detailOnly language="ko" currentVisitor="봉사자" role="user"
        events={[{ ...event, applicants }]} onApplyToEvent={apply} />
    </MemoryRouter>
    const view = render(detail([]))
    fireEvent.click(screen.getByRole('button', { name: /신청하기/ }))
    expect(apply).toHaveBeenCalledWith(17)
    view.rerender(detail(['봉사자', '동료']))
    expect(screen.getByText('동료')).toBeTruthy()
    expect(screen.getByRole('button', { name: '신청취소' })).toBeTruthy()
  })

  it('editing from home explicitly requests full calendar history', async () => {
    const select = vi.fn()
    const page = (full: boolean, ready: boolean) => <MemoryRouter initialEntries={['/?openEvent=17']}>
      <CalendarReadContext.Provider value={{ month: '', full, ready, error: false, select, retry: vi.fn() }}>
        <AdminMobileCalendar detailOnly language="ko" currentVisitor="관리자" role="admin"
          events={[{ ...event }]} onUpdateEvent={vi.fn()} />
      </CalendarReadContext.Provider>
    </MemoryRouter>
    const view = render(page(false, true))
    fireEvent.click(screen.getByRole('button', { name: '더보기' }))
    fireEvent.click(screen.getByRole('button', { name: '편집' }))
    await waitFor(() => expect(select).toHaveBeenLastCalledWith('', true))
    expect(screen.queryByText('comment area')).toBeNull()
    view.rerender(page(true, false))
    expect(screen.getByRole('status')).toBeTruthy()
    view.rerender(page(true, true))
    expect(screen.getByText('일정 편집')).toBeTruthy()
    expect(screen.getByPlaceholderText('일정 제목').getAttribute('value')).toBe('传道')
    expect(screen.queryByText('comment area')).toBeNull()
  })

  it.each(['button', 'gesture', 'external'] as const)('direct home detail hides the calendar and returns home: %s', async mode => {
    vi.spyOn(window.history, 'back').mockImplementation(() => {
      window.history.replaceState({}, '', '/')
      window.dispatchEvent(new PopStateEvent('popstate', { state: {} }))
    })
    render(<MemoryRouter initialEntries={mode === 'external' ? ['/?openEvent=17'] : ['/', {
      pathname: '/', search: '?openEvent=17', state: { eventDetailReturnTo: '/' },
    }]} initialIndex={mode === 'external' ? 0 : 1}><HomeDetail /></MemoryRouter>)
    expect(screen.getByText('comment area')).toBeTruthy()
    expect(screen.queryByRole('heading', { name: /2026년.*월/ })).toBeNull()
    if (mode === 'gesture') act(() => window.history.back())
    else fireEvent.click(screen.getByRole('button', { name: '뒤로' }))
    await waitFor(() => expect(screen.getByText('home screen')).toBeTruthy())
    expect(screen.queryByText('comment area')).toBeNull()
  })

  it('missing home event has a way home without showing the calendar', async () => {
    render(<MemoryRouter initialEntries={['/?openEvent=999']}><HomeDetail /></MemoryRouter>)
    expect(screen.getByRole('status')).toBeTruthy()
    expect(screen.queryByRole('heading', { name: /2026년.*월/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '뒤로' }))
    await waitFor(() => expect(screen.getByText('home screen')).toBeTruthy())
  })

  it('홈에서 연 상세는 상단 뒤로 버튼으로 홈에 돌아간다', async () => {
    const pushState = vi.spyOn(window.history, 'pushState')
    vi.spyOn(window.history, 'back').mockImplementation(() => {
      window.history.replaceState({}, '', '/calendar')
      window.dispatchEvent(new PopStateEvent('popstate', { state: {} }))
    })

    render(
      <MemoryRouter
        initialEntries={[
          '/',
          { pathname: '/calendar', search: '?openEvent=17', state: { eventDetailReturnTo: '/' } },
        ]}
        initialIndex={1}
      >
        <Routes>
          <Route path="/" element={<div>home screen</div>} />
          <Route
            path="/calendar"
            element={(
              <AdminMobileCalendar
                language="ko"
                currentVisitor="봉사자"
                role="user"
                events={[event]}
              />
            )}
          />
        </Routes>
      </MemoryRouter>,
    )

    await screen.findByRole('button', { name: '뒤로' })
    expect(pushState).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: '뒤로' }))
    await waitFor(() => expect(screen.getByText('home screen')).toBeTruthy())
    expect(screen.queryByRole('button', { name: '뒤로' })).toBeNull()
  })

  it('알림을 보던 구역 화면에서 연 상세는 스와이프 한 번으로 구역에 돌아간다', async () => {
    render(
      <MemoryRouter
        initialEntries={[
          '/zone?scope=cards',
          { pathname: '/calendar', search: '?openEvent=17', state: { eventDetailReturnTo: '/zone?scope=cards' } },
        ]}
        initialIndex={1}
      >
        <Routes>
          <Route path="/zone" element={<div>zone screen</div>} />
          <Route
            path="/calendar"
            element={(
              <AdminMobileCalendar
                language="ko"
                currentVisitor="봉사자"
                role="user"
                events={[event]}
              />
            )}
          />
        </Routes>
      </MemoryRouter>,
    )

    await screen.findByRole('button', { name: '뒤로' })
    act(() => {
      window.history.replaceState({}, '', '/calendar')
      window.dispatchEvent(new PopStateEvent('popstate', { state: {} }))
    })

    await waitFor(() => expect(screen.getByText('zone screen')).toBeTruthy())
  })

  it('외부 알림으로 바로 연 상세는 스와이프 뒤 캘린더에 안전하게 남는다', async () => {
    render(
      <MemoryRouter initialEntries={['/calendar?openEvent=17']}>
        <AdminMobileCalendar
          language="ko"
          currentVisitor="봉사자"
          role="user"
          events={[event]}
        />
      </MemoryRouter>,
    )

    await screen.findByRole('button', { name: '뒤로' })
    act(() => {
      window.history.replaceState({}, '', '/calendar')
      window.dispatchEvent(new PopStateEvent('popstate', { state: {} }))
    })

    await waitFor(() => expect(screen.queryByRole('button', { name: '뒤로' })).toBeNull())
    expect(screen.getByRole('heading', { name: '2026년 9월' })).toBeTruthy()
  })

  it('인도자를 사람별로 표시하고 등록된 번호가 있는 인도자만 전화 링크로 만든다', async () => {
    render(
      <MemoryRouter initialEntries={['/calendar?openEvent=17']}>
        <AdminMobileCalendar
          language="ko"
          currentVisitor="봉사자"
          role="user"
          events={[{ ...event, leader: '첫째, 둘째', leaders: ['첫째', '둘째'] }]}
          participantUsers={[
            { id: 1, name: '첫째', phone: '010-1234-5678' },
            { id: 2, name: '둘째', phone: null },
          ]}
        />
      </MemoryRouter>,
    )

    expect(await screen.findByText('첫째')).toBeTruthy()
    expect(screen.getByText('둘째')).toBeTruthy()
    expect(screen.getByRole('link', { name: '첫째에게 전화' }).getAttribute('href')).toBe('tel:01012345678')
    expect(screen.queryByRole('link', { name: '둘째에게 전화' })).toBeNull()
  })
})
