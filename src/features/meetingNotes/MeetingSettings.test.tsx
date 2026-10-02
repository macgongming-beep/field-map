// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MeetingSettings } from './MeetingSettings'
import { MeetingContext } from './context'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { changeMeetingCollection, fetchMeetingCollections, saveMeetingCollection } from './api'
import { confirmDialog } from '../../lib/confirm'
vi.mock('../../lib/confirm', () => ({ confirmDialog: vi.fn() }))
vi.mock('./model', async original => ({ ...await original<typeof import('./model')>(), meetingNotesEnabled: true }))
vi.mock('./api', () => ({ fetchMeetingCollections: vi.fn(), saveMeetingCollection: vi.fn(), changeMeetingCollection: vi.fn() }))
const collection = { id: 4, nameKo: '숨긴 모음', nameZh: '', homeEnabled: false, startDate: '2026-09-29', endDate: '2026-10-04', homeVisibleUntil: '2026-10-18', homePosition: 'after_service' as const, collapseSuggestions: true, updatedAt: 'v1' }
afterEach(() => { cleanup(); vi.clearAllMocks() })
function mount(canManage = true) {
  return render(<MemoryRouter><MeetingContext.Provider value={{ userId: 1, canManage, data: { collections: [], notes: [] }, refresh: vi.fn() }}><MeetingSettings language="ko" /><Location /></MeetingContext.Provider></MemoryRouter>)
}
function Location() { return <output>{useLocation().search}</output> }
it('lets an admin enable a hidden collection from settings without opening an article', async () => {
  vi.mocked(fetchMeetingCollections).mockResolvedValue([collection])
  mount()
  await screen.findByRole('option', { name: '숨긴 모음' })
  expect(fetchMeetingCollections).toHaveBeenCalledWith(undefined)
  fireEvent.change(screen.getByLabelText('모음 관리'), { target: { value: '4' } })
  const archive = screen.getByRole('button', { name: '모음 삭제' })
  expect(archive.compareDocumentPosition(screen.getByLabelText('모음 이름 · 한국어')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect(screen.queryByLabelText('시작일')).toBeNull()
  expect(screen.queryByLabelText('종료일')).toBeNull()
  expect(screen.queryByLabelText('홈 표시 종료일')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '내용 보기' }))
  expect(screen.getByText('?meetingCollection=4')).toBeTruthy()
  expect((screen.getByRole('switch') as HTMLInputElement).checked).toBe(false)
  fireEvent.click(screen.getByRole('switch'))
  fireEvent.click(screen.getByRole('button', { name: '저장' }))
  await waitFor(() => expect(saveMeetingCollection).toHaveBeenCalledWith(expect.objectContaining({ homeEnabled: true }), collection))
})
it('deletes to trash only after confirmation and restores from trash', async () => {
  vi.mocked(fetchMeetingCollections).mockResolvedValue([collection])
  vi.mocked(confirmDialog).mockResolvedValue(false)
  mount(); await screen.findByRole('option', { name: '숨긴 모음' })
  fireEvent.change(screen.getByLabelText('모음 관리'), { target: { value: '4' } })
  fireEvent.click(screen.getByRole('button', { name: '모음 삭제' }))
  await waitFor(() => expect(confirmDialog).toHaveBeenCalled())
  expect(changeMeetingCollection).not.toHaveBeenCalled()
  vi.mocked(confirmDialog).mockResolvedValue(true)
  fireEvent.click(screen.getByRole('button', { name: '모음 삭제' }))
  await waitFor(() => expect(changeMeetingCollection).toHaveBeenCalledWith(collection, 'trash'))
  fireEvent.click(screen.getByRole('tab', { name: '휴지통' }))
  fireEvent.click(await screen.findByRole('button', { name: '복원' }))
  await waitFor(() => expect(changeMeetingCollection).toHaveBeenCalledWith(collection, 'restore'))
})
it('requires confirmation for permanent deletion', async () => {
  vi.mocked(fetchMeetingCollections).mockResolvedValue([collection])
  vi.mocked(confirmDialog).mockResolvedValue(false)
  mount(); await screen.findByRole('option', { name: '숨긴 모음' })
  fireEvent.click(screen.getByRole('tab', { name: '휴지통' }))
  fireEvent.click(await screen.findByRole('button', { name: '완전 삭제' }))
  await waitFor(() => expect(confirmDialog).toHaveBeenCalled())
  expect(changeMeetingCollection).not.toHaveBeenCalled()
  vi.mocked(confirmDialog).mockResolvedValue(true)
  fireEvent.click(screen.getByRole('button', { name: '완전 삭제' }))
  await waitFor(() => expect(changeMeetingCollection).toHaveBeenCalledWith(collection, 'purge'))
})
it('does not fetch or expose management for a non-admin direct entry', () => {
  mount(false)
  expect(fetchMeetingCollections).not.toHaveBeenCalled()
  expect(screen.queryByRole('heading')).toBeNull()
})
