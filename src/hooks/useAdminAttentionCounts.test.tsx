import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { useAdminAttentionCounts } from './useAdminAttentionCounts'
import { ADMIN_ATTENTION_CHANGED_EVENT } from '../lib/adminAttentionEvents'

const fetchCount = vi.hoisted(() => vi.fn<() => Promise<number | null>>())
vi.mock('./storeMutations/placeChangeRequests', () => ({ fetchPendingPlaceChangeRequestCount: fetchCount }))
afterEach(() => { cleanup(); fetchCount.mockReset() })

test('hidden badge does not read; entering settings and returning both read fresh counts', async () => {
  fetchCount.mockResolvedValue(2)
  const { result, rerender } = renderHook(({ enabled, path }) => useAdminAttentionCounts({
    enabled, users: [], returnVisits: [], refreshKey: path,
  }), { initialProps: { enabled: false, path: '/' } })
  expect(fetchCount).not.toHaveBeenCalled()
  act(() => window.dispatchEvent(new Event('focus')))
  expect(fetchCount).not.toHaveBeenCalled()
  rerender({ enabled: true, path: '/settings' })
  await waitFor(() => expect(result.current.placeRequests).toBe(2))
  expect(fetchCount).toHaveBeenCalledTimes(1)
  fetchCount.mockResolvedValue(4)
  act(() => window.dispatchEvent(new Event(ADMIN_ATTENTION_CHANGED_EVENT)))
  await waitFor(() => expect(result.current.placeRequests).toBe(4))
  rerender({ enabled: false, path: '/calendar' })
  act(() => window.dispatchEvent(new Event(ADMIN_ATTENTION_CHANGED_EVENT)))
  expect(fetchCount).toHaveBeenCalledTimes(2)
  fetchCount.mockResolvedValue(7)
  rerender({ enabled: true, path: '/settings' })
  await waitFor(() => expect(result.current.placeRequests).toBe(7))
  expect(fetchCount).toHaveBeenCalledTimes(3)
})
