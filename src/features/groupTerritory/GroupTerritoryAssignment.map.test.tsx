import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import type { ComponentProps } from 'react'
import type { MapCanvas } from '../../components/MapCanvas'
import { testCard } from '../../test/territoryFixture'
import { GroupTerritoryAssignment } from './GroupTerritoryAssignment'
import { GroupTerritoryContext } from './context'
vi.mock('../../lib/confirm', () => ({ confirmDialog: vi.fn(async () => true) }))
vi.mock('../../components/MapCanvas', () => ({ MapCanvas: (p: ComponentProps<typeof MapCanvas>) => <div>
  <output data-testid="map-ids">{p.cards?.map(card => card.id).join(',')}</output>
  <output data-testid="boundary-ids">{p.cardBoundaries?.map(b => b.cardId).join(',')}</output>
  {[1, 2, 999].map(id => <button key={id} onClick={() => p.onSelectCardBoundary?.(id)}>boundary {id}</button>)}
</div> }))
afterEach(() => { cleanup(); vi.restoreAllMocks() })
const cards = [testCard(1, 'Shared', { assignedGroupCodes: ['a', 'b'], groupAssignmentRevision: '3' }),
  testCard(2, 'B only', { assignedGroupCodes: ['b'], groupAssignmentRevision: '4' }), testCard(3, 'No boundary', { groupAssignmentRevision: '1' })]
const boundaries = [1, 2].map(cardId => ({ cardId, points: [] }))
function mount(canManage = true, save = vi.fn(async () => {})) {
  render(<GroupTerritoryContext.Provider value={{ enabled: true, canManage, ownCode: 'a', groups: [{ code: 'a', name: '东滩', active: true }, { code: 'b', name: '新葛', active: true }], save }}>
    <GroupTerritoryAssignment cards={cards} cardBoundaries={boundaries} />
  </GroupTerritoryContext.Provider>)
  return save
}
test('map and list share selection; adding shared territory preserves the other group and exact revisions', async () => {
  const save = mount()
  fireEvent.click(screen.getByRole('tab', { name: '전체 구역 3' }))
  fireEvent.click(screen.getByRole('button', { name: '지도', exact: true }))
  expect(screen.getByTestId('map-ids')).toHaveTextContent('1,2,3')
  expect(screen.getByTestId('boundary-ids')).toHaveTextContent('1,2')
  fireEvent.click(screen.getByText('boundary 2')); fireEvent.click(screen.getByText('boundary 999'))
  fireEvent.click(screen.getByRole('button', { name: '목록', exact: true }))
  expect(screen.getByLabelText(/B only/)).toBeChecked()
  fireEvent.click(screen.getByRole('button', { name: '+ 추가' }))
  await waitFor(() => expect(save).toHaveBeenCalledWith('a', [cards[1]], 'add'))
  expect(cards[1].assignedGroupCodes).toEqual(['b'])
})
test('map removal and search can only select currently visible territories', async () => {
  const save = mount()
  fireEvent.click(screen.getByRole('button', { name: '지도', exact: true }))
  expect(screen.getByTestId('map-ids')).toHaveTextContent(/^1$/)
  fireEvent.click(screen.getByText('boundary 2')); expect(screen.getByText('0개 선택')).toBeVisible()
  fireEvent.click(screen.getByText('boundary 1'))
  fireEvent.click(screen.getByRole('button', { name: '배정 해제' }))
  await waitFor(() => expect(save).toHaveBeenCalledWith('a', [cards[0]], 'remove'))
  expect(cards[0].assignedGroupCodes).toEqual(['a', 'b'])
})
test('an out-of-scope boundary callback cannot leave a hidden selection when ownership later changes', async () => {
  const save = vi.fn(async () => {})
  const element = (items: typeof cards) => <GroupTerritoryContext.Provider value={{ enabled: true, canManage: true, ownCode: 'a', groups: [{ code: 'a', name: '东滩', active: true }], save }}>
    <GroupTerritoryAssignment cards={items} cardBoundaries={boundaries} />
  </GroupTerritoryContext.Provider>
  const { rerender } = render(element(cards))
  fireEvent.click(screen.getByRole('button', { name: '지도', exact: true }))
  expect(screen.getByTestId('map-ids')).toHaveTextContent(/^1$/)
  fireEvent.click(screen.getByText('boundary 2'))
  const updated = cards.map(card => card.id === 2 ? { ...card, assignedGroupCodes: ['a', 'b'], groupAssignmentRevision: '5' } : card)
  rerender(element(updated))
  expect(screen.getByTestId('map-ids')).toHaveTextContent(/^1,2$/)
  expect(screen.getByText('0개 선택')).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: '목록', exact: true }))
  expect(screen.getByLabelText(/B only/)).not.toBeChecked()
  // A valid new click still selects and saves; rejecting every click cannot pass.
  fireEvent.click(screen.getByLabelText(/B only/))
  fireEvent.click(screen.getByRole('button', { name: '배정 해제' }))
  await waitFor(() => expect(save).toHaveBeenCalledExactlyOnceWith('a', [updated[1]], 'remove'))
})
test('switching groups clears selection; boundaryless cards remain selectable in the list', () => {
  mount(); fireEvent.click(screen.getByRole('button', { name: '지도', exact: true }))
  fireEvent.click(screen.getByText('boundary 1'))
  fireEvent.change(screen.getByRole('combobox', { name: '집단 선택' }), { target: { value: 'b' } })
  expect(screen.getByText('0개 선택')).toBeVisible()
  expect(screen.getByTestId('map-ids')).toHaveTextContent(/^1,2$/)
  fireEvent.click(screen.getByRole('tab', { name: '전체 구역 3' }))
  fireEvent.click(screen.getByRole('button', { name: '경계선 없는 구역 1개' }))
  fireEvent.click(screen.getByLabelText(/No boundary/))
  expect(screen.getByText('1개 선택')).toBeVisible()
})
test('readonly map cannot select or save', () => {
  const save = mount(false)
  fireEvent.click(screen.getByRole('button', { name: '지도', exact: true }))
  fireEvent.click(screen.getByText('boundary 1'))
  expect(screen.getByText('0개 선택')).toBeVisible()
  expect(screen.getByRole('button', { name: '배정 해제' })).toBeDisabled()
  expect(save).not.toHaveBeenCalled()
})
test('map has no hidden list search and keeps selected matching cards when switching views', () => {
  mount()
  fireEvent.click(screen.getByRole('tab', { name: '전체 구역 3' }))
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Shared' } })
  fireEvent.click(screen.getByLabelText(/Shared/))
  fireEvent.click(screen.getByRole('button', { name: '지도', exact: true }))
  expect(screen.queryByRole('searchbox')).toBeNull()
  expect(screen.queryByLabelText('전체 선택')).toBeNull()
  expect(screen.getByTestId('map-ids')).toHaveTextContent(/^1,2,3$/)
  expect(screen.getByText('1개 선택')).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: '목록', exact: true }))
  expect(screen.getByRole('searchbox')).toHaveValue('')
  expect(screen.getByLabelText(/Shared/)).toBeChecked()
  expect(screen.getByLabelText(/B only/)).not.toBeChecked()
})
test('pending save locks map selection and group changes', async () => {
  let finish!: () => void
  mount(true, vi.fn(() => new Promise<void>(resolve => { finish = resolve })))
  fireEvent.click(screen.getByRole('tab', { name: '전체 구역 3' }))
  fireEvent.click(screen.getByRole('button', { name: '지도', exact: true }))
  fireEvent.click(screen.getByText('boundary 2')); fireEvent.click(screen.getByRole('button', { name: '+ 추가' }))
  expect(screen.getByRole('combobox', { name: '집단 선택' })).toBeDisabled()
  expect(screen.getByRole('combobox', { name: '지역 선택' })).toBeDisabled()
  expect(screen.getByRole('combobox', { name: '동 선택' })).toBeDisabled()
  expect(screen.getByRole('button', { name: '목록', exact: true })).toBeDisabled()
  fireEvent.click(screen.getByText('boundary 1')); expect(screen.getByText('1개 선택')).toBeVisible()
  await act(async () => finish())
  expect(screen.getByText('0개 선택')).toBeVisible()
})
