import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { AppHeaderActionButtons } from './AppHeader'

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('../lib/supabase', () => ({ supabase: mocks }))
vi.mock('../lib/authToken', () => ({ getAuthToken: () => 'test-token' }))
vi.mock('../lib/activeChat', () => ({ isActiveChatLink: () => false }))
vi.mock('../hooks/useUserChats', () => ({ useUserChats: () => ({ chats: [], totalUnread: 0, markChatReadLocally: vi.fn() }) }))
vi.mock('./GlobalChatModal', () => ({ GlobalChatModal: () => null }))

const rows = ['assignment', 'notice', 'comment'].map((type, i) => ({ id: i + 1, user_id: 10, type, title: `Title ${type}`, body: `Body ${type}`, link: null, related_id: null, is_read: false, created_at: '2026-10-30' }))
beforeEach(() => { const root = document.createElement('div'); root.id = 'root'; document.body.appendChild(root) })
afterEach(() => { cleanup(); document.getElementById('root')?.remove(); vi.unstubAllEnvs(); vi.restoreAllMocks(); mocks.rpc.mockReset() })

test.each([
  ['true', undefined],
  ['false', 'true'],
  [undefined, 'true'],
] as const)('enabled header loads metadata then full content and marks read: demo=%s flag=%s', async (demo, flag) => {
  vi.stubEnv('VITE_DEMO_MODE', demo)
  vi.stubEnv('VITE_NOTIFICATION_BADGE_ONLY_ENABLED', flag)
  const select = vi.fn().mockResolvedValue({ data: rows.map(({ title: _title, body: _body, ...rest }) => rest), error: null })
  let resolveFull!: (reply: unknown) => void
  const full = new Promise((resolve) => { resolveFull = resolve })
  mocks.rpc.mockReturnValueOnce({ select }).mockReturnValueOnce(full).mockResolvedValue({ data: null, error: null })
  render(<MemoryRouter><AppHeaderActionButtons userId={10} /></MemoryRouter>)
  await act(async () => {})
  expect(screen.getByRole('button', { name: /알림.*1/ })).toBeTruthy()
  expect(screen.queryByText('Body assignment')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: /알림.*1/ }))
  expect(screen.getByRole('status')).toBeTruthy()
  expect(screen.queryByText('Title assignment')).toBeNull()
  await act(async () => { resolveFull({ data: rows, error: null }) })
  expect(screen.getByText('Body assignment')).toBeTruthy()
  expect(screen.queryByText('Title notice')).toBeNull()
  expect(screen.queryByText('Title comment')).toBeNull()
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: /모두 읽음/ })) })
  expect(mocks.rpc).toHaveBeenCalledWith('mark_all_notifications_read', { p_token: 'test-token' })
  expect(screen.getByRole('button', { name: '알림' })).toBeTruthy()
})

test.each([
  ['false', undefined],
  [undefined, undefined],
  ['true', 'false'],
  ['false', 'false'],
] as const)('disabled header keeps full RPC read: demo=%s flag=%s', async (demo, flag) => {
  vi.stubEnv('VITE_DEMO_MODE', demo)
  vi.stubEnv('VITE_NOTIFICATION_BADGE_ONLY_ENABLED', flag)
  const select = vi.fn()
  mocks.rpc.mockReturnValue(Object.assign(Promise.resolve({ data: rows, error: null }), { select }))
  render(<MemoryRouter><AppHeaderActionButtons userId={10} /></MemoryRouter>)
  await act(async () => {})
  expect(select).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: /알림.*1/ }))
  expect(screen.getByText('Body assignment')).toBeTruthy()
  expect(mocks.rpc).toHaveBeenCalledTimes(1)
})

test('opening after metadata failure offers retry instead of an empty notification list', async () => {
  vi.stubEnv('VITE_DEMO_MODE', 'true')
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  mocks.rpc.mockReturnValueOnce({ select: vi.fn().mockResolvedValue({ data: null, error: new Error('offline') }) })
    .mockResolvedValueOnce({ data: null, error: new Error('offline') })
    .mockResolvedValue({ data: rows, error: null })
  render(<MemoryRouter><AppHeaderActionButtons userId={10} /></MemoryRouter>)
  await act(async () => {})
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '알림' })) })
  expect(screen.getByRole('alert')).toBeTruthy()
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '다시 시도' })) })
  expect(screen.getByText('Body assignment')).toBeTruthy()
  expect(screen.queryByRole('alert')).toBeNull()
})
