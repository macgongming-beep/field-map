import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, expect, test, vi } from 'vitest'
import { UserMobileHome } from './UserMobileHome'
import { DesktopHome } from './DesktopHome'
import { testCard } from '../test/territoryFixture'

vi.mock('./ServiceSuggestionsSection', () => ({ ServiceSuggestionsSection: () => <span>suggestions entry</span> }))
vi.mock('../features/meetingNotes/MeetingHome', () => ({ MeetingHome: () => null }))
afterEach(cleanup)
const cards = [testCard(1, 'Old progress card', { assignedLeader: 'Me', progress: 73, completed: 73, units: 100 })]

test('leader home excludes progress even if legacy card props are supplied', () => {
  const legacy = { leaderCards: cards, onOpenZone: vi.fn() }
  render(<UserMobileHome {...legacy} language="ko" role="leader" myTodayEvents={[]} onOpenEventDetail={vi.fn()} />)
  expect(screen.getByText('오늘의 봉사')).toBeTruthy()
  expect(screen.getByText('suggestions entry')).toBeTruthy()
  expect(screen.queryByText('Old progress card')).toBeNull()
  expect(screen.queryByText('73%')).toBeNull()
})

test.each(['leader', 'admin'] as const)('%s desktop home retains service entries without progress', role => {
  render(<MemoryRouter><DesktopHome language="ko" role={role} cards={cards} calendarEvents={[]} currentVisitor="Me"
    serviceSessions={[]} onApplyToEvent={vi.fn()} onStartServiceSession={vi.fn()} onEndServiceSession={vi.fn()} onOpenTerritory={vi.fn()} /></MemoryRouter>)
  expect(screen.getByText('오늘의 봉사')).toBeTruthy()
  expect(screen.getByText('suggestions entry')).toBeTruthy()
  expect(screen.queryByText('운영 현황')).toBeNull()
  expect(screen.queryByText('Old progress card')).toBeNull()
})
