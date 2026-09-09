// 지역(구·시) 목록의 유일한 출처.
//
// 예전에는 같은 목록이 코드 여섯 군데에 따로 적혀 있었다 — 목록·순서·카드명
// 접두 제거(두 곳)·주소 정규화·상위 시 매핑. 지역을 하나 늘리려면 여섯 군데를
// 고쳐야 했고, 하나만 빠뜨려도 오류 없이 조용히 어긋났다.
// 이제 전부 이 모듈에서 만들어 쓴다.
//
// 왜 모듈 상태인가: MapCanvas·ZoneAssignScreen 의 접두 제거는 컴포넌트가 아니라
// 모듈 수준 함수라 props 로 받을 수 없다. i18n 의 currentLang() 과 같은 방식이다.

import { territoryRegions as FALLBACK_NAMES } from '../data/territoryStructure'

export type TerritoryRegionInfo = {
  /** DB 의 territory_regions.id. 기본값(아직 안 불러옴)은 0 — 고칠 수 없다는 뜻 */
  id: number
  name: string
  /** 구를 품은 시 ('수지구' → '용인시'). 시 자체면 빈 값 */
  city: string
  sortOrder: number
  nameZh: string
  nameEn: string
}

/**
 * DB 를 읽기 전까지 쓰는 값. 화면이 빈 채로 깜빡이지 않게 하려는 것이지
 * 정답이 아니다 — 불러오면 곧바로 덮인다.
 */
const FALLBACK: TerritoryRegionInfo[] = FALLBACK_NAMES.map((name, i) => ({
  id: 0,
  name,
  city: '',
  sortOrder: i + 1,
  nameZh: '',
  nameEn: '',
}))

let regions: TerritoryRegionInfo[] = FALLBACK
// 목록이 바뀔 때만 새로 만든다. 호출할 때마다 새 배열을 돌려주면
// useMemo/useEffect 의존성에 넣는 순간 렌더마다 다시 계산된다.
let names: string[] = FALLBACK.map((r) => r.name)

export function setRegions(next: TerritoryRegionInfo[]): void {
  // 빈 목록으로 덮으면 지역 필터가 통째로 사라진다. 불러오기 실패와 구분되지 않으니
  // 무시하고 이전 값을 지킨다.
  if (next.length === 0) return
  regions = [...next].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'ko'))
  names = regions.map((r) => r.name)
}

/** DB 조회가 성공한 결과. 빈 배열도 '아직 지역을 만들지 않은 새 회중'이라는 유효한 값이다. */
export function setRegionsFromDatabase(next: TerritoryRegionInfo[]): void {
  regions = [...next].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'ko'))
  names = regions.map((r) => r.name)
}

export function getRegions(): TerritoryRegionInfo[] {
  return regions
}

export function getRegionNames(): string[] {
  return names
}

/** 구 → 상위 시. 지오코딩에서 '수지구' 만으로 엉뚱한 곳에 찍히는 걸 막는다 */
export function getRegionCity(name: string): string {
  return regions.find((r) => r.name === name)?.city ?? ''
}

/** 정규식에 넣기 전에 특수문자를 무력화한다 (지역명에 괄호가 들어갈 수도 있다) */
function escapeForRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * 카드 이름 앞의 지역을 뗀다. '처인구 백암면 1' → '백암면 1'
 * 지도·배정 화면에서 좁은 자리에 카드 이름을 넣을 때 쓴다.
 */
export function stripRegionPrefix(cardName: string): string {
  if (!cardName) return ''
  for (const r of regions) {
    const prefix = `${r.name} `
    if (cardName.startsWith(prefix)) return cardName.slice(prefix.length).trimStart()
    if (cardName === r.name) return ''
  }
  return cardName
}

/**
 * 주소에서 지워야 할 시·구 이름들. 주소를 '백암로 175' 까지 줄여
 * 같은 건물을 알아보는 데 쓴다 (전화 조사 대조).
 */
export function getAddressStripWords(): string[] {
  const words = new Set<string>()
  for (const r of regions) {
    words.add(r.name)
    if (r.city) words.add(r.city)
  }
  return [...words]
}

/** 위 목록으로 만든 정규식. 긴 이름부터 지워야 '용인시' 가 조각나지 않는다 */
export function getAddressStripPattern(): RegExp {
  const words = getAddressStripWords()
    .sort((a, b) => b.length - a.length)
    .map(escapeForRegex)
  if (words.length === 0) return /(?!)/g
  return new RegExp(words.join('|'), 'g')
}
