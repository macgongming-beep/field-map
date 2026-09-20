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
const geocodeFirstMatch = vi.hoisted(() => vi.fn())

vi.mock('../lib/confirm', () => ({ confirmDialog }))
vi.mock('../lib/placeSearch', () => ({ searchPlacesAndAddressesForCongregation }))
vi.mock('../lib/naverGeocode', () => ({ geocodeFirstMatch }))
vi.mock('./OverlayPortal', () => ({
  OverlayPortal: ({ children }: { children: ReactNode }) => children,
}))

vi.mock('./MapCanvas', () => ({
  MapCanvas: (props: any) => (
    <div>
      <button type="button" onClick={() => props.onZoomChange?.(14)}>zoom middle</button>
      <button type="button" onClick={() => props.onZoomChange?.(16)}>zoom close</button>
      <button type="button" onClick={() => props.onToggleAddingBuilding?.(true)}>start add building</button>
      <button type="button" onClick={() => props.onMapClick?.(37.276, 127.119)}>tap map add</button>
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
    geocodeFirstMatch.mockReset()
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
    fireEvent.click(screen.getByRole('button', { name: '검색' }))

    expect(await screen.findByText('경기도 용인시 기흥구 언동로 213')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: /언동로 213/ }))
    fireEvent.click(await screen.findByRole('button', { name: '이 주소에 건물 추가' }))

    expect(screen.getByRole('heading', { name: '장소 등록' })).toBeVisible()
    expect(screen.getByDisplayValue('경기도 용인시 기흥구 언동로 213')).toBeVisible()
    expect(screen.getByDisplayValue('언동로 213')).toBeVisible()
    expect(screen.getByPlaceholderText('예: 101호')).toBeVisible()
    expect(screen.getByRole('button', { name: '건물과 세대 등록' })).toBeDisabled()
  })

  test('상호 검색 후 짧은 주소를 건물명으로, 상호를 상가 세대로 함께 등록한다', async () => {
    searchPlacesAndAddressesForCongregation.mockResolvedValue({
      ok: true,
      places: [{
        name: '카멜리아힐',
        address: '경기도 용인시 기흥구 언동로 213',
        category: '카페,디저트',
        lat: 37.275,
        lng: 127.118,
        source: 'place',
      }],
    })
    const onCreateBuilding = vi.fn(async () => true)
    const onAddUnit = vi.fn(async () => [9102])
    const props = territoryProps({ ...mapProps(), onCreateBuilding, onAddUnit })
    const { rerender } = render(<MemoryRouter><MobileMap {...(props as never)} /></MemoryRouter>)

    fireEvent.click(screen.getByRole('button', { name: '통합 검색' }))
    fireEvent.change(screen.getByPlaceholderText('구역, 건물, 주소, 식당 검색'), {
      target: { value: '카멜리아힐' },
    })
    fireEvent.click(screen.getByRole('button', { name: '검색' }))
    fireEvent.click(await screen.findByRole('button', { name: /카멜리아힐/ }))
    fireEvent.click(screen.getByRole('button', { name: '이 주소에 건물 추가' }))

    const sheet = screen.getByRole('heading', { name: '장소 등록' }).closest('.mm-building-edit-sheet') as HTMLElement
    expect(within(sheet).getByRole('button', { name: '상가' })).toHaveClass('active')
    expect(within(sheet).getByDisplayValue('언동로 213')).toBeVisible()
    expect(within(sheet).getByDisplayValue('카멜리아힐')).toBeVisible()
    fireEvent.change(within(sheet).getByRole('combobox'), { target: { value: '1' } })
    fireEvent.click(within(sheet).getByRole('button', { name: '건물과 세대 등록' }))

    await waitFor(() => expect(onCreateBuilding).toHaveBeenCalledWith(expect.objectContaining({
      name: '언동로 213',
      address: '경기도 용인시 기흥구 언동로 213',
      type: '상가',
    })))

    const created = testBuilding(93, 1, '언동로 213', [])
    created.address = '경기도 용인시 기흥구 언동로 213'
    created.type = '상가'
    created.lat = 37.275
    created.lng = 127.118
    rerender(<MemoryRouter><MobileMap {...({ ...props, buildings: [created] } as never)} /></MemoryRouter>)

    await waitFor(() => expect(onAddUnit).toHaveBeenCalledWith(93, '카멜리아힐', '상가'))
  })

  test('상호 주소의 기존 건물이 있으면 새 건물 대신 상가 세대 추가로 연결한다', async () => {
    const building = testBuilding(94, 1, '언동로 213')
    building.address = '경기도 용인시 기흥구 언동로 213'
    building.lat = 37.275
    building.lng = 127.118
    searchPlacesAndAddressesForCongregation.mockResolvedValue({
      ok: true,
      places: [{
        name: '카멜리아힐',
        address: building.address,
        category: '카페,디저트',
        lat: building.lat,
        lng: building.lng,
        source: 'place',
      }],
    })
    const onCreateBuilding = vi.fn(async () => true)
    const onAddUnit = vi.fn(async () => [9103])
    const props = territoryProps({ ...mapProps(), buildings: [building], onCreateBuilding, onAddUnit })
    const { container } = render(<MemoryRouter><MobileMap {...(props as never)} /></MemoryRouter>)

    fireEvent.click(screen.getByRole('button', { name: '통합 검색' }))
    fireEvent.change(screen.getByPlaceholderText('구역, 건물, 주소, 식당 검색'), {
      target: { value: '카멜리아힐' },
    })
    fireEvent.click(screen.getByRole('button', { name: '검색' }))
    fireEvent.click(await screen.findByRole('button', { name: /카멜리아힐/ }))

    const scroll = container.querySelector('.mobile-sheet-scroll') as HTMLElement
    const input = await within(scroll).findByDisplayValue('카멜리아힐')
    expect(input).toBeVisible()
    fireEvent.click(within(scroll).getByRole('button', { name: '추가' }))
    await waitFor(() => expect(onAddUnit).toHaveBeenCalledWith(94, '카멜리아힐', '상가'))
    expect(onCreateBuilding).not.toHaveBeenCalled()
  })

  test('지도에서 건물 가장자리를 눌러도 가까운 주소 대표 좌표로 새 핀을 보정한다', async () => {
    geocodeFirstMatch.mockResolvedValue({ lat: 37.2764, lng: 127.1194 })
    ;(window as any).naver = {
      maps: {
        LatLng: class LatLng { constructor(public lat: number, public lng: number) {} },
        Service: {
          Status: { OK: 'OK' },
          OrderType: { ADDR: 'addr', ROAD_ADDR: 'roadaddr' },
          reverseGeocode: (_options: unknown, callback: (status: string, response: unknown) => void) => callback('OK', {
            v2: {
              results: [{
                name: 'roadaddr',
                region: {
                  area1: { name: '경기도' },
                  area2: { name: '용인시 기흥구' },
                  area3: { name: '중동' },
                },
                land: { name: '언동로', number1: '216' },
              }],
            },
          }),
        },
      },
    }

    render(<MemoryRouter><MobileMap {...(mapProps() as never)} /></MemoryRouter>)
    fireEvent.click(screen.getByRole('button', { name: 'start add building' }))
    fireEvent.click(screen.getByRole('button', { name: 'tap map add' }))

    expect(screen.getByRole('heading', { name: '건물 추가' })).toBeVisible()
    await waitFor(() => expect(screen.getByText('37.27640, 127.11940')).toBeVisible())
    expect(geocodeFirstMatch).toHaveBeenCalledWith(expect.arrayContaining([
      '경기도 용인시 기흥구 중동 언동로 216',
      '경기도 용인시 기흥구 언동로 216',
    ]))
  })

  test('주소 대표 좌표가 멀면 새 핀을 원래 누른 위치에 유지한다', async () => {
    geocodeFirstMatch.mockResolvedValue({ lat: 37.3, lng: 127.2 })
    ;(window as any).naver = {
      maps: {
        LatLng: class LatLng { constructor(public lat: number, public lng: number) {} },
        Service: {
          Status: { OK: 'OK' },
          OrderType: { ADDR: 'addr', ROAD_ADDR: 'roadaddr' },
          reverseGeocode: (_options: unknown, callback: (status: string, response: unknown) => void) => callback('OK', {
            v2: {
              results: [{
                name: 'roadaddr',
                region: {
                  area1: { name: '경기도' },
                  area2: { name: '용인시 기흥구' },
                  area3: { name: '' },
                },
                land: { name: '언동로', number1: '216' },
              }],
            },
          }),
        },
      },
    }

    render(<MemoryRouter><MobileMap {...(mapProps() as never)} /></MemoryRouter>)
    fireEvent.click(screen.getByRole('button', { name: 'start add building' }))
    fireEvent.click(screen.getByRole('button', { name: 'tap map add' }))

    await waitFor(() => expect(geocodeFirstMatch).toHaveBeenCalled())
    expect(screen.getByText('37.27600, 127.11900')).toBeVisible()
  })

  test('주소 좌표 응답 전에 조정 화면을 열어도 직접 끌기 전에는 자동 보정을 적용한다', async () => {
    let resolveGeocode: (value: { lat: number; lng: number }) => void = () => undefined
    geocodeFirstMatch.mockReturnValue(new Promise((resolve) => { resolveGeocode = resolve }))
    ;(window as any).naver = {
      maps: {
        LatLng: class LatLng { constructor(public lat: number, public lng: number) {} },
        Service: {
          Status: { OK: 'OK' },
          OrderType: { ADDR: 'addr', ROAD_ADDR: 'roadaddr' },
          reverseGeocode: (_options: unknown, callback: (status: string, response: unknown) => void) => callback('OK', {
            v2: {
              results: [{
                name: 'roadaddr',
                region: {
                  area1: { name: '경기도' },
                  area2: { name: '용인시 기흥구' },
                  area3: { name: '' },
                },
                land: { name: '언동로', number1: '216' },
              }],
            },
          }),
        },
      },
    }
    ;(window as any).__mobileMapInstance = { setCenter: vi.fn(), getZoom: () => 18, setZoom: vi.fn() }

    render(<MemoryRouter><MobileMap {...(mapProps() as never)} /></MemoryRouter>)
    fireEvent.click(screen.getByRole('button', { name: 'start add building' }))
    fireEvent.click(screen.getByRole('button', { name: 'tap map add' }))
    fireEvent.click(screen.getByRole('button', { name: /핀 위치 조정/ }))
    resolveGeocode({ lat: 37.2764, lng: 127.1194 })

    fireEvent.click(await screen.findByRole('button', { name: '완료', exact: true }))
    expect(screen.getByText('37.27640, 127.11940')).toBeVisible()
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
    const onAddUnit = vi.fn(async () => [9101])
    const other = testBuilding(92, 1, '언동로 218')
    other.address = '경기도 용인시 기흥구 언동로 218'
    other.lat = 37.277
    other.lng = 127.12
    const props = territoryProps({ ...mapProps(), buildings: [other], onCreateBuilding, onAddUnit })
    const { container, rerender } = render(
      <MemoryRouter><MobileMap {...(props as never)} /></MemoryRouter>,
    )

    fireEvent.click(screen.getByRole('button', { name: '통합 검색' }))
    fireEvent.change(screen.getByPlaceholderText('구역, 건물, 주소, 식당 검색'), {
      target: { value: '언동로 216' },
    })
    fireEvent.click(screen.getByRole('button', { name: '검색' }))
    fireEvent.click(await screen.findByRole('button', { name: /언동로 216/ }))
    fireEvent.click(screen.getByRole('button', { name: '이 주소에 건물 추가' }))
    expect(screen.getByText('37.27600, 127.11900')).toBeVisible()

    fireEvent.click(screen.getByRole('button', { name: /핀 위치 조정/ }))
    expect(screen.queryByRole('heading', { name: '장소 등록' })).not.toBeInTheDocument()
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
    fireEvent.change(screen.getByPlaceholderText('예: 101호'), { target: { value: '101호' } })
    fireEvent.click(screen.getByRole('button', { name: '건물과 세대 등록' }))

    await waitFor(() => expect(onCreateBuilding).toHaveBeenCalledTimes(1))
    expect(onCreateBuilding).toHaveBeenCalledWith(expect.objectContaining({ lat: 37.277, lng: 127.12 }))
    setCenter.mockClear()
    panBy.mockClear()
    const created = testBuilding(91, 1, '언동로 216', [])
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
      expect(sheet.style.height).toBe(`${window.innerHeight * 0.46}px`)
    })
    const buildingButton = within(scroll).getByRole('button', { name: /언동로 216/ })
    expect(buildingButton).toBeVisible()
    expect(within(scroll).getByRole('button', { name: /언동로 218/ })).toBeVisible()
    await waitFor(() => expect(onAddUnit).toHaveBeenCalledWith(91, '101호', '주택'))

    const createdWithUnit = testBuilding(91, 1, '언동로 216')
    createdWithUnit.address = created.address
    createdWithUnit.lat = created.lat
    createdWithUnit.lng = created.lng
    rerender(
      <MemoryRouter><MobileMap {...({ ...props, buildings: [other, createdWithUnit] } as never)} /></MemoryRouter>,
    )
    expect(within(scroll).getByText('101호')).toBeVisible()
    expect(within(scroll).queryByText('첫 세대를 등록해 주세요')).not.toBeInTheDocument()

    const centerCallsBeforeRepeat = setCenter.mock.calls.length
    const panCallsBeforeRepeat = panBy.mock.calls.length
    fireEvent.click(within(scroll).getByRole('button', { name: /언동로 216/ }))
    fireEvent.click(within(scroll).getByRole('button', { name: /언동로 216/ }))
    expect(setCenter).toHaveBeenCalledTimes(centerCallsBeforeRepeat + 2)
    expect(setCenter.mock.calls.every(([point]) => point.lat === 37.276 && point.lng === 127.119)).toBe(true)
    expect(panBy).toHaveBeenCalledTimes(panCallsBeforeRepeat + 2)
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
    fireEvent.click(screen.getByRole('button', { name: '검색' }))
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
