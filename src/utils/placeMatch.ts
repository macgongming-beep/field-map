// 플레이스 수집 목록 ↔ 필드맵 대조
//
// 왜 이 규칙이 필요한가: 이름만으로 맞추면 시내에서 오탐이 난다.
// (실제 시험에서 '반주' 가 '일반 주택' 에 걸렸다)
// 그래서 주소로 건물을 먼저 특정하고, 그 안에서 이름을 비교한다.
//
// 대조 순서 — 확실한 것부터
//   1. 업체ID      네이버 고유값. 한 번 연결하면 계속 정확하다
//   2. 주소 + 이름  같은 건물의 같은 상호
//   3. 주소만      같은 건물인데 이름이 다름 → 사람이 판단
//   없으면 신규

import { getAddressStripPattern } from '../lib/regions'
import { getCongregationProfile } from '../lib/congregationProfile'

export type SurveyRow = {
  placeId: string
  name: string
  address: string
  category?: string
  phone?: string
  /** 수집기가 채운 값들 — 통화 목록에 그대로 실어 보내야 한다 */
  restaurant?: string
  collectStatus?: string
  detailLink?: string
  /** 있음 / 없음 / 미확인 / 빈칸(아직 조사 안 함) */
  chinese?: string
  checkedAt?: string
  checkedBy?: string
  memo?: string
}

export type KnownUnit = {
  unitId: number
  buildingId: number
  name: string
  address: string
  placeId?: string | null
  isChinese: boolean
}

export type MatchKind = 'surveyed' | 'registered' | 'ambiguous' | 'new'

export type MatchResult = {
  row: SurveyRow
  kind: MatchKind
  /** 붙은 세대 (registered/ambiguous 일 때) */
  unit?: KnownUnit
  /** 왜 그렇게 판정했는지 — 화면에 그대로 보여 준다 */
  reason: string
}

/**
 * 도로명 + 건물번호만 남긴다.
 *   '경기 용인시 처인구 백암면 백암로 175 돈가네옛날김치돼지찌개' → '백암로 175'
 * 시·군·구·면과 상세주소(건물명·층·호)를 떼어내야 같은 건물이 같은 값이 된다.
 */
export function normalizeRoadAddress(address: string): string {
  if (!address) return ''
  const { province, provinceShort } = getCongregationProfile()
  const provincePattern = [province, provinceShort]
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)
    .map(escapeForRegex)
    .join('|')
  const cleaned = address
    .replace(provincePattern ? new RegExp(provincePattern, 'g') : /(?!)/g, ' ')
    // 시·구 이름은 지역 목록에서 만든다. 예전에는 여기에 따로 적혀 있어서
    // 지역이 늘어도 이 줄만 옛날 목록으로 남았다 (다른 회중에서 대조가 전멸한다)
    .replace(getAddressStripPattern(), ' ')
  const m = cleaned.match(/([가-힣0-9]+(?:대?로|길))\s*([0-9]+(?:-[0-9]+)?)/)
  return m ? `${m[1]} ${m[2]}` : ''
}

function escapeForRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * 상호명 비교용 — 지점명·괄호·공백 차이를 무시한다.
 *   '라홍방마라탕 보라점' → '라홍방마라탕'
 *
 * 지점명을 떼도 안전한 이유: 이름만으로 맞추지 않고 늘 주소와 함께 쓴다.
 * 지점이 다르면 주소가 다르므로, 같은 주소에서 표기만 다른 경우에만 붙는다.
 */
export function normalizePlaceName(name: string): string {
  if (!name) return ''
  return name
    // 전각 괄호（）도 함께 — 실제 데이터에 반각·전각이 섞여 있다
    .replace(/[（(][^)）]*[)）]|\[[^\]]*\]/g, '')
    .replace(/\s*[가-힣A-Za-z0-9]{0,8}점$/, '')
    .replace(/[\s·,\-&]/g, '')
    .toLowerCase()
}

export function matchSurveyRows(
  rows: SurveyRow[],
  units: KnownUnit[],
  surveyedPlaceIds: Set<string>,
): MatchResult[] {
  const byPlaceId = new Map<string, KnownUnit>()
  const byAddrName = new Map<string, KnownUnit>()
  const byAddr = new Map<string, KnownUnit[]>()

  for (const unit of units) {
    if (unit.placeId) byPlaceId.set(unit.placeId, unit)
    const addr = normalizeRoadAddress(unit.address)
    if (!addr) continue
    const key = `${addr}|${normalizePlaceName(unit.name)}`
    if (!byAddrName.has(key)) byAddrName.set(key, unit)
    const list = byAddr.get(addr)
    if (list) list.push(unit)
    else byAddr.set(addr, [unit])
  }

  return rows.map((row) => {
    // 1. 업체ID — 가장 확실하다
    const byId = row.placeId ? byPlaceId.get(row.placeId) : undefined
    if (byId) {
      return { row, kind: 'registered' as const, unit: byId, reason: '업체ID 일치' }
    }

    const addr = normalizeRoadAddress(row.address)
    const surveyed = Boolean(row.placeId && surveyedPlaceIds.has(row.placeId))

    // 2. 주소 + 이름
    // ⚠ 조사 대장 확인보다 먼저 본다. 지도에 있는 곳이면 '등록됨' 으로 알려 주는 편이
    //   정보가 많고, 세대를 찾아야 업체ID 를 붙일 수 있다 (다음 대조가 정확해진다).
    const exact = addr ? byAddrName.get(`${addr}|${normalizePlaceName(row.name)}`) : undefined
    if (exact) {
      return {
        row,
        kind: 'registered' as const,
        unit: exact,
        reason: surveyed ? '주소·상호 일치 (조사도 완료)' : '주소·상호 일치',
      }
    }

    // 조사 대장에 있으면 (등록은 안 했어도) 이미 확인한 곳
    if (surveyed) {
      return { row, kind: 'surveyed' as const, reason: '지난 조사에서 확인함' }
    }

    if (!addr) return { row, kind: 'new' as const, reason: '주소에서 도로명을 찾지 못함' }

    // 3. 주소만 — 같은 건물인데 이름이 다르다
    const sameAddr = byAddr.get(addr)
    if (sameAddr && sameAddr.length > 0) {
      return {
        row,
        kind: 'ambiguous' as const,
        unit: sameAddr[0],
        reason: `같은 건물에 '${sameAddr[0].name}' 등 ${sameAddr.length}곳이 등록돼 있음`,
      }
    }

    return { row, kind: 'new' as const, reason: '' }
  })
}

/** 조사 결과 값 → 대장에 저장할 값 */
export function normalizeSurveyAnswer(value: string | undefined): '있음' | '없음' | '미확인' | null {
  const v = (value ?? '').trim()
  if (!v) return null
  if (/^(있음|있|y|yes|o|ㅇ|예)$/i.test(v)) return '있음'
  if (/^(없음|없|n|no|x|아니오|아니요)$/i.test(v)) return '없음'
  return '미확인'
}
