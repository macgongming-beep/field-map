import { useContext, useEffect } from 'react'
import { act, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { RecipientPreviewLive } from './useRecipientPreviewLive'
import { TerritoryRealtimeContext, type TerritoryRealtime } from './territoryRealtimeContext'
import { mergeRecipientSnapshot } from './recipientSnapshot'
import type { RecipientCardDetails } from '../lib/recipientCardPrefetch'
import type { Building, VisitHistory } from '../types'

const mocks = vi.hoisted(() => ({ read: vi.fn(), summaries: vi.fn(), token: vi.fn(() => 'session') }))
vi.mock('./useTerritoryRealtime', () => ({ useTerritoryRealtime: vi.fn() }))
vi.mock('./territorySync', () => ({ fetchChangedBuildings: mocks.read }))
vi.mock('../lib/cardSummaries', () => ({ fetchCardSummaries: mocks.summaries }))
vi.mock('../lib/authToken', () => ({ getAuthToken: mocks.token }))

const initial = { buildings: [{ id: 11, card_id: 1, name: 'Building', type: '주택', units: [{ id: 21, building_id: 11, number: '101', status: '미방문' }] }], histories: [], boundaries: [], baseline: '2026-10-05T00:00:00Z' } as unknown as RecipientCardDetails
let live: TerritoryRealtime | null
function Probe() { const context = useContext(TerritoryRealtimeContext); useEffect(() => { live = context }, [context]); return null }
beforeEach(() => { vi.clearAllMocks(); mocks.token.mockReturnValue('session'); live = null; mocks.summaries.mockResolvedValue([{ id: 1, completed: 1 }]) })
const changedBuilding = (id = 11, cardId = 1, unitId = 21) => ({ id, cardId, units: [{ id: unitId, status: '부재' }] } as Building)
const history = (id: number, unitId = 21) => ({ id, unitId, result: '부재' } as VisitHistory)

it('updates selected building data and card progress without remounting or global reads', async () => {
  const summary = vi.fn()
  render(<RecipientPreviewLive details={initial} cardIds={[1]} onSummaries={summary}>{(data) => <><Probe /><div>{data.buildings[0]?.units[0]?.status}</div><div data-testid="histories">{data.histories.length}</div></>}</RecipientPreviewLive>)
  await waitFor(() => expect(live).not.toBeNull())
  expect(live!.checkpoint.baseline).toBe(initial.baseline)
  mocks.read.mockResolvedValue({ buildings: [changedBuilding()], histories: [history(1)] })
  await act(() => live!.sync([11]))
  expect(screen.getByText('부재')).toBeTruthy()
  expect(screen.getByTestId('histories').textContent).toBe('1')
  expect(mocks.read).toHaveBeenCalledWith([11])
  expect(mocks.summaries).toHaveBeenCalledWith([1])
  expect(summary).toHaveBeenCalledWith([{ id: 1, completed: 1 }])
})

it('rejects account changes and late results after unmount', async () => {
  const summary = vi.fn()
  const view = render(<RecipientPreviewLive details={initial} cardIds={[1]} onSummaries={summary}>{() => <Probe />}</RecipientPreviewLive>)
  await waitFor(() => expect(live).not.toBeNull())
  mocks.token.mockReturnValue('another-session')
  await expect(live!.sync([11])).rejects.toThrow('session changed')
  expect(mocks.read).not.toHaveBeenCalled()
  mocks.token.mockReturnValue('session')
  let resolve!: (value: unknown) => void
  mocks.read.mockReturnValue(new Promise((r) => { resolve = r }))
  const pending = live!.sync([11])
  view.unmount()
  resolve({ buildings: [changedBuilding()], histories: [] })
  await expect(pending).rejects.toThrow('session changed')
  expect(summary).not.toHaveBeenCalled()
})

it('does not replace a newer refresh with a late response', async () => {
  render(<RecipientPreviewLive details={initial} cardIds={[1]} onSummaries={vi.fn()}>{(data) => <><Probe /><div>{data.buildings[0]?.units[0]?.status}</div></>}</RecipientPreviewLive>)
  await waitFor(() => expect(live).not.toBeNull())
  let resolve!: (value: unknown) => void
  mocks.read.mockReturnValueOnce(new Promise((r) => { resolve = r })).mockResolvedValueOnce({ buildings: [changedBuilding()], histories: [] })
  const old = live!.sync([11])
  await act(() => live!.sync([11]))
  await act(async () => { resolve({ buildings: [], histories: [] }); await old })
  expect(screen.getByText('부재')).toBeTruthy()
})

it('removes invalidated histories, excludes moved-out buildings, and preserves destination-first moves', () => {
  const current = { buildings: [changedBuilding()], histories: [history(1)] }
  expect(mergeRecipientSnapshot(current, { buildings: [changedBuilding()], histories: [] }, [11], [1]).histories).toEqual([])
  expect(mergeRecipientSnapshot(current, { buildings: [changedBuilding(11, 99)], histories: [history(2)] }, [11], [1])).toEqual({ buildings: [], histories: [] })
  const destination = mergeRecipientSnapshot(current, { buildings: [changedBuilding(12)], histories: [history(2)] }, [12], [1])
  const removal = mergeRecipientSnapshot(destination, { buildings: [], histories: [] }, [11], [1])
  expect(removal.histories).toEqual([history(2)])
  expect(removal.buildings.map((b) => b.id)).toEqual([12])
})
