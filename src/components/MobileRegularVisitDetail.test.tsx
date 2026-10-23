import { useState } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, expect, test, vi } from 'vitest'
import { MobileRegularVisitDetail } from './MobileRegularVisitDetail'
import type { Building, ReturnVisit, ReturnVisitLog } from '../types'

const state = vi.hoisted(() => ({ read: vi.fn() }))
vi.mock('../hooks/returnVisitLogReader', async (original) => ({
  ...await original<typeof import('../hooks/returnVisitLogReader')>(), readReturnVisitLogs: state.read,
}))
vi.mock('../lib/authToken', () => ({ getAuthToken: () => 'demo-account' }))
afterEach(() => { cleanup(); vi.unstubAllEnvs(); state.read.mockReset() })

const visit: ReturnVisit = {
  id: 7, buildingId: 10, unitId: 100, displayName: 'Test visit', nickname: 'Test nickname',
  address: 'Test address', unitNumber: '101', assignedUserName: 'Volunteer', createdBy: 'Volunteer',
  lastVisitedAt: null, lastResult: null, createdAt: '2026-10-20',
}
const building: Building = { id: 10, cardId: 3, name: 'Test building', address: 'Test address', type: '주택', lat: 37, lng: 127, units: [] }
const log: ReturnVisitLog = { id: 1, returnVisitId: 7, visitedAt: '2026-10-23T01:00:00Z', result: '부재', memo: 'Saved test memo', createdBy: 'Volunteer' }

function Location() { const location = useLocation(); return <output data-testid="location">{location.pathname}{location.search}</output> }
function mount(buildings: Building[], visits = [visit], onSave = vi.fn()) {
  vi.stubEnv('VITE_DEMO_MODE', 'true')
  state.read.mockResolvedValue([])
  function Detail() {
    const [index, setIndex] = useState<ReturnVisitLog[]>([])
    return <MobileRegularVisitDetail language="en" returnVisits={visits} returnVisitLogs={index}
      buildings={buildings} currentVisitor="Volunteer" onAddReturnVisitLog={async (...args) => {
        onSave(...args)
        state.read.mockResolvedValue([log])
        setIndex([{ ...log, memo: '', createdBy: '', result: null }])
      }} />
  }
  return render(<MemoryRouter initialEntries={['/territory/regular/7']}>
    <Location /><Routes><Route path="/territory/regular/:id" element={<Detail />} /><Route path="*" element={<span>Destination</span>} /></Routes>
  </MemoryRouter>)
}

test('scoped building snapshot retains details and save re-reads the target memo', async () => {
  const save = vi.fn()
  mount([building], [visit], save)
  await waitFor(() => expect(state.read).toHaveBeenCalledExactlyOnceWith(7))
  expect(screen.getByText('Test nickname')).toBeTruthy()
  expect(screen.getByText('Test address')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: /record/i }))
  fireEvent.click(screen.getByRole('button', { name: 'Absent', exact: true }))
  fireEvent.change(screen.getByPlaceholderText('Memo (optional)'), { target: { value: log.memo } })
  fireEvent.click(screen.getByRole('button', { name: 'Save', exact: true }))
  await waitFor(() => expect(screen.getByText(log.memo)).toBeTruthy())
  expect(save).toHaveBeenCalledExactlyOnceWith(7, '부재', log.memo)
  expect(state.read).toHaveBeenCalledTimes(2)
  expect(state.read.mock.calls.every(([id]) => id === 7)).toBe(true)
})

test('linked building still opens its card map', async () => {
  mount([building])
  await waitFor(() => expect(state.read).toHaveBeenCalled())
  fireEvent.click(screen.getByRole('button', { name: /map/i }))
  expect(screen.getByTestId('location').textContent).toBe('/map?cardId=3')
})

test('unlinked address retains the map fallback', async () => {
  mount([], [{ ...visit, buildingId: null, unitId: null }])
  await waitFor(() => expect(state.read).toHaveBeenCalled())
  fireEvent.click(screen.getByRole('button', { name: /map/i }))
  expect(screen.getByTestId('location').textContent).toBe('/map?addr=Test%20address&pinLabel=Test%20nickname')
})

test('missing record does not request another record history', () => {
  mount([], [])
  expect(state.read).not.toHaveBeenCalled()
  expect(screen.queryByText('Test nickname')).toBeNull()
})
