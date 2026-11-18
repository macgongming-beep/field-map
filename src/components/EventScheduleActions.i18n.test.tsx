import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import type { ComponentProps } from 'react'
import type { CalendarEvent } from '../types'
import { setCurrentLang, t } from '../i18n'
import { AdminEventDetailSheet } from './admin/AdminEventDetailSheet'
import { DesktopCalendar } from './DesktopCalendar'
import { GroupServiceDetail } from '../features/groupService/GroupServiceDetail'

vi.mock('./CommentSection', () => ({ CommentSection: () => null }))
vi.mock('./calendar/CartApplicantSection', () => ({ CartApplicantSection: () => null }))
vi.mock('../features/meetingNotes/MeetingEditor', () => ({ MeetingEditor: () => null }))
vi.mock('../features/groupService/GroupEventComments', () => ({ GroupEventComments: () => null }))
vi.mock('../hooks/useEventLeaderContacts', () => ({ useEventLeaderContacts: () => ({ phoneByName: new Map(), loading: false, error: false, retry: vi.fn() }) }))
vi.mock('../features/groupService/api', () => ({
  readGroupServiceContext: vi.fn(async () => ({ ownGroup: 'dongtan', events: [{ id: 10, groupCode: 'dongtan', count: 0, canManage: true, canEdit: true, canRead: true }] })),
  readMeetingAccess: vi.fn(),
}))

const event: CalendarEvent = { id: 10, date: '2026-11-18', time: '14:30', endTime: '16:30',
  title: 'Service', type: '주택', serviceKind: 'congregation', place: '', memo: '',
  leader: '', leaders: [], card: '', hasMeeting: false, meetingMode: 'none',
  allowApplications: true, applicants: [], guests: [], assigned: [], cardAssignments: [] }

beforeEach(() => {
  vi.stubEnv('VITE_GROUP_SERVICE_ENABLED', 'true')
  vi.stubEnv('VITE_ASSIGNMENT_REVISION_ENABLED', 'true')
  vi.stubEnv('VITE_CHAT_DISABLED', 'true')
  Element.prototype.scrollIntoView = vi.fn()
})
afterEach(() => { cleanup(); setCurrentLang('ko'); vi.unstubAllEnvs(); vi.clearAllMocks() })

for (const layout of ['mobile-congregation', 'desktop-congregation', 'mobile-group', 'desktop-group'] as const) {
  test.each([
    ['zh', '修改安排', '删除安排'],
    ['en', 'Edit event', 'Delete event'],
  ] as const)(`${layout} resolves both schedule labels through the real %s dictionary`, async (language, editLabel, deleteLabel) => {
    setCurrentLang(language)
    let trigger: HTMLElement
    if (layout.endsWith('group')) {
      const groupEvent: CalendarEvent = { ...event, serviceKind: 'group', groupServiceScope: true, targetGroups: ['dongtan'] }
      render(<GroupServiceDetail event={groupEvent} events={[groupEvent]} language={language} role="admin"
        currentVisitor="Admin" mobile={layout === 'mobile-group'} onClose={vi.fn()} onEdit={vi.fn()} onDelete={vi.fn()} />)
      trigger = await screen.findByRole('button', { name: t(language, 'map.more'), exact: true })
    } else if (layout === 'mobile-congregation') {
      render(<AdminEventDetailSheet event={event} role="admin" currentVisitor="Admin" language={language}
        onClose={vi.fn()} onEdit={vi.fn()} onDelete={vi.fn()} />)
      trigger = screen.getByRole('button', { name: t(language, 'map.more'), exact: true })
    } else {
      const props = { events: [event], language, role: 'admin', actualRole: 'admin', currentVisitor: 'Admin',
        cards: [], specialPeriods: [], participantUsers: [], onApplyToEvent: vi.fn(), onCreateEvent: vi.fn(),
        onCreateRepeatEvents: vi.fn(), onDeleteEvent: vi.fn(), onDeleteEventSeries: vi.fn(),
        onLinkEventsToSeries: vi.fn(), onRemoveParticipant: vi.fn(), onUpdateEvent: vi.fn(),
        onUpdateEventSeries: vi.fn(), onCreateSpecialPeriod: vi.fn(), onDeleteSpecialPeriod: vi.fn(),
      } as ComponentProps<typeof DesktopCalendar>
      const view = render(<MemoryRouter initialEntries={['/calendar?openEvent=10']}><DesktopCalendar {...props} /></MemoryRouter>)
      trigger = view.container.querySelector<HTMLButtonElement>('.event-dots-btn')!
      expect(trigger).not.toBeNull()
    }
    fireEvent.click(trigger)
    const itemRole = layout.endsWith('group') ? 'menuitem' : 'button'
    expect(screen.getByRole(itemRole, { name: editLabel, exact: true })).toBeTruthy()
    expect(screen.getByRole(itemRole, { name: deleteLabel, exact: true })).toBeTruthy()
    expect(screen.queryByRole(itemRole, { name: '일정 수정', exact: true })).toBeNull()
    expect(screen.queryByRole(itemRole, { name: '일정 삭제', exact: true })).toBeNull()
  })
}
