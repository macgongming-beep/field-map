import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { MapCanvas, type MapViewportMemory } from './MapCanvas'
import { testBoundary, testBuilding } from '../test/territoryFixture'
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
  constructor(public options: { map?: unknown; strokeStyle?: string; fillOpacity?: number; paths?: LatLng[] }) {
    super(options)
    polygons.push(this)
  }
}
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

test('unchanged polygon styles are not reapplied, but selections, team colors and drawing remain live', () => {
  const memory: MapViewportMemory = { current: { lat: 37.2, lng: 127.2, zoom: 14 } }
  const view = render(<MapCanvas {...props} viewportMemory={memory} />)
  const one = polygons.find(p => p.options.fillOpacity === 0.08 && p.options.paths?.[0].lat() === 37.1)!
  const two = polygons.find(p => p.options.fillOpacity === 0.08 && p.options.paths?.[0].lat() === 37.3)!
  expect(one.setOptions).toHaveBeenLastCalledWith(expect.objectContaining({ strokeStyle: 'shortdash', map: maps[0], clickable: true }))
  one.setOptions.mockClear(); two.setOptions.mockClear()
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
  expect(one.setOptions).toHaveBeenLastCalledWith(expect.objectContaining({ map: null, clickable: true }))
  view.rerender(<MapCanvas {...props} viewportMemory={memory} selectedCardId={1} drawingBoundary addingBuilding cardColorMap={colors} />)
  expect(one.setOptions).toHaveBeenLastCalledWith(expect.objectContaining({ map: null, clickable: false }))
  expect(two.setOptions).toHaveBeenLastCalledWith(expect.objectContaining({ map: maps[0], clickable: false }))
  view.rerender(<MapCanvas {...props} viewportMemory={memory} cardColorMap={colors} />)
  expect(one.setOptions).toHaveBeenLastCalledWith(expect.objectContaining({ map: maps[0], clickable: true }))
  view.rerender(<MapCanvas {...props} viewportMemory={memory} />)
  expect(two.setOptions).toHaveBeenLastCalledWith(expect.objectContaining({ strokeStyle: 'shortdash', zIndex: 5 }))
})

test('a boundary removed by a filter receives its style again when it returns', () => {
  const memory: MapViewportMemory = { current: { lat: 37.2, lng: 127.2, zoom: 14 } }
  const view = render(<MapCanvas {...props} viewportMemory={memory} highlightedCardIds={new Set([1])} />)
  const original = polygons.find(p => p.options.fillOpacity === 0.08 && p.options.paths?.[0].lat() === 37.1)!
  view.rerender(<MapCanvas {...props} viewportMemory={memory} cardBoundaries={[]} highlightedCardIds={new Set([1])} />)
  expect(original.getMap()).toBeNull()
  view.rerender(<MapCanvas {...props} viewportMemory={memory} highlightedCardIds={new Set([1])} />)
  const recreated = polygons.find(p => p.options.fillOpacity === 0.08 && p.options.paths?.[0].lat() === 37.1 && p.getMap() === maps[0])!
  expect(recreated).not.toBe(original)
  expect(recreated.setOptions).toHaveBeenCalledWith(expect.objectContaining({ strokeStyle: 'solid', zIndex: 20 }))
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

test('dong-level view culls 609 boundaries to the visible area and adds them on pan', () => {
  vi.useFakeTimers()
  const getBounds = vi.spyOn(FakeMap.prototype, 'getBounds').mockReturnValue(new Bounds(new LatLng(37.09, 127.09), new LatLng(37.21, 127.21)))
  const many = [boundaries[0], ...Array.from({ length: 608 }, (_, i) => testBoundary(i + 2, [37.7, 127.7, 37.71, 127.71]))]
  render(<MapCanvas {...props} cardBoundaries={many} boundaryViewportMinZoom={13} viewportMemory={{ current: { lat: 37.15, lng: 127.15, zoom: 14 } }} />)
  const cardPolygons = () => polygons.filter(p => p.options.fillOpacity === 0.08 && p.getMap() === maps[0])
  expect(cardPolygons()).toHaveLength(1)
  getBounds.mockReturnValue(new Bounds(new LatLng(37.69, 127.69), new LatLng(37.72, 127.72)))
  act(() => { emit(maps[0], 'dragstart'); emit(maps[0], 'idle') })
  expect(cardPolygons().length).toBeGreaterThan(0)
  expect(cardPolygons().every(p => p.options.paths?.[0].lat() === 37.7)).toBe(true)
  expect(maps[0].getZoom()).toBe(14)
  getBounds.mockReturnValue(new Bounds(new LatLng(37.09, 127.09), new LatLng(37.21, 127.21)))
  act(() => { emit(maps[0], 'center_changed'); emit(maps[0], 'idle') })
  expect(cardPolygons()).toHaveLength(1)
  expect(cardPolygons()[0].options.paths?.[0].lat()).toBe(37.1)
  act(() => { maps[0].setZoom(12); emit(maps[0], 'zoom_changed'); emit(maps[0], 'idle'); vi.advanceTimersByTime(121) })
  expect(cardPolygons().length).toBeGreaterThan(1)
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
