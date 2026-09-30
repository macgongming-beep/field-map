import type { Building, CalendarEvent } from '../types'
import { msg } from '../lib/msg'
import { scopeBuildingToUsage, unitsForUsage, type UnitUsageFilter } from './unitUsage'

export const cardServiceLabel = (scope: UnitUsageFilter) => scope === '주택'
  ? msg('주택 봉사') : scope === '상가' ? msg('상가 봉사') : msg('주택·상가 전체')

export function assignedServiceScope(event: CalendarEvent | undefined, userName: string, requestedCardId?: number) {
  const assignment = event?.cardAssignments.find((a) => a.userName === userName)
  const ids = assignment?.assignedCardIds?.length ? assignment.assignedCardIds
    : assignment?.assignedCardId != null ? [assignment.assignedCardId] : []
  return { ids: requestedCardId === undefined ? ids : ids.filter((id) => id === requestedCardId), scope: assignment?.cardScope ?? '전체' as UnitUsageFilter }
}

/**
 * 배정 카드의 건물 중 이 봉사 유형에 해당하는 것만, 해당 세대만 남긴다.
 *
 * ⚠ 걸러진 세대가 아니라 **원래 세대**로 판정한다.
 *   · 해당 유형 세대가 있다                → 보인다 (그 세대만)
 *   · 다른 유형 세대만 있다                → 안 보인다. 빈 건물로 오인하지 않는다
 *   · 실제 세대가 하나도 없다 (빈 건물)     → `includeEmptyOfScopeType` 일 때만,
 *                                          건물 유형이 봉사 유형과 같으면 보인다
 *
 * 빈 건물 포함은 **지도 표시용**이다. 배정 화면은 이 함수로 "이 범위에 넣을 수 있는 카드" 를
 * 정하는데, 거기서 빈 건물만 있는 카드가 주택·상가 범위로 잡히면 배정 범위가 바뀐다.
 * 그래서 기본값은 꺼져 있고, 지도만 켠다.
 * (예전에는 지도도 빈 건물을 버려서, 나의 봉사에서 건물을 추가하자마자 핀이 사라지고
 *  첫 세대 등록으로 넘어가지 못했다. 다시 등록하면 서버는 "이미 있다" 고 했다.)
 */
export function scopeServiceBuildings(
  buildings: Building[],
  ids: number[],
  scope: UnitUsageFilter,
  options: { includeEmptyOfScopeType?: boolean } = {},
) {
  return buildings.filter((b) => ids.includes(b.cardId)).flatMap((b) => {
    const scoped = scopeBuildingToUsage(b, scope)
    if (scope === '전체' || scoped.units.length > 0) return [scoped]
    if (!options.includeEmptyOfScopeType) return []
    // 판정은 걸러지기 전 원래 건물로 한다. unitsForUsage 는 '출입불가' 가짜 세대를 빼 준다.
    const isEmptyBuilding = unitsForUsage(b, '전체').length === 0
    return isEmptyBuilding && b.type === scope ? [scoped] : []
  })
}
