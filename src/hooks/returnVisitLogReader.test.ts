import { afterEach, expect, test, vi } from 'vitest'
import { readReturnVisitLogs } from './returnVisitLogReader'

const state = vi.hoisted(() => ({ token: 'token', query: vi.fn(), eq: vi.fn(), is: vi.fn(), select: vi.fn(), range: vi.fn() }))
vi.mock('../lib/authToken', () => ({ getAuthToken: () => state.token }))
vi.mock('../lib/supabase', () => ({ supabase: { from: () => {
  const chain = {
    select: (s: string) => { state.select(s); return chain },
    eq: (...args: unknown[]) => { state.eq(...args); return chain },
    is: (...args: unknown[]) => { state.is(...args); return chain },
    order: () => chain,
    range: (...args: unknown[]) => { state.range(...args); return state.query() },
  }
  return chain
} } }))
afterEach(() => { vi.clearAllMocks(); state.query.mockReset(); state.token = 'token' })
const row = { id: 1, return_visit_id: 7, visited_at: '2026-10-20', result: '만남', memo: 'memo', created_by: 'test' }
test('reads full projected details only for the target, excludes invalidated records and paginates', async () => {
  state.query.mockResolvedValueOnce({ data: Array.from({ length: 1000 }, (_, i) => ({ ...row, id: i + 1 })), error: null })
    .mockResolvedValueOnce({ data: [{ ...row, id: 1001 }], error: null })
  const rows = await readReturnVisitLogs(7)
  expect(rows).toHaveLength(1001)
  expect(rows[0].memo).toBe('memo')
  expect(state.select).toHaveBeenCalledWith('id,return_visit_id,visited_at,result,memo,created_by')
  expect(state.eq).toHaveBeenNthCalledWith(1, 'return_visit_id', 7)
  expect(state.eq).toHaveBeenNthCalledWith(2, 'return_visit_id', 7)
  expect(state.is).toHaveBeenCalledWith('invalidated_at', null)
  expect(state.range).toHaveBeenNthCalledWith(2, 1000, 1999)
})
test('rejects a foreign target instead of exposing its memo', async () => {
  state.query.mockResolvedValue({ data: [{ ...row, return_visit_id: 8 }], error: null })
  await expect(readReturnVisitLogs(7)).rejects.toThrow('Unexpected')
})
test('rejects a response received after account change', async () => {
  state.query.mockImplementation(async () => { state.token = 'different'; return { data: [row], error: null } })
  await expect(readReturnVisitLogs(7)).rejects.toThrow('session changed')
})
test('does not return partial results after a failed page', async () => {
  state.query.mockResolvedValueOnce({ data: Array.from({ length: 1000 }, () => row), error: null })
    .mockResolvedValueOnce({ data: null, error: new Error('offline') })
  await expect(readReturnVisitLogs(7)).rejects.toThrow('offline')
})
