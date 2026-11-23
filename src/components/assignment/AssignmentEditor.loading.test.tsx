import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { AssignmentEditor } from './AssignmentEditor'
import { FullBuildingContext, type FullBuildingReader } from '../../hooks/buildingDemand'
import type { CalendarEvent } from '../../types'
import { testCard } from '../../test/territoryFixture'

const read = vi.hoisted(() => vi.fn())
vi.mock('../../hooks/calendarEventRefresh', () => ({ fetchUpdatedCalendarEvent: read }))
vi.mock('./TeamBuildScreen', () => ({ TeamBuildScreen: ({ participants }: { participants: string[] }) => <div data-testid="participants">{participants.join(',')}</div> }))
vi.mock('./ZoneAssignScreen', () => ({ ZoneAssignScreen: () => null }))

const event = {
  id: 71, date: '2026-11-18', time: '14:30', title: 'Meeting', applicants: ['Old'], assigned: [], guests: [],
  assignmentRevision: '4', assignmentStatus: 'shared', assignmentSharedAt: null,
  assignmentTeamInformal: {}, cardAssignments: [],
} as unknown as CalendarEvent
const fresh = { ...event, applicants: ['Current'], assignmentRevision: '7',
  cardAssignments: [{ userName: 'Current', teamKey: 'team', assignedCardIds: [1], cardScope: '전체' }] } as CalendarEvent
const props = () => ({ event, cards: [testCard(1, 'Card')], allCards: [testCard(1, 'Card')], buildings: [], cardBoundaries: [],
  currentVisitor: 'Leader', canEdit: true, onClose: vi.fn(), onShare: vi.fn().mockResolvedValue(true) })

beforeEach(() => {
  localStorage.clear()
  read.mockReset()
  vi.stubEnv('VITE_ASSIGNMENT_REVISION_ENABLED', 'true')
})
afterEach(() => { cleanup(); vi.unstubAllEnvs() })

test.each(['event', 'buildings'])('editor stays fullscreen until both independent reads finish (%s first)', async first => {
  let finish!: (value: CalendarEvent) => void
  read.mockReturnValue(new Promise(resolve => { finish = resolve }))
  const p = props(), request = vi.fn(), retry = vi.fn().mockResolvedValue(undefined)
  const view = (ready: boolean) => <FullBuildingContext.Provider value={{ ready, error: false, request, retry }}>
    <AssignmentEditor {...p} />
  </FullBuildingContext.Provider>
  const rendered = render(view(false))
  expect(request).toHaveBeenCalledTimes(1)
  expect(read).toHaveBeenCalledExactlyOnceWith(71)
  expect(screen.getByRole('status').closest('.asg-editor')).not.toBeNull()
  expect(screen.queryByTestId('participants')).not.toBeInTheDocument()
  if (first === 'event') await act(async () => { finish(fresh) })
  else rendered.rerender(view(true))
  expect(screen.getByRole('status').closest('.asg-editor')).not.toBeNull()
  expect(screen.getByRole('button', { name: '뒤로' })).toBeEnabled()
  expect(screen.queryByRole('button', { name: '배정 공유', exact: true })).not.toBeInTheDocument()
  if (first === 'event') rendered.rerender(view(true))
  else await act(async () => { finish(fresh) })
  expect(await screen.findByTestId('participants')).toHaveTextContent('Current')
  fireEvent.click(screen.getByRole('button', { name: '배정 공유', exact: true }))
  await waitFor(() => expect(p.onShare).toHaveBeenCalledWith(71, expect.any(Array), expect.objectContaining({ expectedRevision: '7' })))
  expect(read).toHaveBeenCalledTimes(1)
  expect(request).toHaveBeenCalledTimes(1)
})

test('event read failure keeps fullscreen back and retries the latest version', async () => {
  read.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(fresh)
  const p = props()
  render(<AssignmentEditor {...p} />)
  expect((await screen.findByRole('alert')).closest('.asg-editor')).not.toBeNull()
  expect(screen.queryByTestId('participants')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '다시 시도' }))
  expect(await screen.findByTestId('participants')).toHaveTextContent('Current')
  expect(read).toHaveBeenCalledTimes(2)
  expect(p.onShare).not.toHaveBeenCalled()
})

test('building read failure retains fullscreen and retries without refetching the event', async () => {
  read.mockResolvedValue(fresh)
  const p = props(), request = vi.fn(), retry = vi.fn().mockResolvedValue(undefined)
  const reader: FullBuildingReader = { ready: false, error: true, request, retry, mapReady: false, requestMap: vi.fn() }
  const view = () => <FullBuildingContext.Provider value={{ ...reader }}><AssignmentEditor {...p} /></FullBuildingContext.Provider>
  const rendered = render(view())
  await act(async () => {})
  expect(screen.getByRole('alert').closest('.asg-editor')).not.toBeNull()
  expect(screen.queryByTestId('participants')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '다시 시도' }))
  expect(retry).toHaveBeenCalledTimes(1)
  reader.ready = true; reader.error = false
  rendered.rerender(view())
  expect(await screen.findByTestId('participants')).toHaveTextContent('Current')
  expect(read).toHaveBeenCalledTimes(1)
})

test('closing while loading does not reopen the editor when the response arrives', async () => {
  let finish!: (value: CalendarEvent) => void
  read.mockReturnValue(new Promise(resolve => { finish = resolve }))
  const p = props(), rendered = render(<AssignmentEditor {...p} />)
  fireEvent.click(screen.getByRole('button', { name: '뒤로' }))
  expect(p.onClose).toHaveBeenCalledTimes(1)
  rendered.unmount()
  await act(async () => { finish(fresh) })
  expect(screen.queryByTestId('participants')).not.toBeInTheDocument()
  expect(document.querySelector('.asg-editor')).toBeNull()
  expect(p.onShare).not.toHaveBeenCalled()
})
