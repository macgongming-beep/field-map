import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { MemoryRouter, useLocation } from 'react-router-dom'
import type { ComponentProps } from 'react'
import { MobileMap } from './MobileMap'
import { testBuilding, testCard, testUnit, territoryProps } from '../test/territoryFixture'
import { getPinGroup } from '../utils/buildingPin'
import { getLocalDateString } from '../utils/dateUtils'
import type { Building, VisitHistory } from '../types'

vi.mock('../hooks/useTerritoryRealtime', () => ({ useTerritoryRealtime: vi.fn() }))
vi.mock('./MapCanvas', () => ({ MapCanvas: (props: {
  buildings: Building[]; onSelectBuilding: (id: number) => void;
  onZoomChange: (zoom: number) => void;
  aggregateMarkers: { id: string; unitCount: number }[];
}) => <div>
  <button onClick={() => props.onZoomChange(16)}>zoom close</button>
  <output data-testid="pins">{props.buildings.map(b => `${b.id}:${b.units.map(u => u.id).join(',')}:${getPinGroup(b)}`).join('|')}</output>
  <output data-testid="aggregates">{props.aggregateMarkers.map(m => `${m.id}=${m.unitCount}`).join('|')}</output>
  {props.buildings.map(b => <button key={b.id} onClick={() => props.onSelectBuilding(b.id)}>pin {b.id}</button>)}
</div> }))

const label = '중국어 사용 세대만 표시'
beforeEach(() => {
  vi.stubEnv('VITE_MAP_CHINESE_FILTER_ENABLED', 'true')
  vi.stubEnv('VITE_DEMO_MODE', 'false')
  Element.prototype.scrollIntoView = vi.fn()
  const root = document.createElement('div'); root.id = 'root'; document.body.appendChild(root)
})
afterEach(() => { cleanup(); document.getElementById('root')?.remove(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

function propsForMap() {
  return territoryProps({
    actualRole: 'user', currentVisitor: '봉사자', assignmentServiceMap: true,
    focusedScopeLabel: '주택 봉사', focusedCardIds: [1, 2],
    cards: [testCard(1, '기흥구 영덕동 1'), testCard(2, '수지구 죽전동 1'), testCard(3, '범위 밖 1')],
    buildings: [
      testBuilding(1, 1, 'mixed', [testUnit(11, '101', { isChinese: true, memo: 'keep' }),
        testUnit(12, '109', { isChinese: false, memo: 'hidden memo' }),
        testUnit(13, 'shop', { isChinese: true, isRestaurant: true, status: '부재' })]),
      testBuilding(2, 1, 'non Chinese', [testUnit(21, '201')]),
      { ...testBuilding(3, 2, 'blocked', [testUnit(31, '301', { isChinese: true })]), accessStatus: 'blocked' },
      { ...testBuilding(4, 2, 'regular', [testUnit(41, '401', { isChinese: true, isRegularVisit: true, status: '만남' })]), unitsSurveyed: true },
      testBuilding(5, 2, 'empty', []),
      testBuilding(6, 3, 'outside', [testUnit(61, '601', { isChinese: true })]),
    ],
    serviceSessions: [], onBack: vi.fn(), onQuickLogVisit: vi.fn(), onUndoLatestVisit: vi.fn(),
    onSetBuildingAccess: vi.fn(), onSetUnitsSurveyed: vi.fn(),
  }) as unknown as ComponentProps<typeof MobileMap>
}
function Location() { return <output data-testid="route">{useLocation().search}</output> }
function view(props: ComponentProps<typeof MobileMap>, url = '/map?assignmentMap=7&scope=house') {
  return <MemoryRouter initialEntries={[url]}><MobileMap {...props} /><Location /></MemoryRouter>
}
function enable() { fireEvent.click(screen.getByRole('button', { name: label })) }
function expand(container: HTMLElement, id: number) {
  fireEvent.click(screen.getByRole('button', { name: `pin ${id}` }))
  fireEvent.click(container.querySelector(`#building-card-${id} .bld-row-head-btn`)!)
}

test('header clearance tracks translated wrapping without scaling layout pixels twice', () => {
  let resize: (() => void) | undefined
  const disconnect = vi.fn()
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: () => void) { resize = callback }
    observe = vi.fn()
    disconnect = disconnect
  })
  let height = 119
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
    return this.classList.contains('mobile-map-header') ? height : 0
  })
  const { container, unmount } = render(view(propsForMap()))
  const shell = container.querySelector<HTMLElement>('.mobile-map-shell')!
  expect(shell.style.getPropertyValue('--map-filter-header-height')).toBe('119px')
  height = 147
  resize!()
  expect(shell.style.getPropertyValue('--map-filter-header-height')).toBe('147px')
  unmount()
  expect(disconnect).toHaveBeenCalled()
  expect(shell.style.getPropertyValue('--map-filter-header-height')).toBe('')
})

test.each([
  ['en', 'Show Chinese-speaking units only', 'No Chinese-speaking units match this area and filters', 'Show all units'],
  ['zh', '只显示中文住户', '当前范围和筛选条件下没有标记为中文的住户', '显示所有住户'],
] as const)('filter help and no-match controls follow %s', (language, help, empty, reset) => {
  const props = propsForMap()
  props.language = language
  props.buildings = [testBuilding(2, 1, 'unmarked', [testUnit(21, '201')])]
  render(view(props))
  const button = screen.getByRole('button', { name: help })
  expect(button).toHaveAttribute('title', help)
  fireEvent.click(button)
  expect(screen.getByText(empty)).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: reset }))
  expect(button).toHaveAttribute('aria-pressed', 'false')
})

test('header, pins, legend, list and progress share one projection; both teams and original data stay intact', () => {
  const props = propsForMap(), before = structuredClone(props.buildings)
  const { container } = render(view(props))
  expect(container.querySelector('.mm-stats-sub')).toHaveTextContent('카드 2개 · 6세대')
  enable()
  expect(screen.getByRole('button', { name: label })).toHaveAttribute('aria-pressed', 'true')
  expect(container.querySelector('.mm-stats-sub')).toHaveTextContent('카드 2개 · 중국어 4세대')
  expect(screen.getByTestId('pins')).toHaveTextContent('1:11,13:방문필요|3:31:방문금지|4:41:정기방문')
  expect(container.querySelector('.mobile-sheet-summary')).toHaveTextContent('중국어 · 건물 3개50% · 2/4 세대')
  expect(within(container.querySelector('.mobile-map-legend-card')!).getByRole('button', { name: /^방문필요\s*1$/ })).toBeVisible()
  expand(container, 1)
  expect(container.querySelectorAll('.unit-grid-row')).toHaveLength(2)
  expect(container.querySelector('[data-unit-id="12"]')).toBeNull()
  expect(container.querySelector('#building-card-1 .bld-head-right')).toHaveTextContent('1/2 · 50%')
  expect(props.buildings).toEqual(before)
  enable()
  expect(container.querySelector('[data-unit-id="12"]')).not.toBeNull()
  expect(screen.getByTestId('pins')).not.toHaveTextContent('6:')
  expect(screen.getByTestId('route')).toHaveTextContent('?assignmentMap=7&scope=house')
  expect(props.onQuickLogVisit).not.toHaveBeenCalled()
  expect(props.onUndoLatestVisit).not.toHaveBeenCalled()
})

test('saving, cancelling, Chinese flag removal and changed assignments update the filtered snapshot', async () => {
  const props = propsForMap()
  const { container, rerender } = render(view(props))
  enable(); expand(container, 1)
  fireEvent.click(container.querySelector('[data-unit-id="11"] .unit-check-btn:nth-of-type(3)')!)
  expect(props.onQuickLogVisit).toHaveBeenCalledWith(1, 11, '부재')
  // Incoming authoritative store snapshots are the same path used by own saves and realtime.
  const saved = { ...props, buildings: props.buildings.map(b => b.id !== 1 ? b : {
    ...b, units: b.units.map(u => u.id === 11 ? { ...u, status: '부재' as const } : u),
  }), visitHistories: [{ id: 99, unitId: 11, result: '부재', visitor: '봉사자', visitedAt: getLocalDateString() } as VisitHistory] }
  rerender(view(saved))
  expect(container.querySelector('.mobile-sheet-summary')).toHaveTextContent('75% · 3/4')
  fireEvent.click(container.querySelector('[data-unit-id="11"] .unit-check-btn:nth-of-type(3)')!)
  expect(props.onUndoLatestVisit).toHaveBeenCalledWith(1, 11)
  rerender(view(props))
  expect(container.querySelector('.mobile-sheet-summary')).toHaveTextContent('50% · 2/4')
  rerender(view({ ...props, buildings: props.buildings.map(b => b.id === 1 ? { ...b, units: b.units.map(u => ({ ...u, isChinese: false })) } : b) }))
  await waitFor(() => expect(container.querySelector('#building-card-1')).toBeNull())
  expect(screen.getByTestId('pins')).toHaveTextContent('3:31:방문금지|4:41:정기방문')
  rerender(view({ ...props, focusedCardIds: [2] }))
  expect(screen.queryByRole('button', { name: 'pin 1', exact: true })).toBeNull()
  expect(container.querySelector('.mm-stats-sub')).toHaveTextContent('카드 1개 · 중국어 2세대')
})

test('filtered completed pin opens its displayed group, not the original incomplete group', () => {
  const props = propsForMap()
  props.buildings = [{ ...testBuilding(1, 1, 'mixed', [testUnit(11, '101', { isChinese: true, status: '만남' }), testUnit(12, '102')]), unitsSurveyed: true }]
  const { container } = render(view(props))
  enable()
  expect(screen.getByTestId('pins')).toHaveTextContent('1:11:완료')
  expand(container, 1)
  expect(container.querySelector('[data-unit-id="11"]')).not.toBeNull()
  enable()
  expect(screen.getByTestId('pins')).toHaveTextContent('1:11,12:방문필요')
})

test('no-match state can restore all units; reentry defaults to unfiltered', () => {
  const props = propsForMap()
  props.buildings = [testBuilding(1, 1, 'unknown')]
  const first = render(view(props)); enable()
  expect(screen.getByText('현재 범위와 조건에 중국어로 표시된 세대가 없습니다')).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: '전체 세대 보기' }))
  expect(screen.getByRole('button', { name: label })).toHaveAttribute('aria-pressed', 'false')
  enable(); first.unmount(); render(view(props))
  expect(screen.getByRole('button', { name: label })).toHaveAttribute('aria-pressed', 'false')
})

test('adding units uses hidden original numbers and turns the filter off after success', async () => {
  const props = propsForMap(); props.onAddUnit = vi.fn().mockResolvedValue([14])
  const { container } = render(view(props)); enable(); expand(container, 1)
  fireEvent.click(container.querySelector('#building-card-1 .bld-add-unit-btn')!)
  const input = container.querySelector('.mm-unit-add-input') as HTMLInputElement
  expect(input.placeholder).toBe('110')
  fireEvent.click(container.querySelector('.mm-unit-add-btn')!)
  await waitFor(() => expect(props.onAddUnit).toHaveBeenCalledWith(1, '110', '주택'))
  expect(screen.getByRole('button', { name: label })).toHaveAttribute('aria-pressed', 'false')
})

test('ordinary map usage tabs and aggregate counts use Chinese units but keep all cards in scope', () => {
  const props = { ...propsForMap(), assignmentServiceMap: false, focusedCardIds: [], actualRole: 'leader' as const }
  const { container } = render(view(props)); enable()
  expect(screen.getByTestId('aggregates')).toHaveTextContent('region:기흥구=2')
  fireEvent.click(screen.getByRole('button', { name: 'zoom close' }))
  fireEvent.click(screen.getByRole('tab', { name: /^주택\s*4$/ }))
  expect(screen.getByTestId('pins')).toHaveTextContent('1:11:방문필요')
  expect(screen.getByTestId('pins')).not.toHaveTextContent('11,13')
  expect(container.querySelector('.mobile-sheet-summary')).toHaveTextContent('4 세대')
})

test('searching a hidden unit clears the display filter without losing assignment routing', async () => {
  render(view(propsForMap()))
  enable()
  fireEvent.click(screen.getByRole('button', { name: '통합 검색' }))
  fireEvent.change(screen.getByPlaceholderText('구역, 건물, 주소, 식당 검색'), { target: { value: 'mixed 109' } })
  fireEvent.click(await screen.findByRole('button', { name: /mixed · 109/ }))
  expect(screen.getByRole('button', { name: label })).toHaveAttribute('aria-pressed', 'false')
  expect(screen.getByTestId('pins')).toHaveTextContent('1:11,12,13:방문필요')
  expect(screen.getByText('카드 1개 · 4세대')).toBeVisible()
  const params = new URLSearchParams(screen.getByTestId('route').textContent ?? '')
  expect(params.get('assignmentMap')).toBe('7')
  expect(params.get('scope')).toBe('house')
})

test('partial view cannot mark a whole building surveyed; failed unit creation keeps its input', async () => {
  const props = propsForMap(); props.onAddUnit = vi.fn().mockResolvedValue(false)
  const { container } = render(view(props)); enable(); expand(container, 1)
  fireEvent.click(container.querySelector('#building-card-1 .bld-edit-btn')!)
  expect(screen.getByRole('menu')).toBeVisible()
  expect(screen.queryByRole('button', { name: /세대 확인 완료/ })).toBeNull()
  expect(props.onSetUnitsSurveyed).not.toHaveBeenCalled()
  fireEvent.click(document.querySelector('.bld-menu-backdrop')!)
  fireEvent.click(container.querySelector('#building-card-1 .bld-add-unit-btn')!)
  fireEvent.change(container.querySelector('.mm-unit-add-input')!, { target: { value: '203' } })
  fireEvent.click(container.querySelector('.mm-unit-add-btn')!)
  await waitFor(() => expect(props.onAddUnit).toHaveBeenCalledWith(1, '203', '주택'))
  expect(container.querySelector('.mm-unit-add-input')).toHaveValue('203')
  expect(screen.getByRole('button', { name: label })).toHaveAttribute('aria-pressed', 'true')
})

test.each([
  [{ regularVisitScope: true }, '/map'], [{ focusedInformalId: 10 }, '/map?informalId=10'],
  [{}, '/map?addr=test'],
])('focused maps do not acquire the unrelated filter', (extra, url) => {
  render(view({ ...propsForMap(), ...extra }, url))
  expect(screen.queryByRole('button', { name: label })).toBeNull()
})

test('explicit false disables the new UI even in demo', () => {
  vi.stubEnv('VITE_MAP_CHINESE_FILTER_ENABLED', 'false'); vi.stubEnv('VITE_DEMO_MODE', 'true')
  render(view(propsForMap()))
  expect(screen.queryByRole('button', { name: label })).toBeNull()
})
