// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ServiceSuggestionsSection } from './ServiceSuggestionsSection'
import { MeetingContext } from '../features/meetingNotes/context'

const read = vi.hoisted(() => vi.fn(() => ({ suggestions: [], loading: false })))
vi.mock('../hooks/useServiceSuggestions', () => ({ useServiceSuggestions: read }))
afterEach(() => { cleanup(); read.mockClear() })
it('does not mount the suggestion reader until opened and unmounts it when closed', async () => {
  const { container } = render(<ServiceSuggestionsSection language="ko" />)
  const details = container.querySelector('details')!
  expect(details.open).toBe(false)
  expect(read).not.toHaveBeenCalled()
  expect(screen.queryByText('등록된 대화 방법이 없습니다.')).toBeNull()
  fireEvent.click(screen.getByText('대화 방법 제안'))
  await waitFor(() => expect(screen.getByText('등록된 대화 방법이 없습니다.')).toBeTruthy())
  expect(read).toHaveBeenCalledWith(true)
  fireEvent.click(screen.getByText('대화 방법 제안'))
  await waitFor(() => expect(screen.queryByText('등록된 대화 방법이 없습니다.')).toBeNull())
  expect(details.open).toBe(false)
})

it('starts collapsed when configured even with no suggestions and can still expand', async () => {
  const { container } = render(<MeetingContext.Provider value={{ userId: 1, canManage: false, refresh: () => {}, data: {
    collections: [{ id: 4, nameKo: '모음', nameZh: '', startDate: '2020-01-01', endDate: '2099-01-01', homeVisibleUntil: '2099-01-01', homePosition: 'top', collapseSuggestions: true, updatedAt: 'v1' }],
    notes: [{ id: 5, collectionId: 4, eventId: null, titleKo: '글', titleZh: '', excerptKo: '', excerptZh: '', readingMinutesKo: 1, readingMinutesZh: 0, date: '2026-10-01', time: '', place: '', leader: '', updatedAt: 'v1', archivedAt: null }],
  } }}><ServiceSuggestionsSection language="zh" /></MeetingContext.Provider>)
  const details = container.querySelector('details')!
  expect(details.open).toBe(false)
  expect(read).not.toHaveBeenCalled()
  fireEvent.click(screen.getByText('对话建议'))
  expect(details.open).toBe(true)
  await waitFor(() => expect(screen.getByText('暂无对话建议。')).toBeTruthy())
})
