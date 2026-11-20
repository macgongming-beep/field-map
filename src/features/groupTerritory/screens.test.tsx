import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { expect, test, vi } from 'vitest'
import { GroupTerritoryContext } from './context'
import { DesktopTerritory } from '../../components/DesktopTerritory'
import { DesktopMyService } from '../../components/DesktopMyService'
import { territoryProps, testCard, testBuilding } from '../../test/territoryFixture'
import { AuthContext } from '../../hooks/AuthContext'
import { authFixture } from '../../test/authFixture'

const context = { enabled: true, canManage: false, ownCode: 'a', groups: [{ code: 'a', name: 'A', active: true }, { code: 'b', name: 'B', active: true }], save: vi.fn() }
const cards = [testCard(1, '기흥구 Shared 1', { assignedGroupCodes: ['a', 'b'] }), testCard(2, '기흥구 Legacy 2', { assignedGroupCodes: ['b'], assignedLeader: 'Me' })]

test('PC building list is scoped with cards, and all restores both groups without writes', () => {
  const props = territoryProps({ role: 'leader', currentVisitor: 'Me', cards, buildings: [testBuilding(1, 1, 'OwnBuilding'), { ...testBuilding(2, 2, 'OtherBuilding'), isRestaurant: true }] })
  render(<MemoryRouter><AuthContext.Provider value={authFixture()}><GroupTerritoryContext.Provider value={context}><DesktopTerritory {...props as never} /></GroupTerritoryContext.Provider></AuthContext.Provider></MemoryRouter>)
  fireEvent.click(screen.getByRole('button', { name: '건물 관리' }))
  const table = screen.getByRole('table', { name: '건물 관리 목록' })
  expect(within(table).getByText('OwnBuilding')).toBeTruthy()
  expect(within(table).queryByText('OtherBuilding')).toBeNull()
  expect(screen.getByRole('tab', { name: /식당/ }).textContent).toBe('식당0')
  fireEvent.change(screen.getByRole('combobox', { name: '집단 구역 보기' }), { target: { value: 'all' } })
  expect(within(table).getByText('OtherBuilding')).toBeTruthy()
  expect(screen.getByRole('tab', { name: /식당/ }).textContent).toBe('식당1')
  expect(context.save).not.toHaveBeenCalled()
})

test('PC leader standing territories follow group ownership; feature off keeps legacy scope', () => {
  const props = { language: 'ko', role: 'leader', currentVisitor: 'Me', cards, buildings: [], calendarEvents: [], serviceSessions: [], onOpenMap: vi.fn(), onEndServiceSession: vi.fn() }
  const content = <DesktopMyService {...props as never} />
  const tree = (enabled: boolean) => <MemoryRouter><GroupTerritoryContext.Provider value={{ ...context, enabled }}>{content}</GroupTerritoryContext.Provider></MemoryRouter>
  const view = render(tree(true))
  expect(screen.getByText('기흥구 Shared 1')).toBeTruthy()
  expect(screen.queryByText('기흥구 Legacy 2')).toBeNull()
  view.rerender(tree(false))
  expect(screen.getByText('기흥구 Legacy 2')).toBeTruthy()
  expect(screen.queryByText('기흥구 Shared 1')).toBeNull()
})
