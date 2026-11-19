import '@testing-library/jest-dom/vitest'
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { MapCanvas, type MapViewportMemory } from './MapCanvas'
import { testBoundary } from '../test/territoryFixture'

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
}
const maps: FakeMap[] = []
class FakeMap {
  center: LatLng
  zoom: number
  fitBounds = vi.fn(() => { this.center = new LatLng(37.2, 127.2); this.zoom = 12 })
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
  maps.length = 0
  listeners = new WeakMap()
  vi.stubEnv('VITE_NAVER_MAP_CLIENT_ID', 'test-key')
  vi.stubGlobal('ResizeObserver', class { observe() {}; disconnect() {} })
  vi.stubGlobal('naver', { maps: { Map: FakeMap, LatLng, LatLngBounds: Bounds, Polygon: Overlay, Polyline: Overlay, Marker: Overlay,
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
afterEach(() => { cleanup(); document.getElementById('naver-map-script')?.remove(); vi.unstubAllEnvs(); vi.unstubAllGlobals() })
const boundaries = [testBoundary(1, [37.1, 127.1, 37.2, 127.2]), testBoundary(2, [37.3, 127.3, 37.4, 127.4])]
const props = { buildings: [], cards: [], cardBoundaries: boundaries, selectedBuildingId: 0, selectedCardId: '전체' as const, onSelectBuilding: vi.fn() }

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
