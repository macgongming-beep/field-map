// ⚠ 여기 있는 값은 더 이상 정답이 아니다 — 불러오기 전에 화면이 비지 않게 하는 임시값이다.
//
//   지역(구·시) → DB 의 territory_regions  (읽는 곳: lib/regions.ts)
//   동          → 실제 카드에서 뽑는다      (읽는 곳: utils/areaOptions.ts)
//
// 지역·동을 늘리려면 이 파일이 아니라 앱에서 하면 된다. 여기를 고쳐도
// DB 값이 곧바로 덮어쓴다. (동 목록은 15개에서 멈춘 채 실제 41개와
// 어긋나 있었다 — 코드에 두면 이렇게 방치된다)
import type { TerritoryRegion, VisitTargetType } from '../types'

/** DB 를 읽기 전에는 비운다. 다른 회중에 용인 지역을 잠깐이라도 보여주지 않는다. */
export const territoryRegions: TerritoryRegion[] = []

export const visitTargetTypes: VisitTargetType[] = ['전체', '상가', '주택']
