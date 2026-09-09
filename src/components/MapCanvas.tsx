/* eslint-disable @typescript-eslint/no-explicit-any -- 네이버 지도 SDK(window.naver)는 공식 TS 타입이 없어 any 사용이 불가피함 */
import { useState, useEffect, useMemo, useRef } from 'react'
import type { MouseEvent } from 'react'
import type { Building, BuildingStatus, CardBoundary, GeoPoint, TerritoryCard } from '../types'
import { boundaryIntersectsBounds, clusterByGrid, getClusterThresholdKm, shouldRebuildMapMarkersOnIdle } from '../utils/mapClustering'
import { getBuildingStatus, getCardName, getMockPosition, isValidMapCoordinate } from '../utils/mapUtils'
import { getBuildingPin, BUILDING_STATUS_COLORS, TONE_COLORS } from '../utils/buildingPin'
import { INFORMAL_KIND_STYLE, informalKindSvgPath } from '../utils/informalKind'
import type { InformalKind } from '../types'
import { getCongregationProfile, getTerritoryBoundary } from '../lib/congregationProfile'
import { showToast } from '../lib/toast'
import { msg } from '../lib/msg'
import { stripRegionPrefix } from '../lib/regions'
import { removeStaleKeyedEntries, upsertKeyedEntry, type KeyedEntry } from '../utils/keyedReconciliation'

const STATUS_COLORS: Record<BuildingStatus, string> = BUILDING_STATUS_COLORS

// 핀은 **속(채움)과 테두리**를 따로 쓴다.
//   속   파랑 = 아직 가 볼 곳이 있다
//   테두리 = 왜 눈여겨봐야 하는지 (초록: 다 갔지만 세대 미확인 · 금색: 정기방문인데 갈 곳 남음)
// 예전에는 색 하나에 성격과 진행을 우겨넣어 **하나가 다른 하나를 가렸다.**
const NEED_FILL = STATUS_COLORS.방문필요

/**
 * 핀 하나의 색 두 개와 테두리 굵기.
 *
 * ⚠ 처음엔 '파란 속 + 얇은 색 테두리' 로 했는데 **실제 크기에서 안 보였다**
 *   (지도 위 핀은 26px 쯤이라 2px 테두리가 파랑에 먹힌다).
 *   대신 **속을 비운다** — 색보다 형태가 먼저 눈에 들어오고,
 *   "아직 안 채워졌다" 는 뜻도 그대로 맞는다. 채우면 꽉 찬 색이 된다.
 */
function pinColors(building: Building): { fill: string; ring: string; ringWidth: number } {
  const pin = getBuildingPin(building)
  if (pin.filled) return { fill: TONE_COLORS[pin.tone], ring: '#ffffff', ringWidth: 2 }
  if (pin.ring) return { fill: '#ffffff', ring: TONE_COLORS[pin.ring], ringWidth: 3 }
  return { fill: NEED_FILL, ring: '#ffffff', ringWidth: 2 }
}

function cssVar(name: string, fallback: string): string {
  return `var(${name}, ${fallback})`
}

function resolveCssColor(name: string, fallback: string): string {
  if (typeof window === 'undefined' || typeof document === 'undefined') return fallback
  const value = window.getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return value || fallback
}

function getMapPalette() {
  return {
    brand: resolveCssColor('--brand-700', '#4267a5'),
    info: resolveCssColor('--info-700', '#3b82f6'),
    accent: resolveCssColor('--accent-700', '#1f6b43'),
    danger: resolveCssColor('--danger-600', '#d73b4a'),
    cardDraft: '#ed9407',
    preview: '#f97316',
  }
}

function getBoundaryBox() {
  const boundary = getTerritoryBoundary()
  if (boundary.length === 0) {
    const { lat, lng } = getCongregationProfile().mapCenter
    return { minLng: lng - 0.01, maxLng: lng + 0.01, minLat: lat - 0.01, maxLat: lat + 0.01 }
  }
  return boundary.reduce(
    (box, [lng, lat]) => ({
      minLng: Math.min(box.minLng, lng),
      maxLng: Math.max(box.maxLng, lng),
      minLat: Math.min(box.minLat, lat),
      maxLat: Math.max(box.maxLat, lat),
    }),
    {
      minLng: Number.POSITIVE_INFINITY,
      maxLng: Number.NEGATIVE_INFINITY,
      minLat: Number.POSITIVE_INFINITY,
      maxLat: Number.NEGATIVE_INFINITY,
    },
  )
}

function getMockBoundaryPoints() {
  const box = getBoundaryBox()
  const lngRange = box.maxLng - box.minLng || 1
  const latRange = box.maxLat - box.minLat || 1

  return getTerritoryBoundary().map(([lng, lat]) => {
    const x = ((lng - box.minLng) / lngRange) * 100
    const y = (1 - (lat - box.minLat) / latRange) * 100
    return `${x.toFixed(2)},${y.toFixed(2)}`
  }).join(' ')
}

function getMockPolygonPoints(points: GeoPoint[]) {
  const box = getBoundaryBox()
  const lngRange = box.maxLng - box.minLng || 1
  const latRange = box.maxLat - box.minLat || 1

  return points.map(({ lng, lat }) => {
    const x = ((lng - box.minLng) / lngRange) * 100
    const y = (1 - (lat - box.minLat) / latRange) * 100
    return `${x.toFixed(2)},${y.toFixed(2)}`
  }).join(' ')
}

function getMockPoint(point: GeoPoint) {
  const box = getBoundaryBox()
  const lngRange = box.maxLng - box.minLng || 1
  const latRange = box.maxLat - box.minLat || 1

  return {
    x: ((point.lng - box.minLng) / lngRange) * 100,
    y: (1 - (point.lat - box.minLat) / latRange) * 100,
  }
}

function getMidPoint(start: GeoPoint, end: GeoPoint): GeoPoint {
  return {
    lat: (start.lat + end.lat) / 2,
    lng: (start.lng + end.lng) / 2,
  }
}

function getPointFromMockEvent(event: MouseEvent<HTMLDivElement>): GeoPoint {
  const rect = event.currentTarget.getBoundingClientRect()
  const x = Math.min(Math.max((event.clientX - rect.left) / rect.width, 0), 1)
  const y = Math.min(Math.max((event.clientY - rect.top) / rect.height, 0), 1)
  const box = getBoundaryBox()

  return {
    lng: box.minLng + (box.maxLng - box.minLng) * x,
    lat: box.maxLat - (box.maxLat - box.minLat) * y,
  }
}

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

// ── Clustering ─────────────────────────────────────────────────────────────
// 묶는 계산은 utils/mapClustering 으로 옮겼다.
// (예전엔 모든 건물 쌍의 거리를 재느라 1,000개 기준 약 50만 번 계산이 들어갔고,
//  줌을 한 칸 옮길 때마다 그걸 다시 했다 — 지도 진입이 느리던 주된 원인)

/** 지도에 찍을 비공식 장소. 지도는 이름과 좌표만 알면 된다 */
export type InformalPlacePin = { id: number; name: string; lat: number; lng: number; kind?: InformalKind }

type BuildingCluster = { buildings: Building[]; lat: number; lng: number }
export type MapAggregateMarker = {
  id: string
  label: string
  count: number
  unitCount: number
  houseCount: number
  shopCount: number
  lat: number
  lng: number
}

function clusterBuildings(buildings: Building[], zoom: number): BuildingCluster[] {
  const validBuildings = buildings.filter((building) => isValidMapCoordinate(Number(building.lat), Number(building.lng)))
  return clusterByGrid(validBuildings, getClusterThresholdKm(zoom))
    .map((cluster) => ({ buildings: cluster.items, lat: cluster.lat, lng: cluster.lng }))
}

function clusterMarkerHtml(count: number): string {
  const size = count >= 50 ? 52 : count >= 10 ? 44 : 36
  const fontSize = count >= 50 ? 16 : count >= 10 ? 15 : 14
  const clusterColor = '#334155'
  return `<div title="${count}개 건물" style="
    display:grid;
    width:${size}px;
    height:${size}px;
    place-items:center;
    transform:translateZ(0);
    backface-visibility:hidden;
    border:3px solid #ffffff;
    border-radius:999px;
    background:${clusterColor};
    box-shadow:0 4px 14px rgba(15,23,42,0.28);
    color:#ffffff;
    cursor:pointer;
    font-size:${fontSize}px;
    font-weight:700;
    font-family:sans-serif;
    user-select:none;
  ">${count}</div>`
}

function aggregateMarkerHtml(marker: MapAggregateMarker): string {
  const safeLabel = escapeAttr(marker.label)
  const safeTitle = escapeAttr(`${marker.label} · 건물 ${marker.count}개 · 세대 ${marker.unitCount}개`)
  return `<div title="${safeTitle}" style="
    display:flex;
    align-items:center;
    gap:7px;
    min-width:84px;
    max-width:128px;
    height:38px;
    padding:0 10px 0 12px;
    transform:translateZ(0);
    backface-visibility:hidden;
    border:1.5px solid rgba(0,0,0,0.10);
    border-radius:999px;
    background:rgba(255,255,255,0.92);
    box-shadow:0 2px 10px rgba(0,0,0,0.12);
    color:#37352F;
    cursor:pointer;
    font-family:sans-serif;
    user-select:none;
    box-sizing:border-box;
  ">
    <span style="
      min-width:0;
      overflow:hidden;
      text-overflow:ellipsis;
      white-space:nowrap;
      font-size:13px;
      font-weight:700;
      line-height:1;
    ">${safeLabel}</span>
    <strong style="
      flex:0 0 auto;
      display:grid;
      min-width:24px;
      height:24px;
      place-items:center;
      padding:0 6px;
      border-radius:999px;
      background:rgba(0,0,0,0.07);
      font-size:13px;
      font-weight:800;
      line-height:1;
      box-sizing:border-box;
    ">${marker.count}</strong>
  </div>`
}

function virtualPinHtml(label: string): string {
  const safe = label.replace(/</g, '&lt;').replace(/>/g, '&gt;')
  // 고정 너비 120px 컨테이너 → anchor Point(60, 35)와 정확히 대응
  // pointer-events:auto + cursor:pointer → 클릭 이벤트 정상 수신
  return `<div style="width:120px;display:flex;flex-direction:column;align-items:center;pointer-events:auto;cursor:pointer;">
    <div style="background:#f97316;color:#fff;font-size:12px;font-weight:700;padding:4px 8px;border-radius:8px;white-space:nowrap;box-shadow:0 2px 10px rgba(0,0,0,0.25);max-width:116px;overflow:hidden;text-overflow:ellipsis;text-align:center;">${safe}</div>
    <div style="width:0;height:0;border-left:7px solid transparent;border-right:7px solid transparent;border-top:9px solid #f97316;flex-shrink:0;pointer-events:none;"></div>
  </div>`
}

// 구역선 중앙 카드 라벨 — 짧은 이름(구/시 접두어 제거)
function shortCardLabel(name: string): string {
  return stripRegionPrefix(name)
}

// 점이 폴리곤 내부인지 (ring: [x=lng, y=lat][])
function pointInRing(x: number, y: number, ring: [number, number][]): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [ax, ay] = ring[i]
    const [bx, by] = ring[j]
    if ((ay > y) !== (by > y) && x < ((bx - ax) * (y - ay)) / (by - ay) + ax) inside = !inside
  }
  return inside
}

// 폴리곤 라벨 위치: 면적 가중 중심(centroid). 중심이 폴리곤 밖이면 bbox 중심으로 폴백.
// → 삐뚤어진/사다리꼴 구역에서도 라벨이 안쪽에 들어옴.
/** 비공식 장소 핀. 건물 핀과 색을 달리해 섞이지 않게 한다 */
/** 동선의 순서 표시. A, B, C … 26곳을 넘으면 숫자로 */

function informalMarkerHtml(name: string, kind: InformalKind = '비공식구역'): string {
  const safe = String(name ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .slice(0, 20)
  const color = INFORMAL_KIND_STYLE[kind]?.color ?? INFORMAL_KIND_STYLE.비공식구역.color
  // ⚠ 색만으로 나누지 않는다. 26px 에서는 형태가 색보다 먼저 보인다.
  const glyph = `<svg width="13" height="13" viewBox="0 0 24 24" fill="#fff" style="transform:rotate(45deg)">
      <path d="${informalKindSvgPath(kind)}"/></svg>`
  return `
    <div style="position:relative;transform:translateZ(0)">
      <div style="width:26px;height:26px;border-radius:50% 50% 50% 4px;transform:rotate(-45deg);
                  background:${color};border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.35);
                  display:flex;align-items:center;justify-content:center">${glyph}</div>
      <div style="position:absolute;left:31px;top:2px;white-space:nowrap;font-size:11.5px;font-weight:700;
                  color:#4b3a58;background:rgba(255,255,255,.88);padding:1px 5px;border-radius:4px">${safe}</div>
    </div>`
}

function boundaryLabelCenter(points: { lat: number; lng: number }[]): { lat: number; lng: number } | null {
  const pts = points.filter((p) => typeof p.lat === 'number' && typeof p.lng === 'number' && !isNaN(p.lat) && !isNaN(p.lng))
  if (pts.length === 0) return null
  const lats = pts.map((p) => p.lat)
  const lngs = pts.map((p) => p.lng)
  const bbox = { lat: (Math.min(...lats) + Math.max(...lats)) / 2, lng: (Math.min(...lngs) + Math.max(...lngs)) / 2 }
  if (pts.length < 3) return bbox

  const ring = pts.map((p) => [p.lng, p.lat] as [number, number])
  let area = 0, cx = 0, cy = 0
  for (let i = 0, n = ring.length; i < n; i++) {
    const [x0, y0] = ring[i]
    const [x1, y1] = ring[(i + 1) % n]
    const cross = x0 * y1 - x1 * y0
    area += cross
    cx += (x0 + x1) * cross
    cy += (y0 + y1) * cross
  }
  area *= 0.5
  if (Math.abs(area) < 1e-12) return bbox
  const centroid = { lng: cx / (6 * area), lat: cy / (6 * area) }
  return pointInRing(centroid.lng, centroid.lat, ring) ? centroid : bbox
}

// 구역 라벨 칩 HTML (클릭 통과 → 아래 폴리곤/지도가 받음)
function cardLabelHtml(text: string): string {
  const safe = text.replace(/</g, '&lt;').replace(/>/g, '&gt;')
  // 성능: backdrop-filter/box-shadow 는 안드로이드에서 드래그 시 매 프레임 리페인트 → 제거.
  // 대신 텍스트 그림자(halo)로 지도 위 가독성 확보 (리페인트 저렴).
  return `<div style="pointer-events:none;transform:translate(-50%,-50%);white-space:nowrap;
    background:rgba(255,255,255,0.5);color:#1A1A18;font-size:10px;font-weight:700;letter-spacing:-0.01em;
    padding:1px 5px;border-radius:7px;border:1px solid rgba(0,0,0,0.06);
    text-shadow:0 0 2px rgba(255,255,255,0.9);">${safe}</div>`
}

const CARD_LABEL_MIN_ZOOM = 15  // 이 줌 미만이면 라벨 숨김 (겹침 방지)

function previewPinHtml(): string {
  const infoColor = cssVar('--info-700', '#3b82f6')
  return `<div style="position:relative; width:40px; height:40px; display:flex; justify-content:center;">
            <div style="
              width: 26px;
              height: 26px;
              background: ${infoColor};
              border: 2.5px solid white;
              border-radius: 50% 50% 50% 0;
              box-sizing: border-box;
              transform: rotate(-45deg);
              box-shadow: 0 2px 6px rgba(0,0,0,0.3);
              display: flex;
              align-items: center;
              justify-content: center;
            ">
              <div style="
                width: 8px;
                height: 8px;
                background: white;
                border-radius: 50%;
                transform: rotate(45deg);
              "></div>
            </div>
          </div>`
}

// ── Individual marker (SVG image) ──────────────────────────────────────────
// 성능: HTML DOM 오버레이 대신 이미지 마커 → 안드로이드 드래그 시 리페인트 없이
// GPU 합성만. 모양은 markerHtml 의 CSS 핀과 픽셀 동일 (14px 티어드롭, 흰 테두리,
// 동일 그림자). 상태(color × dimmed)별 data URI 캐시.
const markerIconCache = new Map<string, string>()

function markerIconUrl(color: string, isDimmed: boolean, ring = '#ffffff', ringWidth = 2): string {
  const key = `${color}|${ring}|${ringWidth}|${isDimmed ? 1 : 0}`
  const cached = markerIconCache.get(key)
  if (cached) return cached
  // CSS: 14x14 박스 + border 2px(inside) = 외곽 14 → SVG: 12x12 path + stroke 2(centered) = 외곽 14
  // border-radius 50% 50% 50% 0 + rotate(-45deg) → 아래로 뾰족한 티어드롭 (rotate 로 동일 재현)
  // box-shadow 0 2px 6px rgba(15,23,42,0.26) → feDropShadow dy=2 stdDeviation=3
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40">` +
    `<defs><filter id="s" x="-50%" y="-50%" width="200%" height="200%">` +
    `<feDropShadow dx="0" dy="2" stdDeviation="3" flood-color="#0f172a" flood-opacity="0.26"/>` +
    `</filter></defs>` +
    `<g transform="rotate(-45 20 20)"${isDimmed ? ' opacity="0.38"' : ''} filter="url(#s)">` +
    `<path d="M14 26 L14 20 A6 6 0 0 1 20 14 A6 6 0 0 1 26 20 A6 6 0 0 1 20 26 Z" ` +
    `fill="${color}" stroke="${ring}" stroke-width="${ringWidth}"/></g></svg>`
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
  markerIconCache.set(key, url)
  return url
}

function markerTitle(building: Building, cards: TerritoryCard[]): string {
  const status = getBuildingStatus(building)
  const cardName = getCardName(cards, building.cardId)
  const hasRegularVisit = building.units.some((unit) => unit.isRegularVisit)
  const hasChineseNeedsReview = building.units.some((unit) => unit.isChinese && !unit.isRegularVisit)
  return `${building.name} · ${status} · ${cardName}${hasChineseNeedsReview ? ' · 중국어 사용자' : hasRegularVisit ? ' · 정기방문 있음' : ''}`
}

// ── Individual marker HTML (선택된 핀 전용 — 1개뿐이라 DOM 비용 무관) ────────

function markerHtml(
  building: Building,
  cards: TerritoryCard[],
  isSelected: boolean,
  isDimmed: boolean,
): string {
  const status = getBuildingStatus(building)
  // ⚠ **선택된 핀도 같은 판정을 써야 한다.** 예전에 여기만 옛 판정을 써서,
  //   테두리 핀을 누르면 초록·금색으로 바뀌어 버렸다 (실사용에서 바로 걸렸다).
  const { fill: color, ring: strokeColor, ringWidth } = pinColors(building)
  const cardName = getCardName(cards, building.cardId)
  const hasRegularVisit = building.units.some((unit) => unit.isRegularVisit)
  const hasChineseNeedsReview = building.units.some((unit) => unit.isChinese && !unit.isRegularVisit)
  const scale = isSelected ? 1.22 : 1
  const opacity = isDimmed ? 0.38 : 1
  const label = escapeAttr(`${building.name} · ${status} · ${cardName}${hasChineseNeedsReview ? ' · 중국어 사용자' : hasRegularVisit ? ' · 정기방문 있음' : ''}`)

  return `
    <div
      title="${label}"
      style="
        position: relative;
        cursor: pointer;
        opacity: ${opacity};
        transform: scale(${scale}) translateZ(0);
        backface-visibility: hidden;
        line-height: normal;
        width: 40px;
        height: 40px;
        display: flex;
        justify-content: center;
        align-items: center;
      "
    >
      <div style="
        width: 14px;
        height: 14px;
        background: ${color};
        border: ${ringWidth}px solid ${strokeColor};
        border-radius: 50% 50% 50% 0;
        box-sizing: border-box;
        transform: rotate(-45deg);
        box-shadow: ${isSelected ? '0 0 0 3px rgba(255,255,255,0.72), 0 3px 9px rgba(15,23,42,0.34)' : '0 2px 6px rgba(15,23,42,0.26)'};
        flex-shrink: 0;
      "></div>
    </div>
  `
}

// ── Naver Map Canvas ───────────────────────────────────────────────────────

function NaverMapCanvas({
  buildings,
  informalPlaces = [],
  onSelectInformal,
  informalShape,
  focusPoint,
  aggregateMarkers = [],
  cardBoundaries,
  cards,
  clientId,
  drawingBoundary,
  addingBuilding,
  editingBuildingLocation,
  previewPinLat,
  previewPinLng,
  virtualPinLat,
  virtualPinLng,
  virtualPinLabel,
  draftBoundaryPoints,
  selectedBuildingId,
  focusBuildingId,
  selectedCardId,
  selectedCardIds,
  onAddBoundaryPoint,
  onInsertBoundaryPoint,
  onRemoveBoundaryPoint,
  onSelectBuilding,
  onSelectAggregate,
  onZoomChange,
  onSelectCardBoundary,
  onUpdateBoundaryPoint,
  onMapRightClick,
  onMapClick,
  pickingPoint,
  onMapLongClick,
  highlightedCardIds,
  isMobile = false,
  bottomPadding,
  onToggleAddingBuilding,
  onOpenActionMenu,
  hideActionButton,
  onToggleDrawingBoundary: _onToggleDrawingBoundary,
  onLocationPermissionBlocked,
  onMovePreviewPin,
  onMoveBuilding,
  compact = false,
  cardColorMap,
  hideBuildingMarkers = false,
}: {
  buildings: Building[]
  informalPlaces?: InformalPlacePin[]
  onSelectInformal?: (id: number) => void
  /** 선택한 장소의 모양만 그린다. 전부 그리면 지도가 못 볼 지경이 된다 */
  informalShape?: { boundary?: GeoPoint[] | null; route?: GeoPoint[][] | null } | null
  /** 이 좌표로 지도를 옮긴다. 마커는 그리지 않는다 — 이미 그려진 핀을 보여 주려는 것이다 */
  focusPoint?: { lat: number; lng: number; zoom?: number | null } | null
  aggregateMarkers?: MapAggregateMarker[]
  cardBoundaries: CardBoundary[]
  cards: TerritoryCard[]
  clientId: string
  drawingBoundary: boolean
  addingBuilding?: boolean
  editingBuildingLocation?: boolean
  previewPinLat?: number | null
  previewPinLng?: number | null
  virtualPinLat?: number | null
  virtualPinLng?: number | null
  virtualPinLabel?: string
  draftBoundaryPoints: GeoPoint[]
  selectedBuildingId: number
  focusBuildingId?: number | null
  selectedCardId: number | '전체' | null
  selectedCardIds?: Set<number>
  onAddBoundaryPoint?: (point: GeoPoint) => void
  onInsertBoundaryPoint?: (index: number, point: GeoPoint) => void
  onRemoveBoundaryPoint?: (index: number) => void
  onSelectBuilding?: (id: number) => void
  onSelectAggregate?: (id: string) => void
  onZoomChange?: (zoom: number) => void
  onSelectCardBoundary?: (cardId: number) => void
  onUpdateBoundaryPoint?: (index: number, point: GeoPoint) => void
  onMapRightClick?: (lat: number, lng: number) => void
  onMapClick?: (lat: number, lng: number) => void
  /**
   * 건물 추가가 아니어도 지도 클릭을 받는다 (비공식 포인트 찍기 등).
   * ⚠ 예전에는 addingBuilding 일 때만 클릭을 들어서, 다른 모드에서는
   *   onMapClick 을 넘겨도 아무 일도 일어나지 않았다.
   */
  pickingPoint?: boolean
  onMapLongClick?: (lat: number, lng: number) => void
  highlightedCardIds?: Set<number>
  isMobile?: boolean
  bottomPadding?: number
  onToggleAddingBuilding?: (val: boolean) => void
  onOpenActionMenu?: () => void
  /** 비공식 장소를 보고 있을 때처럼 건물 작업이 뜻이 없는 화면에서 감춘다 */
  hideActionButton?: boolean
  onToggleDrawingBoundary?: (val: boolean) => void
  onLocationPermissionBlocked?: () => void
  onMovePreviewPin?: (lat: number, lng: number) => void
  onMoveBuilding?: (id: number, lat: number, lng: number) => void
  compact?: boolean
  cardColorMap?: Map<number, string>   // cardId → hex. 배정 색칠용 (팀별 색)
  hideBuildingMarkers?: boolean          // 배정 모드: 건물 핀 숨김, 폴리곤만
}) {
  const mapRef = useRef<HTMLDivElement | null>(null)
  const mapInstanceRef = useRef<any>(null)
  const markersRef = useRef<Map<string, KeyedEntry<any>>>(new Map())
  const viewportMarkersDirtyRef = useRef(false)
  const boundaryRef = useRef<any>(null)
  const cardPolygonsRef = useRef<Map<number, any>>(new Map())
  const cardLabelsRef = useRef<Map<number, any>>(new Map())  // 구역선 중앙 카드 라벨
  const draftBoundaryRef = useRef<any>(null)
  const draftPointMarkerRefs = useRef<any[]>([])
  const draftMidpointMarkerRefs = useRef<any[]>([])
  const clickListenerRef = useRef<any>(null)
  const scriptLoadedRef = useRef(false)
  // 지도가 준비됐다는 걸 '상태'로도 알린다. ref 만 쓰면 스크립트가 늦게 떴을 때
  // 이미 지나간 효과가 다시 돌지 않아 '지도만 뜨고 그 자리로 안 가는' 일이 생긴다
  const [mapReady, setMapReady] = useState(false)
  const hasFitBoundaryRef = useRef(false)
  // 건물을 지정해 들어온 직후, 화면 밖에서 카드 필터가 뒤늦게 세팅되며
  // 지도를 카드 범위로 끌고 가던 것을 막는다 (전체 → 구 → 건물 처럼 보이던 잔상)
  const suppressNextCardFitRef = useRef(false)
  // 건물을 지정해 들어왔는지 — 첫 자동 맞춤(전체 보기)을 건너뛰는 데 쓴다
  const mountedWithFocusRef = useRef(false)
  const prevSelectedBuildingIdRef = useRef(selectedBuildingId)
  const prevSelectedCardIdRef = useRef<number | '전체' | null>(selectedCardId)
  const prevHighlightedCardIdsSignatureRef = useRef('')
  const visibleBuildingSignatureRef = useRef('')
  const selectedCardIdRef = useRef<number | '전체' | null>(selectedCardId)
  selectedCardIdRef.current = selectedCardId
  const cardBoundariesRef = useRef(cardBoundaries)
  cardBoundariesRef.current = cardBoundaries
  const aggregateMarkersRef = useRef(aggregateMarkers)
  aggregateMarkersRef.current = aggregateMarkers
  const highlightedCardIdsRef = useRef(highlightedCardIds)
  highlightedCardIdsRef.current = highlightedCardIds
  const selectedCardIdsRef = useRef(selectedCardIds)
  selectedCardIdsRef.current = selectedCardIds
  const cardColorMapRef = useRef(cardColorMap)
  cardColorMapRef.current = cardColorMap
  const hideBuildingMarkersRef = useRef(hideBuildingMarkers)
  hideBuildingMarkersRef.current = hideBuildingMarkers

  const onMapRightClickRef = useRef(onMapRightClick)
  onMapRightClickRef.current = onMapRightClick
  const onMapClickRef = useRef(onMapClick)
  onMapClickRef.current = onMapClick
  const onMapLongClickRef = useRef(onMapLongClick)
  onMapLongClickRef.current = onMapLongClick

  // Stable refs for event callbacks (avoids stale closures in zoom_changed listener)
  const buildingsRef = useRef(buildings)
  buildingsRef.current = buildings
  const cardsRef = useRef(cards)
  cardsRef.current = cards
  const selectedBuildingIdRef2 = useRef(selectedBuildingId)
  selectedBuildingIdRef2.current = selectedBuildingId
  const focusBuildingIdRef = useRef(focusBuildingId)
  focusBuildingIdRef.current = focusBuildingId
  const addingBuildingRef = useRef(addingBuilding)
  addingBuildingRef.current = addingBuilding
  const editingBuildingLocationRef = useRef(editingBuildingLocation)
  editingBuildingLocationRef.current = editingBuildingLocation
  const onSelectBuildingRef = useRef(onSelectBuilding)
  onSelectBuildingRef.current = onSelectBuilding
  const onMoveBuildingRef = useRef(onMoveBuilding)
  onMoveBuildingRef.current = onMoveBuilding
  const onSelectAggregateRef = useRef(onSelectAggregate)
  onSelectAggregateRef.current = onSelectAggregate
  const onZoomChangeRef = useRef(onZoomChange)
  onZoomChangeRef.current = onZoomChange
  const onSelectCardBoundaryRef = useRef(onSelectCardBoundary)
  onSelectCardBoundaryRef.current = onSelectCardBoundary
  const previewMarkerRef = useRef<any>(null)
  // 비공식 봉사 장소 — 건물 마커와 다른 레이어다. 같이 관리하면
  // 건물 갱신(클러스터 재계산) 때마다 같이 지워졌다 다시 그려진다.
  const informalMarkersRef = useRef<any[]>([])
  const informalPlacesRef = useRef(informalPlaces)
  informalPlacesRef.current = informalPlaces
  const onSelectInformalRef = useRef(onSelectInformal)
  onSelectInformalRef.current = onSelectInformal
  const userLocationMarkerRef = useRef<any>(null)
  const previewPinLatRef = useRef(previewPinLat)
  previewPinLatRef.current = previewPinLat
  const previewPinLngRef = useRef(previewPinLng)
  previewPinLngRef.current = previewPinLng
  const virtualMarkerRef = useRef<any>(null)
  const virtualPinLatRef = useRef(virtualPinLat)
  virtualPinLatRef.current = virtualPinLat
  const virtualPinLngRef = useRef(virtualPinLng)
  virtualPinLngRef.current = virtualPinLng
  const virtualPinLabelRef = useRef(virtualPinLabel)
  virtualPinLabelRef.current = virtualPinLabel
  // 가상 핀: 최초 배치 시에만 지도 중심/줌 이동 (zoom_changed 때마다 리셋 방지)
  const lastVirtualPinPosRef = useRef<{ lat: number; lng: number } | null>(null)

  /**
   * 비공식 봉사 장소 핀. 건물과 색을 달리해 한눈에 구분되게 한다.
   * 건물 마커 재계산(줌마다 클러스터를 다시 묶는다)과 엮이면 안 되므로 따로 그린다.
   */
  const rebuildInformalMarkers = () => {
    const naver = (window as any).naver
    if (!naver?.maps || !mapInstanceRef.current) return

    informalMarkersRef.current.forEach((m) => m.setMap(null))
    informalMarkersRef.current = []

    for (const place of informalPlacesRef.current) {
      const lat = Number(place.lat)
      const lng = Number(place.lng)
      if (!isValidMapCoordinate(lat, lng)) continue
      const marker = new naver.maps.Marker({
        map: mapInstanceRef.current,
        position: new naver.maps.LatLng(lat, lng),
        icon: {
          content: informalMarkerHtml(place.name, place.kind),
          anchor: new naver.maps.Point(13, 30),
        },
        zIndex: 6,
      })
      naver.maps.Event.addListener(marker, 'click', () => {
        if (addingBuildingRef.current) return
        onSelectInformalRef.current?.(place.id)
      })
      informalMarkersRef.current.push(marker)
    }
  }

  const doRebuildMarkers = () => {
    // 데이터/표현 전환으로 즉시 최신 마커를 만들었다면 대기 중인 idle 작업은 중복이다.
    if (rebuildTimerRef.current !== null) {
      window.clearTimeout(rebuildTimerRef.current)
      rebuildTimerRef.current = null
    }
    const naver = (window as any).naver
    if (!naver?.maps || !mapInstanceRef.current) return

    viewportMarkersDirtyRef.current = false

    ;(window as any).__ctaMarkerClick = onSelectBuildingRef.current

    const nextMarkerKeys = new Set<string>()
    const upsertMarker = (key: string, signature: string, create: () => any) => {
      nextMarkerKeys.add(key)
      upsertKeyedEntry(markersRef.current, key, signature, create, (marker) => marker.setMap(null))
    }
    const removeUnusedMarkers = () => {
      removeStaleKeyedEntries(markersRef.current, nextMarkerKeys, (marker) => marker.setMap(null))
    }

    if (aggregateMarkersRef.current.length > 0) {
      aggregateMarkersRef.current.forEach((aggregate) => {
        if (!isValidMapCoordinate(Number(aggregate.lat), Number(aggregate.lng))) return
        const signature = [aggregate.lat, aggregate.lng, aggregate.label, aggregate.count, aggregate.unitCount, aggregate.houseCount, aggregate.shopCount].join(':')
        upsertMarker(`aggregate:${aggregate.id}`, signature, () => {
          const marker = new naver.maps.Marker({
            map: mapInstanceRef.current,
            position: new naver.maps.LatLng(aggregate.lat, aggregate.lng),
            icon: {
              content: aggregateMarkerHtml(aggregate),
              anchor: new naver.maps.Point(54, 21),
            },
            zIndex: 8,
          })
          naver.maps.Event.addListener(marker, 'click', () => {
            if (addingBuildingRef.current) return
            onSelectAggregateRef.current?.(aggregate.id)
          })
          return marker
        })
      })
      removeUnusedMarkers()
      return
    }

    // 배정 색칠 모드: 건물 핀 숨기고 폴리곤만
    if (hideBuildingMarkersRef.current) {
      removeUnusedMarkers()
      return
    }

    const zoom = mapInstanceRef.current.getZoom()
    // 가까이 확대했을 때 화면 밖 1,000여 건물까지 DOM 마커로 만들면 지도 이동이
    // 다시 무거워진다. 네이버 지도 권장 방식대로 현재 viewport 안의 건물만 그린다.
    const rawBounds = zoom >= 15 ? mapInstanceRef.current.getBounds() : null
    // 화면보다 조금 넓게 준비해 작은 팬마다 가장자리 핀이 생겼다 사라지지 않게 한다.
    const bounds = rawBounds?.getSW && rawBounds?.getNE
      ? (() => {
          const sw = rawBounds.getSW()
          const ne = rawBounds.getNE()
          const latPad = Math.abs(ne.lat() - sw.lat()) * 0.2
          const lngPad = Math.abs(ne.lng() - sw.lng()) * 0.2
          return new naver.maps.LatLngBounds(
            new naver.maps.LatLng(sw.lat() - latPad, sw.lng() - lngPad),
            new naver.maps.LatLng(ne.lat() + latPad, ne.lng() + lngPad),
          )
        })()
      : rawBounds
    const visibleBuildings = bounds?.hasLatLng
      ? buildingsRef.current.filter((building) => {
          if (!isValidMapCoordinate(Number(building.lat), Number(building.lng))) return false
          return bounds.hasLatLng(new naver.maps.LatLng(Number(building.lat), Number(building.lng)))
        })
      : buildingsRef.current
    const clusters = clusterBuildings(visibleBuildings, zoom)

    clusters.forEach((cluster) => {
      if (cluster.buildings.length === 1) {
        const building = cluster.buildings[0]
        const isSelected = building.id === selectedBuildingIdRef2.current
        const isDimmed =
          selectedCardIdRef.current !== null &&
          selectedCardIdRef.current !== '전체' &&
          building.cardId !== selectedCardIdRef.current
        const colors = pinColors(building)
        const title = markerTitle(building, cardsRef.current)
        const signature = [building.lat, building.lng, title, isSelected, isDimmed, !!editingBuildingLocationRef.current, colors.fill, colors.ring, colors.ringWidth].join(':')
        upsertMarker(`building:${building.id}`, signature, () => {
          // 일반 핀은 SVG 이미지, 선택된 핀(최대 1개)만 HTML을 쓴다.
          const marker = new naver.maps.Marker({
            map: mapInstanceRef.current,
            position: new naver.maps.LatLng(building.lat, building.lng),
            title,
            icon: isSelected
              ? {
                  content: markerHtml(building, cardsRef.current, isSelected, isDimmed),
                  anchor: new naver.maps.Point(20, 30),
                }
              : {
                  url: markerIconUrl(colors.fill, isDimmed, colors.ring, colors.ringWidth),
                  size: new naver.maps.Size(40, 40),
                  scaledSize: new naver.maps.Size(40, 40),
                  anchor: new naver.maps.Point(20, 30),
                },
            zIndex: isSelected ? 10 : isDimmed ? 0 : 1,
            draggable: !!editingBuildingLocationRef.current,
          })
          if (editingBuildingLocationRef.current) {
            naver.maps.Event.addListener(marker, 'dragend', (e: any) => {
              onMoveBuildingRef.current?.(building.id, e.coord.lat(), e.coord.lng())
            })
          }
          naver.maps.Event.addListener(marker, 'click', () => {
            if (addingBuildingRef.current) return
            onSelectBuildingRef.current?.(building.id)
          })
          return marker
        })
      } else {
        const count = cluster.buildings.length
        const size = count >= 50 ? 52 : count >= 10 ? 44 : 36
        const clusterIds = cluster.buildings.map((building) => building.id).sort((a, b) => a - b).join(',')
        const signature = [cluster.lat, cluster.lng, count, size].join(':')
        upsertMarker(`cluster:${clusterIds}`, signature, () => {
          const marker = new naver.maps.Marker({
            map: mapInstanceRef.current,
            position: new naver.maps.LatLng(cluster.lat, cluster.lng),
            icon: {
              content: clusterMarkerHtml(count),
              anchor: new naver.maps.Point(size / 2, size / 2),
            },
            zIndex: 5,
          })
          naver.maps.Event.addListener(marker, 'click', () => {
            if (addingBuildingRef.current) return
            const curZoom = mapInstanceRef.current.getZoom()
            mapInstanceRef.current.setCenter(new naver.maps.LatLng(cluster.lat, cluster.lng))
            mapInstanceRef.current.setZoom(Math.min(curZoom + 3, 20))
          })
          return marker
        })
      }
    })

    removeUnusedMarkers()

    // Preview pin for building add mode
    if (previewMarkerRef.current) {
      previewMarkerRef.current.setMap(null)
      previewMarkerRef.current = null
    }
    const pLat = previewPinLatRef.current
    const pLng = previewPinLngRef.current
    if (pLat != null && pLng != null && !isNaN(pLat) && !isNaN(pLng)) {
      previewMarkerRef.current = new naver.maps.Marker({
        map: mapInstanceRef.current,
        position: new naver.maps.LatLng(pLat, pLng),
        icon: {
          content: previewPinHtml(),
          anchor: new naver.maps.Point(20, 38),
        },
        zIndex: 100,
        draggable: true,
      })
      naver.maps.Event.addListener(previewMarkerRef.current, 'dragend', (e: any) => {
        onMovePreviewPin?.(e.coord.lat(), e.coord.lng())
      })
    }

    // Virtual pin (정기방문 수동 주소 핀)
    if (virtualMarkerRef.current) {
      virtualMarkerRef.current.setMap(null)
      virtualMarkerRef.current = null
    }
    const vLat = virtualPinLatRef.current
    const vLng = virtualPinLngRef.current
    const vLabel = virtualPinLabelRef.current
    if (vLat != null && vLng != null && !isNaN(vLat) && !isNaN(vLng)) {
      virtualMarkerRef.current = new naver.maps.Marker({
        map: mapInstanceRef.current,
        position: new naver.maps.LatLng(vLat, vLng),
        icon: {
          content: virtualPinHtml(vLabel ?? ''),
          anchor: new naver.maps.Point(60, 35), // 120px 컨테이너 중앙, 삼각형 끝
        },
        zIndex: 200,
        draggable: false,
      })
      // 클릭 시 핀 위치로 부드럽게 줌인
      naver.maps.Event.addListener(virtualMarkerRef.current, 'click', () => {
        const curZoom = mapInstanceRef.current.getZoom()
        const targetZoom = curZoom >= 17 ? 19 : 17
        mapInstanceRef.current.morph(new naver.maps.LatLng(vLat, vLng), targetZoom)
      })
      // 위치가 바뀐 경우에만 지도 중심/줌 이동 (zoom_changed 때마다 17로 리셋되는 버그 방지)
      const prev = lastVirtualPinPosRef.current
      if (!prev || prev.lat !== vLat || prev.lng !== vLng) {
        lastVirtualPinPosRef.current = { lat: vLat, lng: vLng }
        mapInstanceRef.current.setCenter(new naver.maps.LatLng(vLat, vLng))
        mapInstanceRef.current.setZoom(17)
      }
    } else {
      lastVirtualPinPosRef.current = null
    }
  }

  // Stable ref so zoom_changed listener always calls the latest version
  const rebuildMarkersCallbackRef = useRef(doRebuildMarkers)
  rebuildMarkersCallbackRef.current = doRebuildMarkers

  // 줌은 한 번 조작에 여러 단계가 연속으로 들어온다 — 단계마다 마커를 전부
  // 지웠다 다시 만들면 화면이 멈춘다. 마지막 단계에서 한 번만 다시 그린다.
  const rebuildTimerRef = useRef<number | null>(null)
  const scheduleRebuildMarkers = () => {
    if (rebuildTimerRef.current !== null) window.clearTimeout(rebuildTimerRef.current)
    rebuildTimerRef.current = window.setTimeout(() => {
      rebuildTimerRef.current = null
      rebuildMarkersCallbackRef.current()
      syncCardBoundariesRef.current()
    }, 120)
  }
  const scheduleRebuildMarkersRef = useRef(scheduleRebuildMarkers)
  scheduleRebuildMarkersRef.current = scheduleRebuildMarkers
  useEffect(() => () => {
    if (rebuildTimerRef.current !== null) window.clearTimeout(rebuildTimerRef.current)
  }, [])
  // 카드 라벨 줌 토글용 stable ref (정의는 아래, 할당은 매 렌더)
  const updateCardLabelVisibilityRef = useRef<() => void>(() => {})
  const syncCardBoundariesRef = useRef<() => void>(() => {})

  const rebuildMarkers = () => rebuildMarkersCallbackRef.current()
 
  const getFitMargin = () => {
    if (compact) return [24, 24, 24, 24]
    if (!isMobile) return [80, 80, 80, 80]
    // 모바일에서는 바텀 시트 높이에 따라 하단 여백 가변 적용
    // 상단 여백은 헤더(~56) + stats sub 행 정도만 비우면 됨 — 과도하게 잡으면 경계선 짤림
    const bp = bottomPadding ?? 450
    return [90, 24, bp + 16, 24]
  }
 
  const fitTerritoryBoundary = () => {
    const naver = (window as any).naver
    const territoryBoundary = getTerritoryBoundary()
    if (!naver?.maps || !mapInstanceRef.current || territoryBoundary.length === 0) return
    const bounds = new naver.maps.LatLngBounds(
      new naver.maps.LatLng(territoryBoundary[0][1], territoryBoundary[0][0]),
      new naver.maps.LatLng(territoryBoundary[0][1], territoryBoundary[0][0]),
    )
    territoryBoundary.forEach((p) => bounds.extend(new naver.maps.LatLng(p[1], p[0])))
    mapInstanceRef.current.fitBounds(bounds, { margin: getFitMargin() })
  }

  const getHighlightedCardIdsSignature = (ids?: Set<number>) =>
    ids ? [...ids].sort((a, b) => a - b).join(',') : ''

  const fitBoundaryPoints = (points: GeoPoint[]) => {
    const naver = (window as any).naver
    if (!naver?.maps || !mapInstanceRef.current) return false

    const latValues = points.map((p) => p.lat).filter((v) => typeof v === 'number' && !isNaN(v))
    const lngValues = points.map((p) => p.lng).filter((v) => typeof v === 'number' && !isNaN(v))
    if (latValues.length === 0 || lngValues.length === 0) return false

    const minLat = Math.min(...latValues)
    const maxLat = Math.max(...latValues)
    const minLng = Math.min(...lngValues)
    const maxLng = Math.max(...lngValues)
    const bounds = new naver.maps.LatLngBounds(
      new naver.maps.LatLng(minLat, minLng),
      new naver.maps.LatLng(maxLat, maxLng),
    )
    mapInstanceRef.current.fitBounds(bounds, { margin: getFitMargin() })
    return true
  }

  const fitHighlightedBoundaries = (ids?: Set<number>) => {
    const hIds = ids || new Set<number>()
    const highlightedBoundaries = cardBoundaries.filter((boundary) => hIds.has(boundary.cardId))
    if (highlightedBoundaries.length === 0) return false
    return fitBoundaryPoints(highlightedBoundaries.flatMap((boundary) => boundary.points))
  }

  const fitVisibleBuildings = (reason: 'data' | 'card' = 'data') => {
    const naver = (window as any).naver
    if (!naver?.maps || !mapInstanceRef.current) return false

    if (aggregateMarkersRef.current.length > 0) {
      const visibleAggregates = aggregateMarkersRef.current.filter((marker) =>
        isValidMapCoordinate(Number(marker.lat), Number(marker.lng)),
      )
      if (visibleAggregates.length === 0) return false
      if (visibleAggregates.length === 1) {
        const marker = visibleAggregates[0]
        mapInstanceRef.current.morph(new naver.maps.LatLng(Number(marker.lat), Number(marker.lng)), reason === 'card' ? 13 : 12)
        return true
      }
      const bounds = new naver.maps.LatLngBounds(
        new naver.maps.LatLng(Number(visibleAggregates[0].lat), Number(visibleAggregates[0].lng)),
        new naver.maps.LatLng(Number(visibleAggregates[0].lat), Number(visibleAggregates[0].lng)),
      )
      visibleAggregates.forEach((marker) => {
        bounds.extend(new naver.maps.LatLng(Number(marker.lat), Number(marker.lng)))
      })
      mapInstanceRef.current.fitBounds(bounds, { margin: getFitMargin() })
      return true
    }

    const visibleBuildings = buildingsRef.current.filter((building) => {
      const lat = Number(building.lat)
      const lng = Number(building.lng)
      if (!isValidMapCoordinate(lat, lng)) return false
      if (selectedCardIdRef.current !== null && selectedCardIdRef.current !== '전체') {
        return building.cardId === selectedCardIdRef.current
      }
      return true
    })

    if (visibleBuildings.length === 0) return false

    if (visibleBuildings.length === 1) {
      const building = visibleBuildings[0]
      mapInstanceRef.current.morph(new naver.maps.LatLng(Number(building.lat), Number(building.lng)), reason === 'card' ? 16 : 15)
      return true
    }

    const bounds = new naver.maps.LatLngBounds(
      new naver.maps.LatLng(Number(visibleBuildings[0].lat), Number(visibleBuildings[0].lng)),
      new naver.maps.LatLng(Number(visibleBuildings[0].lat), Number(visibleBuildings[0].lng)),
    )
    visibleBuildings.forEach((building) => {
      bounds.extend(new naver.maps.LatLng(Number(building.lat), Number(building.lng)))
    })
    mapInstanceRef.current.fitBounds(bounds, { margin: getFitMargin() })
    return true
  }

  const focusBuildingOnMap = (buildingId?: number | null) => {
    if (!buildingId) return false
    const naver = (window as any).naver
    if (!naver?.maps || !mapInstanceRef.current) return false
    const building = buildingsRef.current.find((item) => item.id === buildingId)
    if (!building) return false
    const lat = Number(building.lat)
    const lng = Number(building.lng)
    if (!isValidMapCoordinate(lat, lng)) return false
    mapInstanceRef.current.morph(new naver.maps.LatLng(lat, lng), 17)
    return true
  }

  const toggleSatellite = () => {
    const naver = (window as any).naver
    if (!mapInstanceRef.current || !naver) return
    const current = mapInstanceRef.current.getMapTypeId()
    const satellite = naver.maps.MapTypeId.SATELLITE
    const normal = naver.maps.MapTypeId.NORMAL
    mapInstanceRef.current.setMapTypeId(current === satellite ? normal : satellite)
  }

  const handleZoom = (delta: number) => {
    if (!mapInstanceRef.current) return
    mapInstanceRef.current.setZoom(mapInstanceRef.current.getZoom() + delta)
  }

  const handleGPS = () => {
    if (!mapInstanceRef.current || !navigator.geolocation) {
      showToast(msg('GPS를 사용할 수 없는 환경입니다.'), 'error')
      return
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const naver = (window as any).naver
        if (!naver?.maps) return
        const lat = pos.coords.latitude
        const lng = pos.coords.longitude
        const latLng = new naver.maps.LatLng(lat, lng)

        // 네이버지도 스타일: 파란 원 + 흰 테두리 (펄스 애니메이션)
        const html = `
          <div style="position:relative;width:22px;height:22px;">
            <div style="position:absolute;inset:0;border-radius:50%;background:rgba(46,109,255,0.18);animation:userLocPulse 1.6s ease-out infinite;"></div>
            <div style="position:absolute;inset:5px;border-radius:50%;background:#2e6dff;border:2.5px solid #ffffff;box-shadow:0 1px 4px rgba(0,0,0,0.35);"></div>
          </div>
        `
        if (userLocationMarkerRef.current) {
          userLocationMarkerRef.current.setPosition(latLng)
        } else {
          userLocationMarkerRef.current = new naver.maps.Marker({
            position: latLng,
            map: mapInstanceRef.current,
            icon: {
              content: html,
              size: new naver.maps.Size(22, 22),
              anchor: new naver.maps.Point(11, 11),
            },
            zIndex: 999,
          })
        }
        mapInstanceRef.current.morph(latLng, 16)
      },
      (error) => {
        if (error.code === error.PERMISSION_DENIED) {
          onLocationPermissionBlocked?.()
          return
        }
        showToast(msg('위치 정보를 가져올 수 없습니다.'), 'error')
      },
    )
  }

  const updatePolygonStyles = () => {
    const naver = (window as any).naver
    if (!naver?.maps || !mapInstanceRef.current) return
    const palette = getMapPalette()

    const currentCardId = selectedCardIdRef.current
    const hIds = highlightedCardIdsRef.current || new Set()
    const selectedIds = selectedCardIdsRef.current

    const colorMap = cardColorMapRef.current

    cardPolygonsRef.current.forEach((polygon, cardId) => {
      const isVisible = !(drawingBoundary && cardId === currentCardId)

      // ── 배정 색칠 모드 (cardColorMap 있으면 우선) ──
      if (colorMap) {
        const teamColor = colorMap.get(cardId)
        if (teamColor) {
          // 팀 배정된 구역 — 팀색으로 채움 (파스텔이라 채도 보강)
          polygon.setOptions({
            fillColor: teamColor,
            fillOpacity: 0.45,
            strokeColor: teamColor,
            strokeOpacity: 1,
            strokeWeight: 3,
            strokeStyle: 'solid',
            zIndex: 25,
            map: isVisible ? mapInstanceRef.current : null,
            clickable: !addingBuilding,
          })
        } else {
          // 미배정 담당 구역 — 잘 보이게 (연한 채움 + 또렷한 실선 테두리)
          polygon.setOptions({
            fillColor: '#5b6b7c',
            fillOpacity: 0.10,
            strokeColor: '#5b6b7c',
            strokeOpacity: 0.85,
            strokeWeight: 2.5,
            strokeStyle: 'solid',
            zIndex: 8,
            map: isVisible ? mapInstanceRef.current : null,
            clickable: !addingBuilding,
          })
        }
        return
      }

      // ── 기존 단색 강조 모드 ──
      const isSelected =
        selectedIds && selectedIds.size > 0
          ? selectedIds.has(cardId)
        : currentCardId === '전체'
          ? hIds.has(cardId)
          : cardId === currentCardId

      polygon.setOptions({
        fillColor: isSelected ? '#5D5B54' : palette.cardDraft,
        fillOpacity: isSelected ? 0.10 : 0.05,
        strokeColor: isSelected ? '#5D5B54' : palette.cardDraft,
        strokeOpacity: isSelected ? 0.85 : 0.5,
        strokeWeight: isSelected ? 3 : 2,
        strokeStyle: isSelected ? 'solid' : 'shortdash',
        zIndex: isSelected ? 20 : 5,
        map: isVisible ? mapInstanceRef.current : null,
        clickable: !addingBuilding,
      })
    })
  }

  // 구역선 하나를 지도에 올린다 (폴리곤)
  const createBoundaryPolygon = (boundary: CardBoundary) => {
    const naver = (window as any).naver
    if (!naver?.maps || !mapInstanceRef.current) return
    if (cardPolygonsRef.current.has(boundary.cardId)) return
    if (!boundary.points || boundary.points.length < 3) return
    const palette = getMapPalette()
    try {
      const polygon = new naver.maps.Polygon({
        map: mapInstanceRef.current,
        paths: boundary.points.map(({ lat, lng }) => {
          if (typeof lat !== 'number' || typeof lng !== 'number') {
            throw new Error(`Invalid point: ${lat}, ${lng}`)
          }
          return new naver.maps.LatLng(lat, lng)
        }),
        fillColor: palette.cardDraft,
        fillOpacity: 0.08,
        strokeColor: palette.cardDraft,
        strokeOpacity: 0.55,
        strokeWeight: 2,
        strokeStyle: 'shortdash',
        clickable: !addingBuilding,
      })

      naver.maps.Event.addListener(polygon, 'click', () => {
        onSelectCardBoundaryRef.current?.(boundary.cardId)
      })
      naver.maps.Event.addListener(polygon, 'rightclick', (event: any) => {
        onMapRightClickRef.current?.(event.coord.lat(), event.coord.lng())
      })

      cardPolygonsRef.current.set(boundary.cardId, polygon)
    } catch (err) {
      console.error(`Error creating polygon for card ${boundary.cardId}:`, err)
    }
  }

  // 카드 이름 라벨 — 확대해야 보이므로, 보일 때가 되면 그때 만든다
  // (600개를 미리 만들어 두면 지도 진입에서 그대로 시간을 잡아먹는다)
  const createBoundaryLabel = (boundary: CardBoundary) => {
    const naver = (window as any).naver
    if (!naver?.maps || !mapInstanceRef.current) return
    if (cardLabelsRef.current.has(boundary.cardId)) return
    const center = boundaryLabelCenter(boundary.points)
    const card = cardsRef.current.find((c) => c.id === boundary.cardId)
    const text = card ? shortCardLabel(card.name) : ''
    if (!center || !text) return
    try {
      const labelMarker = new naver.maps.Marker({
        position: new naver.maps.LatLng(center.lat, center.lng),
        map: mapInstanceRef.current,
        icon: { content: cardLabelHtml(text), anchor: new naver.maps.Point(0, 0) },
        clickable: false,
        zIndex: 50,
      })
      cardLabelsRef.current.set(boundary.cardId, labelMarker)
    } catch (err) {
      console.error(`Error creating label for card ${boundary.cardId}:`, err)
    }
  }

  // 남은 구역선을 조금씩 나눠서 올린다 — 한 번에 다 만들면 지도가 그동안 멈춘다
  const boundaryQueueRef = useRef<CardBoundary[]>([])
  const boundaryChunkTimerRef = useRef<number | null>(null)
  const cancelBoundaryQueue = () => {
    if (boundaryChunkTimerRef.current !== null) {
      window.cancelAnimationFrame(boundaryChunkTimerRef.current)
      boundaryChunkTimerRef.current = null
    }
    boundaryQueueRef.current = []
  }
  const drainBoundaryQueueRef = useRef<() => void>(() => {})
  drainBoundaryQueueRef.current = () => {
    const CHUNK = 40
    const chunk = boundaryQueueRef.current.splice(0, CHUNK)
    chunk.forEach(createBoundaryPolygon)
    // 스타일 정리는 끝나고 한 번만 — 조각마다 전체를 다시 칠하면 그게 또 부담이다
    if (boundaryQueueRef.current.length > 0) {
      boundaryChunkTimerRef.current = window.requestAnimationFrame(() => drainBoundaryQueueRef.current())
    } else {
      boundaryChunkTimerRef.current = null
      updatePolygonStyles()
      updateCardLabelVisibility()
    }
  }

  useEffect(() => () => cancelBoundaryQueue(), [])

  const syncCardBoundaries = () => {
    const naver = (window as any).naver
    if (!naver?.maps || !mapInstanceRef.current) return

    const zoom = mapInstanceRef.current.getZoom()
    // 가까이 확대했을 때는 모바일과 PC 모두 화면 주변 구역선만 유지한다.
    // PC만 600여 폴리곤을 계속 그리던 탓에 줌·팬마다 SVG 갱신이 끊겼다.
    const rawBounds = zoom >= 15
      ? mapInstanceRef.current.getBounds?.()
      : null
    const visibleBoundaries = rawBounds?.getSW && rawBounds?.getNE
      ? (() => {
          const sw = rawBounds.getSW()
          const ne = rawBounds.getNE()
          const latPad = Math.abs(ne.lat() - sw.lat()) * 0.25
          const lngPad = Math.abs(ne.lng() - sw.lng()) * 0.25
          const bounds = {
            minLat: sw.lat() - latPad,
            maxLat: ne.lat() + latPad,
            minLng: sw.lng() - lngPad,
            maxLng: ne.lng() + lngPad,
          }
          return cardBoundariesRef.current.filter((boundary) =>
            boundaryIntersectsBounds(boundary.points, bounds),
          )
        })()
      : cardBoundariesRef.current

    const currentMap = cardPolygonsRef.current
    const labelMap = cardLabelsRef.current
    const boundaryIds = new Set(visibleBoundaries.map((b) => b.cardId))

    currentMap.forEach((polygon, cardId) => {
      if (!boundaryIds.has(cardId)) {
        polygon.setMap(null)
        currentMap.delete(cardId)
      }
    })
    // 사라진 경계의 라벨 제거
    labelMap.forEach((label, cardId) => {
      if (!boundaryIds.has(cardId)) {
        label.setMap(null)
        labelMap.delete(cardId)
      }
    })

    cancelBoundaryQueue()
    const pending = visibleBoundaries.filter((b) => !currentMap.has(b.cardId))

    // 지도 가운데에 가까운 것부터 — 보고 있는 곳이 먼저 채워진다
    const center = mapInstanceRef.current.getCenter?.()
    if (center && pending.length > 1) {
      const cLat = center.lat()
      const cLng = center.lng()
      pending.sort((a, b) => {
        const pa = a.points?.[0]
        const pb = b.points?.[0]
        if (!pa || !pb) return 0
        const da = (pa.lat - cLat) ** 2 + (pa.lng - cLng) ** 2
        const db = (pb.lat - cLat) ** 2 + (pb.lng - cLng) ** 2
        return da - db
      })
    }

    const FIRST_BATCH = 40
    pending.slice(0, FIRST_BATCH).forEach(createBoundaryPolygon)
    boundaryQueueRef.current = pending.slice(FIRST_BATCH)

    updatePolygonStyles()
    updateCardLabelVisibility()

    if (boundaryQueueRef.current.length > 0 && boundaryChunkTimerRef.current === null) {
      boundaryChunkTimerRef.current = window.requestAnimationFrame(() => drainBoundaryQueueRef.current())
    }
  }
  syncCardBoundariesRef.current = syncCardBoundaries

  // 줌 레벨에 따라 카드 라벨 표시/숨김 (겹침 방지)
  const updateCardLabelVisibility = () => {
    if (!mapInstanceRef.current) return
    const show = mapInstanceRef.current.getZoom() >= CARD_LABEL_MIN_ZOOM
    if (show) {
      // 아직 안 만든 라벨은 이때 만든다 (숨겨진 라벨을 미리 만들지 않는다)
      cardBoundariesRef.current.forEach((boundary) => {
        if (cardPolygonsRef.current.has(boundary.cardId)) createBoundaryLabel(boundary)
      })
    }
    cardLabelsRef.current.forEach((label) => {
      const onMap = !!label.getMap()
      if (show && !onMap) label.setMap(mapInstanceRef.current)
      else if (!show && onMap) label.setMap(null)
    })
  }
  updateCardLabelVisibilityRef.current = updateCardLabelVisibility

  const rebuildDraftBoundary = () => {
    const naver = (window as any).naver
    if (!naver?.maps || !mapInstanceRef.current) return
    const palette = getMapPalette()

    if (draftBoundaryRef.current) {
      draftBoundaryRef.current.setMap(null)
      draftBoundaryRef.current = null
    }
    draftPointMarkerRefs.current.forEach((marker) => marker.setMap(null))
    draftPointMarkerRefs.current = []
    draftMidpointMarkerRefs.current.forEach((marker) => marker.setMap(null))
    draftMidpointMarkerRefs.current = []
    if (draftBoundaryPoints.length === 0) return

    const path = draftBoundaryPoints.map(({ lat, lng }) => new naver.maps.LatLng(lat, lng))
    const common = {
      map: mapInstanceRef.current,
      paths: path,
      strokeColor: palette.info,
      strokeOpacity: 0.95,
      strokeWeight: 2,
      strokeStyle: 'solid',
    }

    draftBoundaryRef.current =
      draftBoundaryPoints.length >= 3
        ? new naver.maps.Polygon({
            ...common,
            fillColor: palette.info,
            fillOpacity: 0.12,
          })
        : new naver.maps.Polyline({ ...common, path })

    draftBoundaryPoints.forEach((point, index) => {
      const marker = new naver.maps.Marker({
        map: mapInstanceRef.current,
        position: new naver.maps.LatLng(point.lat, point.lng),
        draggable: true,
        icon: {
          content: `
            <div
              title="드래그로 이동, 우클릭으로 삭제"
              style="
                width: 14px;
                height: 14px;
                border: 2px solid #ffffff;
                border-radius: 50%;
                background: ${palette.info};
                box-shadow: 0 1px 4px rgba(0,0,0,0.3);
                cursor: grab;
                box-sizing: border-box;
                padding: 0;
                margin: 0;
              "
            ></div>
          `,
          anchor: new naver.maps.Point(7, 7),
        },
        zIndex: 30,
      })
      naver.maps.Event.addListener(marker, 'drag', (event: any) => {
        if (!draftBoundaryRef.current) return
        try {
          const isPolygon = draftBoundaryPoints.length >= 3
          const path = isPolygon
            ? (draftBoundaryRef.current as any).getPaths().getAt(0)
            : (draftBoundaryRef.current as any).getPath()
          path.setAt(index, event.coord)
        } catch {
          // ignore
        }
      })
      naver.maps.Event.addListener(marker, 'dragend', (event: any) => {
        onUpdateBoundaryPoint?.(index, { lat: event.coord.lat(), lng: event.coord.lng() })
      })
      naver.maps.Event.addListener(marker, 'rightclick', () => {
        onRemoveBoundaryPoint?.(index)
      })
      naver.maps.Event.addListener(marker, 'click', (event: any) => {
        event.pointerEvent?.stopPropagation?.()
      })
      draftPointMarkerRefs.current.push(marker)
    })

    if (draftBoundaryPoints.length >= 2) {
      draftBoundaryPoints.forEach((point, index) => {
        const nextPoint = draftBoundaryPoints[(index + 1) % draftBoundaryPoints.length]
        if (!nextPoint || (draftBoundaryPoints.length < 3 && index === draftBoundaryPoints.length - 1)) return
        const middle = getMidPoint(point, nextPoint)
        const marker = new naver.maps.Marker({
          map: mapInstanceRef.current,
          position: new naver.maps.LatLng(middle.lat, middle.lng),
          icon: {
            content: `
              <div
                title="클릭하면 점 추가"
                style="
                  width: 10px;
                  height: 10px;
                  border: 2px solid #ffffff;
                  border-radius: 50%;
                  background: #9ca3af;
                  box-shadow: 0 1px 3px rgba(0,0,0,0.3);
                  cursor: copy;
                  box-sizing: border-box;
                  padding: 0;
                  margin: 0;
                "
              ></div>
            `,
            anchor: new naver.maps.Point(5, 5),
          },
          zIndex: 25,
        })
        naver.maps.Event.addListener(marker, 'click', () => {
          onInsertBoundaryPoint?.(index + 1, middle)
        })
        draftMidpointMarkerRefs.current.push(marker)
      })
    }
  }

  // 지도 초기화
  useEffect(() => {
    if (!mapRef.current) return

    const initMap = () => {
      const naver = (window as any).naver
      if (!naver?.maps || !mapRef.current) return
      scriptLoadedRef.current = true

      // 갈 곳이 정해져 있으면 처음부터 거기서 시작한다.
      // 예전에는 아무 데나 띄운 뒤 → 건물로 날아가고 → 다시 카드 범위로 맞추느라
      // 화면이 두세 번 움직였다 (구역 → 구 → 건물 처럼 보이던 것)
      const focusTarget = focusBuildingIdRef.current
        ? buildingsRef.current.find((item) => item.id === focusBuildingIdRef.current)
        : undefined
      const hasFocusTarget = !!focusTarget && isValidMapCoordinate(Number(focusTarget.lat), Number(focusTarget.lng))

      // 비공식 장소로 들어온 경우 — 처음부터 거기서 시작한다
      const fp = focusPointRef.current
      const hasFocusPoint = !!fp && isValidMapCoordinate(Number(fp.lat), Number(fp.lng))
      if (hasFocusPoint) lastFocusPointRef.current = `${fp!.lat},${fp!.lng}`

      const center = hasFocusPoint
        ? new naver.maps.LatLng(Number(fp!.lat), Number(fp!.lng))
        : hasFocusTarget
          ? new naver.maps.LatLng(Number(focusTarget!.lat), Number(focusTarget!.lng))
          : buildingsRef.current.length > 0
            ? new naver.maps.LatLng(buildingsRef.current[0].lat, buildingsRef.current[0].lng)
          : new naver.maps.LatLng(
              getCongregationProfile().mapCenter.lat,
              getCongregationProfile().mapCenter.lng,
            )

      mapInstanceRef.current = new naver.maps.Map(mapRef.current, {
        center,
        zoom: hasFocusPoint ? (fp!.zoom ?? 17) : hasFocusTarget ? 17 : 15,
        mapTypeControl: false,
        zoomControl: false,
      })
      if (isMobile) (window as any).__mobileMapInstance = mapInstanceRef.current
      else (window as any).__desktopMapInstance = mapInstanceRef.current
      setMapReady(true)

      // ResizeObserver: 컨테이너 크기 변경 시 Naver 지도에 알림 (패널 열림/닫힘 보정)
      if (mapRef.current) {
        const ro = new ResizeObserver(() => {
          if (mapInstanceRef.current) {
            naver.maps.Event.trigger(mapInstanceRef.current, 'resize')
          }
        })
        ro.observe(mapRef.current)
      }

      rebuildMarkers()
      if (hasFocusTarget) lastFocusedBuildingIdRef.current = focusBuildingIdRef.current ?? null

      // 구역 경계선 폴리곤
      const territoryBoundary = getTerritoryBoundary()
      if (territoryBoundary.length >= 3) {
        boundaryRef.current = new naver.maps.Polygon({
          map: mapInstanceRef.current,
          paths: territoryBoundary.map(([lng, lat]) => new naver.maps.LatLng(lat, lng)),
          fillColor: getMapPalette().brand,
          fillOpacity: 0.05,
          strokeColor: getMapPalette().brand,
          strokeOpacity: 0.6,
          strokeWeight: 2,
          strokeStyle: 'shortdash',
        })

        naver.maps.Event.addListener(boundaryRef.current, 'rightclick', (event: any) => {
          onMapRightClickRef.current?.(event.coord.lat(), event.coord.lng())
        })
      }

      // 선택된 카드나 범위가 있으면 해당 경계로 줌인, 없으면 전체 영역
      // (건물을 지정해서 들어온 경우엔 이미 그 건물에 맞춰져 있으므로 건너뛴다)
      const initialCardId = selectedCardIdRef.current
      // 좌표를 지정해 들어온 경우(비공식 장소)도 건물과 같다 — 이미 그 자리에
      // 맞춰 뒀는데 아래 fitTerritoryBoundary() 가 용인 전체로 되돌려 버린다
      if (hasFocusTarget || hasFocusPoint) {
        hasFitBoundaryRef.current = true
        suppressNextCardFitRef.current = true
        mountedWithFocusRef.current = true
        prevSelectedCardIdRef.current = initialCardId
        prevHighlightedCardIdsSignatureRef.current = getHighlightedCardIdsSignature(highlightedCardIdsRef.current)
      } else if (initialCardId !== null && initialCardId !== '전체') {
        const boundary = cardBoundaries.find((b: CardBoundary) => b.cardId === initialCardId)
        if (boundary && boundary.points.length >= 3) {
          if (fitBoundaryPoints(boundary.points)) {
            hasFitBoundaryRef.current = true
          } else {
            fitTerritoryBoundary()
          }
        } else {
          fitTerritoryBoundary()
        }
        prevSelectedCardIdRef.current = initialCardId
        prevHighlightedCardIdsSignatureRef.current = getHighlightedCardIdsSignature(highlightedCardIdsRef.current)
      } else if (initialCardId === '전체') {
        if (!fitHighlightedBoundaries(highlightedCardIdsRef.current)) {
          fitTerritoryBoundary()
        }
        prevSelectedCardIdRef.current = initialCardId
        prevHighlightedCardIdsSignatureRef.current = getHighlightedCardIdsSignature(highlightedCardIdsRef.current)
      } else {
        fitTerritoryBoundary()
      }
      syncCardBoundaries()
      rebuildDraftBoundary()

      naver.maps.Event.addListener(mapInstanceRef.current, 'rightclick', (event: any) => {
        onMapRightClickRef.current?.(event.coord.lat(), event.coord.lng())
      })
      naver.maps.Event.addListener(mapInstanceRef.current, 'longclick', (event: any) => {
        onMapLongClickRef.current?.(event.coord.lat(), event.coord.lng())
      })

      // Re-cluster when zoom changes
      naver.maps.Event.addListener(mapInstanceRef.current, 'zoom_changed', () => {
        if (rebuildTimerRef.current !== null) {
          window.clearTimeout(rebuildTimerRef.current)
          rebuildTimerRef.current = null
        }
        viewportMarkersDirtyRef.current = true
        onZoomChangeRef.current?.(mapInstanceRef.current.getZoom())
        updateCardLabelVisibilityRef.current()
      })
      onZoomChangeRef.current?.(mapInstanceRef.current.getZoom())

      // 성능: 드래그 중엔 카드 라벨 숨김 → 멈추면(idle) 다시 표시.
      // (안드로이드에서 라벨 오버레이 리페인트가 드래그를 느리게 하는 것 방지)
      naver.maps.Event.addListener(mapInstanceRef.current, 'dragstart', () => {
        if (rebuildTimerRef.current !== null) {
          window.clearTimeout(rebuildTimerRef.current)
          rebuildTimerRef.current = null
        }
        viewportMarkersDirtyRef.current = true
        cardLabelsRef.current.forEach((label) => { if (label.getMap()) label.setMap(null) })
      })
      naver.maps.Event.addListener(mapInstanceRef.current, 'idle', () => {
        updateCardLabelVisibilityRef.current()
        // 드래그하는 동안에는 기존 핀을 유지하고, 손을 뗀 뒤 새 화면의 핀만 한 번 갱신한다.
        if (shouldRebuildMapMarkersOnIdle({
          dirty: viewportMarkersDirtyRef.current,
          zoom: mapInstanceRef.current.getZoom(),
          hasAggregates: aggregateMarkersRef.current.length > 0,
        })) {
          scheduleRebuildMarkersRef.current()
        }
      })
    }

    const scriptId = 'naver-map-script'
    if (document.getElementById(scriptId)) {
      if ((window as any).naver?.maps) {
        initMap()
      } else {
        document.getElementById(scriptId)?.addEventListener('load', initMap, { once: true })
      }
      return
    }

    const script = document.createElement('script')
    script.id = scriptId
    script.src = `https://oapi.map.naver.com/openapi/v3/maps.js?ncpKeyId=${clientId}&submodules=geocoder`
    script.async = true
    script.onload = initMap
    document.head.appendChild(script)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId])

  useEffect(() => {
    const naver = (window as any).naver
    if (!scriptLoadedRef.current || !naver?.maps || !mapInstanceRef.current) return

    if (clickListenerRef.current) {
      naver.maps.Event.removeListener(clickListenerRef.current)
      clickListenerRef.current = null
    }

    if (drawingBoundary && onAddBoundaryPoint) {
      clickListenerRef.current = naver.maps.Event.addListener(
        mapInstanceRef.current,
        'click',
        (event: any) => {
          onAddBoundaryPoint({ lat: event.coord.lat(), lng: event.coord.lng() })
        },
      )
    } else if (addingBuilding || pickingPoint) {
      clickListenerRef.current = naver.maps.Event.addListener(
        mapInstanceRef.current,
        'click',
        (event: any) => {
          onMapClickRef.current?.(event.coord.lat(), event.coord.lng())
        },
      )
    }

    return () => {
      if (clickListenerRef.current) {
        naver.maps.Event.removeListener(clickListenerRef.current)
        clickListenerRef.current = null
      }
    }
  }, [drawingBoundary, addingBuilding, pickingPoint, onAddBoundaryPoint])

  // 가상 핀(정기방문 주소) 변경 시 마커 재생성
  useEffect(() => {
    if (!scriptLoadedRef.current) return
    rebuildMarkers()
  }, [virtualPinLat, virtualPinLng, virtualPinLabel])

  const informalShapeRef = useRef(informalShape)
  informalShapeRef.current = informalShape
  const informalShapeOverlaysRef = useRef<any[]>([])

  /**
   * 선택한 장소의 구역선(닫힌 도형)과 동선(열린 선)을 그린다.
   * 같은 좌표 목록이고 그리는 도구도 같다 — 닫느냐 마느냐만 다르다.
   */
  const rebuildInformalShape = () => {
    const naver = (window as any).naver
    if (!naver?.maps || !mapInstanceRef.current) return

    informalShapeOverlaysRef.current.forEach((o) => o.setMap(null))
    informalShapeOverlaysRef.current = []

    const shape = informalShapeRef.current
    if (!shape) return
    const toPath = (points: GeoPoint[]) =>
      points.map((p) => new naver.maps.LatLng(p.lat, p.lng))

    if (shape.boundary && shape.boundary.length >= 3) {
      informalShapeOverlaysRef.current.push(new naver.maps.Polygon({
        map: mapInstanceRef.current,
        paths: toPath(shape.boundary),
        fillColor: '#7A5C8A', fillOpacity: 0.1,
        strokeColor: '#7A5C8A', strokeOpacity: 0.7, strokeWeight: 2,
      }))
    }

    // 중심거리는 **여러 줄**일 수 있다. 한 구역에 걸어다닐 줄기가 여럿이다.
    // ⒶⒷ 순서 표시는 뺐다 — 줄이 여러 개가 되면 번호가 서로 섞여 읽기 어렵다.
    for (const line of shape.route ?? []) {
      if (!line || line.length < 2) continue
      informalShapeOverlaysRef.current.push(new naver.maps.Polyline({
        map: mapInstanceRef.current,
        path: toPath(line),
        strokeColor: '#C44536', strokeOpacity: 0.9, strokeWeight: 4,
        // 점선이다. 실선으로 두면 지도의 도로선과 헷갈린다 —
        // 이건 길이 아니라 '이 줄기를 따라 걷는다' 는 표시다.
        strokeStyle: 'shortdash',
        // 화살표(endIcon)를 뺐다 — 줄이 여러 개가 되면 끝마다 화살표가 붙어
        // 지도가 어수선해지고, 어차피 어느 방향으로 걷든 상관없는 줄기다.
      }))
    }
  }

  const focusPointRef = useRef(focusPoint)
  focusPointRef.current = focusPoint

  // 좌표가 바뀐 순간에만 옮긴다. 매 렌더마다 옮기면 사용자가 지도를 만질 수 없다.
  const lastFocusPointRef = useRef<string>('')
  useEffect(() => {
    if (!mapReady || !focusPoint) return
    const naver = (window as any).naver
    if (!naver?.maps || !mapInstanceRef.current) return
    const key = `${focusPoint.lat},${focusPoint.lng}`
    if (lastFocusPointRef.current === key) return
    lastFocusPointRef.current = key
    mapInstanceRef.current.setCenter(new naver.maps.LatLng(focusPoint.lat, focusPoint.lng))
    mapInstanceRef.current.setZoom(focusPoint.zoom ?? 17)
  }, [focusPoint, mapReady])

  // 비공식 장소는 건물과 다른 레이어라 따로 다시 그린다.
  // 줌마다 건물 클러스터가 재계산되는 것과 엮이면 깜빡인다.
  useEffect(() => {
    if (!scriptLoadedRef.current) return
    rebuildInformalMarkers()
  }, [informalPlaces])

  useEffect(() => {
    if (!mapReady) return
    rebuildInformalShape()
  }, [informalShape, mapReady])

  // 건물 목록, 선택, 또는 미리보기 핀 변경 시 마커 재생성
  useEffect(() => {
    if (!scriptLoadedRef.current) return
    rebuildMarkers()

    const naver = (window as any).naver
    if (!naver?.maps || !mapInstanceRef.current) return
    const visibleSignature = buildings
      .filter((building) => isValidMapCoordinate(Number(building.lat), Number(building.lng)))
      .map((building) => `${building.id}:${building.cardId}:${Number(building.lat).toFixed(6)},${Number(building.lng).toFixed(6)}`)
      .sort()
      .join('|')
    const aggregateSignature = aggregateMarkers
      .filter((marker) => isValidMapCoordinate(Number(marker.lat), Number(marker.lng)))
      .map((marker) => `${marker.id}:${marker.count}:${Number(marker.lat).toFixed(6)},${Number(marker.lng).toFixed(6)}`)
      .sort()
      .join('|')
    const visibleMapSignature = aggregateSignature || visibleSignature

    if (visibleMapSignature && visibleBuildingSignatureRef.current !== visibleMapSignature) {
      const isInitialLoad = !visibleBuildingSignatureRef.current
      visibleBuildingSignatureRef.current = visibleMapSignature
      // 지정한 건물로 들어왔으면 이미 그 위치다 — 전체 보기로 되돌리지 않는다
      if (isInitialLoad && mountedWithFocusRef.current) {
        // 위에서 signature 는 기록해 두었으므로 다음부터는 이 분기로 오지 않는다
      } else if (isInitialLoad && !editingBuildingLocationRef.current && !addingBuildingRef.current) {
        // 특정 카드로 진입한 경우, 건물 마커 기준(과도한 줌인) 대신 구역선 전체가 보이게 fit
        const sel = selectedCardIdRef.current
        const selBoundary = (sel !== null && sel !== '전체')
          ? cardBoundariesRef.current.find((b: CardBoundary) => b.cardId === sel)
          : null
        if (!(selBoundary && selBoundary.points.length >= 3 && fitBoundaryPoints(selBoundary.points))) {
          fitVisibleBuildings('data')
        }
      }
    }

    // 선택 건물 클릭 때는 자동 이동하지 않음
    prevSelectedBuildingIdRef.current = selectedBuildingId
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buildings, aggregateMarkers, selectedBuildingId, previewPinLat, previewPinLng])

  const lastFocusedBuildingIdRef = useRef<number | null>(null)
  useEffect(() => {
    if (!scriptLoadedRef.current) return
    // buildings 배열이 갱신될 때마다 다시 날아가지 않도록, 대상이 바뀔 때만 이동
    if (lastFocusedBuildingIdRef.current === (focusBuildingId ?? null)) return
    if (focusBuildingOnMap(focusBuildingId)) {
      lastFocusedBuildingIdRef.current = focusBuildingId ?? null
    }
  }, [focusBuildingId, buildings])

  useEffect(() => {
    if (!scriptLoadedRef.current) return
    syncCardBoundaries()
    rebuildDraftBoundary()

    const naver = (window as any).naver
    if (!naver?.maps || !mapInstanceRef.current) return

    const highlightedCardIdsSignature = getHighlightedCardIdsSignature(highlightedCardIds)
    const cardSelectionChanged = prevSelectedCardIdRef.current !== selectedCardId
    const highlightedScopeChanged = prevHighlightedCardIdsSignatureRef.current !== highlightedCardIdsSignature

    if (cardSelectionChanged || highlightedScopeChanged) {
      // 지정한 건물을 보고 있는 중이라면 그 화면을 유지한다
      if (suppressNextCardFitRef.current) {
        suppressNextCardFitRef.current = false
        prevSelectedCardIdRef.current = selectedCardId
        prevHighlightedCardIdsSignatureRef.current = highlightedCardIdsSignature
        return
      }
      if (selectedCardId !== '전체' && selectedCardId !== null) {
        const boundary = cardBoundaries.find((b: CardBoundary) => b.cardId === selectedCardId)
        if (boundary && boundary.points.length >= 3) {
          fitBoundaryPoints(boundary.points)
        } else {
          fitVisibleBuildings('card')
        }
      } else if (selectedCardId === '전체' && cardBoundaries.length > 0) {
        if (!fitHighlightedBoundaries(highlightedCardIds)) {
          fitVisibleBuildings('card')
        }
      } else if (selectedCardId === '전체') {
        fitVisibleBuildings('card')
      }
      prevSelectedCardIdRef.current = selectedCardId
      prevHighlightedCardIdsSignatureRef.current = highlightedCardIdsSignature
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardBoundaries, draftBoundaryPoints, selectedCardId, selectedCardIds, drawingBoundary, addingBuilding, editingBuildingLocation, buildings.length, highlightedCardIds, cardColorMap])

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div
        className={`naver-map-canvas${compact ? ' compact-map-canvas' : ''}`}
        ref={mapRef}
        onContextMenu={(e) => e.preventDefault()}
        style={addingBuilding ? { cursor: 'crosshair' } : editingBuildingLocation ? { cursor: 'grab' } : undefined}
      />

      {/* Map Toolbar Overlay */}
      {!compact && <div className="map-toolbar-overlay" style={{
        position: 'absolute',
        top: 'calc(100px - var(--map-chips-push, 0px))',
        right: '12px',
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
        zIndex: isMobile ? 40 : 1000
      }}>
        <button className="toolbar-btn" onClick={toggleSatellite} title="위성 지도로 변환" type="button" aria-label="위성 지도 전환">
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
            <path fill="currentColor" d="M4.979 9.685C2.993 8.891 2 8.494 2 8s.993-.89 2.979-1.685l2.808-1.123C9.773 4.397 10.767 4 12 4s2.227.397 4.213 1.192l2.808 1.123C21.007 7.109 22 7.506 22 8s-.993.89-2.979 1.685l-2.808 1.124C14.227 11.603 13.233 12 12 12s-2.227-.397-4.213-1.191z"/>
            <path fill="currentColor" fillRule="evenodd" d="M2 8c0 .494.993.89 2.979 1.685l2.808 1.124C9.773 11.603 10.767 12 12 12s2.227-.397 4.213-1.191l2.808-1.124C21.007 8.891 22 8.494 22 8s-.993-.89-2.979-1.685l-2.808-1.123C14.227 4.397 13.233 4 12 4s-2.227.397-4.213 1.192L4.98 6.315C2.993 7.109 2 7.506 2 8" clipRule="evenodd"/>
            <path fill="currentColor" d="m5.766 10l-.787.315C2.993 11.109 2 11.507 2 12s.993.89 2.979 1.685l2.808 1.124C9.773 15.603 10.767 16 12 16s2.227-.397 4.213-1.191l2.808-1.124C21.007 12.891 22 12.493 22 12s-.993-.89-2.979-1.685L18.234 10l-2.021.809C14.227 11.603 13.233 12 12 12s-2.227-.397-4.213-1.191z" opacity="0.7"/>
            <path fill="currentColor" d="m5.766 14l-.787.315C2.993 15.109 2 15.507 2 16s.993.89 2.979 1.685l2.808 1.124C9.773 19.603 10.767 20 12 20s2.227-.397 4.213-1.192l2.808-1.123C21.007 16.891 22 16.494 22 16c0-.493-.993-.89-2.979-1.685L18.234 14l-2.021.809C14.227 15.603 13.233 16 12 16s-2.227-.397-4.213-1.191z" opacity="0.4"/>
          </svg>
        </button>
        {!hideActionButton && (
          <button 
            className={`toolbar-btn${addingBuilding || editingBuildingLocation ? ' active' : ''}`} 
            onClick={() => {
              if (onOpenActionMenu) onOpenActionMenu()
              else onToggleAddingBuilding?.(!addingBuilding)
            }}
            title="지도 작업"
            type="button"
            aria-label="지도 작업"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
              <path fill="currentColor" fillRule="evenodd" d="M2.52 7.823C2 8.77 2 9.915 2 12.203v1.522c0 3.9 0 5.851 1.172 7.063S6.229 22 10 22h4c3.771 0 5.657 0 6.828-1.212S22 17.626 22 13.725v-1.521c0-2.289 0-3.433-.52-4.381c-.518-.949-1.467-1.537-3.364-2.715l-2-1.241C14.111 2.622 13.108 2 12 2s-2.11.622-4.116 1.867l-2 1.241C3.987 6.286 3.038 6.874 2.519 7.823M12.75 11a.75.75 0 0 0-1.5 0v2.25H9a.75.75 0 0 0 0 1.5h2.25V17a.75.75 0 0 0 1.5 0v-2.25H15a.75.75 0 0 0 0-1.5h-2.25z" clipRule="evenodd"/>
            </svg>
          </button>
        )}
        <button className="toolbar-btn" onClick={handleGPS} title="현재 위치" type="button" aria-label="현재 위치">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="3"/>
            <path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>
          </svg>
        </button>
        <div style={{ height: '4px' }} />
        <button className="toolbar-btn" onClick={() => handleZoom(1)} title="확대" type="button" aria-label="확대">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
            <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
        </button>
        <button className="toolbar-btn" onClick={() => handleZoom(-1)} title="축소" type="button" aria-label="축소">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
            <line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
        </button>
      </div>}

      <style>{`
        @keyframes userLocPulse {
          0%   { transform: scale(0.7); opacity: 1; }
          80%  { transform: scale(2.2); opacity: 0; }
          100% { transform: scale(2.2); opacity: 0; }
        }
        .map-toolbar-overlay {
          z-index: 10000 !important;
        }
        .map-toolbar-overlay .toolbar-btn {
          width: 44px;
          height: 44px;
          border-radius: 50%;
          /* 성능: backdrop-filter 는 지도 드래그 시 매 프레임 리페인트(안드로이드 렉).
             지도 위 고정 버튼이라 블러 제거 + 배경 불투명↑ 로 대체 */
          background: rgba(255, 255, 255, 0.96);
          border: 1px solid rgba(0, 0, 0, 0.05);
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 18px;
          cursor: pointer;
          transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
          padding: 0;
          color: #1a1a1a;
        }
        .map-toolbar-overlay .toolbar-btn:hover {
          background: #ffffff;
          transform: translateY(-2px);
          box-shadow: 0 6px 16px rgba(0, 0, 0, 0.12);
        }
        .map-toolbar-overlay .toolbar-btn:active {
          transform: scale(0.92);
        }
        .map-toolbar-overlay .toolbar-btn.active {
          background: #1a1a1a;
          color: #ffffff;
          border-color: #1a1a1a;
        }
        @media (max-width: 768px) {
          .map-toolbar-overlay {
            top: calc(112px - var(--map-chips-push, 0px)) !important;
            right: 12px !important;
            z-index: 40 !important;
          }
          .map-toolbar-overlay .toolbar-btn {
            width: 40px;
            height: 40px;
            font-size: 16px;
          }
        }
      `}</style>
    </div>
  )
}

// ── Public MapCanvas ───────────────────────────────────────────────────────

export function MapCanvas({
  buildings,
  aggregateMarkers = [],
  cardBoundaries = [],
  cards,
  drawingBoundary = false,
  addingBuilding = false,
  editingBuildingLocation = false,
  previewPinLat,
  previewPinLng,
  virtualPinLat,
  virtualPinLng,
  virtualPinLabel,
  draftBoundaryPoints = [],
  selectedBuildingId,
  focusBuildingId,
  selectedCardId = '전체',
  onAddBoundaryPoint,
  onInsertBoundaryPoint,
  onRemoveBoundaryPoint,
  onSelectBuilding,
  onSelectAggregate,
  onZoomChange,
  onSelectCardBoundary,
  onUpdateBoundaryPoint,
  onMapRightClick,
  onMapClick,
  pickingPoint,
  onMapLongClick,
  highlightedCardIds,
  selectedCardIds,
  isMobile = false,
  bottomPadding,
  onToggleAddingBuilding,
  onOpenActionMenu,
  hideActionButton,
  onToggleDrawingBoundary,
  onLocationPermissionBlocked,
  onMovePreviewPin,
  onMoveBuilding,
  compact = false,
  cardColorMap,
  hideBuildingMarkers = false,
  informalPlaces = [],
  onSelectInformal,
  informalShape,
  focusPoint,
}: {
  buildings: Building[]
  informalPlaces?: InformalPlacePin[]
  onSelectInformal?: (id: number) => void
  informalShape?: { boundary?: GeoPoint[] | null; route?: GeoPoint[][] | null } | null
  focusPoint?: { lat: number; lng: number; zoom?: number | null } | null
  aggregateMarkers?: MapAggregateMarker[]
  cardBoundaries?: CardBoundary[]
  cards: TerritoryCard[]
  drawingBoundary?: boolean
  addingBuilding?: boolean
  editingBuildingLocation?: boolean
  previewPinLat?: number | null
  previewPinLng?: number | null
  virtualPinLat?: number | null
  virtualPinLng?: number | null
  virtualPinLabel?: string
  draftBoundaryPoints?: GeoPoint[]
  selectedBuildingId: number
  focusBuildingId?: number | null
  selectedCardId: number | '전체' | null
  onAddBoundaryPoint?: (point: GeoPoint) => void
  onInsertBoundaryPoint?: (index: number, point: GeoPoint) => void
  onRemoveBoundaryPoint?: (index: number) => void
  onSelectBuilding: (buildingId: number) => void
  onSelectAggregate?: (id: string) => void
  onZoomChange?: (zoom: number) => void
  onSelectCardBoundary?: (cardId: number) => void
  onUpdateBoundaryPoint?: (index: number, point: GeoPoint) => void
  onMapRightClick?: (lat: number, lng: number) => void
  onMapClick?: (lat: number, lng: number) => void
  /**
   * 건물 추가가 아니어도 지도 클릭을 받는다 (비공식 포인트 찍기 등).
   * ⚠ 예전에는 addingBuilding 일 때만 클릭을 들어서, 다른 모드에서는
   *   onMapClick 을 넘겨도 아무 일도 일어나지 않았다.
   */
  pickingPoint?: boolean
  onMapLongClick?: (lat: number, lng: number) => void
  highlightedCardIds?: Set<number>
  selectedCardIds?: Set<number>
  isMobile?: boolean
  bottomPadding?: number
  onToggleAddingBuilding?: (val: boolean) => void
  onOpenActionMenu?: () => void
  /** 비공식 장소를 보고 있을 때처럼 건물 작업이 뜻이 없는 화면에서 감춘다 */
  hideActionButton?: boolean
  onToggleDrawingBoundary?: (val: boolean) => void
  onLocationPermissionBlocked?: () => void
  onMovePreviewPin?: (lat: number, lng: number) => void
  onMoveBuilding?: (id: number, lat: number, lng: number) => void
  compact?: boolean
  cardColorMap?: Map<number, string>
  hideBuildingMarkers?: boolean
}) {
  const naverMapClientId = import.meta.env.VITE_NAVER_MAP_CLIENT_ID as string | undefined
  const validBuildings = useMemo(
    () => buildings.filter((building) => isValidMapCoordinate(Number(building.lat), Number(building.lng))),
    [buildings],
  )

  if (naverMapClientId) {
    return (
      <div className="map-canvas-container" style={{ width: '100%', height: '100%' }}>
        <NaverMapCanvas
          buildings={validBuildings}
          informalPlaces={informalPlaces}
          onSelectInformal={onSelectInformal}
          informalShape={informalShape}
          focusPoint={focusPoint}
          aggregateMarkers={aggregateMarkers}
          cardBoundaries={cardBoundaries}
          cards={cards}
          clientId={naverMapClientId}
          drawingBoundary={drawingBoundary}
          addingBuilding={addingBuilding}
          editingBuildingLocation={editingBuildingLocation}
          previewPinLat={previewPinLat}
          previewPinLng={previewPinLng}
          virtualPinLat={virtualPinLat}
          virtualPinLng={virtualPinLng}
          virtualPinLabel={virtualPinLabel}
          draftBoundaryPoints={draftBoundaryPoints}
          selectedBuildingId={selectedBuildingId}
          focusBuildingId={focusBuildingId}
          selectedCardId={selectedCardId}
          selectedCardIds={selectedCardIds}
          onAddBoundaryPoint={onAddBoundaryPoint}
          onInsertBoundaryPoint={onInsertBoundaryPoint}
          onRemoveBoundaryPoint={onRemoveBoundaryPoint}
          onSelectBuilding={onSelectBuilding}
          onSelectAggregate={onSelectAggregate}
          onZoomChange={onZoomChange}
          onSelectCardBoundary={onSelectCardBoundary}
          onUpdateBoundaryPoint={onUpdateBoundaryPoint}
          onMapRightClick={onMapRightClick}
          onMapClick={onMapClick}
          pickingPoint={pickingPoint}
          onMapLongClick={onMapLongClick}
          highlightedCardIds={highlightedCardIds}
          isMobile={isMobile}
          bottomPadding={bottomPadding}
          onToggleAddingBuilding={onToggleAddingBuilding}
          onOpenActionMenu={onOpenActionMenu}
          hideActionButton={hideActionButton}
          onToggleDrawingBoundary={onToggleDrawingBoundary}
          onLocationPermissionBlocked={onLocationPermissionBlocked}
          onMovePreviewPin={onMovePreviewPin}
          onMoveBuilding={onMoveBuilding}
          compact={compact}
          cardColorMap={cardColorMap}
          hideBuildingMarkers={hideBuildingMarkers}
        />
      </div>
    )
  }

  // MockMap with clustering simulation at small zoom + preview pin
  return (
    <div
      className={['mock-map', drawingBoundary ? 'drawing-boundary' : '', addingBuilding ? 'adding-building' : '', editingBuildingLocation ? 'editing-building-location' : ''].join(' ')}
      aria-label="샘플 지도"
      style={addingBuilding ? { cursor: 'crosshair' } : editingBuildingLocation ? { cursor: 'grab' } : undefined}
      onClick={(event) => {
        if (drawingBoundary && onAddBoundaryPoint) {
          onAddBoundaryPoint(getPointFromMockEvent(event))
          return
        }
        if (addingBuilding && onMapClick) {
          const pt = getPointFromMockEvent(event)
          onMapClick(pt.lat, pt.lng)
        }
      }}
    >
      <div className="mock-map-grid" />
      <svg className="mock-boundary-overlay" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        <polygon points={getMockBoundaryPoints()} />
        {cardBoundaries
          .filter((boundary) => !(drawingBoundary && boundary.cardId === selectedCardId))
          .map((boundary) => {
            const isSelected = 
              selectedCardIds && selectedCardIds.size > 0
                ? selectedCardIds.has(boundary.cardId)
              : selectedCardId === '전체' 
                ? highlightedCardIds?.has(boundary.cardId)
                : boundary.cardId === selectedCardId
            return (
              <polygon
                className={isSelected ? 'selected-card-boundary' : 'card-boundary'}
                key={boundary.cardId}
                points={getMockPolygonPoints(boundary.points)}
              />
            )
          })}
        {draftBoundaryPoints.length > 0 && (
          <polyline className="draft-boundary" points={getMockPolygonPoints(draftBoundaryPoints)} />
        )}
        {drawingBoundary &&
          draftBoundaryPoints.length >= 2 &&
          draftBoundaryPoints.map((point, index) => {
            const nextPoint = draftBoundaryPoints[(index + 1) % draftBoundaryPoints.length]
            if (!nextPoint || (draftBoundaryPoints.length < 3 && index === draftBoundaryPoints.length - 1))
              return null
            const middle = getMockPoint(getMidPoint(point, nextPoint))
            return (
              <circle
                className="draft-midpoint"
                cx={middle.x}
                cy={middle.y}
                key={`mid-${index}`}
                onClick={(event) => {
                  event.stopPropagation()
                  onInsertBoundaryPoint?.(index + 1, getMidPoint(point, nextPoint))
                }}
                r="0.35"
              />
            )
          })}
        {drawingBoundary &&
          draftBoundaryPoints.map((point, index) => {
            const position = getMockPoint(point)
            return (
              <circle
                className="draft-vertex"
                cx={position.x}
                cy={position.y}
                key={`vertex-${index}`}
                onClick={(event) => {
                  event.stopPropagation()
                  onRemoveBoundaryPoint?.(index)
                }}
                r="0.5"
              />
            )
          })}
      </svg>
      <div className="mock-map-road road-one" />
      <div className="mock-map-road road-two" />
      <div className="mock-map-road road-three" />
      <p className="mock-map-label">전체 구역 경계선 · KML {getTerritoryBoundary().length}개 좌표</p>
      {aggregateMarkers.length > 0 && aggregateMarkers.map((marker) => {
        const pos = getMockPoint({ lat: marker.lat, lng: marker.lng })
        return (
          <button
            className="map-aggregate-marker"
            key={marker.id}
            onClick={(event) => {
              if (drawingBoundary) return
              event.stopPropagation()
              onSelectAggregate?.(marker.id)
            }}
            style={{ left: `${pos.x}%`, top: `${pos.y}%` }}
            type="button"
          >
            <span>{marker.label}</span>
            <strong>{marker.count}</strong>
          </button>
        )
      })}
      {aggregateMarkers.length === 0 && validBuildings.map((building) => {
        const position = getMockPosition(validBuildings, building)
        const status = getBuildingStatus(building)
        const isDimmed = selectedCardId !== null && selectedCardId !== '전체' && building.cardId !== selectedCardId
        const hasRegularVisit = building.units.some((unit) => unit.isRegularVisit)
        const hasChineseNeedsReview = building.units.some((unit) => unit.isChinese && !unit.isRegularVisit)
        return (
          <button
            className={[
              'map-marker',
              `status-${status}`,
              hasChineseNeedsReview ? 'has-chinese' : hasRegularVisit ? 'has-regular' : '',
              selectedBuildingId === building.id ? 'selected' : '',
              isDimmed ? 'dimmed' : '',
            ].join(' ')}
            key={building.id}
            onClick={(event) => {
              if (drawingBoundary) return
              event.stopPropagation()
              onSelectBuilding(building.id)
            }}
            style={{ left: `${position.left}%`, top: `${position.top}%` }}
            type="button"
          >
            <span>{building.units.length}</span>
            <strong>{building.name}</strong>
            <em>{getCardName(cards, building.cardId)}</em>
          </button>
        )
      })}
      {/* Preview pin for building add mode */}
      {previewPinLat != null && previewPinLng != null && (() => {
        const pos = getMockPoint({ lat: previewPinLat, lng: previewPinLng })
        return (
          <div
            aria-hidden="true"
            style={{
              position: 'absolute',
              left: `${pos.x}%`,
              top: `${pos.y}%`,
              transform: 'translate(-50%, -80%)',
              zIndex: 10,
              pointerEvents: 'none',
              lineHeight: 0,
              filter: 'drop-shadow(0 4px 8px rgba(249,115,22,0.55))',
            }}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24">
              <path fill="#f97316" d="M16.37 12.79a1 1 0 0 0-.74 1.86C17.09 15.23 18 16.13 18 17c0 1.42-2.46 3-6 3s-6-1.58-6-3c0-.87.91-1.77 2.37-2.35a1 1 0 0 0-.74-1.86C5.36 13.69 4 15.26 4 17c0 2.8 3.51 5 8 5s8-2.2 8-5c0-1.74-1.36-3.31-3.63-4.21M11 9.86V17a1 1 0 0 0 2 0V9.86a4 4 0 1 0-2 0M12 4a2 2 0 1 1-2 2a2 2 0 0 1 2-2"/>
            </svg>
          </div>
        )
      })()}
    </div>
  )
}
