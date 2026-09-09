export const CONGREGATION_PROFILE_KEY = 'congregation_profile'

export type PlaceNameTranslation = [ko: string, zh: string, en: string]

export type CongregationProfile = {
  name: string
  province: string
  provinceShort: string
  defaultCity: string
  mapCenter: { lat: number; lng: number }
  territoryBoundary: [lng: number, lat: number][]
  placeNames: PlaceNameTranslation[]
}

// 새 설치가 특정 회중 자료를 물려받지 않게 중립값으로 시작한다.
// 현재 운영값은 해당 회중 Supabase의 congregation_profile에 이관돼 있다.
export const DEFAULT_CONGREGATION_PROFILE: CongregationProfile = {
  name: 'Field Map',
  province: '',
  provinceShort: '',
  defaultCity: '',
  mapCenter: { lat: 36.5, lng: 127.8 },
  territoryBoundary: [],
  placeNames: [],
}

let activeProfile = DEFAULT_CONGREGATION_PROFILE

function cleanText(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

function validCoordinatePair(value: unknown): value is [number, number] {
  return Array.isArray(value)
    && value.length === 2
    && Number.isFinite(value[0])
    && Number.isFinite(value[1])
    && Math.abs(value[0]) <= 180
    && Math.abs(value[1]) <= 90
}

function parseBoundary(value: unknown): [number, number][] {
  if (Array.isArray(value) && value.length === 0) return []
  if (!Array.isArray(value) || value.length < 3 || !value.every(validCoordinatePair)) {
    return DEFAULT_CONGREGATION_PROFILE.territoryBoundary
  }
  return value.map(([lng, lat]) => [lng, lat])
}

function parsePlaceNames(value: unknown): PlaceNameTranslation[] {
  if (!Array.isArray(value)) return []
  const rows: PlaceNameTranslation[] = []
  for (const row of value) {
    if (!Array.isArray(row) || row.length !== 3) continue
    const [ko, zh, en] = row
    if (typeof ko !== 'string' || !ko.trim()) continue
    rows.push([
      ko.trim(),
      typeof zh === 'string' ? zh.trim() : '',
      typeof en === 'string' ? en.trim() : '',
    ])
  }
  return rows
}

export function parseCongregationProfile(raw: string | undefined): CongregationProfile {
  if (!raw?.trim()) return DEFAULT_CONGREGATION_PROFILE

  let value: Record<string, unknown>
  try {
    value = JSON.parse(raw) as Record<string, unknown>
  } catch {
    return DEFAULT_CONGREGATION_PROFILE
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return DEFAULT_CONGREGATION_PROFILE
  }

  const center = value.mapCenter && typeof value.mapCenter === 'object' && !Array.isArray(value.mapCenter)
    ? value.mapCenter as Record<string, unknown>
    : {}
  const lat = typeof center.lat === 'number' && Number.isFinite(center.lat)
    ? center.lat
    : DEFAULT_CONGREGATION_PROFILE.mapCenter.lat
  const lng = typeof center.lng === 'number' && Number.isFinite(center.lng)
    ? center.lng
    : DEFAULT_CONGREGATION_PROFILE.mapCenter.lng

  return {
    name: cleanText(value.name, DEFAULT_CONGREGATION_PROFILE.name),
    province: cleanText(value.province, DEFAULT_CONGREGATION_PROFILE.province),
    provinceShort: cleanText(value.provinceShort, DEFAULT_CONGREGATION_PROFILE.provinceShort),
    defaultCity: cleanText(value.defaultCity, DEFAULT_CONGREGATION_PROFILE.defaultCity),
    mapCenter: {
      lat: Math.abs(lat) <= 90 ? lat : DEFAULT_CONGREGATION_PROFILE.mapCenter.lat,
      lng: Math.abs(lng) <= 180 ? lng : DEFAULT_CONGREGATION_PROFILE.mapCenter.lng,
    },
    territoryBoundary: parseBoundary(value.territoryBoundary),
    placeNames: parsePlaceNames(value.placeNames),
  }
}

export function applyCongregationSettings(settings: Record<string, string>): void {
  activeProfile = parseCongregationProfile(settings[CONGREGATION_PROFILE_KEY])
}

export function getCongregationProfile(): CongregationProfile {
  return activeProfile
}

export function getTerritoryBoundary(): [number, number][] {
  return activeProfile.territoryBoundary
}

export function getAddressExample(detail = ''): string {
  const location = [activeProfile.province, activeProfile.defaultCity, detail]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(' ')
  return location ? `예) ${location}` : '예) 주소를 입력하세요'
}
