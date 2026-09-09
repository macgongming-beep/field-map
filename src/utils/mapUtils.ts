import type { Building, BuildingStatus, CardBoundary, GeoPoint, TerritoryCard, TerritoryRegion } from '../types'
import { isForbiddenBuilding } from './buildingPin'

export function getBuildingStatus(building: Building): BuildingStatus {
  // ⚠ 판정은 utils/buildingPin 한 곳에 있다. 여기서 따로 보면 지도 핀과 목록이 어긋난다.
  if (isForbiddenBuilding(building)) return '방문금지'
  if (building.units.some(u => u.isRegularVisit)) return '정기방문'
  if (building.units.length > 0 && building.units.every(u => u.status !== '미방문' && u.status !== '부재')) return '방문완료'
  return '방문필요'
}

export function getCardName(cards: TerritoryCard[], cardId: number): string {
  return cards.find((card) => card.id === cardId)?.name ?? '카드 없음'
}

export function formatDisplayAddress(address: string): string {
  const normalized = address.replace(/\s+/g, ' ').trim()
  if (!normalized) return ''

  const tokens = normalized.split(' ')
  const roadIndex = tokens.findIndex((token) => /(로|길)\d*(번길)?$/.test(token) || /(로|길)\d*(번길)?/.test(token))
  if (roadIndex >= 0) {
    return tokens.slice(roadIndex).join(' ')
  }

  const lotIndex = tokens.findIndex((token) => /\d/.test(token))
  if (lotIndex > 0) {
    const start = Math.max(0, lotIndex - 1)
    return tokens.slice(start).join(' ')
  }

  return normalized
}

export function parseCoordinate(value: string): number {
  const text = value.trim()
  if (!text) return Number.NaN
  return Number(text.replace(',', '.'))
}

export function isValidMapCoordinate(lat: number, lng: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= 33 &&
    lat <= 39.5 &&
    lng >= 124 &&
    lng <= 132
  )
}

export function normalizeMapCoordinates(lat: number, lng: number): GeoPoint | null {
  if (isValidMapCoordinate(lat, lng)) return { lat, lng }
  if (isValidMapCoordinate(lng, lat)) return { lat: lng, lng: lat }
  return null
}

export function getMockPosition(
  buildings: Building[],
  building: Building,
): { left: number; top: number } {
  const latValues = buildings.map((item) => item.lat)
  const lngValues = buildings.map((item) => item.lng)
  const minLat = Math.min(...latValues)
  const maxLat = Math.max(...latValues)
  const minLng = Math.min(...lngValues)
  const maxLng = Math.max(...lngValues)
  const latRange = maxLat - minLat || 1
  const lngRange = maxLng - minLng || 1

  return {
    left: 12 + ((building.lng - minLng) / lngRange) * 76,
    top: 14 + (1 - (building.lat - minLat) / latRange) * 70,
  }
}

/**
 * Ray-casting point-in-polygon test.
 * Returns true if (lat, lng) is inside the polygon defined by `points`.
 */
export function pointInPolygon(lat: number, lng: number, points: GeoPoint[]): boolean {
  if (points.length < 3) return false
  let inside = false
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const yi = points[i].lat, xi = points[i].lng
    const yj = points[j].lat, xj = points[j].lng
    if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
      inside = !inside
    }
  }
  return inside
}

function polygonArea(points: GeoPoint[]): number {
  if (points.length < 3) return Number.POSITIVE_INFINITY
  let area = 0
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index]
    const next = points[(index + 1) % points.length]
    area += current.lng * next.lat - next.lng * current.lat
  }
  return Math.abs(area) / 2
}

/**
 * Find which card's boundary polygon contains the given coordinates.
 * Returns the matching cardId, or null if no boundary contains the point.
 * If multiple card boundaries overlap, the smallest polygon wins so detailed
 * cards take priority over broader parent/duplicate boundaries.
 */
export function findCardForCoordinates(
  lat: number,
  lng: number,
  cardBoundaries: CardBoundary[],
): number | null {
  const matches = cardBoundaries
    .filter((boundary) => boundary.points.length >= 3 && pointInPolygon(lat, lng, boundary.points))
    .map((boundary) => ({
      cardId: boundary.cardId,
      area: polygonArea(boundary.points),
    }))
    .sort((a, b) => a.area - b.area)

  return matches[0]?.cardId ?? null
}

/**
 * Return sorted area options for a given region.
 * Combines the caller's configured areas with actual card areas found in context.
 * '미배정' is always appended as the final option.
 */
export function getSortedAreaOptions(
  region: TerritoryRegion | '전체',
  areasByRegion: Record<TerritoryRegion, string[]>,
  cards: TerritoryCard[],
): string[] {
  // 1. 해당 필터 조건에 맞는 카드들의 실제 'area' 목록 추출
  const existingAreas = Array.from(
    new Set(
      cards
        .filter((c) => region === '전체' || c.region === region)
        .map((c) => c.area)
        .filter((a) => a && a !== '미배정'),
    ),
  )

  // 2. 구조 데이터에 정의된 동 목록과 합치기 (중복 제거)
  const definedAreas =
    region === '전체'
      ? Object.values(areasByRegion).flat()
      : areasByRegion[region as TerritoryRegion] ?? []

  const combined = Array.from(new Set([...definedAreas, ...existingAreas])).sort((a, b) =>
    a.localeCompare(b, 'ko'),
  )

  // 3. 마지막에 '미배정' 추가
  return [...combined, '미배정']
}
