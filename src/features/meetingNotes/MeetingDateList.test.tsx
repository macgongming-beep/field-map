// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MeetingDateList } from './MeetingReader'
import type { MeetingNoteMeta } from './model'
afterEach(cleanup)
it('groups same-date articles under one non-interactive date while preserving article navigation', () => {
  const note: MeetingNoteMeta = { id: 1, collectionId: 4, eventId: null, titleKo: '기존 글', titleZh: '', excerptKo: '', excerptZh: '', readingMinutesKo: 1, readingMinutesZh: 0, date: '2026-10-01', time: '', place: '', leader: '', updatedAt: 'v1', archivedAt: null }
  const onOpen = vi.fn()
  render(<MeetingDateList language="ko" userId={1} onOpen={onOpen} notes={[{ ...note, id: 3, date: '2026-09-30', titleKo: '지난 글' }, note, { ...note, id: 2, titleKo: '오후 글' }]} />)
  const headings = screen.getAllByRole('heading', { level: 2 })
  expect(headings.map(h => h.textContent)).toEqual(['10월 1일 (목)', '9월 30일 (수)'])
  expect(screen.getAllByText('10월 1일 (목)')).toHaveLength(1)
  expect(headings[0].closest('button')).toBeNull()
  expect(within(headings[0].parentElement!).getAllByRole('button')).toHaveLength(2)
  expect(screen.getAllByRole('button')).toHaveLength(3)
  fireEvent.click(screen.getByRole('button', { name: /오후 글/ }))
  expect(onOpen).toHaveBeenCalledWith(2)
})
