// 건물 목록에서 **세대 한 줄씩**을 만든다 (세대 화면의 목록).
//
// 뿌리는 건물의 '범위' 필터까지만이다 (filterBuildingsByScope).
// 건물의 속성 필터(메모·식당·중국어세대)는 여기에 끼면 안 된다 —
// 건물에 메모가 없어도 그 안 세대는 세대 화면에 나와야 한다.
import type { Building, Unit, VisitHistory } from '../types'
import { hasText } from './filterBuildings'

export type PointRow = {
  building: Building
  unit: Unit
  /** 가장 최근 방문. 기록이 없으면 undefined */
  latestHistory?: VisitHistory
}

export type PointFilters = {
  /** '전체' | '중국어' | '정기방문' | '식당' | '점검 필요' */
  kind: string
  /** '전체' 또는 세대 상태값 */
  status: string
  /** '전체' | '있음' | '없음' */
  regularVisit: string
  memo: string
}

/** 종류 필터 — 세대의 성격 하나만 고른다 */
export function matchesPointKind(unit: Unit, kind: string): boolean {
  if (kind === '중국어') return !!unit.isChinese
  if (kind === '정기방문') return !!unit.isRegularVisit
  if (kind === '식당') return !!unit.isRestaurant
  if (kind === '점검 필요') return !!unit.isChinese && unit.status === '대상외'
  return true
}

export function buildPointRows(
  buildings: readonly Building[],
  f: PointFilters,
  historiesOf: (unitId: number) => VisitHistory[],
): PointRow[] {
  return buildings
    .flatMap((building) =>
      building.units
        .filter((unit) => matchesPointKind(unit, f.kind))
        .map((unit) => {
          // ⚠ 방문기록은 최신이 앞에 오도록 이미 정렬돼 있다고 본다.
          //   [0] 을 '가장 최근' 으로 쓰는 곳이 여러 군데다
          const histories = historiesOf(unit.id)
          return { building, unit, latestHistory: histories[0] }
        }),
    )
    .filter(({ unit }) => {
      if (f.status !== '전체' && unit.status !== f.status) return false
      if (f.regularVisit === '있음' && !unit.isRegularVisit) return false
      if (f.regularVisit === '없음' && unit.isRegularVisit) return false
      const memo = hasText(unit.memo)
      // ⚠ 세대 메모만 본다. 건물 메모는 여기서 안 본다
      //   (건물 필터의 '메모' 는 건물+세대를 둘 다 보는 것과 다르다)
      if (f.memo === '있음' && !memo) return false
      if (f.memo === '없음' && memo) return false
      return true
    })
}
