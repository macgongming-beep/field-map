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
vi.mock('./api', () => ({ MeetingConflict: class extends Error {}, fetchMeetingCollections: vi.fn(), saveMeetingCollection: vi.fn(), changeMeetingCollection: vi.fn() }))
const collection = { id: 4, nameKo: '숨긴 모음', nameZh: '', homeEnabled: false, startDate: '2026-09-29', endDate: '2026-10-04', homeVisibleUntil: '2026-10-18', homePosition: 'after_service' as const, collapseSuggestions: true, updatedAt: 'v1' }
afterEach(() => { cleanup(); vi.resetAllMocks() })
function mount(canManage = true) {
  return render(<MemoryRouter><MeetingContext.Provider value={{ userId: 1, canManage, data: { collections: [], notes: [] }, refresh: vi.fn() }}><MeetingSettings language="ko" /><Location /></MeetingContext.Provider></MemoryRouter>)
}
function Location() { return <output>{useLocation().search}</output> }
it('lets an admin enable a hidden collection from settings without opening an article', async () => {
  vi.mocked(fetchMeetingCollections).mockResolvedValue([collection])
  mount()
  await screen.findByRole('option', { name: '숨긴 모음' })
  expect(fetchMeetingCollections).toHaveBeenCalledWith(undefined)
  fireEvent.change(screen.getByLabelText('주제 관리'), { target: { value: '4' } })
  const archive = screen.getByRole('button', { name: '휴지통으로 이동' })
  expect(archive.compareDocumentPosition(screen.getByLabelText('주제 이름 · 한국어')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect(screen.queryByLabelText('시작일')).toBeNull()
  expect(screen.queryByLabelText('종료일')).toBeNull()
  expect(screen.queryByLabelText('홈 표시 종료일')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '미리보기' }))
  expect(screen.getByText('?meetingCollection=4')).toBeTruthy()
  expect((screen.getByRole('switch') as HTMLInputElement).checked).toBe(false)
  fireEvent.click(screen.getByRole('switch'))
  await waitFor(() => expect(saveMeetingCollection).toHaveBeenCalledWith(expect.objectContaining({ homeEnabled: true }), collection))
})
it('autosaves only visibility and uses the refreshed version for subsequent changes', async () => {
  vi.mocked(fetchMeetingCollections).mockResolvedValue([collection])
  vi.mocked(saveMeetingCollection).mockResolvedValue(4)
  mount(); await screen.findByRole('option', { name: '숨긴 모음' })
  fireEvent.change(screen.getByLabelText('주제 관리'), { target: { value: '4' } })
  fireEvent.change(screen.getByLabelText('주제 이름 · 한국어'), { target: { value: '아직 저장 안 한 이름' } })
  const enabled = { ...collection, homeEnabled: true, updatedAt: 'v2' }
  vi.mocked(fetchMeetingCollections).mockResolvedValue([enabled])
  fireEvent.click(screen.getByRole('switch'))
  expect((screen.getByRole('switch') as HTMLInputElement).disabled).toBe(true)
  await waitFor(() => expect((screen.getByRole('switch') as HTMLInputElement).disabled).toBe(false))
  expect(saveMeetingCollection).toHaveBeenNthCalledWith(1, { ...collection, homeEnabled: true }, collection)
  expect((screen.getByLabelText('주제 이름 · 한국어') as HTMLInputElement).value).toBe('아직 저장 안 한 이름')
  expect((screen.getByLabelText('주제 관리') as HTMLSelectElement).value).toBe('4')
  vi.mocked(fetchMeetingCollections).mockResolvedValue([{ ...enabled, homeEnabled: false, updatedAt: 'v3' }])
  fireEvent.click(screen.getByRole('switch'))
  await waitFor(() => expect(saveMeetingCollection).toHaveBeenNthCalledWith(2, { ...enabled, homeEnabled: false }, enabled))
})
it('rolls back a failed visibility save and reports the error', async () => {
  vi.mocked(fetchMeetingCollections).mockResolvedValue([collection])
  vi.mocked(saveMeetingCollection).mockRejectedValue(new Error('network'))
  mount(); await screen.findByRole('option', { name: '숨긴 모음' })
  fireEvent.change(screen.getByLabelText('주제 관리'), { target: { value: '4' } })
  fireEvent.click(screen.getByRole('switch'))
  await screen.findByRole('alert')
  expect((screen.getByRole('switch') as HTMLInputElement).checked).toBe(false)
  expect((screen.getByRole('switch') as HTMLInputElement).disabled).toBe(false)
  expect((screen.getByLabelText('주제 관리') as HTMLSelectElement).value).toBe('4')
})
it('does not undo an acknowledged save when refreshing the settings fails', async () => {
  vi.mocked(fetchMeetingCollections).mockResolvedValue([collection])
  vi.mocked(saveMeetingCollection).mockResolvedValue(4)
  mount(); await screen.findByRole('option', { name: '숨긴 모음' })
  fireEvent.change(screen.getByLabelText('주제 관리'), { target: { value: '4' } })
  vi.mocked(fetchMeetingCollections).mockRejectedValue(new Error('refresh failed'))
  fireEvent.click(screen.getByRole('switch'))
  await screen.findByRole('alert')
  expect((screen.getByRole('switch') as HTMLInputElement).checked).toBe(true)
})
it('deletes to trash only after confirmation and restores from trash', async () => {
  vi.mocked(fetchMeetingCollections).mockResolvedValue([collection])
  vi.mocked(confirmDialog).mockResolvedValue(false)
  mount(); await screen.findByRole('option', { name: '숨긴 모음' })
  fireEvent.change(screen.getByLabelText('주제 관리'), { target: { value: '4' } })
  fireEvent.click(screen.getByRole('button', { name: '휴지통으로 이동' }))
  await waitFor(() => expect(confirmDialog).toHaveBeenCalled())
  expect(changeMeetingCollection).not.toHaveBeenCalled()
  vi.mocked(confirmDialog).mockResolvedValue(true)
  fireEvent.click(screen.getByRole('button', { name: '휴지통으로 이동' }))
  await waitFor(() => expect(changeMeetingCollection).toHaveBeenCalledWith(collection, 'trash'))
  fireEvent.click(screen.getByText('휴지통'))
  fireEvent.click(await screen.findByRole('button', { name: '복원' }))
  await waitFor(() => expect(changeMeetingCollection).toHaveBeenCalledWith(collection, 'restore'))
})
it('requires confirmation for permanent deletion', async () => {
  vi.mocked(fetchMeetingCollections).mockResolvedValue([collection])
  vi.mocked(confirmDialog).mockResolvedValue(false)
  mount(); await screen.findByRole('option', { name: '숨긴 모음' })
  fireEvent.click(screen.getByText('휴지통'))
  fireEvent.click(await screen.findByRole('button', { name: '영구 삭제' }))
  await waitFor(() => expect(confirmDialog).toHaveBeenCalled())
  expect(changeMeetingCollection).not.toHaveBeenCalled()
  vi.mocked(confirmDialog).mockResolvedValue(true)
  fireEvent.click(screen.getByRole('button', { name: '영구 삭제' }))
  await waitFor(() => expect(changeMeetingCollection).toHaveBeenCalledWith(collection, 'purge'))
})
it('keeps management visible and preserves drafts when expanding the bottom trash', async () => {
  vi.mocked(fetchMeetingCollections).mockResolvedValue([collection])
  mount(); await screen.findByRole('option', { name: '숨긴 모음' })
  expect(screen.queryByRole('tablist')).toBeNull()
  const trash = screen.getByText('휴지통').closest('details')!
  expect(trash.open).toBe(false)
  const name = screen.getByLabelText('주제 이름 · 한국어') as HTMLInputElement
  fireEvent.change(name, { target: { value: '입력 중인 주제' } })
  expect(name.compareDocumentPosition(trash) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  let finish!: (rows: typeof collection[]) => void
  vi.mocked(fetchMeetingCollections).mockImplementation(mode => mode === 'trash' ? new Promise(resolve => { finish = resolve }) : Promise.resolve([collection]))
  fireEvent.click(screen.getByText('휴지통'))
  await waitFor(() => expect(finish).toBeTypeOf('function'))
  finish([collection])
  await screen.findByRole('button', { name: '복원' })
  expect((screen.getByLabelText('주제 이름 · 한국어') as HTMLInputElement).value).toBe('입력 중인 주제')
  expect(screen.getByRole('switch')).toBeTruthy()
})
it('does not fetch or expose management for a non-admin direct entry', () => {
  mount(false)
  expect(fetchMeetingCollections).not.toHaveBeenCalled()
  expect(screen.queryByRole('heading')).toBeNull()
})
