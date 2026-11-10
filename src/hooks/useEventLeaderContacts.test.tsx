import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
const api = vi.hoisted(() => ({ rpc: vi.fn(), token: 'one' }))
vi.mock('../lib/supabase', () => ({ supabase: { rpc: api.rpc } }))
vi.mock('../lib/authToken', () => ({ getAuthToken: () => api.token }))
import { useEventLeaderContacts } from './useEventLeaderContacts'
import { privateUserReadsEnabled } from '../lib/privateUserReads'
const users = [{ id: 1, name: 'Leader', phone: 'old-private-phone' }]
beforeEach(() => { vi.clearAllMocks(); api.token = 'one'; vi.stubEnv('VITE_PRIVATE_USER_READS_ENABLED', 'true') })
afterEach(() => { cleanup(); vi.unstubAllEnvs() })
test.each([
  [undefined, undefined, false], ['true', undefined, true], ['false', 'true', false], [undefined, 'true', true],
])('flag %s demo %s = %s', (flag, demo, result) => {
  vi.stubEnv('VITE_PRIVATE_USER_READS_ENABLED', flag)
  vi.stubEnv('VITE_DEMO_MODE', demo)
  expect(privateUserReadsEnabled()).toBe(result)
})
test('gets only event contacts and never falls back to directory phones on failure; retry works', async () => {
  api.rpc.mockResolvedValueOnce({ error: Error('offline') }).mockResolvedValueOnce({ data: [{ id: 1, name: 'Leader', phone: '010-1234' }] })
  const h = renderHook(() => useEventLeaderContacts(7, ['Leader'], users))
  await waitFor(() => expect(h.result.current.error).toBe(true))
  expect(h.result.current.phoneByName.size).toBe(0)
  act(() => h.result.current.retry())
  await waitFor(() => expect(h.result.current.phoneByName.get('leader')).toBe('010-1234'))
  expect(api.rpc).toHaveBeenCalledWith('get_event_leader_contacts', { p_event_id: 7 })
})
test('event/account changes hide old contacts immediately and reject delayed responses', async () => {
  let finish!: (r: object) => void
  api.rpc.mockResolvedValueOnce({ data: [{ id: 1, name: 'Leader', phone: 'first' }] })
    .mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    .mockResolvedValueOnce({ data: [{ id: 3, name: 'New', phone: 'current' }] })
  const h = renderHook(({ event }) => useEventLeaderContacts(event, ['Leader'], users), { initialProps: { event: 7 } })
  await waitFor(() => expect(h.result.current.phoneByName.get('leader')).toBe('first'))
  h.rerender({ event: 8 })
  expect(h.result.current.phoneByName.size).toBe(0)
  api.token = 'two'
  h.rerender({ event: 9 })
  await waitFor(() => expect(h.result.current.phoneByName.get('new')).toBe('current'))
  await act(async () => finish({ data: [{ id: 2, name: 'Leader', phone: 'stale' }] }))
  expect(h.result.current.phoneByName.get('leader')).toBeUndefined()
})
test('explicit off retains phone links without RPC; missing session never requests contacts', () => {
  vi.stubEnv('VITE_DEMO_MODE', 'true')
  vi.stubEnv('VITE_PRIVATE_USER_READS_ENABLED', 'false')
  const h = renderHook(() => useEventLeaderContacts(7, ['Leader'], users))
  expect(h.result.current.phoneByName.get('leader')).toBe('old-private-phone')
  expect(api.rpc).not.toHaveBeenCalled()
  vi.stubEnv('VITE_PRIVATE_USER_READS_ENABLED', 'true')
  api.token = ''
  h.rerender()
  expect(h.result.current.phoneByName.size).toBe(0)
  expect(api.rpc).not.toHaveBeenCalled()
})
