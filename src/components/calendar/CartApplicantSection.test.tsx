import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { CalendarEvent } from '../../types'
import { CartApplicantSection } from './CartApplicantSection'

vi.mock('../../config/features', () => ({ CART_APPLICATIONS_ENABLED: true }))

afterEach(cleanup)

const event = {
  id: 1,
  date: '2026-09-13',
  time: '10:00',
  title: '봉사',
  type: '주택',
  place: '',
  leader: '인도자',
  leaders: ['인도자'],
  card: '',
  hasMeeting: true,
  allowApplications: true,
  allowCartApplications: true,
  cartCapacity: 4,
  applicants: [],
  guests: [],
  assigned: [],
  cardAssignments: [],
  cartApplicants: [],
  memo: '',
} satisfies CalendarEvent

function renderSection(cartServiceApproved: boolean) {
  const onApply = vi.fn()
  render(
    <CartApplicantSection
      canManage={false}
      currentVisitor="봉사자"
      event={event}
      language="ko"
      onApply={onApply}
      users={[{
        id: 7,
        name: '봉사자',
        approvalStatus: 'approved',
        isActive: true,
        cartServiceApproved,
      }]}
    />,
  )
  return onApply
}

describe('전시대 신청 영역', () => {
  test('승인된 사용자의 신청 버튼은 펼친 뒤에만 보인다', () => {
    const onApply = renderSection(true)

    expect(screen.queryByRole('button', { name: '전시대 봉사 신청' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '전시대 0/4' }))
    fireEvent.click(screen.getByRole('button', { name: '전시대 봉사 신청' }))

    expect(onApply).toHaveBeenCalledOnce()
  })

  test('미승인 사용자에게는 펼쳐도 신청 버튼을 보이지 않는다', () => {
    renderSection(false)

    fireEvent.click(screen.getByRole('button', { name: '전시대 0/4' }))

    expect(screen.queryByRole('button', { name: '전시대 봉사 신청' })).toBeNull()
  })
})
