// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
const mock = vi.hoisted(() => ({ home: vi.fn(), order: vi.fn(), select: vi.fn() }))
vi.mock('./homeServiceSuggestion', () => ({ readHomeServiceSuggestion: mock.home }))
vi.mock('../lib/supabase', () => ({ supabase: { from: () => ({ select: mock.select }) } }))
import { useServiceSuggestions } from './useServiceSuggestions'
import { ServiceSuggestionsSection } from '../components/ServiceSuggestionsSection'
afterEach(() => { cleanup(); vi.unstubAllEnvs(); vi.clearAllMocks() })
it.each([
  [true, 'true', undefined, true],
  [false, 'true', undefined, false],
  [true, 'false', undefined, false],
  [true, undefined, undefined, false],
  [true, undefined, 'true', true],
  [false, undefined, 'true', false],
  [true, 'true', 'false', false],
  [true, undefined, 'false', false],
])('home=%s demo=%s flag=%s uses narrowed read=%s', async (home, demo, flag, narrow) => {
  vi.stubEnv('VITE_DEMO_MODE', demo)
  vi.stubEnv('VITE_HOME_SUGGESTION_BODY_ENABLED', flag)
  mock.home.mockResolvedValue([])
  mock.select.mockReturnValue({ order: mock.order })
  mock.order.mockResolvedValue({ data: [], error: null })
  const hook = renderHook(() => useServiceSuggestions(home))
  await waitFor(() => expect(hook.result.current.loading).toBe(false))
  expect(mock.home).toHaveBeenCalledTimes(narrow ? 1 : 0)
  expect(mock.select).toHaveBeenCalledTimes(narrow ? 0 : 1)
  if (!narrow) expect(mock.select).toHaveBeenCalledWith('*')
})

it('reads only on expand, discards a closed request, and retries a failed read', async () => {
  vi.stubEnv('VITE_HOME_SUGGESTION_BODY_ENABLED', 'true')
  let release!: (rows: unknown[]) => void
  mock.home.mockImplementationOnce(() => new Promise(resolve => { release = resolve }))
  const view = render(<ServiceSuggestionsSection language="ko" />)
  expect(mock.home).not.toHaveBeenCalled()
  expect(mock.select).not.toHaveBeenCalled()
  fireEvent.click(screen.getByText('대화 방법 제안'))
  await waitFor(() => expect(mock.home).toHaveBeenCalledOnce())
  expect(screen.getByText('불러오는 중')).toBeTruthy()
  fireEvent.click(screen.getByText('대화 방법 제안'))
  await waitFor(() => expect(screen.queryByText('불러오는 중')).toBeNull())
  await act(async () => release([{ id: 1, is_visible: true, content: [{ format: 'free', type: '일반', body: 'late body' }] }]))
  expect(screen.queryByText('late body')).toBeNull()

  const log = vi.spyOn(console, 'error').mockImplementation(() => {})
  mock.home.mockRejectedValueOnce(new Error('offline'))
  fireEvent.click(screen.getByText('대화 방법 제안'))
  await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy())
  mock.home.mockResolvedValueOnce([{ id: 2, is_visible: true, content: [{ format: 'free', type: '일반', body: 'fresh body' }] }])
  fireEvent.click(screen.getByRole('button', { name: '다시 시도' }))
  await waitFor(() => expect(screen.getByText('fresh body')).toBeTruthy())
  expect(mock.home).toHaveBeenCalledTimes(3)
  expect(screen.queryByText('late body')).toBeNull()
  log.mockRestore()
  view.unmount()
})
