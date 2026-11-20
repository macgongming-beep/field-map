import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { MemoryRouter, Routes, Route, useNavigate, useLocation } from 'react-router-dom'
import { GroupTerritoryContext, type GroupTerritoryContextValue } from './context'
import { GroupTerritoryAssignment } from './GroupTerritoryAssignment'
import { MapFilterButton } from './MapFilterButton'
import { GroupCardOwners } from './GroupCardOwners'
import { useGroupMapScope } from './useGroupMapScope'
import { AdminMobileZone } from '../../components/admin/AdminMobileZone'
import type { Building, TerritoryCard } from '../../types'
import { setCurrentLang } from '../../i18n'
import { showToast } from '../../lib/toast'
vi.mock('../../lib/confirm', () => ({ confirmDialog: vi.fn(async () => true) }))
vi.mock('../../lib/toast', () => ({ showToast: vi.fn() }))
const cards = [1, 2, 3].map(id => ({ id, name: `Card ${id}`, region: '기흥구', area: '신갈동', assignedGroupCodes: id === 1 ? ['a', 'b'] : id === 2 ? ['b'] : [],
  groupAssignmentRevision: '1', assignedLeader: null, assignedUsers: [], progress: 0, buildings: 1, units: 1, completed: 0, regularVisits: 0, regularVisitPoints: [], type: '전체', status: '미배정',
} as TerritoryCard))
const value: GroupTerritoryContextValue = { enabled: true, canManage: true, ownCode: 'a', groups: [
  { code: 'a', name: '第一组', active: true }, { code: 'b', name: '第二组', active: true },
], save: vi.fn(async () => {}) }
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); setCurrentLang('ko') })
test('assignment adds only selected group without reconstructing or overwriting other group links', async () => {
  render(<GroupTerritoryContext.Provider value={value}><GroupTerritoryAssignment cards={cards} /></GroupTerritoryContext.Provider>)
  expect(screen.queryByText('Card 2')).toBeNull()
  fireEvent.click(screen.getByRole('tab', { name: '전체 구역 3' }))
  fireEvent.click(screen.getByLabelText(/Card 2/))
  fireEvent.click(screen.getByRole('button', { name: '+ 추가' }))
  await waitFor(() => expect(value.save).toHaveBeenCalledWith('a', [cards[1]], 'add'))
  expect(cards[1].assignedGroupCodes).toEqual(['b'])
})
test('removal sends the selected group only; group names come from the real translation path', async () => {
  setCurrentLang('zh')
  render(<GroupTerritoryContext.Provider value={value}><GroupTerritoryAssignment cards={cards} /></GroupTerritoryContext.Provider>)
  expect(screen.getByRole('heading', { name: '分配小组地区' })).toBeTruthy()
  fireEvent.click(screen.getByLabelText(/Card 1/))
  fireEvent.click(screen.getByRole('button', { name: '解除分配' }))
  await waitFor(() => expect(value.save).toHaveBeenCalledWith('a', [cards[0]], 'remove'))
})
test('tooltip disappears after tap while the filter remains active', () => {
  vi.useFakeTimers()
  const click = vi.fn()
  render(<MapFilterButton label="Filter" pressed onClick={click}><span>Icon</span></MapFilterButton>)
  fireEvent.click(screen.getByRole('button', { name: 'Filter' }))
  expect(screen.getByRole('tooltip')).toBeTruthy()
  act(() => vi.advanceTimersByTime(1800))
  expect(screen.queryByRole('tooltip')).toBeNull()
  expect(screen.getByRole('button').getAttribute('aria-pressed')).toBe('true')
  expect(screen.getByRole('button').hasAttribute('title')).toBe(false)
  expect(click).toHaveBeenCalledTimes(1)
})
function MapProbe({ role = 'leader', restricted = false }: { role?: 'leader' | 'user'; restricted?: boolean }) {
  const map = useGroupMapScope({ cards, buildings: cards.map(card => ({ id: card.id, cardId: card.id } as Building)), cardBoundaries: cards.map(card => ({ cardId: card.id, points: [] })) }, role, restricted)
  return <>{map.controls}{map.selector}<output data-testid="scope">{JSON.stringify([map.cards.map(card => card.id), map.buildings.map(building => building.id), map.cardBoundaries.map(boundary => boundary.cardId)])}</output></>
}
test('group map scopes cards, buildings and boundaries together; all restores the same original data', () => {
  render(<MemoryRouter><GroupTerritoryContext.Provider value={value}><MapProbe /></GroupTerritoryContext.Provider></MemoryRouter>)
  expect(screen.getByTestId('scope').textContent).toBe('[[1,2,3],[1,2,3],[1,2,3]]')
  fireEvent.click(screen.getByRole('button', { name: '집단 구역만 보기' }))
  expect(screen.getByTestId('scope').textContent).toBe('[[1],[1],[1]]')
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'b' } })
  expect(screen.getByTestId('scope').textContent).toBe('[[1,2],[1,2],[1,2]]')
  fireEvent.click(screen.getByRole('button', { name: '집단 구역만 보기' }))
  expect(screen.getByTestId('scope').textContent).toBe('[[1,2,3],[1,2,3],[1,2,3]]')
})
test.each([{ role: 'user' as const, restricted: false }, { role: 'leader' as const, restricted: true }])('personal or event maps cannot acquire group-wide scope: %j', props => {
  render(<MemoryRouter><GroupTerritoryContext.Provider value={value}><MapProbe {...props} /></GroupTerritoryContext.Provider></MemoryRouter>)
  expect(screen.queryByRole('button')).toBeNull()
})
test('opening an empty group from the territory list does not fall back to all territories', () => {
  render(<MemoryRouter initialEntries={['/map?groupCode=empty']}><GroupTerritoryContext.Provider value={{ ...value, groups: [...value.groups, { code: 'empty', name: 'Empty', active: true }] }}><MapProbe /></GroupTerritoryContext.Provider></MemoryRouter>)
  expect(screen.getByTestId('scope').textContent).toBe('[[],[],[]]')
  expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('empty')
  fireEvent.click(screen.getByRole('button', { name: '집단 구역만 보기' }))
  expect(screen.getByTestId('scope').textContent).toBe('[[1,2,3],[1,2,3],[1,2,3]]')
})
test('leader preview cannot expose ownership editing even when the signed-in administrator can manage', () => {
  render(<GroupTerritoryContext.Provider value={value}><GroupCardOwners card={cards[0]} readOnly /></GroupTerritoryContext.Provider>)
  expect(screen.getByText('第一组 · 第二组')).toBeTruthy()
  expect(screen.queryByRole('checkbox')).toBeNull()
})
test('leader zone switches between own group and congregation; a leader without membership defaults to all', () => {
  const openMap = vi.fn()
  const zone = <AdminMobileZone language="ko" role="leader" currentVisitor="Leader" cards={cards} buildings={[]} cardBoundaries={[]} visitHistories={[]}
    onOpenMap={vi.fn()} onOpenAssignedMap={openMap} onShowMapView={vi.fn()} />
  const { rerender } = render(<MemoryRouter><GroupTerritoryContext.Provider value={value}>{zone}</GroupTerritoryContext.Provider></MemoryRouter>)
  expect((screen.getByRole('combobox', { name: '집단 구역 보기' }) as HTMLSelectElement).value).toBe('a')
  fireEvent.click(screen.getByRole('button', { name: /지도/ }))
  expect(openMap).toHaveBeenCalledWith([1], { scope: 'mine', groupCode: 'a' })
  fireEvent.change(screen.getByRole('combobox', { name: '집단 구역 보기' }), { target: { value: 'all' } })
  expect((screen.getByRole('combobox', { name: '집단 구역 보기' }) as HTMLSelectElement).value).toBe('all')
  rerender(<MemoryRouter><GroupTerritoryContext.Provider value={{ ...value, ownCode: null }}>{zone}</GroupTerritoryContext.Provider></MemoryRouter>)
  expect((screen.getByRole('combobox', { name: '집단 구역 보기' }) as HTMLSelectElement).value).toBe('all')
})

test.each(['assignmentMap=9', 'addr=Somewhere', 'informalId=4'])('explicit map route %s is not narrowed by group selection', query => {
  render(<MemoryRouter initialEntries={[`/map?groupCode=a&${query}`]}><GroupTerritoryContext.Provider value={value}><MapProbe /></GroupTerritoryContext.Provider></MemoryRouter>)
  expect(screen.queryByRole('button')).toBeNull()
  expect(screen.getByTestId('scope').textContent).toBe('[[1,2,3],[1,2,3],[1,2,3]]')
})

function ZoneRoundTrip({ role = 'admin' }: { role?: 'admin' | 'leader' }) {
  const navigate = useNavigate(), location = useLocation()
  return <><output data-testid="url">{location.pathname}{location.search}</output><Routes>
    <Route path="/zone" element={<AdminMobileZone language="ko" role={role} currentVisitor="Leader" cards={cards} buildings={[]} cardBoundaries={[]} visitHistories={[]}
      onOpenMap={vi.fn()} onOpenAssignedMap={(_, context) => navigate(`/map?groupCode=${context?.groupCode}`)} onShowMapView={vi.fn()} />} />
    <Route path="/map" element={<button onClick={() => navigate(-1)}>Back</button>} />
  </Routes></>
}
test.each(['admin', 'leader'] as const)('selected group survives real list/map/back navigation for %s', role => {
  render(<MemoryRouter initialEntries={['/zone']}><GroupTerritoryContext.Provider value={{ ...value, ownCode: role === 'admin' ? null : 'a' }}><ZoneRoundTrip role={role} /></GroupTerritoryContext.Provider></MemoryRouter>)
  fireEvent.change(screen.getByRole('combobox', { name: '집단 구역 보기' }), { target: { value: 'b' } })
  expect(screen.getByTestId('url').textContent).toContain('groupCode=b')
  fireEvent.click(screen.getByRole('button', { name: /지도/ }))
  expect(screen.getByTestId('url').textContent).toBe('/map?groupCode=b')
  fireEvent.click(screen.getByRole('button', { name: 'Back' }))
  expect((screen.getByRole('combobox', { name: '집단 구역 보기' }) as HTMLSelectElement).value).toBe('b')
  expect(screen.getByTestId('url').textContent).toContain('groupCode=b')
  expect(screen.queryByText('담당 구역이 없습니다')).toBeNull()
})
test('a memberless administrator returning to an old mine URL sees all, not an empty list', () => {
  render(<MemoryRouter initialEntries={['/zone?scope=mine']}><GroupTerritoryContext.Provider value={{ ...value, ownCode: null }}><ZoneRoundTrip /></GroupTerritoryContext.Provider></MemoryRouter>)
  expect((screen.getByRole('combobox', { name: '집단 구역 보기' }) as HTMLSelectElement).value).toBe('all')
  expect(screen.queryByText('담당 구역이 없습니다')).toBeNull()
  expect(screen.getByRole('tab', { name: /구역 카드/ }).textContent).toBe('구역 카드3')
})
test.each([609, 1001])('select-all %i saves in one call or explains the limit before writing', async count => {
  const many = Array.from({ length: count }, (_, index) => ({ ...cards[2], id: index + 100, name: `Territory ${index}` }))
  render(<GroupTerritoryContext.Provider value={value}><GroupTerritoryAssignment cards={many} /></GroupTerritoryContext.Provider>)
  fireEvent.click(screen.getByRole('tab', { name: `전체 구역 ${count}` }))
  fireEvent.click(screen.getByLabelText('전체 선택'))
  fireEvent.click(screen.getByRole('button', { name: '+ 추가' }))
  if (count === 609) await waitFor(() => expect(value.save).toHaveBeenCalledWith('a', many, 'add'))
  else {
    expect(value.save).not.toHaveBeenCalled()
    expect(showToast).toHaveBeenCalledWith('한 번에 1000개까지 선택해 주세요.', 'error')
  }
})
