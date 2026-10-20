import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { SupersededReadError } from '../hooks/supersededRead'
import { PullToRefresh } from './PullToRefresh'

const captureException = vi.hoisted(() => vi.fn())
vi.mock('../lib/sentry', () => ({ Sentry: { captureException } }))

afterEach(() => { cleanup(); vi.restoreAllMocks(); captureException.mockClear() })

function pull() {
  fireEvent.touchStart(document.body, { touches: [{ clientY: 0 }] })
  fireEvent.touchMove(document.body, { touches: [{ clientY: 160 }] })
  fireEvent.touchEnd(document.body)
}

test.each([
  new Error('network unavailable'),
  new Error('Calendar read superseded'),
  new SupersededReadError('Calendar read superseded'),
])('handles $name rejection, resets spinner and permits retry', async (error) => {
  const now = vi.spyOn(Date, 'now').mockReturnValue(10_000)
  let reject!: (reason: Error) => void
  const onRefresh = vi.fn()
    .mockImplementationOnce(() => new Promise<void>((_, rejectPromise) => { reject = rejectPromise }))
    .mockResolvedValue(undefined)
  const { container } = render(<PullToRefresh onRefresh={onRefresh} />)
  pull()
  expect(onRefresh).toHaveBeenCalledOnce()
  expect(container.querySelector('.pull-refresh-spinner')).not.toBeNull()
  await act(async () => { reject(error) })
  if (error instanceof SupersededReadError) {
    expect(captureException).not.toHaveBeenCalled()
  } else {
    expect(captureException).toHaveBeenCalledExactlyOnceWith(error)
  }
  expect(container.querySelector('.pull-refresh-spinner')).toBeNull()
  expect(container.querySelector('[role="status"]')?.getAttribute('aria-hidden')).toBe('true')
  now.mockReturnValue(15_001)
  pull()
  await act(async () => {})
  expect(onRefresh).toHaveBeenCalledTimes(2)
  expect(captureException).toHaveBeenCalledTimes(error instanceof SupersededReadError ? 0 : 1)
  expect(container.querySelector('.pull-refresh-spinner')).toBeNull()
  expect(container.querySelector('[role="status"]')?.getAttribute('aria-hidden')).toBe('true')
})
