import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { AdminMobileCalendar } from './AdminMobileCalendar'

describe('모바일 캘린더 특별봉사 기간 표시', () => {
  it('날짜 셀 대신 숫자 크기만 시즌 색으로 표시한다', () => {
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
            label: 'Autumn service',
            startDate: '2026-09-01',
            endDate: '2026-09-30',
            color: '#4f7d62',
            hasInvitation: false,
          }]}
        />
      </MemoryRouter>,
    )

    expect(screen.getByText('Autumn service')).not.toBeNull()
    expect(screen.getByText('09.01–09.30')).not.toBeNull()

    const dayButton = screen.getByText('12').closest('button')
    expect(dayButton?.style.background).toBe('transparent')
    expect(screen.getByText('12').style.background).toBe('var(--ink)')
    expect(screen.getByText('11').style.background).toBe('rgba(79, 125, 98, 0.125)')
    expect(container.querySelector('.mobile-calendar-period-mark')).toBeNull()

    vi.useRealTimers()
  })
})
