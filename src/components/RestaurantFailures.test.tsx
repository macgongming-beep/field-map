import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { MobileTerritory } from './MobileTerritory'
import { RestaurantsTab } from './RestaurantsTab'

beforeEach(() => { localStorage.clear() })
afterEach(cleanup)

test.each(['false', 'throw'])('request memo survives %s and can be retried', async (failure) => {
  const save = vi.fn()
  if (failure === 'false') save.mockResolvedValueOnce(false)
  else save.mockRejectedValueOnce(new Error('offline'))
  save.mockResolvedValueOnce(true)
  localStorage.setItem('rs:tester', JSON.stringify({ kind: 'request', requestId: 61,
    name: 'Test restaurant', address: 'Test address', startedAt: new Date().toISOString() }))
  render(<MemoryRouter><MobileTerritory {...({ language: 'ko', role: 'user', currentVisitor: 'tester',
    buildings: [], cards: [], calendarEvents: [], visitHistories: [], serviceSessions: [],
    onOpenMap: vi.fn(), onEndServiceSession: vi.fn(), onUpdateRestaurantRequestMemo: save, onSubmitRestaurantRequest: vi.fn(),
  } as never)} /></MemoryRouter>)
  fireEvent.click(screen.getByRole('button', { name: '기록' }))
  fireEvent.change(screen.getByPlaceholderText('봉사 결과 메모 (선택)'), { target: { value: 'Keep this draft' } })
  fireEvent.click(screen.getByRole('button', { name: '저장' }))
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1))
  await waitFor(() => expect(screen.getByRole('button', { name: '저장' })).toBeEnabled())
  expect(screen.getByPlaceholderText('봉사 결과 메모 (선택)')).toHaveValue('Keep this draft')
  expect(localStorage.getItem('rs:tester')).not.toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '저장' }))
  await waitFor(() => expect(screen.queryByPlaceholderText('봉사 결과 메모 (선택)')).not.toBeInTheDocument())
  expect(save).toHaveBeenLastCalledWith(61, 'Keep this draft')
  expect(localStorage.getItem('rs:tester')).toBeNull()
})

test.each(['승인 확정', '거절'])('%s unlocks after a network error and retains edits', async (action) => {
  let fail!: (error: Error) => void
  const process = vi.fn().mockImplementationOnce(() => new Promise<void>((_resolve, reject) => { fail = reject }))
    .mockResolvedValue(undefined)
  render(<RestaurantsTab {...({ language: 'ko', role: 'admin', currentVisitor: 'Admin', buildings: [], cards: [],
    restaurantRequests: [{ id: 61, name: 'Test restaurant', address: 'Test address', status: 'pending',
      requestedBy: 'tester', requestedAt: new Date().toISOString(), memo: null }],
    onApproveRestaurantRequest: process, onRejectRestaurantRequest: process, onOpenMap: vi.fn(),
  } as never)} />)
  await waitFor(() => expect(screen.getByRole('button', { name: '승인 확정' })).toBeEnabled())
  fireEvent.change(screen.getByPlaceholderText('식당 이름'), { target: { value: 'Edited name' } })
  fireEvent.click(screen.getByRole('button', { name: action }))
  expect(screen.getByRole('button', { name: action === '거절' ? '...' : '처리 중...' })).toBeDisabled()
  fail(new Error('offline'))
  await waitFor(() => expect(screen.getByRole('button', { name: action })).toBeEnabled())
  expect(screen.getByPlaceholderText('식당 이름')).toHaveValue('Edited name')
  expect(screen.getByPlaceholderText('주소')).toHaveValue('Test address')
  fireEvent.click(screen.getByRole('button', { name: action }))
  await waitFor(() => expect(process).toHaveBeenCalledTimes(2))
})
