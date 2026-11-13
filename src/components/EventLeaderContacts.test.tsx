import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import type { CalendarEvent } from '../types'
const api = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('../lib/supabase', () => ({ supabase: { rpc: api.rpc } }))
vi.mock('../lib/authToken', () => ({ getAuthToken: () => 'test-token' }))
vi.mock('./CommentSection', () => ({ CommentSection: () => null }))
vi.mock('./calendar/CartApplicantSection', () => ({ CartApplicantSection: () => null }))
vi.mock('../features/meetingNotes/MeetingEditor', () => ({ MeetingEditor: () => null }))
import { AdminEventDetailSheet } from './admin/AdminEventDetailSheet'
import { DesktopCalendar } from './DesktopCalendar'
const event = { id: 10, date: '2026-11-10', time: '10:00', title: 'Test service', type: '주택', place: '',
  leader: 'Leader', leaders: ['Leader'], card: '', hasMeeting: false, allowApplications: false,
  applicants: [], guests: [], assigned: [], cardAssignments: [], memo: '' } satisfies CalendarEvent
beforeEach(() => {
  vi.stubEnv('VITE_PRIVATE_USER_READS_ENABLED', 'true')
  // Match production navigation: the retired-chat path selects the linked date.
  vi.stubEnv('VITE_CHAT_DISABLED', 'true')
  api.rpc.mockResolvedValue({ data: [{ id: 2, name: 'Leader', phone: '010-0000-0000' }], error: null })
  Element.prototype.scrollIntoView = vi.fn()
})
afterEach(() => { cleanup(); vi.unstubAllEnvs(); vi.clearAllMocks() })
test.each(['mobile', 'desktop'])('%s renders event-specific call link without phone numbers in participant directory', async layout => {
  const participantUsers = [{ id: 2, name: 'Leader', phone: null }]
  if (layout === 'mobile') render(<AdminEventDetailSheet event={event} role="user" currentVisitor="Member" participantUsers={participantUsers} onClose={() => {}} />)
  else render(<MemoryRouter initialEntries={['/calendar?openEvent=10']}><DesktopCalendar {...({
    events: [event], role: 'user', actualRole: 'user', currentVisitor: 'Member', cards: [], specialPeriods: [], participantUsers,
    onApplyToEvent: vi.fn(), onCreateEvent: vi.fn(), onCreateRepeatEvents: vi.fn(), onDeleteEvent: vi.fn(), onDeleteEventSeries: vi.fn(),
    onLinkEventsToSeries: vi.fn(), onRemoveParticipant: vi.fn(), onUpdateEvent: vi.fn(), onUpdateEventSeries: vi.fn(), onCreateSpecialPeriod: vi.fn(), onDeleteSpecialPeriod: vi.fn(),
  } as never)} /></MemoryRouter>)
  expect((await screen.findByRole('link', { name: 'Leader에게 전화' })).getAttribute('href')).toBe('tel:01000000000')
  expect(api.rpc).toHaveBeenCalledWith('get_event_leader_contacts', { p_event_id: 10 })
})
