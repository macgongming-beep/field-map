// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { MeetingReader } from './MeetingReader'
import type { AppLanguage } from '../../i18n'

vi.mock('./MeetingEditor', () => ({ MeetingEditor: () => null }))
vi.mock('./api', () => ({
  fetchMeetingCollections: async () => [{ id: 4, nameKo: '모음', nameZh: '合集' }],
  fetchMeetingNoteMetas: async () => [{ id: 5, collectionId: 4, updatedAt: 'v1', date: '2026-10-01', time: '' }],
  fetchMeetingNote: async () => ({ id: 5, collectionId: 4, updatedAt: 'v1', date: '2026-10-01', time: '', titleKo: '한국 제목', titleZh: '中文标题', bodyKo: '한국 본문', bodyZh: '中文正文' }),
}))
afterEach(() => { cleanup(); document.getElementById('root')?.remove(); localStorage.clear() })

it('follows a loaded Chinese preference and puts Chinese first while allowing manual switching', async () => {
  const root = document.createElement('div'); root.id = 'root'; document.body.appendChild(root)
  const view = (language: AppLanguage) => <MemoryRouter initialEntries={['/?meetingCollection=4&meetingNote=5']}><MeetingReader language={language} userId={1} /></MemoryRouter>
  const { rerender } = render(view('ko'), { container: root })
  await screen.findByText('한국 본문')
  rerender(view('zh'))
  expect(await screen.findByText('中文正文')).toBeTruthy()
  expect(screen.getByRole('heading', { name: '中文标题' })).toBeTruthy()
  const buttons = within(screen.getByRole('group')).getAllByRole('button')
  expect(buttons.map(button => button.textContent)).toEqual(['中文', '한국어'])
  expect(buttons[0].getAttribute('aria-pressed')).toBe('true')
  fireEvent.click(buttons[1])
  expect(screen.getByText('한국 본문')).toBeTruthy()
  rerender(view('zh'))
  expect(screen.getByText('한국 본문')).toBeTruthy()
})
