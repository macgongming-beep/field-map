import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ComponentProps } from 'react'
import type { CalendarEvent, InformalAsset } from '../../types'
import { AssignmentEditor } from './AssignmentEditor'
import type { TeamBuildScreen } from './TeamBuildScreen'
import type { MapCanvas } from '../MapCanvas'
import { GroupTerritoryContext } from '../../features/groupTerritory/context'
import { testBuilding, testCard, testUnit } from '../../test/territoryFixture'

vi.mock('../MapCanvas', () => ({ MapCanvas: (p: ComponentProps<typeof MapCanvas>) => <>
  <output data-testid="map-cards">{p.cards?.map(c => c.id).join(',')}</output>
  <output data-testid="map-buildings">{p.buildings.map(b => b.id).join(',')}</output>
  <button onClick={() => p.onSelectCardBoundary?.(2)}>stale outside boundary</button>
</> }))
vi.mock('./TeamBuildScreen', () => ({ TeamBuildScreen: (p: ComponentProps<typeof TeamBuildScreen>) => <>
  <output data-testid="teams">{JSON.stringify(p.teams.map(t => t.cardIds))}</output>
  <button onClick={() => p.onOpenTeamZones(p.teams[0].id)}>open zones</button>
</> }))
beforeEach(() => { localStorage.clear(); vi.stubEnv('VITE_ASSIGNMENT_REVISION_ENABLED', 'false'); vi.stubEnv('VITE_TEAM_SERVICE_ENABLED', 'true'); vi.spyOn(window, 'confirm').mockReturnValue(true) })
afterEach(() => { cleanup(); vi.unstubAllEnvs(); vi.restoreAllMocks() })
const cards = [testCard(1, 'A house', { assignedGroupCodes: ['a'] }), testCard(2, 'B restaurant', { assignedGroupCodes: ['b'] }),
  testCard(3, 'Shared shop', { assignedGroupCodes: ['a', 'b'] }), testCard(4, 'Unassigned')]
const buildings = [testBuilding(1, 1, 'House', [testUnit(1, '101')]),
  testBuilding(2, 2, 'Outside restaurant', [testUnit(2, 'Restaurant', { isRestaurant: true })]),
  testBuilding(3, 3, 'Shop', [testUnit(3, 'Shop', { usageType: '상가' })])]
const event = { id: 71, date: '2026-11-25', time: '14:30', applicants: ['A'], assigned: [], guests: [],
  serviceKind: 'group', groupServiceScope: true, targetGroups: ['a'], assignmentTeamInformal: {},
  assignmentStatus: 'shared', assignmentSharedAt: null,
  cardAssignments: [{ userName: 'A', teamKey: 'pair', assignedCardIds: [1], cardScope: '전체' }],
} as unknown as CalendarEvent
function mount(e = event) {
  const share = vi.fn().mockResolvedValue(undefined)
  render(<GroupTerritoryContext.Provider value={{ enabled: true, ownCode: 'b', canManage: false, groups: [{ code: 'a', name: '东滩', active: true }, { code: 'b', name: '新葛', active: true }], save: vi.fn() }}>
    <AssignmentEditor event={e} cards={cards} allCards={cards} buildings={buildings} cardBoundaries={[]} currentVisitor="A" canEdit onClose={vi.fn()} onShare={share}
      informalAssets={[{ id: 8, name: 'Unrestricted informal', archived: false, parentId: null, groupId: null } as InformalAsset]} />
  </GroupTerritoryContext.Provider>)
  return share
}
test('event group, not arranging leader membership, scopes map and list; house/shop stay inside it', () => {
  mount(); fireEvent.click(screen.getByText('open zones'))
  expect(screen.getByText('东滩 · 구역 배분')).toBeVisible()
  expect(screen.getByTestId('map-cards')).toHaveTextContent(/^1,3$/)
  expect(screen.getByTestId('map-buildings')).toHaveTextContent(/^1,3$/)
  fireEvent.click(screen.getByText('stale outside boundary'))
  fireEvent.click(screen.getByRole('button', { name: '주택봉사', exact: true }))
  expect(screen.getByTestId('map-cards')).toHaveTextContent(/^1$/)
  fireEvent.click(screen.getByRole('button', { name: '상가봉사', exact: true }))
  expect(screen.getByTestId('map-cards')).toHaveTextContent(/^3$/)
  fireEvent.click(screen.getByRole('button', { name: '전체', exact: true }))
  fireEvent.click(screen.getByRole('button', { name: '목록', exact: true }))
  expect(screen.getByText('A house')).toBeVisible(); expect(screen.getByText('Shared shop')).toBeVisible()
  expect(screen.queryByText('B restaurant')).toBeNull(); expect(screen.queryByText('Unassigned')).toBeNull()
})
test('outside boundary callback cannot append a card; restaurants and informal remain global', () => {
  mount(); fireEvent.click(screen.getByText('open zones')); fireEvent.click(screen.getByText('stale outside boundary'))
  fireEvent.click(screen.getByRole('button', { name: '뒤로', exact: true }))
  expect(screen.getByTestId('teams')).toHaveTextContent('[[1]]')
  fireEvent.click(screen.getByText('open zones')); fireEvent.click(screen.getByRole('button', { name: '비공식', exact: true }))
  fireEvent.click(screen.getByText('미분류')); expect(screen.getByText('Unrestricted informal')).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: '식당', exact: true }))
  fireEvent.click(screen.getByText('B'))
  expect(screen.getByText('Restaurant')).toBeVisible()
})
test('congregation keeps all cards and the original heading', () => {
  mount({ ...event, serviceKind: 'congregation', groupServiceScope: false, targetGroups: [] })
  fireEvent.click(screen.getByText('open zones'))
  expect(screen.getByText('구역 배분', { exact: true })).toBeVisible()
  expect(screen.getByTestId('map-cards')).toHaveTextContent(/^1,2,3,4$/)
})
test('no assigned group never falls back to all cards and keeps old draft until explicitly removed', async () => {
  const share = mount({ ...event, targetGroups: ['empty'] })
  expect(screen.getByTestId('teams')).toHaveTextContent('[[1]]')
  expect(screen.getByRole('button', { name: '배정 공유', exact: true })).toBeDisabled()
  fireEvent.click(screen.getByText('open zones'))
  expect(screen.getByText('집단 담당 구역이 없습니다.')).toBeVisible()
  expect(screen.getByTestId('map-cards')).toBeEmptyDOMElement()
  fireEvent.click(screen.getByRole('button', { name: '뒤로', exact: true }))
  expect(share).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '팀 1 · A house 선택 해제' }))
  expect(screen.getByTestId('teams')).toHaveTextContent('[[]]')
  fireEvent.click(screen.getByRole('button', { name: '배정 공유', exact: true }))
  fireEvent.click(screen.getByRole('button', { name: '그대로 공유', exact: true }))
  await waitFor(() => expect(share).toHaveBeenCalled())
})
