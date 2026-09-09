// 주소 하나로 지오코딩 후보 여러 개를 만든다.
//
// 왜: 사람이 적은 주소는 지도가 못 알아듣는 모양이 많다.
//   · 시/도가 빠짐 ('처인구 유림로147번길 55-2')
//   · 도로명 앞에 동이 붙음 ('유방동 유림로147번길')
//   · 뒤에 건물 이름이 붙음 ('유림로147번길 55-2 엠제이오사옥')  ← 실제로 여기서 막혔다
// 하나씩 시도해 처음 맞는 것을 쓴다.
import { getRegions } from '../lib/regions'
import { getCongregationProfile } from '../lib/congregationProfile'
import { shortAddress } from './shortAddress'

export function getGeocodeCandidates(address: string): string[] {
  const normalized = (address ?? '').replace(/\s+/g, ' ').trim()
  if (!normalized) return []
  const profile = getCongregationProfile()

  // 구 → 시. 지역 목록에서 만든다 — 지역을 늘려도 이 매핑만 옛 값으로 남지 않게
  const guToCity: Record<string, string> = Object.fromEntries(
    getRegions().filter((r) => r.city).map((r) => [r.name, r.city]),
  )

  const tokens = normalized.split(' ')
  const isDongToken = (t: string) => /동$/.test(t)
  const isRoadToken = (t: string) => /(로|길)/.test(t)
  const withoutDongBeforeRoad = tokens
    .filter((t, i) => !(isDongToken(t) && tokens.slice(i + 1).some(isRoadToken)))
    .join(' ')
  const withoutProvince = profile.province && profile.provinceShort
    ? normalized.replace(new RegExp(`^${escapeForRegex(profile.province)}\\s+`), `${profile.provinceShort} `)
    : normalized
  const withoutProvinceAndDong = profile.province && profile.provinceShort
    ? withoutDongBeforeRoad.replace(new RegExp(`^${escapeForRegex(profile.province)}\\s+`), `${profile.provinceShort} `)
    : withoutDongBeforeRoad

  // 도로명+번지까지만 남긴 것. 뒤에 붙은 건물 이름을 떼는 데 쓴다
  const roadOnly = shortAddress(normalized)

  const configuredPrefixes = [profile.province, profile.provinceShort, profile.defaultCity]
    .filter(Boolean)
  const hasCity = tokens.some((token) => /(시|도|군)$/.test(token))
    || configuredPrefixes.some((prefix) => normalized === prefix || normalized.startsWith(`${prefix} `))
  const guToken = tokens.find((t) => t in guToCity)
  const cityQualified: string[] = []
  if (!hasCity && guToken) {
    const city = guToCity[guToken]
    cityQualified.push(...withProvinceVariants(profile.province, profile.provinceShort, city, normalized))
  } else if (!hasCity && !guToken && profile.defaultCity) {
    cityQualified.push(...withProvinceVariants(profile.province, profile.provinceShort, profile.defaultCity, normalized))
  }

  // 도로명만 남긴 것도 시를 붙여 시도한다 (그대로는 어디 도로인지 모른다)
  const roadWithCity: string[] = []
  if (roadOnly && roadOnly !== normalized) {
    const city = guToken ? guToCity[guToken] : profile.defaultCity
    roadWithCity.push(...withProvinceVariants(profile.province, profile.provinceShort, city, roadOnly), roadOnly)
  }

  return Array.from(new Set([
    ...cityQualified,
    normalized,
    withoutDongBeforeRoad,
    withoutProvince,
    withoutProvinceAndDong,
    ...roadWithCity,
  ].filter(Boolean)))
}

function escapeForRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function withProvinceVariants(province: string, provinceShort: string, city: string, address: string): string[] {
  const prefix = [city, address].filter(Boolean).join(' ')
  const provincePrefix = province && province === city
    ? [province, address].filter(Boolean).join(' ')
    : [province, prefix].filter(Boolean).join(' ')
  const shortProvincePrefix = province && province === city
    ? [provinceShort, address].filter(Boolean).join(' ')
    : [provinceShort, prefix].filter(Boolean).join(' ')
  return Array.from(new Set([
    provincePrefix,
    shortProvincePrefix,
    prefix,
  ].filter(Boolean)))
}
