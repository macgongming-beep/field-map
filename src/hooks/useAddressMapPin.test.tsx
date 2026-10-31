import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { geocodeQuery, isNaverMapsReady } from '../lib/naverGeocode'
import { useAddressMapPin } from './useAddressMapPin'

vi.mock('../lib/naverGeocode', () => ({ geocodeQuery: vi.fn(), isNaverMapsReady: vi.fn() }))
beforeEach(() => {
  vi.useFakeTimers()
  vi.mocked(isNaverMapsReady).mockReturnValue(true)
  vi.mocked(geocodeQuery).mockReset().mockResolvedValue(null)
})
afterEach(() => { cleanup(); vi.useRealTimers() })
const point = { lat: 37.2, lng: 127.2 }
const settle = () => act(async () => { await vi.advanceTimersByTimeAsync(0) })

test('does not drop locality and accept a different city after no result', async () => {
  vi.mocked(geocodeQuery).mockResolvedValueOnce(null).mockResolvedValueOnce(point)
  const address = '경기도 용인시 처인구 금학로 225'
  const { result } = renderHook(() => useAddressMapPin(address))
  await settle()
  expect(geocodeQuery).toHaveBeenCalledExactlyOnceWith(address)
  expect(result.current).toMatchObject({ status: 'error', point: null })
})

test('no result remains retryable, and retry can succeed', async () => {
  const { result } = renderHook(() => useAddressMapPin('address'))
  await settle()
  expect(result.current).toMatchObject({ status: 'error', point: null })
  vi.mocked(geocodeQuery).mockResolvedValue(point)
  act(() => result.current.retry())
  await settle()
  expect(result.current).toMatchObject({ status: 'ready', point })
})

test('waits for SDK, then searches once ready', async () => {
  vi.mocked(isNaverMapsReady).mockReturnValue(false)
  vi.mocked(geocodeQuery).mockResolvedValue(point)
  const { result } = renderHook(() => useAddressMapPin('address'))
  expect(result.current.status).toBe('loading')
  expect(geocodeQuery).not.toHaveBeenCalled()
  vi.mocked(isNaverMapsReady).mockReturnValue(true)
  await act(async () => { await vi.advanceTimersByTimeAsync(250) })
  expect(result.current.point).toEqual(point)
})

test.each(['sdk', 'callback'])('%s timeout ends searching and does not retry indefinitely', async failure => {
  vi.mocked(isNaverMapsReady).mockReturnValue(failure !== 'sdk')
  let resolve!: (value: typeof point) => void
  vi.mocked(geocodeQuery).mockImplementation(() => new Promise(r => { resolve = r }))
  const { result } = renderHook(() => useAddressMapPin('address'))
  await act(async () => { await vi.advanceTimersByTimeAsync(15_000) })
  expect(result.current).toMatchObject({ status: 'error', point: null })
  if (failure === 'callback') await act(async () => { resolve(point) })
  expect(result.current.point).toBeNull()
  expect(vi.getTimerCount()).toBe(0)
})

test('late previous-address response cannot replace the new pin', async () => {
  let resolve!: (value: typeof point) => void
  vi.mocked(geocodeQuery).mockImplementationOnce(() => new Promise(r => { resolve = r })).mockResolvedValue(point)
  const { result, rerender } = renderHook(({ address }) => useAddressMapPin(address), { initialProps: { address: 'old' } })
  rerender({ address: 'new' })
  await settle()
  await act(async () => { resolve({ lat: 38, lng: 128 }) })
  expect(result.current).toMatchObject({ address: 'new', status: 'ready', point })
})

test('leaving the address route clears the pin and cancels pending SDK work', async () => {
  vi.mocked(geocodeQuery).mockResolvedValue(point)
  const { result, rerender, unmount } = renderHook(({ address }: { address: string | null }) => useAddressMapPin(address), { initialProps: { address: 'address' as string | null } })
  await settle()
  rerender({ address: null })
  expect(result.current).toMatchObject({ status: 'idle', point: null })
  vi.mocked(isNaverMapsReady).mockReturnValue(false)
  rerender({ address: 'pending' })
  unmount()
  expect(vi.getTimerCount()).toBe(0)
})

test('a previously successful pin is hidden immediately for another pending address', async () => {
  vi.mocked(geocodeQuery).mockResolvedValue(point)
  const { result, rerender } = renderHook(({ address }) => useAddressMapPin(address), { initialProps: { address: 'first' } })
  await settle()
  expect(result.current.point).toEqual(point)
  vi.mocked(geocodeQuery).mockImplementation(() => new Promise(() => {}))
  rerender({ address: 'second' })
  expect(result.current).toMatchObject({ status: 'loading', point: null })
  rerender({ address: 'first' })
  expect(result.current).toMatchObject({ status: 'loading', point: null })
})

test('unmounted pending lookup cannot start a fallback query or update the next screen', async () => {
  let resolve!: (value: null) => void
  vi.mocked(geocodeQuery).mockImplementation(() => new Promise(r => { resolve = r }))
  const { unmount } = renderHook(() => useAddressMapPin('address'))
  unmount()
  await act(async () => { resolve(null) })
  expect(geocodeQuery).toHaveBeenCalledTimes(1)
  expect(vi.getTimerCount()).toBe(0)
})
