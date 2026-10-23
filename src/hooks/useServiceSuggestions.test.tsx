// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, renderHook, waitFor } from '@testing-library/react'
const mock = vi.hoisted(() => ({ home: vi.fn(), order: vi.fn(), select: vi.fn() }))
vi.mock('./homeServiceSuggestion', () => ({ readHomeServiceSuggestion: mock.home }))
vi.mock('../lib/supabase', () => ({ supabase: { from: () => ({ select: mock.select }) } }))
import { useServiceSuggestions } from './useServiceSuggestions'
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
