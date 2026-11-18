import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { AssignmentEditor } from './AssignmentEditor'
import type { TeamBuildScreen } from './TeamBuildScreen'
import type { CalendarEvent } from '../../types'
import { FullBuildingContext } from '../../hooks/buildingDemand'
import { loadLocalDraft } from '../../hooks/assignmentDraft'
import { testCard } from '../../test/territoryFixture'

const read = vi.hoisted(() => vi.fn())
vi.mock('../../hooks/calendarEventRefresh', () => ({ fetchUpdatedCalendarEvent: read }))
vi.mock('./TeamBuildScreen', () => ({ TeamBuildScreen: (p: ComponentProps<typeof TeamBuildScreen>) => <>
  <output data-testid="teams">{p.teams.map(team => team.name).join(',')}</output>
  <output data-testid="participants">{p.participants.join(',')}</output>
  <button onClick={() => p.dispatch({ type: 'RENAME_TEAM', teamId: p.teams[0].id, name: 'Local draft' })}>edit local</button>
</> }))
vi.mock('./ZoneAssignScreen', () => ({ ZoneAssignScreen: () => null }))

const event = {
  id: 71, date: '2026-11-18', time: '14:30', title: 'Meeting', applicants: ['A'], assigned: [], guests: [],
  assignmentRevision: '4', assignmentStatus: 'shared', assignmentSharedAt: null, assignmentTeamInformal: {},
  cardAssignments: [{ userName: 'A', teamKey: 'pair', assignedCardIds: [1], cardScope: '전체' }],
} as unknown as CalendarEvent
const props = () => ({ event, cards: [testCard(1, 'Card')], allCards: [testCard(1, 'Card')], buildings: [], cardBoundaries: [],
  currentVisitor: 'Leader', canEdit: true, onClose: vi.fn(), onShare: vi.fn().mockResolvedValue(undefined) })
beforeEach(() => {
  localStorage.clear(); read.mockReset(); read.mockResolvedValue(event)
  vi.stubEnv('VITE_ASSIGNMENT_REVISION_ENABLED', 'true')
})
afterEach(() => { cleanup(); vi.unstubAllEnvs() })
const edit = async () => {
  fireEvent.click(await screen.findByText('edit local'))
  await waitFor(() => expect(loadLocalDraft(71, 'Leader')?.teams[0].name).toBe('Local draft'))
  return loadLocalDraft(71, 'Leader')!
}

test('a hypothetical full-reader readiness loss remounts content but retains the saved draft', async () => {
  const p = props(), request = vi.fn(), retry = vi.fn().mockResolvedValue(undefined)
  const view = (ready: boolean) => <FullBuildingContext.Provider value={{ ready, error: false, request, retry }}>
    <AssignmentEditor {...p} />
  </FullBuildingContext.Provider>
  const rendered = render(view(true)), draft = await edit()
  rendered.rerender(view(false))
  expect(screen.queryByTestId('teams')).not.toBeInTheDocument()
  expect(loadLocalDraft(71, 'Leader')).toEqual(draft)
  rendered.rerender(view(true))
  expect(await screen.findByTestId('teams')).toHaveTextContent('Local draft')
  expect(loadLocalDraft(71, 'Leader')).toEqual(draft)
  expect(read).toHaveBeenCalledTimes(1)
})

test('reopen against a newer version preserves local storage until an explicit conflict choice', async () => {
  const p = props(), first = render(<AssignmentEditor {...p} />), draft = await edit()
  first.unmount()
  read.mockResolvedValue({ ...event, assignmentRevision: '5' })
  const second = render(<AssignmentEditor {...p} />)
  await screen.findByText('임시 저장본과 공유본이 다릅니다')
  expect(loadLocalDraft(71, 'Leader')).toEqual(draft)
  expect(p.onShare).not.toHaveBeenCalled()
  second.unmount()
  render(<AssignmentEditor {...p} />)
  await screen.findByText('임시 저장본과 공유본이 다릅니다')
  expect(loadLocalDraft(71, 'Leader')).toEqual(draft)
  fireEvent.click(screen.getByRole('button', { name: '내 임시 저장 이어서' }))
  expect(await screen.findByTestId('teams')).toHaveTextContent('Local draft')
  await waitFor(() => expect(loadLocalDraft(71, 'Leader')).toEqual({ ...draft, baseRevision: '5' }))
  expect(p.onShare).not.toHaveBeenCalled()
})

test('parent refresh cannot replace the pinned participant snapshot while editing', async () => {
  const p = props(), rendered = render(<AssignmentEditor {...p} />), draft = await edit()
  const participants = screen.getByTestId('participants')
  expect(participants).toHaveTextContent(/^A$/)
  await act(async () => {
    rendered.rerender(<AssignmentEditor {...p} event={{ ...event, applicants: ['B'], assignmentRevision: '5' }} />)
  })
  // This observes what Content forwards to its child, not just its initial revision ref.
  expect(screen.getByTestId('participants')).toBe(participants)
  expect(participants).toHaveTextContent(/^A$/)
  expect(read).toHaveBeenCalledExactlyOnceWith(71)
  expect(screen.getByTestId('teams')).toHaveTextContent('Local draft')
  expect(loadLocalDraft(71, 'Leader')).toEqual(draft)
  expect(p.onShare).not.toHaveBeenCalled()
})

test('a save conflict keeps the draft and editor open', async () => {
  const p = props()
  p.onShare.mockImplementation(async (_id, _assignments, options) => { options.onConflict(null) })
  render(<AssignmentEditor {...p} />)
  const draft = await edit()
  expect(screen.getByTestId('teams')).toHaveTextContent('Local draft')
  fireEvent.click(screen.getByRole('button', { name: '배정 공유', exact: true }))
  await screen.findByText('배정 내용이 변경됐어요')
  expect(p.onShare).toHaveBeenCalledWith(71, expect.any(Array), expect.objectContaining({ expectedRevision: '4' }))
  expect(loadLocalDraft(71, 'Leader')).toEqual(draft)
  expect(p.onClose).not.toHaveBeenCalled()
})
