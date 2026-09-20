/* eslint-disable @typescript-eslint/no-explicit-any -- MapCanvas 전체 대신 집계 핀 선택 계약만 시험한다 */
import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { testBuilding, testCard, territoryProps } from '../test/territoryFixture'
import { MobileMap } from './MobileMap'
import { getMobileMapPinPanOffset, getMobileMapSelectedPeekHeight } from '../utils/mobileMapViewport'

const confirmDialog = vi.hoisted(() => vi.fn().mockResolvedValue(true))
const searchPlacesAndAddressesForCongregation = vi.hoisted(() => vi.fn())

vi.mock('../lib/confirm', () => ({ confirmDialog }))
vi.mock('../lib/placeSearch', () => ({ searchPlacesAndAddressesForCongregation }))
vi.mock('./OverlayPortal', () => ({
  OverlayPortal: ({ children }: { children: ReactNode }) => children,
}))

vi.mock('./MapCanvas', () => ({
  MapCanvas: (props: any) => (
    <div>
      <button type="button" onClick={() => props.onZoomChange?.(14)}>zoom middle</button>
      <button type="button" onClick={() => props.onZoomChange?.(16)}>zoom close</button>
      {(props.aggregateMarkers ?? []).map((marker: { id: string; label: string }) => (
        <button key={marker.id} type="button" onClick={() => props.onSelectAggregate(marker.id)}>
          지도 집계 {marker.label}
        </button>
      ))}
      <output data-testid="highlighted-scope">{[...(props.highlightedCardIds ?? [])].sort((a, b) => a - b).join(',')}</output>
      {(props.aggregateMarkers ?? []).length === 0 && <output>건물 포인트 {props.buildings.length}개</output>}
      {(props.buildings ?? []).map((building: { id: number; name: string }) => (
        <button key={building.id} type="button" onClick={() => props.onSelectBuilding(building.id)}>
          지도 건물 {building.name}
        </button>
      ))}
      {props.previewPinLat != null && props.previewPinLng != null && (
        <button
          type="button"
          onClick={() => props.onMovePreviewPin?.(props.previewPinLat + 0.001, props.previewPinLng + 0.001)}
        >
          move preview pin
        </button>
      )}
      <output data-testid="selected-building-id">{props.selectedBuildingId}</output>
      <output data-testid="map-bottom-padding">{props.bottomPadding}</output>
    </div>
  ),
}))

describe('모바일 지도 하단 시트', () => {
  beforeEach(() => {
    searchPlacesAndAddressesForCongregation.mockReset()
    delete (window as any).__mobileMapInstance
    delete (window as any).naver
  })

  const mapProps = () => territoryProps({
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
    specialPeriods: [],
    eventRestaurantAssignments: [],
    calendarEvents: [],
    onBack: vi.fn(),
  })

  test('확대 수준에 따라 구에서 동, 건물 포인트 순서로 상세화한다', async () => {
    render(<MemoryRouter><MobileMap {...(mapProps() as never)} /></MemoryRouter>)
    expect(screen.getByRole('button', { name: '지도 집계 기흥구' })).toBeVisible()
    expect(screen.queryByRole('button', { name: '지도 집계 영덕동' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'zoom middle' }))
    expect(await screen.findByRole('button', { name: '지도 집계 영덕동' })).toBeVisible()
    expect(screen.getByTestId('highlighted-scope')).toHaveTextContent('1,2')

    fireEvent.click(screen.getByRole('button', { name: 'zoom close' }))
    expect(await screen.findByText('건물 포인트 2개')).toBeVisible()
    expect(screen.getByTestId('highlighted-scope')).toHaveTextContent('1,2')
  })

  test('사용자가 내려둔 시트 높이를 구와 동 집계 핀 선택이 바꾸지 않는다', async () => {
    const props = mapProps()

    const { container } = render(<MemoryRouter><MobileMap {...(props as never)} /></MemoryRouter>)
    const sheet = container.querySelector('.mobile-bottom-sheet') as HTMLElement
    const handle = container.querySelector('.sheet-handle') as HTMLElement
    const now = vi.spyOn(Date, 'now')
      .mockReturnValueOnce(1_000)
      .mockReturnValueOnce(1_100)

    fireEvent.click(handle)
    fireEvent.click(handle)
    await waitFor(() => expect(sheet.style.height).toBe('65px'))

    fireEvent.click(await screen.findByRole('button', { name: '지도 집계 기흥구' }))
    await waitFor(() => expect(screen.getByRole('button', { name: '지도 집계 영덕동' })).toBeVisible())
    expect(sheet.style.height).toBe('65px')

    fireEvent.click(screen.getByRole('button', { name: '지도 집계 영덕동' }))
    expect(sheet.style.height).toBe('65px')
    now.mockRestore()
  })

  test('정기방문 핀을 누르면 선택 건물을 앞에 두고 기존 목록을 유지한다', async () => {
    Element.prototype.scrollIntoView = vi.fn()
    const first = testBuilding(1, 1, '영덕빌라')
    const second = testBuilding(2, 2, '죽전빌라')
    const props = territoryProps({
      actualRole: 'admin',
      currentVisitor: '관리자',
      cards: [testCard(1, '기흥구 영덕동 1'), testCard(2, '수지구 죽전동 1')],
      buildings: [first, second],
      focusedCardIds: [],
      regularVisitScope: true,
      serviceSessions: [],
      specialPeriods: [],
      eventRestaurantAssignments: [],
      calendarEvents: [],
      onBack: vi.fn(),
    })

    const { container } = render(<MemoryRouter><MobileMap {...(props as never)} /></MemoryRouter>)
    fireEvent.click(screen.getByRole('button', { name: '지도 건물 영덕빌라' }))

    const sheet = container.querySelector('.mobile-bottom-sheet') as HTMLElement
    const scroll = container.querySelector('.mobile-sheet-scroll') as HTMLElement
    const expectedHeight = getMobileMapSelectedPeekHeight(window.innerHeight)
    await waitFor(() => expect(sheet.style.height).toBe(`${expectedHeight}px`))
    expect(within(scroll).getByText('영덕빌라')).toBeVisible()
    expect(within(scroll).getByText('죽전빌라')).toBeVisible()
    const names = within(scroll).getAllByText(/빌라$/)
    expect(names[0]).toHaveTextContent('영덕빌라')
    expect(screen.getByTestId('map-bottom-padding')).toHaveTextContent(String(expectedHeight + 20))
  })

  test('선택 핀을 헤더와 하단 시트 사이 중앙으로 옮긴다', () => {
    expect(getMobileMapPinPanOffset(240, 90)).toBe(75)
    expect(getMobileMapPinPanOffset(65, 90)).toBe(0)
  })

  test('관리자도 통합 검색을 열고 건물 문맥이 있는 호수만 찾는다', async () => {
    const { container } = render(<MemoryRouter><MobileMap {...(mapProps() as never)} /></MemoryRouter>)

    const mapContainer = container.querySelector('.mobile-map-container') as HTMLElement
    expect(mapContainer.style.getPropertyValue('--map-toolbar-search-push')).toBe('0px')

    fireEvent.click(screen.getByRole('button', { name: '통합 검색' }))
    const input = screen.getByPlaceholderText('구역, 건물, 주소, 식당 검색')
    expect(mapContainer.style.getPropertyValue('--map-toolbar-search-push')).toBe('68px')

    fireEvent.change(input, { target: { value: '101호' } })
    expect(screen.getByText('호수는 건물명이나 주소와 함께 입력하세요.')).toBeVisible()
    expect(screen.queryByText(/영덕빌라 · 101호/)).not.toBeInTheDocument()

    fireEvent.change(input, { target: { value: '영덕빌라 101' } })
    expect(await screen.findByText('영덕빌라 · 101호')).toBeVisible()
    expect(screen.getByText('세대')).toBeVisible()

    fireEvent.click(screen.getByRole('button', { name: '통합 검색' }))
    expect(mapContainer.style.getPropertyValue('--map-toolbar-search-push')).toBe('0px')
  })

  test('등록 자료에 없는 주소는 네이버 후보를 확인한 뒤 건물 추가로 이어진다', async () => {
    searchPlacesAndAddressesForCongregation.mockResolvedValue({
      ok: true,
      places: [{
        name: '언동로 213',
        address: '경기도 용인시 기흥구 언동로 213',
        category: '주소',
        lat: 37.275,
        lng: 127.118,
        source: 'address',
      }],
    })
    const props = mapProps()
    render(<MemoryRouter><MobileMap {...(props as never)} /></MemoryRouter>)

    fireEvent.click(screen.getByRole('button', { name: '통합 검색' }))
    fireEvent.change(screen.getByPlaceholderText('구역, 건물, 주소, 식당 검색'), {
      target: { value: '언동로 213' },
    })
    fireEvent.click(screen.getByRole('button', { name: '네이버에서 주소 찾기' }))

    expect(await screen.findByText('경기도 용인시 기흥구 언동로 213')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: /언동로 213/ }))
    fireEvent.click(await screen.findByRole('button', { name: '이 주소에 건물 추가' }))

    expect(screen.getByRole('heading', { name: '건물 추가' })).toBeVisible()
    expect(screen.getByDisplayValue('경기도 용인시 기흥구 언동로 213')).toBeVisible()
  })

  test('주소로 건물을 추가하면 갱신된 건물로 이동하고 하단 정보를 연다', async () => {
    Element.prototype.scrollIntoView = vi.fn()
    const setCenter = vi.fn()
    const panBy = vi.fn()
    ;(window as any).naver = {
      maps: {
        LatLng: class LatLng { constructor(public lat: number, public lng: number) {} },
        Point: class Point { constructor(public x: number, public y: number) {} },
      },
    }
    const setZoom = vi.fn()
    ;(window as any).__mobileMapInstance = {
      getZoom: () => 17,
      setCenter,
      setZoom,
      panBy,
    }
    searchPlacesAndAddressesForCongregation.mockResolvedValue({
      ok: true,
      places: [{
        name: '언동로 216',
        address: '경기도 용인시 기흥구 언동로 216',
        category: '주소',
        lat: 37.276,
        lng: 127.119,
        source: 'address',
      }],
    })
    const onCreateBuilding = vi.fn(async () => true)
    const other = testBuilding(92, 1, '언동로 218')
    other.address = '경기도 용인시 기흥구 언동로 218'
    other.lat = 37.277
    other.lng = 127.12
    const props = territoryProps({ ...mapProps(), buildings: [other], onCreateBuilding })
    const { container, rerender } = render(
      <MemoryRouter><MobileMap {...(props as never)} /></MemoryRouter>,
    )

    fireEvent.click(screen.getByRole('button', { name: '통합 검색' }))
    fireEvent.change(screen.getByPlaceholderText('구역, 건물, 주소, 식당 검색'), {
      target: { value: '언동로 216' },
    })
    fireEvent.click(screen.getByRole('button', { name: '네이버에서 주소 찾기' }))
    fireEvent.click(await screen.findByRole('button', { name: /언동로 216/ }))
    fireEvent.click(screen.getByRole('button', { name: '이 주소에 건물 추가' }))
    expect(screen.getByText('37.27600, 127.11900')).toBeVisible()

    fireEvent.click(screen.getByRole('button', { name: /핀 위치 조정/ }))
    expect(screen.queryByRole('heading', { name: '건물 추가' })).not.toBeInTheDocument()
    expect(screen.getByText('새 건물 핀을 원하는 위치로 옮기세요').closest('.mobile-map-mode-banner')).toHaveClass('pin-adjust')
    expect(setCenter).toHaveBeenCalledWith(expect.objectContaining({ lat: 37.276, lng: 127.119 }))
    expect(setZoom).toHaveBeenCalledWith(18)
    fireEvent.click(screen.getByRole('button', { name: 'move preview pin' }))
    fireEvent.click(screen.getByRole('button', { name: '취소' }))
    expect(screen.getByText('37.27600, 127.11900')).toBeVisible()

    fireEvent.click(screen.getByRole('button', { name: /핀 위치 조정/ }))
    fireEvent.click(screen.getByRole('button', { name: 'move preview pin' }))
    const adjustmentBanner = screen.getByText('새 건물 핀을 원하는 위치로 옮기세요').closest('.mobile-map-mode-banner') as HTMLElement
    fireEvent.click(within(adjustmentBanner).getByRole('button', { name: '완료' }))
    expect(screen.getByText('37.27700, 127.12000')).toBeVisible()

    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: '1' } })
    fireEvent.click(screen.getByRole('button', { name: '추가' }))

    await waitFor(() => expect(onCreateBuilding).toHaveBeenCalledTimes(1))
    expect(onCreateBuilding).toHaveBeenCalledWith(expect.objectContaining({ lat: 37.277, lng: 127.12 }))
    setCenter.mockClear()
    panBy.mockClear()
    const created = testBuilding(91, 1, '언동로 216')
    created.address = '경기도 용인시 기흥구 언동로 216'
    created.lat = 37.276
    created.lng = 127.119
    rerender(
      <MemoryRouter><MobileMap {...({ ...props, buildings: [other, created] } as never)} /></MemoryRouter>,
    )

    const sheet = container.querySelector('.mobile-bottom-sheet') as HTMLElement
    const scroll = container.querySelector('.mobile-sheet-scroll') as HTMLElement
    await waitFor(() => {
      expect(screen.getByTestId('selected-building-id')).toHaveTextContent('91')
      expect(sheet.style.height).toBe(`${getMobileMapSelectedPeekHeight(window.innerHeight)}px`)
    })
    const buildingButton = within(scroll).getByRole('button', { name: /언동로 216/ })
    expect(buildingButton).toBeVisible()
    expect(within(scroll).getByRole('button', { name: /언동로 218/ })).toBeVisible()

    fireEvent.click(buildingButton)
    await waitFor(() => expect(sheet.style.height).toBe(`${window.innerHeight * 0.46}px`))
    expect(within(scroll).getByText('101호')).toBeVisible()

    fireEvent.click(within(scroll).getByRole('button', { name: /언동로 216/ }))
    fireEvent.click(within(scroll).getByRole('button', { name: /언동로 216/ }))
    expect(setCenter).toHaveBeenCalledTimes(4)
    expect(setCenter.mock.calls.every(([point]) => point.lat === 37.276 && point.lng === 127.119)).toBe(true)
    expect(panBy).toHaveBeenCalledTimes(4)
  })

  test('주소 후보가 기존 건물과 일치하면 새 건물 추가 대신 기존 건물을 연다', async () => {
    const building = testBuilding(1, 1, '언동로 건물')
    building.address = '경기도 용인시 기흥구 언동로 213'
    building.lat = 37.275
    building.lng = 127.118
    searchPlacesAndAddressesForCongregation.mockResolvedValue({
      ok: true,
      places: [{
        name: '언동로 213',
        address: '경기도 용인시 기흥구 언동로 213',
        category: '주소',
        lat: 37.275,
        lng: 127.118,
        source: 'address',
      }],
    })
    const props = territoryProps({
      ...mapProps(),
      buildings: [building],
    })
    render(<MemoryRouter><MobileMap {...(props as never)} /></MemoryRouter>)

    fireEvent.click(screen.getByRole('button', { name: '통합 검색' }))
    fireEvent.change(screen.getByPlaceholderText('구역, 건물, 주소, 식당 검색'), {
      target: { value: '경기도 용인시 기흥구 언동로 213 1층' },
    })
    fireEvent.click(screen.getByRole('button', { name: '네이버에서 주소 찾기' }))
    fireEvent.click(await screen.findByRole('button', { name: /언동로 213/ }))

    expect(screen.queryByRole('button', { name: '이 주소에 건물 추가' })).not.toBeInTheDocument()
    expect(await screen.findByText('건물 포인트 1개')).toBeVisible()
  })

  test('모바일 건물 수정 시트에서 건물 유형을 바꾼다', async () => {
    Element.prototype.scrollIntoView = vi.fn()
    confirmDialog.mockClear()
    const building = testBuilding(7, 1, '명지로 106')
    building.type = '상가'
    building.units = [
      { ...building.units[0], id: 701, number: '101호' },
      { ...building.units[0], id: 702, number: '진주옥', isRestaurant: true, usageType: '상가' },
    ]
    const onUpdateBuilding = vi.fn()
    const props = territoryProps({
      actualRole: 'admin',
      currentVisitor: '관리자',
      cards: [testCard(1, '처인구 역북동 1')],
      buildings: [building],
      focusedCardId: 1,
      focusedBuildingId: 7,
      focusedCardIds: [],
      serviceSessions: [],
      specialPeriods: [],
      eventRestaurantAssignments: [],
      calendarEvents: [],
      onBack: vi.fn(),
      onUpdateBuilding,
    })

    render(<MemoryRouter><MobileMap {...(props as never)} /></MemoryRouter>)
    fireEvent.click(await screen.findByLabelText('더보기'))
    fireEvent.click(await screen.findByRole('button', { name: '수정' }))

    const usage = screen.getByRole('combobox', { name: '건물 종류' })
    expect(usage).toHaveValue('상가')
    fireEvent.change(usage, { target: { value: '주택' } })
    fireEvent.click(screen.getByRole('button', { name: '저장' }))

    await waitFor(() => expect(confirmDialog).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(onUpdateBuilding).toHaveBeenCalledWith(
      7, '명지로 106', building.address, undefined, undefined, '주택',
    ))
  })
})
