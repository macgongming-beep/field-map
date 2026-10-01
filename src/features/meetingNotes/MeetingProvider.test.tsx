// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, useNavigate } from 'react-router-dom'
const api = vi.hoisted(() => ({ fetchMeetingCollections: vi.fn(), fetchMeetingNoteMetas: vi.fn(), fetchMeetingNote: vi.fn() }))
vi.mock('./api', async original => ({ ...await original<typeof import('./api')>(), ...api }))
vi.mock('../../lib/supabase', () => ({ supabase: {} }))
vi.mock('./model', async original => ({ ...await original<typeof import('./model')>(), meetingNotesEnabled: true }))
import { MeetingProvider } from './MeetingProvider'
import { MeetingHome } from './MeetingHome'
import { readNoteVersion } from './model'

const group = { id: 1, nameKo: '순회방문', nameZh: '', startDate: '2020-01-01', endDate: '2099-01-01', homeVisibleUntil: '2099-01-15', homePosition: 'after_service', collapseSuggestions: true, updatedAt: 'v1' }
const meta = { id: 5, collectionId: 1, eventId: 3, titleKo: '모임 제목', titleZh: '', date: '2026-10-01', time: '10:00', leader: '인도자', place: '장소', excerptKo: '짧은 발췌', excerptZh: '', readingMinutesKo: 2, readingMinutesZh: 1, updatedAt: 'v1' }
function Driver() { const navigate = useNavigate(); return <><button onClick={() => navigate('/calendar')}>calendar</button><button onClick={() => navigate('/')}>home</button><MeetingHome language="ko" position="after_service" /></> }
function mount() { const root = document.createElement('div'); root.id = 'root'; document.body.append(root); return render(<MemoryRouter><MeetingProvider userId={9} canManage={false} language="ko"><Driver /></MeetingProvider></MemoryRouter>, { container: root }) }
beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); api.fetchMeetingCollections.mockResolvedValue([group]); api.fetchMeetingNoteMetas.mockResolvedValue([meta]); api.fetchMeetingNote.mockResolvedValue({ ...meta, bodyKo: '본문 전체', bodyZh: '' }) })
afterEach(() => { cleanup(); document.body.replaceChildren() })
it('fetches no body on home or list, reads only after successful article load', async () => {
  mount()
  await screen.findByText('순회방문')
  expect(api.fetchMeetingNote).not.toHaveBeenCalled()
  expect(screen.queryByText('모임 제목')).toBe(null)
  fireEvent.click(screen.getByText('순회방문'))
  await screen.findByText('모임 제목')
  expect(screen.queryByText('짧은 발췌')).toBe(null)
  expect(api.fetchMeetingNote).not.toHaveBeenCalled()
  expect(readNoteVersion(9, 5)).toBe(null)
  fireEvent.click(screen.getAllByText('모임 제목').at(-1)!)
  await screen.findByText('본문 전체')
  expect(screen.queryByText('中文')).toBe(null)
  expect(api.fetchMeetingNote).toHaveBeenCalledWith(5)
  expect(readNoteVersion(9, 5)).toBe('v1')
})
it('does not fetch again on focus or visibility, but does on next home entry', async () => {
  mount(); await screen.findByText('순회방문')
  window.dispatchEvent(new Event('focus')); document.dispatchEvent(new Event('visibilitychange'))
  expect(api.fetchMeetingCollections).toHaveBeenCalledTimes(1)
  fireEvent.click(screen.getByText('calendar')); fireEvent.click(screen.getByText('home'))
  await waitFor(() => expect(api.fetchMeetingCollections).toHaveBeenCalledTimes(2))
})
it('does not issue a note metadata request when the active collection query is empty', async () => {
  api.fetchMeetingCollections.mockResolvedValue([])
  mount()
  await waitFor(() => expect(api.fetchMeetingCollections).toHaveBeenCalledTimes(1))
  // The API short-circuits an empty list; no body request is made either.
  expect(api.fetchMeetingNoteMetas).toHaveBeenCalledWith([])
  expect(api.fetchMeetingNote).not.toHaveBeenCalled()
  expect(screen.queryByText('순회방문')).toBe(null)
})
it('a failed body fetch never marks the article read', async () => {
  api.fetchMeetingNote.mockRejectedValue(new Error('network'))
  mount(); await screen.findByText('순회방문')
  fireEvent.click(screen.getByText('순회방문'))
  await screen.findByText('모임 제목')
  fireEvent.click(screen.getByText('모임 제목'))
  await screen.findByRole('alert')
  expect(readNoteVersion(9, 5)).toBe(null)
})
