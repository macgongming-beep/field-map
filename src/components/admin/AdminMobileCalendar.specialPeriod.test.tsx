import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { AdminMobileCalendar } from './AdminMobileCalendar'

describe('모바일 캘린더 특별봉사 기간 표시', () => {
  it('날짜 셀을 칠하지 않고 시즌 안내와 얇은 표시선을 보여준다', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-12T09:00:00+09:00'))

    const { container } = render(
      <MemoryRouter>
        <AdminMobileCalendar
          language="ko"
          currentVisitor="관리자"
          role="admin"
          events={[]}
          specialPeriods={[{
            id: 1,
            label: '가을 특별봉사',
            startDate: '2026-09-01',
            endDate: '2026-09-30',
            color: '#4f7d62',
            hasInvitation: false,
          }]}
        />
      </MemoryRouter>,
    )

    expect(screen.getByText('가을 특별봉사')).not.toBeNull()
    expect(screen.getByText('09.01–09.30')).not.toBeNull()

    const dayButton = screen.getByText('12').closest('button')
    expect(dayButton?.style.background).toBe('transparent')
    expect(dayButton?.querySelector('.mobile-calendar-period-mark')).not.toBeNull()
    expect(container.querySelectorAll('.mobile-calendar-period-mark')).toHaveLength(30)

    vi.useRealTimers()
  })
})
