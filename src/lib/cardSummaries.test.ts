import { beforeEach, expect, test, vi } from 'vitest'
import { fetchCardSummaries } from './cardSummaries'
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), token: vi.fn() }))
vi.mock('./supabase', () => ({ supabase: { rpc: mocks.rpc } }))
vi.mock('./authToken', () => ({ getAuthToken: mocks.token }))
beforeEach(() => {
  vi.clearAllMocks()
  mocks.token.mockReturnValue('session')
  mocks.rpc.mockImplementation(async (_name, args) => ({ data: args.p_card_ids.map((id: number) => ({ id })), error: null }))
})
test('empty scope performs no request and never becomes an all-cards query', async () => {
  expect(await fetchCardSummaries([])).toEqual([])
  expect(mocks.rpc).not.toHaveBeenCalled()
})
test('deduplicates and batches explicit IDs with a session', async () => {
  const ids = Array.from({ length: 401 }, (_, i) => i + 1)
  const rows = await fetchCardSummaries([...ids, 1])
  expect(rows.map((row) => row.id)).toEqual(ids)
  expect(mocks.rpc.mock.calls.map(([, args]) => args.p_card_ids.length)).toEqual([200, 200, 1])
  expect(mocks.rpc).toHaveBeenCalledWith('get_card_summaries', { p_token: 'session', p_card_ids: [401] })
})
test('missing token and invalid IDs fail without querying', async () => {
  for (const id of [0, -1, NaN, Infinity, 1.5, 2147483648]) {
    await expect(fetchCardSummaries([id])).rejects.toThrow('Invalid card ID')
  }
  mocks.token.mockReturnValue(null)
  await expect(fetchCardSummaries([1])).rejects.toThrow('로그인')
  expect(mocks.rpc).not.toHaveBeenCalled()
})
test('partial failure is not returned as a successful or empty summary', async () => {
  mocks.rpc.mockResolvedValueOnce({ data: [{ id: 1 }], error: null })
    .mockResolvedValueOnce({ data: null, error: new Error('Unavailable') })
  await expect(fetchCardSummaries(Array.from({ length: 201 }, (_, i) => i + 1))).rejects.toThrow('Unavailable')
})
test('malformed or out-of-scope response is rejected', async () => {
  for (const data of [null, {}, [{ id: 99 }]]) {
    mocks.rpc.mockResolvedValueOnce({ data, error: null })
    await expect(fetchCardSummaries([1])).rejects.toThrow('Invalid card summary response')
  }
})
