import '@testing-library/jest-dom/vitest'
import { useReducer, useState } from 'react'
import type { ComponentProps, ReactNode } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { ZoneAssignScreen } from './ZoneAssignScreen'
import { createAssignmentWorkspace } from './assignmentWorkspace'
import { draftReducer } from '../../hooks/assignmentDraft/reducer'
import type { DraftState } from '../../hooks/assignmentDraft/types'
import { testBoundary, testBuilding, testCard, testUnit } from '../../test/territoryFixture'
import { draftToAssignments } from '../../hooks/assignmentDraft/persistence'
import type { CardBoundary } from '../../types'
import type { Building } from '../../types'

vi.mock('../MapCanvas', () => ({ MapCanvas: ({ buildings, cardBoundaries, toolbarAction, onSelectCardBoundary, viewportMemory, hideActionButton }: {
  buildings: Building[]; cardBoundaries: CardBoundary[]; toolbarAction: ReactNode; onSelectCardBoundary: (id: number) => void; viewportMemory: unknown; hideActionButton: boolean
}) => <div data-testid="map" data-memory={Boolean(viewportMemory)} data-hide-add={hideActionButton}>
  {toolbarAction}<output data-testid="pins">{JSON.stringify(buildings.map(b => [b.id, b.units.map(u => u.id)]))}</output>
  {cardBoundaries.map(boundary => <button key={boundary.cardId} onClick={() => onSelectCardBoundary(boundary.cardId)}>{boundary.cardId === 1 ? 'select polygon' : `select polygon ${boundary.cardId}`}</button>)}
</div> }))

afterEach(() => { cleanup(); vi.unstubAllEnvs() })
const buildings = [testBuilding(1, 1, '주택', [testUnit(11, '101', { isChinese: true }), testUnit(12, '102')]),
  { ...testBuilding(2, 2, '상가', [testUnit(21, '1층', { isChinese: true })]), type: '상가' as const }]
const cards = [testCard(1, '처인구 고림동 1'), testCard(2, '기흥구 구갈동 1')]
const initial: DraftState = { activeTeamId: 'a', undo: null, draft: { mode: 'card', status: 'draft', updatedAt: null, teams: [
  { id: 'a', name: '팀 1', color: 'blue', order: 0, members: ['A'], cardIds: [] },
  { id: 'b', name: '팀 2', color: 'green', order: 1, members: ['B'], cardIds: [] },
  { id: 'c', name: '팀 3', color: 'orange', order: 2, members: ['C'], cardIds: [2], cardScope: '상가' },
  { id: 'd', name: '팀 4', color: 'purple', order: 3, members: ['D'], cardIds: [], cardScope: '전체' },
  { id: 'e', name: '팀 5', color: 'blue', order: 4, members: ['E'], cardIds: [1] },
] } }
function Harness({ canEdit = true }: { canEdit?: boolean }) {
  const [state, dispatch] = useReducer(draftReducer, initial)
  const [open, setOpen] = useState(true)
  const [workspace] = useState(createAssignmentWorkspace)
  const props: ComponentProps<typeof ZoneAssignScreen> = { workspace, teams: state.draft.teams, activeTeamId: state.activeTeamId,
    cards, buildings, cardBoundaries: [testBoundary(1, [37.1, 127.1, 37.2, 127.2]), testBoundary(2, [37.2, 127.2, 37.3, 127.3])], eventId: 1, currentVisitor: 'A', canEdit, dispatch, onBack: () => setOpen(false) }
  return <><output data-testid="draft">{JSON.stringify(state.draft)}</output><button onClick={() => setOpen(true)}>reopen</button>
    {open && <ZoneAssignScreen {...props} />}</>
}
const draft = () => JSON.parse(screen.getByTestId('draft').textContent!)
const team = (name: string) => screen.getByRole('button', { name: new RegExp(`^${name}`) })

test('new team inherits last scope only when assigning, preserving other teams and undo', () => {
  vi.stubEnv('VITE_TEAM_SERVICE_ENABLED', 'true')
  render(<Harness />)
  fireEvent.click(screen.getByRole('button', { name: '주택봉사', exact: true }))
  fireEvent.click(team('팀 2'))
  expect(screen.getByRole('button', { name: '주택봉사', exact: true })).toHaveAttribute('aria-pressed', 'true')
  expect(draft().teams[1].cardScope).toBeUndefined()
  fireEvent.click(screen.getByText('select polygon'))
  expect(draft().teams[1]).toMatchObject({ cardScope: '주택', cardIds: [1] })
  expect(draft().teams[2]).toMatchObject({ cardScope: '상가', cardIds: [2] })
  fireEvent.click(team('팀 3'))
  expect(screen.getByRole('button', { name: '상가봉사', exact: true })).toHaveAttribute('aria-pressed', 'true')
  fireEvent.click(team('팀 4'))
  expect(screen.getByRole('button', { name: '전체', exact: true })).toHaveAttribute('aria-pressed', 'true')
})

test('Chinese display filters only scoped pins and never changes assignment data or original units', () => {
  vi.stubEnv('VITE_TEAM_SERVICE_ENABLED', 'true')
  render(<Harness />)
  fireEvent.click(screen.getByRole('button', { name: '주택봉사', exact: true }))
  const before = draft()
  fireEvent.click(screen.getByRole('button', { name: '중국어 사용 세대만 표시' }))
  expect(screen.getByTestId('pins')).toHaveTextContent('[[1,[11]]]')
  expect(draft()).toEqual(before)
  expect(buildings[0].units).toHaveLength(2)
  expect(screen.getByTestId('map')).toHaveAttribute('data-hide-add', 'true')
  expect(screen.getByTestId('map')).toHaveAttribute('data-memory', 'true')
  fireEvent.click(screen.getByRole('button', { name: '중국어 사용 세대만 표시' }))
  expect(screen.getByTestId('pins')).toHaveTextContent('[[1,[11,12]]]')
})

test('back to teams and return keeps scope, region, view and Chinese switch', () => {
  vi.stubEnv('VITE_TEAM_SERVICE_ENABLED', 'true')
  render(<Harness />)
  fireEvent.click(screen.getByRole('button', { name: '중국어 사용 세대만 표시' }))
  fireEvent.click(screen.getByRole('button', { name: '처인구 1' }))
  fireEvent.click(screen.getByRole('button', { name: '주택봉사', exact: true }))
  fireEvent.click(screen.getByRole('button', { name: '목록', exact: true }))
  fireEvent.click(screen.getByRole('button', { name: '뒤로', exact: true }))
  fireEvent.click(screen.getByText('reopen'))
  expect(screen.getByRole('button', { name: '목록', exact: true })).toHaveAttribute('aria-pressed', 'true')
  expect(screen.getByRole('button', { name: '처인구 1' })).toHaveAttribute('aria-pressed', 'true')
  fireEvent.click(screen.getByRole('button', { name: '지도', exact: true }))
  expect(screen.getByRole('button', { name: '중국어 사용 세대만 표시' })).toHaveAttribute('aria-pressed', 'true')
  expect(screen.getByRole('button', { name: '주택봉사', exact: true })).toHaveAttribute('aria-pressed', 'true')
})

test('read-only viewers can change display but cannot assign or change team scope', () => {
  vi.stubEnv('VITE_TEAM_SERVICE_ENABLED', 'true')
  render(<Harness canEdit={false} />)
  expect(screen.getByRole('button', { name: '주택봉사', exact: true })).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: '중국어 사용 세대만 표시' }))
  fireEvent.click(screen.getByText('select polygon'))
  expect(draft()).toEqual(initial.draft)
})

test('fresh editor workspace does not inherit another event or account preferences', () => {
  const first = createAssignmentWorkspace()
  first.preferredScope = '주택'
  first.viewport.current = { lat: 37.2, lng: 127.1, zoom: 19 }
  expect(createAssignmentWorkspace()).toMatchObject({ preferredScope: '전체', chineseOnly: false, viewport: { current: null } })
})

test('browsing saved teams and returning through team setup never replaces the last explicit preference', () => {
  vi.stubEnv('VITE_TEAM_SERVICE_ENABLED', 'true')
  render(<Harness />)
  fireEvent.click(screen.getByRole('button', { name: '상가봉사', exact: true }))
  fireEvent.click(team('팀 4'))
  expect(screen.getByRole('button', { name: '전체', exact: true })).toHaveAttribute('aria-pressed', 'true')
  fireEvent.click(screen.getByRole('button', { name: '뒤로', exact: true }))
  fireEvent.click(screen.getByText('reopen'))
  fireEvent.click(team('팀 2'))
  expect(screen.getByRole('button', { name: '상가봉사', exact: true })).toHaveAttribute('aria-pressed', 'true')
  expect(draft().teams[3].cardScope).toBe('전체')
})

test('legacy local draft with cards but no scope still displays all, without changing the preference', () => {
  vi.stubEnv('VITE_TEAM_SERVICE_ENABLED', 'true')
  render(<Harness />)
  fireEvent.click(screen.getByRole('button', { name: '상가봉사', exact: true }))
  fireEvent.click(team('팀 5'))
  expect(screen.getByRole('button', { name: '전체', exact: true })).toHaveAttribute('aria-pressed', 'true')
  expect(draft().teams[4]).toMatchObject({ cardIds: [1] })
  expect(draft().teams[4].cardScope).toBeUndefined()
  fireEvent.click(team('팀 2'))
  expect(screen.getByRole('button', { name: '상가봉사', exact: true })).toHaveAttribute('aria-pressed', 'true')
})

test('assigning while Chinese display is enabled keeps the same selectable cards and sharing payload', () => {
  vi.stubEnv('VITE_TEAM_SERVICE_ENABLED', 'true')
  const first = render(<Harness />)
  fireEvent.click(screen.getByText('select polygon'))
  const withoutFilter = draftToAssignments(draft())
  first.unmount()
  render(<Harness />)
  fireEvent.click(screen.getByRole('button', { name: '중국어 사용 세대만 표시' }))
  expect(screen.getByText('select polygon 2')).toBeInTheDocument()
  fireEvent.click(screen.getByText('select polygon'))
  expect(draftToAssignments(draft())).toEqual(withoutFilter)
})
