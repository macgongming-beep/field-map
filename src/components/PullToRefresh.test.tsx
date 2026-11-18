import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { PullToRefresh } from './PullToRefresh'

afterEach(() => { cleanup(); vi.restoreAllMocks() })
const pull = () => {
  fireEvent.touchStart(document.body, { touches: [{ clientY: 20 }] })
  fireEvent.touchMove(document.body, { touches: [{ clientY: 200 }] })
  expect(screen.getByText('놓으면 새로고침')).toBeVisible()
  fireEvent.touchEnd(document.body)
}

test('failed refresh ends the spinner and allows a later retry without an unhandled rejection', async () => {
  const clock = vi.spyOn(Date, 'now').mockReturnValue(10000)
  let fail!: (error: Error) => void
  const onRefresh = vi.fn().mockImplementationOnce(() => new Promise<void>((_, reject) => { fail = reject }))
    .mockResolvedValueOnce(undefined)
  render(<PullToRefresh onRefresh={onRefresh} />)
  pull()
  expect(screen.getByText('새로고침 중...')).toBeVisible()
  expect(onRefresh).toHaveBeenCalledTimes(1)
  await act(async () => { fail(new Error('read failed; store already notified the user')) })
  await waitFor(() => expect(screen.getByRole('status', { hidden: true })).not.toBeVisible())
  clock.mockReturnValue(16000)
  pull()
  await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(2))
  await waitFor(() => expect(screen.getByRole('status', { hidden: true })).not.toBeVisible())
})

test('in-flight refresh and cooldown do not start duplicate reads', async () => {
  vi.spyOn(Date, 'now').mockReturnValue(10000)
  let finish!: () => void
  const onRefresh = vi.fn().mockImplementation(() => new Promise<void>(resolve => { finish = resolve }))
  render(<PullToRefresh onRefresh={onRefresh} />)
  pull()
  fireEvent.touchStart(document.body, { touches: [{ clientY: 20 }] })
  fireEvent.touchMove(document.body, { touches: [{ clientY: 200 }] })
  fireEvent.touchEnd(document.body)
  expect(onRefresh).toHaveBeenCalledTimes(1)
  await act(async () => { finish() })
  pull()
  expect(onRefresh).toHaveBeenCalledTimes(1)
})
