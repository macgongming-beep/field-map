import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { AssignmentEditor } from './AssignmentEditor'
import type { TeamBuildScreen } from './TeamBuildScreen'
import type { CalendarEvent } from '../../types'
import { testBuilding, testCard } from '../../test/territoryFixture'

vi.mock('../MapCanvas', () => ({ MapCanvas: () => <div>map</div> }))
vi.mock('./TeamBuildScreen', () => ({ TeamBuildScreen: (props: ComponentProps<typeof TeamBuildScreen>) =>
  <button onClick={() => props.onOpenTeamZones(props.teams[0].id)}>open zones</button> }))
beforeEach(() => {
  localStorage.clear()
  vi.stubEnv('VITE_ASSIGNMENT_REVISION_ENABLED', 'false')
  vi.stubEnv('VITE_TEAM_SERVICE_ENABLED', 'true')
})
afterEach(() => { cleanup(); vi.unstubAllEnvs() })

test('actual editor owns workspace per event: A keeps its search on return, B starts fresh', () => {
  const event = { id: 71, date: '2026-11-19', time: '14:30', applicants: ['A'], assigned: [], guests: [],
    assignmentStatus: 'shared', assignmentSharedAt: null, assignmentTeamInformal: {},
    cardAssignments: [{ userName: 'A', teamKey: 'pair', assignedCardIds: [1] }],
  } as unknown as CalendarEvent
  const cards = [testCard(1, '처인구 고림동 1'), testCard(2, '기흥구 구갈동 1')]
  const props = { cards, allCards: cards, buildings: [testBuilding(1, 1, '주택'), testBuilding(2, 2, '주택')],
    cardBoundaries: [], currentVisitor: 'A', canEdit: true, onClose: vi.fn(), onShare: vi.fn() }
  const view = render(<AssignmentEditor {...props} event={event} />)
  fireEvent.click(screen.getByText('open zones'))
  fireEvent.click(screen.getByRole('button', { name: '목록', exact: true }))
  fireEvent.click(screen.getByRole('button', { name: '처인구 1' }))
  fireEvent.change(screen.getByPlaceholderText('카드 검색'), { target: { value: '고림' } })
  fireEvent.click(screen.getByRole('button', { name: '뒤로', exact: true }))
  fireEvent.click(screen.getByText('open zones'))
  expect(screen.getByPlaceholderText('카드 검색')).toHaveValue('고림')
  expect(screen.getByRole('button', { name: '처인구 1' })).toHaveAttribute('aria-pressed', 'true')
  view.rerender(<AssignmentEditor {...props} event={{ ...event, id: 72 }} />)
  fireEvent.click(screen.getByText('open zones'))
  expect(screen.getByRole('button', { name: '지도', exact: true })).toHaveAttribute('aria-pressed', 'true')
  fireEvent.click(screen.getByRole('button', { name: '목록', exact: true }))
  expect(screen.getByPlaceholderText('카드 검색')).toHaveValue('')
  expect(screen.getByRole('button', { name: '처인구 1' })).toHaveAttribute('aria-pressed', 'false')
})
