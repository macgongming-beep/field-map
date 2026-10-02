// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MeetingSettings } from './MeetingSettings'
import { MeetingContext } from './context'
import { fetchMeetingCollections, saveMeetingCollection } from './api'
vi.mock('./model', async original => ({ ...await original<typeof import('./model')>(), meetingNotesEnabled: true }))
vi.mock('./api', () => ({ fetchMeetingCollections: vi.fn(), saveMeetingCollection: vi.fn() }))
const collection = { id: 4, nameKo: '숨긴 모음', nameZh: '', homeEnabled: false, startDate: '2026-09-29', endDate: '2026-10-04', homeVisibleUntil: '2026-10-18', homePosition: 'after_service' as const, collapseSuggestions: true, updatedAt: 'v1' }
afterEach(() => { cleanup(); vi.clearAllMocks() })
function mount(canManage = true) {
  return render(<MeetingContext.Provider value={{ userId: 1, canManage, data: { collections: [], notes: [] }, refresh: vi.fn() }}><MeetingSettings language="ko" /></MeetingContext.Provider>)
}
it('lets an admin enable a hidden collection from settings without opening an article', async () => {
  vi.mocked(fetchMeetingCollections).mockResolvedValue([collection])
  mount()
  await screen.findByRole('option', { name: '숨긴 모음' })
  expect(fetchMeetingCollections).toHaveBeenCalledWith()
  fireEvent.change(screen.getByLabelText('모음 관리'), { target: { value: '4' } })
  expect((screen.getByRole('switch') as HTMLInputElement).checked).toBe(false)
  fireEvent.click(screen.getByRole('switch'))
  fireEvent.click(screen.getByRole('button', { name: '저장' }))
  await waitFor(() => expect(saveMeetingCollection).toHaveBeenCalledWith(expect.objectContaining({ homeEnabled: true, startDate: collection.startDate, homeVisibleUntil: collection.homeVisibleUntil }), collection, false))
})
it('does not fetch or expose management for a non-admin direct entry', () => {
  mount(false)
  expect(fetchMeetingCollections).not.toHaveBeenCalled()
  expect(screen.queryByRole('heading')).toBeNull()
})
