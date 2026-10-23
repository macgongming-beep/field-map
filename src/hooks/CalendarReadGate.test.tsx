import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { CalendarReadGate } from './CalendarReadGate'
import { CalendarReadContext } from './CalendarReadContext'

afterEach(cleanup)
test('old month never shows an empty list while its data is pending; failed read offers retry', () => {
  const select = vi.fn(), retry = vi.fn()
  const state = { month: '2026-08', full: false, ready: false, error: false, select, retry }
  const view = (value: typeof state) => <CalendarReadContext.Provider value={value}>
    <CalendarReadGate month="2026-08"><div>Old applicants: A, Guest</div></CalendarReadGate>
  </CalendarReadContext.Provider>
  const { rerender } = render(view(state))
  expect(screen.queryByText('Old applicants: A, Guest')).toBeNull()
  expect(screen.getByRole('status')).toBeTruthy()
  expect(select).toHaveBeenCalledWith('2026-08', false)
  rerender(view({ ...state, error: true }))
  fireEvent.click(screen.getByRole('button'))
  expect(retry).toHaveBeenCalledOnce()
  rerender(view({ ...state, ready: true }))
  expect(screen.getByText('Old applicants: A, Guest')).toBeTruthy()
})
test('month transition masks old children even before parent commits the new demand', () => {
  render(<CalendarReadContext.Provider value={{ month: '2026-10', full: false, ready: true, error: false, select: vi.fn(), retry: vi.fn() }}>
    <CalendarReadGate month="2026-08"><div>Incomplete August</div></CalendarReadGate>
  </CalendarReadContext.Provider>)
  expect(screen.queryByText('Incomplete August')).toBeNull()
})
test('export/edit request does not render until full history is ready', () => {
  const select = vi.fn()
  render(<CalendarReadContext.Provider value={{ month: '2026-10', full: false, ready: true, error: false, select, retry: vi.fn() }}>
    <CalendarReadGate month="2026-10" full><button>Export all</button></CalendarReadGate>
  </CalendarReadContext.Provider>)
  expect(screen.queryByText('Export all')).toBeNull()
  expect(select).toHaveBeenCalledWith('2026-10', true)
})
test('production without provider keeps existing UI unchanged', () => {
  render(<CalendarReadGate month="2026-08"><div>Existing list</div></CalendarReadGate>)
  expect(screen.getByText('Existing list')).toBeTruthy()
})
