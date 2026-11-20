import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { useEffect, useState, type ComponentProps } from 'react'
import type { MapCanvas } from '../../components/MapCanvas'
import { testCard } from '../../test/territoryFixture'
import { GroupTerritoryAssignment } from './GroupTerritoryAssignment'
import { GroupTerritoryContext } from './context'

vi.mock('../../lib/confirm', () => ({ confirmDialog: vi.fn(async () => true) }))
vi.mock('../../components/MapCanvas', () => ({ MapCanvas: function MapProbe(p: ComponentProps<typeof MapCanvas>) {
  const [zoom, setZoom] = useState(0)
  useEffect(() => {
    setZoom(p.viewportMemory?.current?.zoom ?? 0)
    return () => { if (p.viewportMemory) p.viewportMemory.current = { lat: 37, lng: 127, zoom: 19 } }
  }, [p.viewportMemory])
  return <>
  <output data-testid="map-ids">{p.cards?.map(c => c.id).join(',')}</output>
  <output data-testid="boundary-ids">{p.cardBoundaries?.map(c => c.cardId).join(',')}</output>
  <output data-testid="initial-zoom">{zoom}</output>
  <button onClick={() => p.onSelectCardBoundary?.(2)}>outside boundary</button>
  </>
} }))
afterEach(cleanup)
const cards = Array.from({ length: 609 }, (_, index) => testCard(index + 1, `Card ${index + 1}`, {
  region: index % 3 === 0 ? '기흥구' : index % 3 === 1 ? '처인구' : '수지구',
  area: index % 2 === 0 ? '첫동' : '둘동', assignedGroupCodes: ['b'], groupAssignmentRevision: '3',
}))
function mount(compact = false) {
  const save = vi.fn(async () => {})
  render(<GroupTerritoryContext.Provider value={{ enabled: true, canManage: true, ownCode: 'a', groups: [{ code: 'a', name: '东滩', active: true }, { code: 'b', name: '新葛', active: true }], save }}>
    <GroupTerritoryAssignment cards={cards} cardBoundaries={cards.map(c => ({ cardId: c.id, points: [] }))} compact={compact} />
  </GroupTerritoryContext.Provider>)
  fireEvent.click(screen.getByRole('tab', { name: '전체 구역 609' }))
  return save
}
test('compact mobile removes the duplicate heading; desktop keeps its page heading', () => {
  mount(true); expect(screen.queryByRole('heading', { name: '집단 구역 배정' })).toBeNull()
  cleanup(); mount(); expect(screen.getByRole('heading', { name: '집단 구역 배정' })).toBeVisible()
})
test('609 cards render 50 at a time, with exact counts; search resets pagination', () => {
  mount()
  expect(screen.getAllByRole('listitem')).toHaveLength(50)
  expect(screen.getByText('50 / 609개')).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: '더 보기' }))
  expect(screen.getAllByRole('listitem')).toHaveLength(100)
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Card 609' } })
  expect(screen.getAllByRole('listitem')).toHaveLength(1)
  expect(screen.getByText('1 / 1개')).toBeVisible()
  expect(screen.queryByRole('button', { name: '더 보기' })).toBeNull()
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: '' } })
  expect(screen.getAllByRole('listitem')).toHaveLength(50)
})
test('district and neighborhood narrow map/list equally and bulk save only the filtered group targets', async () => {
  const save = mount()
  fireEvent.change(screen.getByRole('combobox', { name: '지역 선택' }), { target: { value: '기흥구' } })
  fireEvent.change(screen.getByRole('combobox', { name: '동 선택' }), { target: { value: '첫동' } })
  const expected = cards.filter(c => c.region === '기흥구' && c.area === '첫동')
  expect(screen.getByText(`50 / ${expected.length}개`)).toBeVisible()
  fireEvent.click(screen.getByLabelText('전체 선택'))
  expect(screen.getByText(`${expected.length}개 선택`)).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: '지도', exact: true }))
  expect(screen.getByTestId('map-ids').textContent).toBe(expected.map(c => c.id).join(','))
  expect(screen.getByTestId('boundary-ids').textContent).toBe(expected.map(c => c.id).join(','))
  fireEvent.click(screen.getByText('outside boundary'))
  fireEvent.click(screen.getByRole('button', { name: '+ 추가' }))
  await waitFor(() => expect(save).toHaveBeenCalledWith('a', expected, 'add'))
  expect(cards.every(c => c.assignedGroupCodes?.join() === 'b')).toBe(true)
})
test('filter and group changes reset stale selections and neighborhood choice', () => {
  mount()
  fireEvent.click(screen.getByLabelText('전체 선택'))
  fireEvent.change(screen.getByRole('combobox', { name: '지역 선택' }), { target: { value: '기흥구' } })
  expect(screen.getByText('0개 선택')).toBeVisible()
  fireEvent.change(screen.getByRole('combobox', { name: '동 선택' }), { target: { value: '첫동' } })
  fireEvent.click(screen.getByLabelText('전체 선택'))
  fireEvent.change(screen.getByRole('combobox', { name: '지역 선택' }), { target: { value: '수지구' } })
  expect(screen.getByRole('combobox', { name: '동 선택' })).toHaveValue('')
  expect(screen.getByText('0개 선택')).toBeVisible()
  fireEvent.change(screen.getByRole('combobox', { name: '집단 선택' }), { target: { value: 'b' } })
  expect(screen.getByRole('combobox', { name: '지역 선택' })).toHaveValue('')
  expect(screen.getByText('50 / 609개')).toBeVisible()
})
test('a departing map cannot overwrite the new district camera; same-scope list/map retains zoom', () => {
  mount()
  fireEvent.click(screen.getByRole('button', { name: '지도', exact: true }))
  expect(screen.getByTestId('initial-zoom')).toHaveTextContent(/^0$/)
  fireEvent.click(screen.getByRole('button', { name: '목록', exact: true }))
  fireEvent.click(screen.getByRole('button', { name: '지도', exact: true }))
  expect(screen.getByTestId('initial-zoom')).toHaveTextContent(/^19$/)
  fireEvent.change(screen.getByRole('combobox', { name: '지역 선택' }), { target: { value: '기흥구' } })
  expect(screen.getByTestId('initial-zoom')).toHaveTextContent(/^0$/)
  fireEvent.change(screen.getByRole('combobox', { name: '동 선택' }), { target: { value: '첫동' } })
  expect(screen.getByTestId('initial-zoom')).toHaveTextContent(/^0$/)
  fireEvent.change(screen.getByRole('combobox', { name: '집단 선택' }), { target: { value: 'b' } })
  expect(screen.getByTestId('initial-zoom')).toHaveTextContent(/^0$/)
})
