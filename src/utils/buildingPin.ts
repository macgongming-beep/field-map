import type { Building } from '../types'

// 건물 핀을 **두 가지로 나눠** 정한다.
//
// 왜 (2026-08-31):
//   예전에는 색 하나에 두 가지를 우겨넣어서 **하나가 다른 하나를 가렸다.**
//     · 정기방문 세대가 하나만 있어도 건물 전체가 금색 → 나머지 10세대가
//       미방문이어도 "정기방문 건물이네" 하고 지나쳤다
//     · 등록된 세대가 다 방문되면 초록 → 그런데 **등록된 세대가 둘뿐**이었다.
//       실제로는 호수가 더 있는데 '완료'로 보여서 아무도 안 갔다
//
//   시스템은 "등록된 세대"만 안다. **"그 건물에 몇 세대가 있는지"는 사람만 안다.**
//   그래서 `unitsSurveyed`(세대를 다 파악했다)를 사람이 표시하게 하고,
//   그게 없으면 **완료로 치지 않는다.**
//
// 그래서:
//   tone(색)   = 이 건물의 성격      (방문금지 / 정기방문 / 보통)
//   filled(채움) = 이제 안 가도 되나  (등록 세대 다 방문 + 세대 파악됨)

export type PinTone = '방문금지' | '정기방문' | '보통'

/**
 * 건물 상태별 색. **판정과 색을 같은 곳에 둔다** — 예전에 지도 핀과 선택된 핀을
 * 두 곳에서 따로 그려서 누를 때만 색이 달라진 적이 있다.
 * 비공식 장소 종류(utils/informalKind)가 이 색들과 겹치지 않는지 시험이 지킨다.
 */
export const BUILDING_STATUS_COLORS = {
  방문필요: '#2D6CDF',
  방문완료: '#4F7A4B',
  방문금지: '#1A1A18',
  정기방문: '#B8862A',
} as const

export const TONE_COLORS: Record<PinTone, string> = {
  보통: BUILDING_STATUS_COLORS.방문완료,
  정기방문: BUILDING_STATUS_COLORS.정기방문,
  방문금지: BUILDING_STATUS_COLORS.방문금지,
}

export type BuildingPin = {
  tone: PinTone
  /** true = 채운 핀(안 가도 됨) · false = 파란 핀(가 볼 곳이 있다) */
  filled: boolean
  /**
   * 파란 핀에 두를 테두리 색. `null` 이면 그냥 파란 핀이다.
   *
   * ⚠ 테두리는 **"완료처럼 보이지만 아직 확인이 필요하다"** 를 말한다:
   *   · 초록 테두리 = 등록된 세대는 다 갔다. **세대를 다 파악했는지는 모른다**
   *   · 금색 테두리 = 정기방문 세대가 있는데 **아직 갈 곳이 남았다**
   *   아직 아무도 안 간 보통 건물은 테두리가 없다 — 헷갈릴 것이 없으니까.
   */
  ring: PinTone | null
}

/** 등록된 세대가 하나라도 '가야 할' 상태인가 */
export function hasUnvisitedUnit(building: Building): boolean {
  return building.units.some((u) => u.status === '미방문' || u.status === '부재')
}

/**
 * 이 건물을 '갈 곳 없는 금지 건물' 로 볼 것인가.
 *
 * ⚠ **세대 하나가 거절이라고 건물 전체를 금지로 보면 안 된다.** 그러면 같은
 *   건물의 미방문 세대를 아무도 안 간다. 정기방문에서 이미 겪은 실수와
 *   똑같은 모양이다 (아래 getPinGroup 의 주석) — 성격 하나가 진행을 가렸다.
 *
 * ⚠ 건물 통째 금지(`warning`)는 다르다. 들어갈 수가 없으니 남은 세대가
 *   있어도 금지다. 관리인이 막은 건물이 여기 해당한다.
 *
 * ⚠ 이 판정은 **여기 한 곳에만 둔다.** utils/mapUtils 의 getBuildingStatus 도
 *   이걸 부른다 — 예전에 지도 핀과 목록이 각자 판정해서 어긋난 적이 있다.
 */
export function isForbiddenBuilding(building: Building): boolean {
  if (building.accessStatus === 'blocked' || building.warning) return true
  const hasForbiddenUnit = building.units.some((u) => u.status === '거절' || u.isForbidden)
  return hasForbiddenUnit && !hasUnvisitedUnit(building)
}

export function getBuildingPin(building: Building): BuildingPin {
  // 방문금지는 '갈 곳' 이 아니다. 채워서 그린다 — 더 갈 일이 없다는 뜻이다.
  if (isForbiddenBuilding(building)) {
    return { tone: '방문금지', filled: true, ring: null }
  }

  const tone: PinTone = building.mapPinToneOverride
    ?? (building.units.some((u) => u.isRegularVisit) ? '정기방문' : '보통')
  // ⚠ 세대가 하나도 없으면 '다 갔다' 고 할 수 없다
  const allVisited = building.units.length > 0 && !hasUnvisitedUnit(building)

  // ⚠ **세대를 다 파악했다고 표시한 건물만** 채운다.
  //   표시가 없으면 등록된 걸 다 갔어도 "더 있을 수 있음" 이다.
  if (allVisited && building.unitsSurveyed === true) {
    return { tone, filled: true, ring: null }
  }

  // 파란 핀. 테두리로 '왜 눈여겨봐야 하는지' 를 말한다.
  if (allVisited) return { tone, filled: false, ring: tone }      // 다 갔는데 미확인
  if (tone === '정기방문') return { tone, filled: false, ring: tone }  // 갈 곳 남은 정기방문
  return { tone, filled: false, ring: null }
}

/** 범례·필터에서 쓰는 한 줄짜리 분류. **건물 하나는 정확히 한 곳에 속한다.** */
export type PinGroup = '방문금지' | '방문필요' | '확인필요' | '완료' | '정기방문'

export function getPinGroup(building: Building): PinGroup {
  const pin = getBuildingPin(building)
  if (pin.tone === '방문금지') return '방문금지'
  // ⚠ 정기방문이어도 **갈 곳이 남아 있으면 '방문필요'** 다.
  //   예전에는 정기방문이 먼저 판정돼서, 미방문 세대가 있어도 금색이라 지나쳤다.
  if (!pin.filled) {
    const allVisited = building.units.length > 0 && !hasUnvisitedUnit(building)
    return allVisited ? '확인필요' : '방문필요'
  }
  return pin.tone === '정기방문' ? '정기방문' : '완료'
}
