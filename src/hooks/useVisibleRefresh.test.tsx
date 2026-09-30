import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { useVisibleRefresh } from './useVisibleRefresh'

afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks() })
test('bounds polling, skips background and merges focus with visibility events', async () => {
  vi.useFakeTimers()
  const refresh = vi.fn().mockResolvedValue(undefined)
  const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(false)
  const { unmount } = renderHook(() => useVisibleRefresh(true, refresh))
  await act(async () => { await vi.advanceTimersByTimeAsync(60_000) })
  expect(refresh).toHaveBeenCalledTimes(1)
  hidden.mockReturnValue(true)
  await act(async () => { await vi.advanceTimersByTimeAsync(180_000) })
  expect(refresh).toHaveBeenCalledTimes(1)
  hidden.mockReturnValue(false)
  await act(async () => {
    window.dispatchEvent(new Event('focus'))
    document.dispatchEvent(new Event('visibilitychange'))
  })
  expect(refresh).toHaveBeenCalledTimes(2)
  unmount()
  await vi.advanceTimersByTimeAsync(120_000)
  expect(refresh).toHaveBeenCalledTimes(2)
})

test('disabled hooks do not poll; slow and failed reads do not pile up', async () => {
  vi.useFakeTimers()
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false)
  let finish!: () => void
  const refresh = vi.fn().mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve }))
    .mockRejectedValue(new Error('offline'))
  const { rerender } = renderHook(({ enabled }) => useVisibleRefresh(enabled, refresh), { initialProps: { enabled: false } })
  await act(async () => { await vi.advanceTimersByTimeAsync(120_000) })
  expect(refresh).not.toHaveBeenCalled()
  rerender({ enabled: true })
  await act(async () => { await vi.advanceTimersByTimeAsync(180_000) })
  expect(refresh).toHaveBeenCalledTimes(1)
  await act(async () => { finish(); await vi.advanceTimersByTimeAsync(60_000) })
  expect(refresh).toHaveBeenCalledTimes(2)
})
