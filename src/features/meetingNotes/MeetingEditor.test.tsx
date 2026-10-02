// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MeetingEditor } from './MeetingEditor'
import { MeetingContext } from './context'
import { saveMeetingNote } from './api'
vi.mock('./model', async original => ({ ...await original<typeof import('./model')>(), meetingNotesEnabled: true }))
vi.mock('../../lib/overlayRoot', () => ({ getOverlayRoot: () => document.body }))
vi.mock('./api', () => ({
  fetchMeetingCollections: vi.fn(async () => [{ id: 4, nameKo: '순회방문', nameZh: '' }]),
  fetchMeetingNote: vi.fn(async () => ({ id: 6, eventId: 10, collectionId: 4, date: '2026-10-01', time: '', leader: '', titleKo: '저녁 모임', titleZh: '晚上聚会', bodyKo: '한국어 본문', bodyZh: '中文正文', listTitleKo: '목록 제목', listTitleZh: '列表标题', archivedAt: null })),
  saveMeetingNote: vi.fn(async () => {}),
}))
afterEach(() => { cleanup(); vi.clearAllMocks() })
it('keeps collection management out of editing and preserves both languages and collapsed list titles on save', async () => {
  render(<MeetingContext.Provider value={{ userId: 1, canManage: true, refresh: vi.fn(), data: { collections: [], notes: [] } }}><MeetingEditor eventId={10} noteId={6} language="ko" /></MeetingContext.Provider>)
  fireEvent.click(screen.getByRole('button', { name: '글 수정' }))
  await screen.findByDisplayValue('저녁 모임')
  expect(screen.queryByRole('button', { name: '모음 관리' })).toBeNull()
  expect(screen.queryByRole('combobox')).toBeNull()
  expect(screen.getByText('10월 1일 (목) · 순회방문')).toBeTruthy()
  expect(screen.queryByRole('button', { name: '닫기' })).toBeNull()
  expect(screen.getByRole('button', { name: '뒤로' }).className).toBe('app-header__back')
  expect(screen.getByDisplayValue('목록 제목').closest('details')?.open).toBe(false)
  fireEvent.change(screen.getByLabelText('제목 · 한국어'), { target: { value: '수정한 제목' } })
  fireEvent.click(screen.getByRole('button', { name: '中文' }))
  fireEvent.change(screen.getByLabelText('본문 · 中文'), { target: { value: '修改正文' } })
  fireEvent.click(screen.getByRole('button', { name: '저장' }))
  await waitFor(() => expect(saveMeetingNote).toHaveBeenCalledWith(10, 4, expect.objectContaining({ titleKo: '수정한 제목', bodyKo: '한국어 본문', bodyZh: '修改正文', listTitleKo: '목록 제목', listTitleZh: '列表标题' }), expect.anything(), false))
})
