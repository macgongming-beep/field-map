import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { MapCanvas, type MapViewportMemory } from './MapCanvas'
import { testBoundary, testBuilding, testCard } from '../test/territoryFixture'
import { applyCongregationSettings } from '../lib/congregationProfile'

class LatLng {
  constructor(private latitude: number, private longitude: number) {}
  lat() { return this.latitude }
  lng() { return this.longitude }
}
class Bounds {
  constructor(private sw: LatLng, private ne: LatLng) {}
  extend() {}
  getSW() { return this.sw }
  getNE() { return this.ne }
  hasLatLng() { return true }
}
class Overlay {
  map: unknown
  constructor(options: { map?: unknown }) { this.map = options.map }
  setMap(map: unknown) { this.map = map }
  getMap() { return this.map }
  setOptions() {}
  setPosition() {}
}
const polygons: Polygon[] = []
class Polygon extends Overlay {
  setOptions = vi.fn()
  setMap = vi.fn((map: unknown) => { this.map = map })
  visible: boolean
  setVisible = vi.fn((visible: boolean) => { this.visible = visible })
  constructor(public options: { map?: unknown; strokeStyle?: string; fillOpacity?: number; visible?: boolean; paths?: LatLng[] }) {
    super(options)
    this.visible = options.visible ?? true
    polygons.push(this)
  }
}
// 구역 카드 구역선만 `visible`을 넘겨 만든다(회중 경계·그리기 선은 넘기지 않는다)
const cardPolygon = (lat: number) => polygons.find(p => p.options.visible !== undefined && p.options.paths?.[0].lat() === lat && p.getMap() !== null)!
const shownCardPolygons = () => polygons.filter(p => p.options.visible !== undefined && p.getMap() === maps[0] && p.visible)
const markers: Marker[] = []
class Marker extends Overlay {
  setMap = vi.fn((map: unknown) => { this.map = map })
  constructor(public options: { map?: unknown; title?: string }) {
    super(options)
    markers.push(this)
  }
}
const maps: FakeMap[] = []
class FakeMap {
  center: LatLng
  zoom: number
  fitBounds = vi.fn((_bounds?: Bounds) => { this.center = new LatLng(37.2, 127.2); this.zoom = 12 })
  panTo = vi.fn((center: LatLng) => { this.center = center })
  morph = vi.fn((center: LatLng, zoom: number) => { this.center = center; this.zoom = zoom })
  constructor(_element: unknown, options: { center: LatLng; zoom: number }) {
    this.center = options.center; this.zoom = options.zoom; maps.push(this)
  }
  getCenter() { return this.center }
  getZoom() { return this.zoom }
  setCenter(center: LatLng) { this.center = center }
  setZoom(zoom: number) { this.zoom = zoom }
  getBounds() { return new Bounds(new LatLng(36, 126), new LatLng(38, 129)) }
}
let listeners = new WeakMap<object, Map<string, (() => void)[]>>()
function emit(target: object, name: string) { listeners.get(target)?.get(name)?.forEach(callback => callback()) }
beforeEach(() => {
  applyCongregationSettings({ congregation_profile: JSON.stringify({ territoryBoundary: [[127, 37], [128, 37], [128, 38], [127, 38]] }) })
  maps.length = 0
  polygons.length = 0
  markers.length = 0
  listeners = new WeakMap()
  vi.stubEnv('VITE_NAVER_MAP_CLIENT_ID', 'test-key')
  vi.stubGlobal('ResizeObserver', class { observe() {}; disconnect() {} })
  vi.stubGlobal('naver', { maps: { Map: FakeMap, LatLng, LatLngBounds: Bounds, Polygon, Polyline: Overlay, Marker,
    Point: LatLng, Size: LatLng, Event: {
      addListener(target: object, name: string, callback: () => void) {
        const events = listeners.get(target) ?? new Map()
        events.set(name, [...(events.get(name) ?? []), callback]); listeners.set(target, events)
        return { target, name, callback }
      },
      removeListener() {}, trigger: emit,
    },
  } })
  const script = document.createElement('script'); script.id = 'naver-map-script'; document.head.appendChild(script)
})
afterEach(() => { cleanup(); vi.useRealTimers(); applyCongregationSettings({}); document.getElementById('naver-map-script')?.remove(); vi.unstubAllEnvs(); vi.unstubAllGlobals() })
const boundaries = [testBoundary(1, [37.1, 127.1, 37.2, 127.2]), testBoundary(2, [37.3, 127.3, 37.4, 127.4])]
const props = { buildings: [], cards: [], cardBoundaries: boundaries, selectedBuildingId: 0, selectedCardId: '전체' as const, onSelectBuilding: vi.fn() }

test('a queued idle must not build intermediate markers when the SDK starts another zoom before zoom_changed', () => {
  vi.useFakeTimers()
  const buildings = [testBuilding(1, 1, 'one'), { ...testBuilding(2, 1, 'two'), lat: 37.5001 }]
  render(<MapCanvas {...props} cardBoundaries={[]} buildings={buildings}
    viewportMemory={{ current: { lat: 37.5, lng: 127.1, zoom: 17 } }} />)
  const map = maps[0]
  expect(markers).toHaveLength(2)
  act(() => { map.setZoom(15); emit(map, 'zoom_changed'); emit(map, 'idle') })
  // Naver starts animating/getZoom changes before its next zoom_changed event.
  act(() => { map.setZoom(14); vi.advanceTimersByTime(121) })
  expect(markers).toHaveLength(2)
  expect(markers.every(marker => marker.setMap.mock.calls.length === 0)).toBe(true)
  act(() => { map.setZoom(14); emit(map, 'zoom_changed'); emit(map, 'idle'); vi.advanceTimersByTime(121) })
  expect(markers).toHaveLength(3)
  expect(markers.filter(marker => marker.getMap() === map)).toHaveLength(1)
  expect(markers[0].setMap).toHaveBeenCalledWith(null)
  expect(map.getZoom()).toBe(14)
})

test('boundaries are created with their final style and later only changed styles are reapplied, without map rebinding', () => {
  const memory: MapViewportMemory = { current: { lat: 37.2, lng: 127.2, zoom: 14 } }
  const view = render(<MapCanvas {...props} viewportMemory={memory} />)
  const one = cardPolygon(37.1)
  const two = cardPolygon(37.3)
  // 기본 모양으로 만들고 다시 칠하지 않는다 — 처음부터 최종 모양이다
  expect(one.options).toEqual(expect.objectContaining({ strokeStyle: 'shortdash', fillOpacity: 0.05, zIndex: 5, clickable: true, visible: true, map: maps[0] }))
  expect(one.setOptions).not.toHaveBeenCalled()
  expect(two.setOptions).not.toHaveBeenCalled()
  view.rerender(<MapCanvas {...props} viewportMemory={memory} highlightedCardIds={new Set()} />)
  act(() => { emit(maps[0], 'center_changed'); emit(maps[0], 'idle') })
  expect(one.setOptions).not.toHaveBeenCalled()
  expect(two.setOptions).not.toHaveBeenCalled()
  view.rerender(<MapCanvas {...props} viewportMemory={memory} selectedCardId={1} />)
  expect(one.setOptions).toHaveBeenCalledTimes(1)
  expect(one.setOptions).toHaveBeenLastCalledWith(expect.objectContaining({ strokeStyle: 'solid', zIndex: 20 }))
  expect(two.setOptions).not.toHaveBeenCalled()
  const colors = new Map([[2, '#123456']])
  view.rerender(<MapCanvas {...props} viewportMemory={memory} cardColorMap={colors} />)
  expect(one.setOptions).toHaveBeenLastCalledWith(expect.objectContaining({ fillColor: '#5b6b7c', zIndex: 8 }))
  expect(two.setOptions).toHaveBeenLastCalledWith(expect.objectContaining({ fillColor: '#123456', zIndex: 25 }))
  view.rerender(<MapCanvas {...props} viewportMemory={memory} selectedCardId={1} drawingBoundary cardColorMap={colors} />)
  expect(one.visible).toBe(false)
  expect(two.visible).toBe(true)
  view.rerender(<MapCanvas {...props} viewportMemory={memory} selectedCardId={1} drawingBoundary addingBuilding cardColorMap={colors} />)
  expect(one.setOptions).toHaveBeenLastCalledWith(expect.objectContaining({ clickable: false }))
  expect(two.setOptions).toHaveBeenLastCalledWith(expect.objectContaining({ clickable: false }))
  expect(one.visible).toBe(false)
  view.rerender(<MapCanvas {...props} viewportMemory={memory} cardColorMap={colors} />)
  expect(one.setOptions).toHaveBeenLastCalledWith(expect.objectContaining({ clickable: true }))
  expect(one.visible).toBe(true)
  view.rerender(<MapCanvas {...props} viewportMemory={memory} />)
  expect(two.setOptions).toHaveBeenLastCalledWith(expect.objectContaining({ strokeStyle: 'shortdash', zIndex: 5 }))
  // 다시 칠할 때 지도를 넘기지 않는다(같은 지도라도 떼었다 붙인다). 지도에서 떼지도 않는다.
  for (const polygon of [one, two]) {
    expect(polygon.setOptions.mock.calls.every(([options]) => !('map' in (options as object)))).toBe(true)
    expect(polygon.setMap).not.toHaveBeenCalled()
  }
})

test('a boundary created while its card is being redrawn starts hidden and does not take taps', () => {
  const memory: MapViewportMemory = { current: { lat: 37.2, lng: 127.2, zoom: 14 } }
  const view = render(<MapCanvas {...props} viewportMemory={memory} selectedCardId={1} drawingBoundary />)
  const one = polygons.find(p => p.options.visible !== undefined && p.options.paths?.[0].lat() === 37.1)!
  const two = cardPolygon(37.3)
  expect(one.options).toEqual(expect.objectContaining({ visible: false, clickable: false }))
  expect(one.visible).toBe(false)
  expect(two.options).toEqual(expect.objectContaining({ visible: true, clickable: true }))
  view.rerender(<MapCanvas {...props} viewportMemory={memory} selectedCardId={1} />)
  expect(one.visible).toBe(true)
  expect(one.setOptions).toHaveBeenLastCalledWith(expect.objectContaining({ clickable: true }))
})

test('a boundary removed by a filter is detached and returns as a new polygon in its current style', () => {
  const memory: MapViewportMemory = { current: { lat: 37.2, lng: 127.2, zoom: 14 } }
  const view = render(<MapCanvas {...props} viewportMemory={memory} highlightedCardIds={new Set([1])} />)
  const original = cardPolygon(37.1)
  view.rerender(<MapCanvas {...props} viewportMemory={memory} cardBoundaries={[]} highlightedCardIds={new Set([1])} />)
  expect(original.getMap()).toBeNull()
  view.rerender(<MapCanvas {...props} viewportMemory={memory} highlightedCardIds={new Set([1])} />)
  const recreated = cardPolygon(37.1)
  expect(recreated).not.toBe(original)
  expect(recreated.options).toEqual(expect.objectContaining({ strokeStyle: 'solid', zIndex: 20, visible: true }))
  expect(recreated.setOptions).not.toHaveBeenCalled()
})

test('group filter hides and restores the congregation outline without moving the camera', () => {
  const memory: MapViewportMemory = { current: { lat: 37.2, lng: 127.2, zoom: 14 } }
  const view = render(<MapCanvas {...props} viewportMemory={memory} showTerritoryBoundary={false} />)
  const outline = polygons.find(polygon => polygon.options.fillOpacity === 0.05)!
  expect(outline).toBeTruthy()
  expect(outline.options.map).toBeNull()
  expect(outline.getMap()).toBeNull()
  view.rerender(<MapCanvas {...props} viewportMemory={memory} showTerritoryBoundary />)
  expect(outline.getMap()).toBe(maps[0])
  view.rerender(<MapCanvas {...props} viewportMemory={memory} showTerritoryBoundary={false} />)
  expect(outline.getMap()).toBeNull()
  expect(maps[0].fitBounds).not.toHaveBeenCalled()
  expect(maps[0].getZoom()).toBe(14)
})

test('dong-level view culls 609 boundaries to the visible area; panned-out ones are hidden and reused', () => {
  vi.useFakeTimers()
  const getBounds = vi.spyOn(FakeMap.prototype, 'getBounds').mockReturnValue(new Bounds(new LatLng(37.09, 127.09), new LatLng(37.21, 127.21)))
  const many = [boundaries[0], ...Array.from({ length: 608 }, (_, i) => testBoundary(i + 2, [37.7, 127.7, 37.71, 127.71]))]
  render(<MapCanvas {...props} cardBoundaries={many} boundaryViewportMinZoom={13} viewportMemory={{ current: { lat: 37.15, lng: 127.15, zoom: 14 } }} />)
  expect(shownCardPolygons()).toHaveLength(1)
  const first = shownCardPolygons()[0]
  getBounds.mockReturnValue(new Bounds(new LatLng(37.69, 127.69), new LatLng(37.72, 127.72)))
  act(() => { emit(maps[0], 'dragstart'); emit(maps[0], 'idle') })
  expect(shownCardPolygons().length).toBeGreaterThan(0)
  expect(shownCardPolygons().every(p => p.options.paths?.[0].lat() === 37.7)).toBe(true)
  // 화면 밖으로 나간 것은 지도에서 떼지 않고 숨긴다
  expect(first.visible).toBe(false)
  expect(first.getMap()).toBe(maps[0])
  expect(first.setMap).not.toHaveBeenCalled()
  expect(maps[0].getZoom()).toBe(14)
  const away = shownCardPolygons()
  const created = polygons.length
  getBounds.mockReturnValue(new Bounds(new LatLng(37.09, 127.09), new LatLng(37.21, 127.21)))
  act(() => { emit(maps[0], 'center_changed'); emit(maps[0], 'idle') })
  // 돌아오면 같은 구역선을 다시 보이기만 한다(새로 만들지 않는다)
  expect(shownCardPolygons()).toEqual([first])
  expect(polygons.length).toBe(created)
  expect(away.every(p => !p.visible && p.setMap.mock.calls.length === 0)).toBe(true)
  act(() => { maps[0].setZoom(12); emit(maps[0], 'zoom_changed'); emit(maps[0], 'idle'); vi.advanceTimersByTime(121) })
  expect(shownCardPolygons().length).toBeGreaterThan(1)
  expect(away.every(p => p.visible)).toBe(true)
  getBounds.mockRestore()
})

test('hidden boundaries over the limit are detached oldest first', () => {
  vi.useFakeTimers()
  const near = new Bounds(new LatLng(37.09, 127.09), new LatLng(37.21, 127.21))
  const far = new Bounds(new LatLng(37.69, 127.69), new LatLng(37.72, 127.72))
  const getBounds = vi.spyOn(FakeMap.prototype, 'getBounds').mockReturnValue(far)
  const many = [boundaries[0], ...Array.from({ length: 400 }, (_, i) => testBoundary(i + 2, [37.7, 127.7, 37.71, 127.71]))]
  render(<MapCanvas {...props} cardBoundaries={many} boundaryViewportMinZoom={13} viewportMemory={{ current: { lat: 37.7, lng: 127.7, zoom: 14 } }} />)
  act(() => { vi.advanceTimersByTime(1000) })
  const farPolygons = polygons.filter(p => p.options.visible !== undefined && p.options.paths?.[0].lat() === 37.7)
  expect(farPolygons).toHaveLength(400)
  getBounds.mockReturnValue(near)
  act(() => { emit(maps[0], 'center_changed'); emit(maps[0], 'idle') })
  expect(shownCardPolygons()).toHaveLength(1)
  const detached = () => farPolygons.filter(p => p.getMap() === null)
  // 그 자리에서 한꺼번에 떼지 않는다(확대해 들어갈 때 멈춤) — 다음 프레임부터 30개씩
  expect(detached()).toHaveLength(0)
  expect(farPolygons.every(p => !p.visible)).toBe(true)
  act(() => { vi.advanceTimersByTime(17) })
  expect(detached()).toHaveLength(30)
  act(() => { vi.advanceTimersByTime(1000) })
  expect(detached()).toHaveLength(250)
  expect(farPolygons.filter(p => p.getMap() === maps[0] && !p.visible)).toHaveLength(150)
  // 오래 숨겨 둔 것(먼저 만든 것, 가운데에서 같은 거리라 넣은 순서)부터 뗀다
  expect(detached()).toEqual(farPolygons.slice(0, 250))
  getBounds.mockRestore()
})

test('boundaries shown again while the overflow is being detached stay on the map', () => {
  vi.useFakeTimers()
  const near = new Bounds(new LatLng(37.09, 127.09), new LatLng(37.21, 127.21))
  const far = new Bounds(new LatLng(37.69, 127.69), new LatLng(37.72, 127.72))
  const getBounds = vi.spyOn(FakeMap.prototype, 'getBounds').mockReturnValue(far)
  const many = [boundaries[0], ...Array.from({ length: 400 }, (_, i) => testBoundary(i + 2, [37.7, 127.7, 37.71, 127.71]))]
  const view = render(<MapCanvas {...props} cardBoundaries={many} boundaryViewportMinZoom={13} viewportMemory={{ current: { lat: 37.7, lng: 127.7, zoom: 14 } }} />)
  act(() => { vi.advanceTimersByTime(1000) })
  const farPolygons = polygons.filter(p => p.options.visible !== undefined && p.options.paths?.[0].lat() === 37.7)
  getBounds.mockReturnValue(near)
  act(() => { emit(maps[0], 'center_changed'); emit(maps[0], 'idle'); vi.advanceTimersByTime(17) })
  expect(farPolygons.filter(p => p.getMap() === null)).toHaveLength(30)
  getBounds.mockReturnValue(far)
  act(() => { emit(maps[0], 'center_changed'); emit(maps[0], 'idle'); vi.advanceTimersByTime(1000) })
  expect(farPolygons.filter(p => p.getMap() === null)).toHaveLength(30)
  expect(farPolygons.filter(p => p.getMap() === maps[0]).every(p => p.visible)).toBe(true)
  expect(shownCardPolygons()).toHaveLength(400)
  // 떼던 중에 화면을 닫아도 남은 프레임이 돌지 않는다
  getBounds.mockReturnValue(near)
  act(() => { emit(maps[0], 'center_changed'); emit(maps[0], 'idle') })
  view.unmount()
  const attached = polygons.filter(p => p.getMap() === maps[0]).length
  act(() => { vi.advanceTimersByTime(1000) })
  expect(polygons.filter(p => p.getMap() === maps[0]).length).toBe(attached)
  getBounds.mockRestore()
})

test('a hidden boundary whose shape changed is rebuilt when it comes back', () => {
  const near = new Bounds(new LatLng(37.09, 127.09), new LatLng(37.21, 127.21))
  const far = new Bounds(new LatLng(37.29, 127.29), new LatLng(37.41, 127.41))
  const getBounds = vi.spyOn(FakeMap.prototype, 'getBounds').mockReturnValue(near)
  const memory: MapViewportMemory = { current: { lat: 37.15, lng: 127.15, zoom: 14 } }
  const view = render(<MapCanvas {...props} boundaryViewportMinZoom={13} viewportMemory={memory} />)
  const original = cardPolygon(37.1)
  getBounds.mockReturnValue(far)
  act(() => { emit(maps[0], 'center_changed'); emit(maps[0], 'idle') })
  expect(original.visible).toBe(false)
  const moved = [testBoundary(1, [37.1, 127.1, 37.25, 127.25]), boundaries[1]]
  view.rerender(<MapCanvas {...props} cardBoundaries={moved} boundaryViewportMinZoom={13} viewportMemory={memory} />)
  getBounds.mockReturnValue(near)
  act(() => { emit(maps[0], 'center_changed'); emit(maps[0], 'idle') })
  expect(original.getMap()).toBeNull()
  const rebuilt = shownCardPolygons().find(p => p.options.paths?.[0].lat() === 37.1)!
  expect(rebuilt).not.toBe(original)
  expect(rebuilt.options.paths?.map(point => point.lat())).toContain(37.25)
  // 모양이 같은 채로 돌아온 것은 그대로 다시 쓴다
  const same = [testBoundary(1, [37.1, 127.1, 37.25, 127.25]), boundaries[1]]
  getBounds.mockReturnValue(far)
  act(() => { emit(maps[0], 'center_changed'); emit(maps[0], 'idle') })
  view.rerender(<MapCanvas {...props} cardBoundaries={same} boundaryViewportMinZoom={13} viewportMemory={memory} />)
  getBounds.mockReturnValue(near)
  act(() => { emit(maps[0], 'center_changed'); emit(maps[0], 'idle') })
  expect(shownCardPolygons().find(p => p.options.paths?.[0].lat() === 37.1)).toBe(rebuilt)
  getBounds.mockRestore()
})

test('zooming in past the label level attaches labels only for boundaries around the view', () => {
  const near = new Bounds(new LatLng(37.09, 127.09), new LatLng(37.21, 127.21))
  const getBounds = vi.spyOn(FakeMap.prototype, 'getBounds').mockReturnValue(near)
  const cards = [testCard(1, '하나'), testCard(2, '둘')]
  render(<MapCanvas {...props} cards={cards} viewportMemory={{ current: { lat: 37.15, lng: 127.15, zoom: 14 } }} />)
  // 기준 줌 아래: 구역선은 전부 있고 라벨은 없다
  expect(shownCardPolygons()).toHaveLength(2)
  expect(markers).toHaveLength(0)
  // 확대가 끝나는 순간(구역선 정리 전)에도 화면 밖 구역선의 라벨은 만들거나 붙이지 않는다
  act(() => { maps[0].setZoom(16); emit(maps[0], 'zoom_changed') })
  expect(markers).toHaveLength(1)
  expect(markers[0].getMap()).toBe(maps[0])
  getBounds.mockRestore()
})

test('card name labels are not created for hidden boundaries', () => {
  vi.useFakeTimers()
  const near = new Bounds(new LatLng(37.09, 127.09), new LatLng(37.21, 127.21))
  const far = new Bounds(new LatLng(37.29, 127.29), new LatLng(37.41, 127.41))
  const getBounds = vi.spyOn(FakeMap.prototype, 'getBounds').mockReturnValue(near)
  const cards = [testCard(1, '하나'), testCard(2, '둘')]
  render(<MapCanvas {...props} cards={cards} boundaryViewportMinZoom={13} viewportMemory={{ current: { lat: 37.15, lng: 127.15, zoom: 16 } }} />)
  const labels = () => markers.filter(m => m.getMap() === maps[0])
  expect(labels()).toHaveLength(1)
  const firstLabel = labels()[0]
  getBounds.mockReturnValue(far)
  // 끌기 시작에 라벨을 뗀다. 멈춘 뒤 화면 밖 라벨은 다시 붙이지도, 두 번 떼지도 않는다
  act(() => { emit(maps[0], 'dragstart'); emit(maps[0], 'idle'); vi.advanceTimersByTime(200) })
  expect(cardPolygon(37.1).visible).toBe(false)
  expect(firstLabel.getMap()).toBeNull()
  expect(firstLabel.setMap.mock.calls.filter(([map]) => map === null)).toHaveLength(1)
  expect(labels()).toHaveLength(1)
  expect(labels()[0]).not.toBe(firstLabel)
  getBounds.mockRestore()
})

test('assignment camera survives scope changes, remount and late idle from the old map', () => {
  const memory: MapViewportMemory = { current: null }
  const view = render(<MapCanvas {...props} viewportMemory={memory} highlightedCardIds={new Set([1])} />)
  const map = maps[0]
  const fitted = map.fitBounds.mock.calls.length
  expect(fitted).toBeGreaterThan(0)
  act(() => { map.setCenter(new LatLng(37.33, 127.44)); map.setZoom(19); emit(map, 'idle') })
  view.rerender(<MapCanvas {...props} viewportMemory={memory} highlightedCardIds={new Set([2])} cardColorMap={new Map([[2, '#123456']])} />)
  expect(map.fitBounds).toHaveBeenCalledTimes(fitted)
  expect(map.getZoom()).toBe(19)
  view.unmount()
  render(<MapCanvas {...props} viewportMemory={memory} highlightedCardIds={new Set([2])} />)
  expect(maps[1].getCenter().lat()).toBe(37.33)
  expect(maps[1].getCenter().lng()).toBe(127.44)
  expect(maps[1].getZoom()).toBe(19)
  expect(maps[1].fitBounds).not.toHaveBeenCalled()
  act(() => { map.setZoom(5); emit(map, 'idle') })
  expect(memory.current?.zoom).toBe(19)
})

test('ordinary maps still fit the newly selected card scope', () => {
  const view = render(<MapCanvas {...props} highlightedCardIds={new Set([1])} />)
  const map = maps[0]
  const fitted = map.fitBounds.mock.calls.length
  view.rerender(<MapCanvas {...props} highlightedCardIds={new Set([2])} />)
  expect(map.fitBounds.mock.calls.length).toBeGreaterThan(fitted)
})

test('first assignment framing includes buildings whose cards have no boundary', () => {
  render(<MapCanvas {...props} viewportMemory={{ current: null }} hideBuildingMarkers
    buildings={[{ ...testBuilding(3, 3, 'no polygon'), lat: 37.6, lng: 127.6 }]}
    highlightedCardIds={new Set([1, 3])} />)
  const bounds = maps[0].fitBounds.mock.calls[0][0] as unknown as Bounds
  expect(bounds.getSW().lat()).toBe(37.1)
  expect(bounds.getNE().lat()).toBe(37.6)
  expect(bounds.getNE().lng()).toBe(127.6)
})

test.each([false, true])('GPS preserves the current zoom, including zoom changed while waiting (workspace=%s)', (withWorkspace) => {
  let locate: PositionCallback | undefined
  const getCurrentPosition = vi.fn((success: PositionCallback) => { locate = success })
  vi.stubGlobal('navigator', Object.create(navigator, { geolocation: { value: { getCurrentPosition } } }))
  const memory: MapViewportMemory = { current: null }
  const view = render(<MapCanvas {...props} viewportMemory={withWorkspace ? memory : undefined} />)
  const map = maps[0]
  const success = () => locate!({ coords: { latitude: 37.244, longitude: 127.181 } } as GeolocationPosition)
  act(() => { map.setZoom(19) })
  fireEvent.click(screen.getByRole('button', { name: '현재 위치' }))
  act(success)
  expect(map.getZoom()).toBe(19)
  expect(map.getCenter().lat()).toBe(37.244)
  expect(map.getCenter().lng()).toBe(127.181)
  fireEvent.click(screen.getByRole('button', { name: '현재 위치' }))
  act(() => { map.setZoom(13); success(); emit(map, 'idle') })
  expect(map.getZoom()).toBe(13)
  expect(getCurrentPosition).toHaveBeenCalledTimes(2)
  if (withWorkspace) expect(memory.current).toEqual({ lat: 37.244, lng: 127.181, zoom: 13 })
  fireEvent.click(screen.getByRole('button', { name: '현재 위치' }))
  view.unmount()
  act(success)
  expect(map.panTo).toHaveBeenCalledTimes(2)
})
