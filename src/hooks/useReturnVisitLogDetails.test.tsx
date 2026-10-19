import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { useReturnVisitLogDetails } from './useReturnVisitLogDetails'
import type { ReturnVisitLog } from '../types'

const state = vi.hoisted(() => ({ read: vi.fn(), token: 'account-a' }))
vi.mock('./returnVisitLogReader', () => ({
  lazyReturnVisitLogsEnabled: () => import.meta.env.VITE_DEMO_MODE === 'true',
  readReturnVisitLogs: state.read,
}))
vi.mock('../lib/authToken', () => ({ getAuthToken: () => state.token }))
afterEach(() => { cleanup(); vi.unstubAllEnvs(); state.read.mockReset(); state.token = 'account-a' })
const row: ReturnVisitLog = { id: 1, returnVisitId: 7, visitedAt: '2026-10-20T00:00:00Z', result: '만남', memo: 'full memo', createdBy: 'test' }
const index = [{ ...row, result: null, memo: '', createdBy: '' }]

test('production uses existing snapshot without any detail request', () => {
  vi.stubEnv('VITE_DEMO_MODE', 'false')
  const { result } = renderHook(() => useReturnVisitLogDetails(7, [row]))
  expect(result.current.logs).toEqual([row])
  expect(state.read).not.toHaveBeenCalled()
})
test('closed details do not fetch; opening and memo-only refresh read only the target', async () => {
  vi.stubEnv('VITE_DEMO_MODE', 'true')
  state.read.mockResolvedValue([row])
  const { result, rerender } = renderHook(({ id, snapshot }) => useReturnVisitLogDetails(id, snapshot),
    { initialProps: { id: null as number | null, snapshot: index } })
  expect(state.read).not.toHaveBeenCalled()
  rerender({ id: 7, snapshot: index })
  await waitFor(() => expect(result.current.logs).toEqual([row]))
  expect(state.read).toHaveBeenCalledExactlyOnceWith(7)
  state.read.mockResolvedValue([{ ...row, memo: 'edited' }])
  rerender({ id: 7, snapshot: [...index] })
  await waitFor(() => expect(result.current.logs[0]?.memo).toBe('edited'))
  expect(state.read).toHaveBeenCalledTimes(2)
  rerender({ id: null, snapshot: index })
  expect(result.current.logs).toEqual([])
  expect(state.read).toHaveBeenCalledTimes(2)
})
test('failed read exposes retry, not a successful empty history', async () => {
  vi.stubEnv('VITE_DEMO_MODE', 'true')
  state.read.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce([row])
  const { result } = renderHook(() => useReturnVisitLogDetails(7, index))
  await waitFor(() => expect(result.current.error).toBe(true))
  act(() => result.current.reload())
  await waitFor(() => expect(result.current.logs).toEqual([row]))
  expect(result.current.error).toBe(false)
})
test('late response cannot cross targets or accounts', async () => {
  vi.stubEnv('VITE_DEMO_MODE', 'true')
  let finish!: (rows: ReturnVisitLog[]) => void
  state.read.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
    .mockResolvedValueOnce([{ ...row, id: 2, returnVisitId: 8 }])
  const { result, rerender } = renderHook(({ id }) => useReturnVisitLogDetails(id, index), { initialProps: { id: 7 } })
  state.token = 'account-b'
  rerender({ id: 8 })
  await waitFor(() => expect(result.current.logs[0]?.returnVisitId).toBe(8))
  await act(async () => finish([row]))
  expect(result.current.logs[0]?.returnVisitId).toBe(8)
})

test('same target with a new account refetches and rejects the old response', async () => {
  vi.stubEnv('VITE_DEMO_MODE', 'true')
  let finish!: (rows: ReturnVisitLog[]) => void
  state.read.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
    .mockResolvedValueOnce([{ ...row, memo: 'account-b memo' }])
  const { result, rerender } = renderHook(() => useReturnVisitLogDetails(7, index))
  state.token = 'account-b'
  rerender()
  expect(result.current.logs).toEqual([])
  await waitFor(() => expect(result.current.logs[0]?.memo).toBe('account-b memo'))
  await act(async () => finish([row]))
  expect(result.current.logs[0]?.memo).toBe('account-b memo')
  expect(state.read).toHaveBeenCalledTimes(2)
})
