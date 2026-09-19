// 같은 주소로 두 번 등록된 건물을 하나로 합칠 계획을 세운다.
//
// **왜 순수 함수인가:** 여기가 "무엇을 지울지" 를 정하는 곳이다. DB 를 붙인 채로는
// 확인할 수 없고, 잘못되면 방문 기록이 사라진다. 판단만 떼어내 테스트로 못 박는다.
//
// ⚠ 정책 (2026-08-24, 사용자가 정함)
//   같은 호수 번호가 양쪽에 있으면 **그 주소 묶음은 통째로 병합하지 않는다.**
//
//   왜: 예전 코드는 겹치는 호수를 "이동 건너뛰기" 하고 원본 건물을 지웠다.
//   units 는 visit_histories · regular_visits 에서 on delete cascade 로 물려 있어서,
//   건너뛴 호수의 **방문 기록이 조용히 사라졌다.** 화면에는 '병합했습니다' 만 떴다.
//   무엇을 남길지는 사람이 봐야 하는 판단이라, 자동으로 정하지 않는다.
import type { Building } from '../types'

export type MergeGroup = {
  /** 남길 건물 (id 가 가장 작은 것) */
  primary: Building
  /** 지울 건물들. 호수는 primary 로 옮긴다 */
  absorbed: Building[]
  /** 옮길 호수 수 */
  movingUnits: number
}

export type ConflictGroup = {
  primary: Building
  /** 같은 주소로 묶였지만 호수가 겹쳐 합치지 않은 나머지 건물 */
  absorbed: Building[]
  /** 양쪽에 다 있는 호수 번호. 이게 있으면 병합하지 않는다 */
  conflictingNumbers: string[]
}

export type MergePlan = {
  merge: MergeGroup[]
  /** 호수가 겹쳐 제외한 묶음. 화면이 사용자에게 알려야 한다 */
  conflicts: ConflictGroup[]
}

/**
 * 호수 비교용 정규화. **병합 충돌 판정에만 쓴다** (화면 표시는 원래 값 그대로).
 *
 * 실제 데이터가 섞여 있다. 1,572개 중 숫자만 394개 · '호' 붙은 것 337개,
 * 지하도 B02 와 B02호 가 같이 있다. 그대로 비교하면 같은 호수를 다른 것으로 보고
 * **겹치는데 안 겹친다고 판단해 합쳐 버린다** — 그러면 방문 기록이 사라진다.
 *
 * 판단이 애매하면 **같은 것으로 본다.** 잘못 합치면 되돌릴 수 없고,
 * 잘못 안 합치면 사람이 보고 정리하면 된다.
 */
export function normalizeUnitNumber(raw: string): string {
  const trimmed = (raw ?? '').trim().replace(/\s+/g, '')
  if (!trimmed) return ''
  // B02호 · 101호 · 101 → B2 · 101 · 101
  const m = /^([A-Za-z]*)0*(\d+)호?$/.exec(trimmed)
  if (m) return `${m[1].toUpperCase()}${m[2]}`
  // '호별 방문' 같은 글자 라벨은 공백만 없앤 채로 비교한다
  return trimmed
}

/** 주소 비교용 정규화 — 공백과 하이픈 차이로 중복을 놓치지 않게 */
export function normalizeAddress(address: string): string {
  return address.trim().toLowerCase().replace(/\s+/g, '').replace(/[-‐]/g, '-')
}

export function planDuplicateBuildingMerge(
  buildings: Building[],
  options: { scopeCardId?: number; selectedPrimaryIds?: number[] } = {},
): MergePlan {
  const scope = options.scopeCardId
    ? buildings.filter((b) => b.cardId === options.scopeCardId)
    : buildings

  // 같은 카드 · 같은 주소끼리 묶는다
  const groups = new Map<string, Building[]>()
  for (const b of scope) {
    const key = `${b.cardId}::${normalizeAddress(b.address)}`
    const list = groups.get(key)
    if (list) list.push(b)
    else groups.set(key, [b])
  }

  const selected = options.selectedPrimaryIds ? new Set(options.selectedPrimaryIds) : null
  const merge: MergeGroup[] = []
  const conflicts: ConflictGroup[] = []

  for (const group of groups.values()) {
    if (group.length <= 1) continue
    const sorted = [...group].sort((a, b) => a.id - b.id)
    const [primary, ...absorbed] = sorted
    if (selected && !selected.has(primary.id)) continue

    // 호수 번호가 하나라도 겹치면 손대지 않는다
    // 101 과 101호 는 같은 호수다. 문자열 그대로 비교하면 겹침을 놓친다.
    const seen = new Set(primary.units.map((u) => normalizeUnitNumber(u.number)))
    const conflicting: string[] = []
    let movingUnits = 0
    for (const dup of absorbed) {
      for (const unit of dup.units) {
        const key = normalizeUnitNumber(unit.number)
        if (seen.has(key)) conflicting.push(unit.number)   // 알릴 때는 원래 표기로
        else { seen.add(key); movingUnits++ }
      }
    }

    if (conflicting.length > 0) {
      conflicts.push({ primary, absorbed, conflictingNumbers: [...new Set(conflicting)].sort() })
      continue
    }
    merge.push({ primary, absorbed, movingUnits })
  }

  return { merge, conflicts }
}

/**
 * DB 의 merge_duplicate_buildings_tx 가 돌려주는 것.
 * 성공·건너뜀·실패를 화면까지 그대로 전달한다 — void 로는 구분할 수 없다.
 */
export type MergeResult = {
  ok: boolean
  mergedBuildings: number
  movedUnits: number
  /** 호수가 겹쳐 건드리지 않은 묶음 */
  conflicts: Array<{ primaryId: number; conflictingNumbers: string[] }>
}
