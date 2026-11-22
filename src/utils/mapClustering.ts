// 지도 마커 묶기 (클러스터링)
//
// 왜 따로 뺐나: 예전 방식은 건물을 두 겹으로 순회하며 모든 쌍의 거리를 쟀다.
// 건물 1,000개면 약 50만 번 거리 계산이고, 줌을 한 칸 움직일 때마다 다시 돈다.
// PC 구역 화면에서 [지도]를 누르면 눈에 띄게 멈추던 원인.
//
// 지금 방식: 지도를 threshold 크기의 격자로 나누고 같은 칸에 든 건물을 묶는다.
// 건물 수에 비례(1,000개면 1,000번)해서 끝나고, 눈으로 보이는 결과는 사실상 같다.

export type ClusterInput = { lat: number; lng: number }
export type Cluster<T extends ClusterInput> = { items: T[]; lat: number; lng: number }
export type MobileMapDetailLevel = 'region' | 'area' | 'building'
export type CoordinateBounds = {
  minLat: number
  maxLat: number
  minLng: number
  maxLng: number
}

const KM_PER_LAT_DEGREE = 111.32

/** 줌 단계별 묶는 거리(km). 0 이면 묶지 않고 건물 하나씩 표시한다. */
export function getClusterThresholdKm(zoom: number): number {
  if (zoom >= 17) return 0
  if (zoom >= 16) return 0.05
  if (zoom >= 15) return 0.1
  if (zoom >= 14) return 0.2
  if (zoom >= 13) return 0.4
  if (zoom >= 12) return 0.8
  return 1.5
}

/** 모바일 전체 지도에서 줌에 따라 구 → 동 → 건물로 자연스럽게 상세화한다. */
export function getMobileMapDetailLevel(zoom: number): MobileMapDetailLevel {
  if (zoom >= 16) return 'building'
  if (zoom >= 13) return 'area'
  return 'region'
}

/** 핀치 확대가 임계값 근처를 오갈 때 표시 단계가 연달아 뒤집히지 않게 한다. */
export function getNextMobileMapDetailLevel(
  current: MobileMapDetailLevel,
  zoom: number,
): MobileMapDetailLevel {
  if (current === 'building' && zoom >= 15) return 'building'
  if (current === 'area' && zoom >= 12 && zoom < 16) return 'area'
  return getMobileMapDetailLevel(zoom)
}

export function shouldRebuildMapMarkersOnIdle({
  dirty,
  zoom,
  hasAggregates,
  zoomChanged = false,
}: {
  dirty: boolean
  zoom: number
  hasAggregates: boolean
  zoomChanged?: boolean
}): boolean {
  return dirty && !hasAggregates && (zoomChanged || zoom >= 15)
}

/** 지도 화면과 구역선의 경계 상자가 겹치는지 확인한다. */
export function boundaryIntersectsBounds(
  points: ClusterInput[],
  bounds: CoordinateBounds,
): boolean {
  if (points.length === 0) return false

  let minLat = Number.POSITIVE_INFINITY
  let maxLat = Number.NEGATIVE_INFINITY
  let minLng = Number.POSITIVE_INFINITY
  let maxLng = Number.NEGATIVE_INFINITY

  for (const point of points) {
    minLat = Math.min(minLat, point.lat)
    maxLat = Math.max(maxLat, point.lat)
    minLng = Math.min(minLng, point.lng)
    maxLng = Math.max(maxLng, point.lng)
  }

  return !(
    maxLat < bounds.minLat ||
    minLat > bounds.maxLat ||
    maxLng < bounds.minLng ||
    minLng > bounds.maxLng
  )
}

export function clusterByGrid<T extends ClusterInput>(items: T[], thresholdKm: number): Cluster<T>[] {
  if (thresholdKm <= 0) {
    return items.map((item) => ({ items: [item], lat: item.lat, lng: item.lng }))
  }

  const latStep = thresholdKm / KM_PER_LAT_DEGREE
  const buckets = new Map<string, T[]>()

  for (const item of items) {
    const latCell = Math.floor(item.lat / latStep)
    // 경도 1도의 실제 거리는 위도가 높을수록 짧아진다 — 위도에 맞춰 칸 너비를 조정
    const kmPerLngDegree = KM_PER_LAT_DEGREE * Math.cos((item.lat * Math.PI) / 180)
    const lngStep = kmPerLngDegree > 0.001 ? thresholdKm / kmPerLngDegree : latStep
    const lngCell = Math.floor(item.lng / lngStep)
    const key = `${latCell}:${lngCell}`
    const bucket = buckets.get(key)
    if (bucket) bucket.push(item)
    else buckets.set(key, [item])
  }

  const clusters: Cluster<T>[] = []
  for (const bucket of buckets.values()) {
    let latSum = 0
    let lngSum = 0
    for (const item of bucket) {
      latSum += item.lat
      lngSum += item.lng
    }
    clusters.push({ items: bucket, lat: latSum / bucket.length, lng: lngSum / bucket.length })
  }
  return clusters
}
