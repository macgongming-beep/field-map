import { supabase } from './supabase'
import { getAuthToken } from './authToken'
import { getRegions } from './regions'
import { geocodeAddressFirstMatch } from './naverGeocode'
import { getGeocodeCandidates } from '../utils/geocodeCandidates'
import { buildingAddressKey, shortAddress } from '../utils/shortAddress'

export type PlaceCandidate = {
  name: string
  address: string
  category: string
  lat: number
  lng: number
  source?: 'place' | 'address'
}

export function isAddressLikePlaceQuery(query: string): boolean {
  const value = query.trim()
  return /(로|길|동|읍|면)\s*\d|\d+(-\d+)?\s*$/.test(value)
}

/** 상호명 지역 검색과 주소 지오코딩을 한 입력에서 함께 수행한다. */
export async function searchPlacesAndAddressesForCongregation(query: string): Promise<PlaceSearchResult> {
  const q = query.trim()
  if (!q) return { ok: true, places: [] }

  const [placeResult, addressMatches] = await Promise.all([
    searchPlacesForCongregation(q),
    geocodeAddressFirstMatch(getGeocodeCandidates(q)),
  ])
  const places = placeResult.ok
    ? placeResult.places.map((place) => ({ ...place, source: 'place' as const }))
    : []
  const placeAddressKeys = new Set(places.map((place) => buildingAddressKey(place.address)).filter(Boolean))
  const addresses: PlaceCandidate[] = addressMatches
    .filter((match) => !placeAddressKeys.has(buildingAddressKey(match.address)))
    .map((match) => ({
      name: shortAddress(match.address) || q,
      address: match.address,
      category: '주소',
      lat: match.lat,
      lng: match.lng,
      source: 'address',
    }))

  const combined = isAddressLikePlaceQuery(q)
    ? [...addresses, ...places]
    : [...places, ...addresses]
  if (combined.length > 0) return { ok: true, places: combined.slice(0, 8) }
  return placeResult.ok ? { ok: true, places: [] } : placeResult
}

/**
 * 장소 이름으로 좌표 후보를 찾는다.
 *
 * ⚠ 지도 SDK 의 geocode 는 **주소만** 받는다. '용인 강남대학교' 같은 이름은
 *   못 찾는다. 그래서 Edge Function(search-place)을 거쳐 네이버 지역 검색을 쓴다.
 * ⚠ 서버 키가 필요해 브라우저에서 직접 못 부른다. 함수가 창구다.
 *
 * 최대 5개까지 온다 (네이버 지역 검색의 상한).
 */
export type PlaceSearchResult =
  | { ok: true; places: PlaceCandidate[] }
  /**
   * ⚠ 실패를 빈 결과로 뭉뚱그리지 않는다. 그러면 "검색 결과 없음" 과
   *   "검색이 고장남" 이 화면에서 같아 보여 원인을 못 찾는다.
   */
  | { ok: false; reason: 'no_session' | 'rejected' | 'unavailable' }

export async function searchPlaces(query: string): Promise<PlaceSearchResult> {
  const q = query.trim()
  if (!q) return { ok: true, places: [] }
  const token = getAuthToken()
  if (!token) return { ok: false, reason: 'no_session' }

  const { data, error } = await supabase.functions.invoke('search-place', {
    body: { query: q },
    headers: { 'x-session-token': token },
  })
  if (error) {
    console.warn('[searchPlaces] search-place 호출 실패', error)
    // 401 은 '세션이 거부됨' 이다. 연결 문제와 같은 문구로 묶으면 원인을 못 찾는다.
    const status = (error as { context?: { status?: number } })?.context?.status
    return { ok: false, reason: status === 401 ? 'rejected' : 'unavailable' }
  }
  const body = data as { places?: unknown; error?: unknown }
  if (body?.error) {
    console.warn('[searchPlaces] search-place 가 오류를 돌려줌', body.error)
    return { ok: false, reason: 'unavailable' }
  }
  const places = Array.isArray(body?.places) ? body.places : []

  return {
    ok: true,
    places: places.filter((place): place is PlaceCandidate => {
      const p = place as Partial<PlaceCandidate>
      return typeof p?.name === 'string' && p.name.length > 0
        && typeof p.lat === 'number' && typeof p.lng === 'number'
    }),
  }
}

/**
 * 회중이 담당하는 시 이름을 검색어에 붙여 전국 동명 식당보다 가까운 후보를 먼저 찾는다.
 * 구역선은 실제 담당 범위보다 작을 수 있어 검색 결과를 숨기는 용도로는 쓰지 않는다.
 */
export async function searchPlacesForCongregation(query: string): Promise<PlaceSearchResult> {
  const q = query.trim()
  if (!q) return { ok: true, places: [] }
  const scopes = [...new Set(getRegions().map((region) => region.city || region.name).filter(Boolean))]
  if (scopes.length === 0) return searchPlaces(q)

  const results = await Promise.all(scopes.map((scope) => searchPlaces(`${scope} ${q}`)))
  const successful = results.filter((result): result is Extract<PlaceSearchResult, { ok: true }> => result.ok)
  if (successful.length === 0) return results[0]

  const seen = new Set<string>()
  const places = successful.flatMap((result) => result.places).filter((place) => {
    const key = `${place.name}|${place.address}|${place.lat.toFixed(6)}|${place.lng.toFixed(6)}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  if (places.length > 0) return { ok: true, places }
  return searchPlaces(q)
}
