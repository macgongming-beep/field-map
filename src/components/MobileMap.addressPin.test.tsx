import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, expect, test, vi } from 'vitest'
import { MobileMap } from './MobileMap'
import { territoryProps } from '../test/territoryFixture'
import { geocodeQuery } from '../lib/naverGeocode'

vi.mock('../lib/naverGeocode', () => ({ isNaverMapsReady: () => true, geocodeQuery: vi.fn(), geocodeFirstMatch: vi.fn() }))
vi.mock('./MapCanvas', () => ({ MapCanvas: ({ virtualPinLat, virtualPinLng }: { virtualPinLat: number | null; virtualPinLng: number | null }) =>
  <output data-testid="pin">{JSON.stringify([virtualPinLat, virtualPinLng])}</output> }))
afterEach(cleanup)

test('no-match remains visible and retry passes resolved coordinates to MapCanvas', async () => {
  vi.mocked(geocodeQuery).mockResolvedValue(null)
  const props = { ...territoryProps(), language: 'en', actualRole: 'user', currentVisitor: 'Me',
    buildings: [], cards: [], serviceSessions: [], specialPeriods: [], eventRestaurantAssignments: [],
    calendarEvents: [], focusedCardIds: [], regularVisitScope: true, onBack: vi.fn() }
  render(<MemoryRouter initialEntries={['/map?scope=regularVisits&returnVisitId=7&addr=Test']}><MobileMap {...(props as never)} /></MemoryRouter>)
  await waitFor(() => expect(screen.getByText('Address not found')).toBeTruthy())
  expect(screen.getByTestId('pin').textContent).toBe('[null,null]')
  vi.mocked(geocodeQuery).mockResolvedValue({ lat: 37.2, lng: 127.2 })
  await act(async () => fireEvent.click(screen.getByRole('button', { name: /다시 시도|Retry/ })))
  await waitFor(() => expect(screen.getByTestId('pin').textContent).toBe('[37.2,127.2]'))
  expect(screen.queryByText('Address not found')).toBeNull()
})
