import { describe, it, expect } from 'vitest'
import { boundaryIntersectsBounds, clusterByGrid, getClusterThresholdKm, getMobileMapDetailLevel, getNextMobileMapDetailLevel, shouldRebuildMapMarkersOnIdle } from './mapClustering'

const YONGIN = { lat: 37.2411, lng: 127.1776 }

function near(base: { lat: number; lng: number }, meters: number) {
  // 위도 방향으로 meters 만큼 떨어진 지점
  return { lat: base.lat + meters / 111320, lng: base.lng }
}

describe('getClusterThresholdKm', () => {
  it('많이 확대하면 묶지 않는다', () => {
    expect(getClusterThresholdKm(17)).toBe(0)
    expect(getClusterThresholdKm(20)).toBe(0)
  })

  it('줌이 낮을수록 더 넓게 묶는다', () => {
    expect(getClusterThresholdKm(16)).toBeLessThan(getClusterThresholdKm(14))
    expect(getClusterThresholdKm(14)).toBeLessThan(getClusterThresholdKm(11))
  })
})

describe('getMobileMapDetailLevel', () => {
  it('확대 수준에 따라 구, 동, 건물 순서로 상세화한다', () => {
    expect(getMobileMapDetailLevel(12)).toBe('region')
    expect(getMobileMapDetailLevel(13)).toBe('area')
    expect(getMobileMapDetailLevel(15)).toBe('area')
    expect(getMobileMapDetailLevel(16)).toBe('building')
  })

  it('경계에서 한 단계 완충해 표시가 반복 전환되지 않는다', () => {
    expect(getNextMobileMapDetailLevel('area', 16)).toBe('building')
    expect(getNextMobileMapDetailLevel('building', 15)).toBe('building')
    expect(getNextMobileMapDetailLevel('building', 14)).toBe('area')
    expect(getNextMobileMapDetailLevel('area', 12)).toBe('area')
    expect(getNextMobileMapDetailLevel('area', 11)).toBe('region')
  })
})

describe('clusterByGrid', () => {
  it('묶지 않는 단계에서는 건물 하나당 마커 하나', () => {
    const items = [YONGIN, near(YONGIN, 10), near(YONGIN, 20)]
    const clusters = clusterByGrid(items, 0)
    expect(clusters).toHaveLength(3)
    expect(clusters.every((c) => c.items.length === 1)).toBe(true)
  })

  it('가까운 건물끼리 묶인다', () => {
    const items = [YONGIN, near(YONGIN, 5), near(YONGIN, 10)]
    const clusters = clusterByGrid(items, 1)
    expect(clusters).toHaveLength(1)
    expect(clusters[0].items).toHaveLength(3)
  })

  it('멀리 떨어진 건물은 따로 묶인다', () => {
    const items = [YONGIN, near(YONGIN, 5000)]
    const clusters = clusterByGrid(items, 0.2)
    expect(clusters).toHaveLength(2)
  })

  it('묶인 위치는 속한 건물들의 평균', () => {
    const a = { lat: 37.2, lng: 127.1 }
    const b = { lat: 37.2002, lng: 127.1002 }
    const [cluster] = clusterByGrid([a, b], 1)
    expect(cluster.lat).toBeCloseTo((a.lat + b.lat) / 2, 6)
    expect(cluster.lng).toBeCloseTo((a.lng + b.lng) / 2, 6)
  })

  it('건물이 하나도 없으면 마커도 없다', () => {
    expect(clusterByGrid([], 0.5)).toEqual([])
  })

  it('원래 항목을 그대로 담아 돌려준다 (건물 정보 유실 없음)', () => {
    const items = [
      { id: 1, lat: 37.2, lng: 127.1 },
      { id: 2, lat: 37.2001, lng: 127.1001 },
    ]
    const clusters = clusterByGrid(items, 1)
    const ids = clusters.flatMap((c) => c.items.map((i) => i.id)).sort()
    expect(ids).toEqual([1, 2])
  })

  it('건물이 많아도 모든 건물이 정확히 한 번씩 들어간다', () => {
    const items = Array.from({ length: 1000 }, (_, i) => ({
      id: i,
      lat: 37.2 + (i % 50) * 0.001,
      lng: 127.1 + Math.floor(i / 50) * 0.001,
    }))
    const clusters = clusterByGrid(items, 0.2)
    const total = clusters.reduce((sum, c) => sum + c.items.length, 0)
    expect(total).toBe(1000)
    expect(new Set(clusters.flatMap((c) => c.items.map((i) => i.id))).size).toBe(1000)
  })
})

describe('shouldRebuildMapMarkersOnIdle', () => {
  it('reclusters after a zoom below the viewport-culling threshold, but not for a low-zoom pan', () => {
    expect(shouldRebuildMapMarkersOnIdle({ dirty: true, zoom: 13, hasAggregates: false, zoomChanged: true })).toBe(true)
    expect(shouldRebuildMapMarkersOnIdle({ dirty: true, zoom: 13, hasAggregates: false, zoomChanged: false })).toBe(false)
    expect(shouldRebuildMapMarkersOnIdle({ dirty: true, zoom: 13, hasAggregates: true, zoomChanged: true })).toBe(false)
  })
  it('가까운 건물 단계에서 카메라가 실제로 움직였을 때만 갱신한다', () => {
    expect(shouldRebuildMapMarkersOnIdle({ dirty: true, zoom: 16, hasAggregates: false })).toBe(true)
    expect(shouldRebuildMapMarkersOnIdle({ dirty: false, zoom: 16, hasAggregates: false })).toBe(false)
    expect(shouldRebuildMapMarkersOnIdle({ dirty: true, zoom: 14, hasAggregates: false })).toBe(false)
    expect(shouldRebuildMapMarkersOnIdle({ dirty: true, zoom: 16, hasAggregates: true })).toBe(false)
  })
})

describe('boundaryIntersectsBounds', () => {
  const viewport = { minLat: 37, maxLat: 38, minLng: 127, maxLng: 128 }

  it('keeps a boundary that overlaps the viewport', () => {
    expect(boundaryIntersectsBounds([
      { lat: 37.2, lng: 126.9 },
      { lat: 37.2, lng: 127.2 },
      { lat: 37.4, lng: 127.2 },
    ], viewport)).toBe(true)
  })

  it('keeps a large boundary surrounding the viewport even when no vertex is inside', () => {
    expect(boundaryIntersectsBounds([
      { lat: 36, lng: 126 },
      { lat: 36, lng: 129 },
      { lat: 39, lng: 129 },
      { lat: 39, lng: 126 },
    ], viewport)).toBe(true)
  })

  it('drops a boundary completely outside the viewport', () => {
    expect(boundaryIntersectsBounds([
      { lat: 38.2, lng: 127.2 },
      { lat: 38.3, lng: 127.3 },
      { lat: 38.4, lng: 127.2 },
    ], viewport)).toBe(false)
  })
})
