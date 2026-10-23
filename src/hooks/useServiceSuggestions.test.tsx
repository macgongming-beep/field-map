// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, renderHook, waitFor } from '@testing-library/react'
const mock = vi.hoisted(() => ({ home: vi.fn(), order: vi.fn(), select: vi.fn() }))
vi.mock('./homeServiceSuggestion', () => ({ readHomeServiceSuggestion: mock.home }))
vi.mock('../lib/supabase', () => ({ supabase: { from: () => ({ select: mock.select }) } }))
import { useServiceSuggestions } from './useServiceSuggestions'
afterEach(() => { cleanup(); vi.unstubAllEnvs(); vi.clearAllMocks() })
it.each([
  [true, 'true', true],
  [false, 'true', false],
  [true, 'false', false],
])('home=%s demo=%s uses narrowed read=%s', async (home, demo, narrow) => {
  vi.stubEnv('VITE_DEMO_MODE', demo)
  mock.home.mockResolvedValue([])
  mock.select.mockReturnValue({ order: mock.order })
  mock.order.mockResolvedValue({ data: [], error: null })
  const hook = renderHook(() => useServiceSuggestions(home))
  await waitFor(() => expect(hook.result.current.loading).toBe(false))
  expect(mock.home).toHaveBeenCalledTimes(narrow ? 1 : 0)
  expect(mock.select).toHaveBeenCalledTimes(narrow ? 0 : 1)
  if (!narrow) expect(mock.select).toHaveBeenCalledWith('*')
})
