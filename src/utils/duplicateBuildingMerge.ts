// 같은 주소로 두 번 등록된 건물을 하나로 합칠 계획을 세운다.
//
// **왜 순수 함수인가:** 여기가 "무엇을 지울지" 를 정하는 곳이다. DB 를 붙인 채로는
// 확인할 수 없고, 잘못되면 방문 기록이 사라진다. 판단만 떼어내 테스트로 못 박는다.
//
// ⚠ 정책 (2026-09-20)
//   같은 호수 번호가 양쪽에 있으면 최신 방문이 있는 세대를 남기고 기록을 통합한다.
//   이 함수는 화면의 미리보기만 만든다. 실제 연결 자료 이동과 현재 담당 충돌 판정은
//   DB 트랜잭션 merge_duplicate_buildings_tx 가 잠근 최신 자료로 다시 수행한다.
import type { Building, UnitStatus, VisitHistory } from '../types'
import { buildingAddressKey } from './shortAddress'

export type MergeGroup = {
  /** 남길 건물 (id 가 가장 작은 것) */
  primary: Building
  /** 지울 건물들. 호수는 primary 로 옮긴다 */
  absorbed: Building[]
  /** 옮길 호수 수 */
  movingUnits: number
  /** 기록까지 통합할 중복 호수 표기 */
  duplicateUnitNumbers: string[]
  /** 전체 주소까지 같은지, 도로명·건물번호만 같은 확인 후보인지 */
  matchType: 'exact' | 'candidate'
}

export type ConflictGroup = {
  primary: Building
  /** 서버가 현재 담당 자료 때문에 보류할 수 있는 나머지 건물 */
  absorbed: Building[]
  /** 확인이 필요한 같은 호수 번호 */
  conflictingNumbers: string[]
}

export type MergePlan = {
  merge: MergeGroup[]
  /** 서버의 최신 자료 판정에서만 채워질 수 있는 보류 묶음 */
  conflicts: ConflictGroup[]
}

export type DuplicateUnitPreview = {
  normalizedNumber: string
  displayNumber: string
  keptBuildingName: string
  latestVisitedAt: string | null
  latestResult: UnitStatus | null
  visitCount: number
  isChinese: boolean
  isRestaurant: boolean
  usageType: '주택' | '상가'
}

function compareLatestHistory(a: VisitHistory | undefined, b: VisitHistory | undefined): number {
  if (!a && !b) return 0
  if (!a) return 1
  if (!b) return -1
  const visited = new Date(b.visitedAt).getTime() - new Date(a.visitedAt).getTime()
  if (visited !== 0) return visited
  const created = new Date(b.createdAt ?? b.visitedAt).getTime() - new Date(a.createdAt ?? a.visitedAt).getTime()
  if (created !== 0) return created
  return b.id - a.id
}

/**
 * 서버가 실제로 남길 중복 세대와 같은 기준으로 확인 화면을 만든다.
 * 방문 기록이 있으면 가장 최근 기록의 세대를, 없으면 기준 건물의 세대를 남긴다.
 */
export function buildDuplicateUnitPreviews(
  group: MergeGroup,
  visitHistories: VisitHistory[],
): DuplicateUnitPreview[] {
  const buildings = [group.primary, ...group.absorbed]
  const historiesByUnit = new Map<number, VisitHistory[]>()
  visitHistories.forEach((history) => {
    const list = historiesByUnit.get(history.unitId)
    if (list) list.push(history)
    else historiesByUnit.set(history.unitId, [history])
  })
  historiesByUnit.forEach((list) => list.sort(compareLatestHistory))

  const unitsByNumber = new Map<string, Array<{ building: Building; unit: Building['units'][number] }>>()
  buildings.forEach((building) => {
    building.units.forEach((unit) => {
      const key = normalizeUnitNumber(unit.number)
      const list = unitsByNumber.get(key)
      if (list) list.push({ building, unit })
      else unitsByNumber.set(key, [{ building, unit }])
    })
  })

  return [...unitsByNumber.entries()]
    .filter(([, candidates]) => candidates.length > 1)
    .map(([normalizedNumber, candidates]) => {
      const sorted = [...candidates].sort((a, b) => {
        const byHistory = compareLatestHistory(
          historiesByUnit.get(a.unit.id)?.[0],
          historiesByUnit.get(b.unit.id)?.[0],
        )
        if (byHistory !== 0) return byHistory
        const byPrimary = Number(b.building.id === group.primary.id) - Number(a.building.id === group.primary.id)
        if (byPrimary !== 0) return byPrimary
        return b.unit.id - a.unit.id
      })
      const kept = sorted[0]
      const latest = historiesByUnit.get(kept.unit.id)?.[0]
      const allHistories = candidates.flatMap(({ unit }) => historiesByUnit.get(unit.id) ?? [])
      return {
        normalizedNumber,
        displayNumber: kept.unit.number,
        keptBuildingName: kept.building.name || '건물명 없음',
        latestVisitedAt: latest?.visitedAt ?? null,
        latestResult: latest?.result ?? null,
        visitCount: allHistories.length,
        isChinese: Boolean(kept.unit.isChinese),
        isRestaurant: Boolean(kept.unit.isRestaurant),
        usageType: kept.unit.usageType ?? kept.building.type,
      }
    })
    .sort((a, b) => a.normalizedNumber.localeCompare(b.normalizedNumber, 'ko', { numeric: true }))
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

/** 식당 등록과 같은 도로명·건물번호 열쇠. 자동 병합이 아니라 사람이 볼 후보를 찾는 데만 쓴다. */
export function buildingAddressCandidateKey(address: string): string {
  return buildingAddressKey(address)
}

export function planDuplicateBuildingMerge(
  buildings: Building[],
  options: { scopeCardId?: number; selectedPrimaryIds?: number[] } = {},
): MergePlan {
  const scope = options.scopeCardId
    ? buildings.filter((b) => b.cardId === options.scopeCardId)
    : buildings

  // 같은 카드 · 같은 도로명/건물번호를 후보로 묶는다. 전체 주소가 다른 후보는
  // 화면에서 기본 선택하지 않아 사람이 실제 같은 건물인지 확인해야 한다.
  const groups = new Map<string, Building[]>()
  for (const b of scope) {
    const key = `${b.cardId}::${buildingAddressCandidateKey(b.address)}`
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

    // 101 과 101호도 같은 호수다. 서버는 이 묶음의 방문 기록을 최신 세대로 통합한다.
    const seen = new Set(primary.units.map((u) => normalizeUnitNumber(u.number)))
    const duplicateUnitNumbers: string[] = []
    let movingUnits = 0
    for (const dup of absorbed) {
      for (const unit of dup.units) {
        const key = normalizeUnitNumber(unit.number)
        if (seen.has(key)) duplicateUnitNumbers.push(unit.number)
        else { seen.add(key); movingUnits++ }
      }
    }

    merge.push({
      primary,
      absorbed,
      movingUnits,
      duplicateUnitNumbers: [...new Set(duplicateUnitNumbers)].sort(),
      matchType: group.every((building) => normalizeAddress(building.address) === normalizeAddress(primary.address))
        ? 'exact'
        : 'candidate',
    })
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
  mergedUnits?: number
  movedUnits: number
  movedVisitHistories?: number
  auditIds?: number[]
  /** 현재 담당 자료 때문에 자동 판단하지 않은 묶음 */
  conflicts: Array<{ primaryId: number; conflictingNumbers: string[]; reason?: string }>
}
