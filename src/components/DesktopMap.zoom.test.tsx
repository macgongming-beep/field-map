/* eslint-disable @typescript-eslint/no-explicit-any -- MapCanvas 대신 PC 지도의 단계 전환 계약만 시험한다 */
import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, test, vi } from 'vitest'
import { testBuilding, testCard, territoryProps } from '../test/territoryFixture'
import { DesktopMap } from './DesktopMap'
import { GroupTerritoryContext } from '../features/groupTerritory/context'

vi.mock('./MapCanvas', () => ({
  MapCanvas: (props: any) => (
    <div>
      <output data-testid="boundary-options">{JSON.stringify({ outline: props.showTerritoryBoundary, minZoom: props.boundaryViewportMinZoom, cards: props.cardBoundaries.map((b: { cardId: number }) => b.cardId) })}</output>
      <button type="button" onClick={() => props.onZoomChange?.(14)}>zoom middle</button>
      <button type="button" onClick={() => props.onZoomChange?.(16)}>zoom close</button>
      <button type="button" onClick={() => props.onZoomChange?.(10)}>zoom far</button>
      {(props.aggregateMarkers ?? []).map((marker: { id: string; label: string }) => (
        <button key={marker.id} type="button" onClick={() => props.onSelectAggregate?.(marker.id)}>
          지도 집계 {marker.label}
        </button>
      ))}
      {(props.aggregateMarkers ?? []).length === 0 && <span>건물 포인트 {props.buildings.length}개</span>}
      {(props.buildings ?? []).length > 0 && (
        <button type="button" onClick={() => props.onSelectBuilding?.(props.buildings[0].id)}>첫 건물 열기</button>
      )}
    </div>
  ),
}))

function mapProps() {
  return territoryProps({
    actualRole: 'admin',
    currentVisitor: '관리자',
    cards: [
      testCard(1, '기흥구 영덕동 1'),
      testCard(2, '수지구 죽전동 1'),
    ],
    buildings: [
      testBuilding(1, 1, '영덕빌라'),
      testBuilding(2, 2, '죽전빌라'),
    ],
    focusedCardIds: [],
    serviceSessions: [],
    informalAssets: [],
    visitHistories: [],
    specialPeriods: [],
    eventRestaurantAssignments: [],
    calendarEvents: [],
  })
}

describe('PC 지도 확대 단계', () => {
  test('PC group/all maps forward outline visibility and dong viewport threshold without changing scope', () => {
    const props = mapProps()
    props.actualRole = 'leader'
    props.cards = props.cards.map((card, i) => ({ ...card, assignedGroupCodes: [i ? 'b' : 'a'] }))
    props.cardBoundaries = props.cards.map(card => ({ cardId: card.id, points: [] }))
    render(<MemoryRouter initialEntries={['/map?groupCode=a']}><GroupTerritoryContext.Provider value={{ enabled: true, canManage: false, ownCode: 'a', groups: [{ code: 'a', name: 'A', active: true }], save: vi.fn() }}>
      <DesktopMap {...props as never} />
    </GroupTerritoryContext.Provider></MemoryRouter>)
    const options = () => JSON.parse(screen.getByTestId('boundary-options').textContent!)
    expect(options()).toEqual({ outline: false, minZoom: 13, cards: [1] })
    fireEvent.click(screen.getByRole('button', { name: '집단 구역만 보기' }))
    expect(options()).toEqual({ outline: true, minZoom: 13, cards: [1, 2] })
    fireEvent.click(screen.getByRole('button', { name: '집단 구역만 보기' }))
    expect(options()).toEqual({ outline: false, minZoom: 13, cards: [1] })
  })

  test('긴 구역 목록은 평소에 지도 폭을 차지하지 않고 필요할 때만 연다', () => {
    render(<MemoryRouter><DesktopMap {...(mapProps() as never)} /></MemoryRouter>)

    expect(screen.queryByLabelText('지도 카드 목록')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '구역 목록' }))
    expect(screen.getByLabelText('지도 카드 목록')).toBeVisible()

    fireEvent.click(screen.getByRole('button', { name: '구역 목록 닫기' }))
    expect(screen.queryByLabelText('지도 카드 목록')).not.toBeInTheDocument()
  })

  test('확대 수준에 따라 구에서 동, 건물 포인트 순서로 상세화한다', () => {
    render(<MemoryRouter><DesktopMap {...(mapProps() as never)} /></MemoryRouter>)

    expect(screen.getByText('지도 집계 기흥구')).toBeVisible()
    expect(screen.queryByText('지도 집계 영덕동')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'zoom middle' }))
    expect(screen.getByText('지도 집계 영덕동')).toBeVisible()

    fireEvent.click(screen.getByRole('button', { name: 'zoom close' }))
    expect(screen.getByText('건물 포인트 2개')).toBeVisible()
  })

  test('직접 고른 구와 동은 줌을 바꿔도 상위 단계로 돌아가지 않는다', () => {
    render(<MemoryRouter><DesktopMap {...(mapProps() as never)} /></MemoryRouter>)

    fireEvent.click(screen.getByRole('button', { name: '지도 집계 기흥구' }))
    expect(screen.getByRole('button', { name: '지도 집계 영덕동' })).toBeVisible()

    fireEvent.click(screen.getByRole('button', { name: 'zoom far' }))
    expect(screen.getByRole('button', { name: '지도 집계 영덕동' })).toBeVisible()
    expect(screen.queryByRole('button', { name: '지도 집계 기흥구' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '지도 집계 영덕동' }))
    expect(screen.getByText('건물 포인트 1개')).toBeVisible()

    fireEvent.click(screen.getByRole('button', { name: 'zoom far' }))
    expect(screen.getByText('건물 포인트 1개')).toBeVisible()
  })

  test('PC 세대 상세에서 폭을 늘리고 상가 세대를 추가한다', async () => {
    window.localStorage.removeItem('desktop-map-detail-width')
    const onAddUnit = vi.fn(async () => [999])
    render(<MemoryRouter><DesktopMap {...(mapProps() as never)} onAddUnit={onAddUnit} /></MemoryRouter>)

    fireEvent.click(screen.getByRole('button', { name: 'zoom close' }))
    fireEvent.click(screen.getByRole('button', { name: '첫 건물 열기' }))

    const resizer = screen.getByRole('separator', { name: '세대 상세 폭 조절' })
    fireEvent.keyDown(resizer, { key: 'ArrowLeft' })
    expect(window.localStorage.getItem('desktop-map-detail-width')).toBe('552')

    fireEvent.click(screen.getByRole('button', { name: /101호/ }))
    expect(screen.getByText('세대 정보')).toBeVisible()
    const unitUsageGroup = screen.getByRole('group', { name: '장소 종류' })
    expect(within(unitUsageGroup).getByRole('button', { name: /주택/ })).toHaveAttribute('aria-pressed', 'true')
    const addHistoryButton = screen.getByRole('button', { name: '기록 추가' })
    expect(addHistoryButton).toBeVisible()
    expect(screen.queryByRole('button', { name: /\+\+ 기록/ })).not.toBeInTheDocument()
    fireEvent.click(addHistoryButton)
    const historyOverlay = document.querySelector('.desktop-history-modal-overlay') as HTMLElement
    expect(historyOverlay).toBeVisible()
    fireEvent.click(within(historyOverlay).getByRole('button', { name: '닫기' }))

    fireEvent.click(screen.getByRole('button', { name: /\+ 세대 추가/ }))
    const usageGroup = screen.getAllByRole('group', { name: '장소 종류' })[1]
    fireEvent.click(within(usageGroup).getByRole('button', { name: '상가' }))
    fireEvent.change(screen.getByPlaceholderText(/101/), { target: { value: '202' } })
    fireEvent.click(screen.getByRole('button', { name: '추가' }))

    expect(onAddUnit).toHaveBeenCalledWith(1, '202', '상가')
  })
})
