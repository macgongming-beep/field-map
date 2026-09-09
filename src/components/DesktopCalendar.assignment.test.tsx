import { describe, expect, test, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import type { CalendarEvent, TerritoryCard } from '../types'
import { DesktopCalendar } from './DesktopCalendar'

vi.mock('./assignment/AssignmentEditor', () => ({
  AssignmentEditor: ({ cards, canEdit }: { cards: TerritoryCard[]; canEdit: boolean }) => (
    <div data-testid="assignment-editor">
      <span>{canEdit ? '편집 가능' : '읽기 전용'}</span>
      <span>{cards.map((card) => card.name).join(',')}</span>
    </div>
  ),
}))

vi.mock('./CommentSection', () => ({
  CommentSection: () => <div data-testid="comments" />,
}))

vi.mock('./ChatRoom', () => ({
  ChatRoom: () => <div data-testid="chat-room" />,
}))

function localDateString() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

const cards = [
  { id: 1, name: '인도자 담당 구역', assignedLeader: '인도자', assignedLeaders: ['인도자'] },
  { id: 2, name: '다른 인도자 구역', assignedLeader: '다른 사람', assignedLeaders: ['다른 사람'] },
] as TerritoryCard[]

const event = {
  id: 91,
  date: localDateString(),
  time: '10:00',
  title: '오전 봉사',
  type: '주택',
  place: '회관',
  leader: '인도자',
  leaders: ['인도자'],
  card: '',
  hasMeeting: true,
  allowApplications: true,
  applicants: ['봉사자'],
  guests: [],
  assigned: [],
  cardAssignments: [],
  memo: '',
} satisfies CalendarEvent

function calendarProps(overrides: Record<string, unknown> = {}) {
  return {
    currentVisitor: '관리자',
    cards,
    events: [event],
    role: 'admin',
    actualRole: 'admin',
    specialPeriods: [],
    onApplyToEvent: vi.fn(),
    onAssignCardToEventParticipant: vi.fn(),
    onAssignCardsToEventParticipantsBulk: vi.fn(),
    onAddParticipant: vi.fn(),
    onCreateEvent: vi.fn(),
    onCreateRepeatEvents: vi.fn(),
    onDeleteEvent: vi.fn(),
    onDeleteEventSeries: vi.fn(),
    onLinkEventsToSeries: vi.fn(),
    onRemoveParticipant: vi.fn(),
    onUpdateEvent: vi.fn(),
    onUpdateEventSeries: vi.fn(),
    onCreateSpecialPeriod: vi.fn(),
    onDeleteSpecialPeriod: vi.fn(),
    ...overrides,
  }
}

async function openAssignment(overrides: Record<string, unknown> = {}) {
  const user = userEvent.setup()
  render(
    <MemoryRouter>
      <DesktopCalendar {...(calendarProps(overrides) as never)} />
    </MemoryRouter>,
  )
  await user.click(screen.getByRole('button', { name: '팀 구성 및 배정' }))
  return screen.getByTestId('assignment-editor')
}

describe('PC 일정 배정 권한', () => {
  test('관리자는 화면 모드와 무관하게 모든 구역을 편집한다', async () => {
    const editor = await openAssignment({ role: 'leader', actualRole: 'admin' })

    expect(editor.textContent).toContain('편집 가능')
    expect(editor.textContent).toContain('인도자 담당 구역,다른 인도자 구역')
  })

  test('인도자는 자신에게 배정된 구역만 편집한다', async () => {
    const editor = await openAssignment({
      currentVisitor: '인도자',
      role: 'leader',
      actualRole: 'leader',
    })

    expect(editor.textContent).toContain('편집 가능')
    expect(editor.textContent).toContain('인도자 담당 구역')
    expect(editor.textContent).not.toContain('다른 인도자 구역')
  })

  test('신청자가 일곱 명을 넘어도 전부 보여 준다', () => {
    const applicants = Array.from({ length: 10 }, (_, index) => `신청자${index + 1}`)
    render(
      <MemoryRouter>
        <DesktopCalendar {...(calendarProps({ events: [{ ...event, applicants }] }) as never)} />
      </MemoryRouter>,
    )

    expect(screen.getByText('신청자10')).toBeTruthy()
    expect(screen.queryByText('+3')).toBeNull()
  })

  test('일반 사용자와 인도자에게 일정 추가 진입점을 노출하지 않는다', () => {
    const { rerender } = render(
      <MemoryRouter>
        <DesktopCalendar {...(calendarProps({ role: 'user', actualRole: 'user' }) as never)} />
      </MemoryRouter>,
    )

    expect(screen.queryAllByRole('button', { name: '+ 일정 추가' })).toHaveLength(0)

    rerender(
      <MemoryRouter>
        <DesktopCalendar {...(calendarProps({ role: 'leader', actualRole: 'leader' }) as never)} />
      </MemoryRouter>,
    )

    expect(screen.queryAllByRole('button', { name: '+ 일정 추가' })).toHaveLength(0)
  })
})
