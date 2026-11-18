import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { AdminMobileHome } from './AdminMobileHome'

vi.mock('../../features/meetingNotes/MeetingHome', () => ({ MeetingHome: () => null }))
vi.mock('../ServiceSuggestionsSection', () => ({ ServiceSuggestionsSection: () => <div>suggestions</div> }))
afterEach(cleanup)

it('home retains service content without operational statistics', () => {
  render(<AdminMobileHome language="ko" todayEvents={[]} onOpenEventDetail={vi.fn()} />)
  expect(screen.getByText('오늘의 봉사')).toBeTruthy()
  expect(screen.getByText('suggestions')).toBeTruthy()
  expect(screen.queryByText('운영 현황')).toBeNull()
})
