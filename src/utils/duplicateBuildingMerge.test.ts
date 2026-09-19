// 병합 계획. **여기가 "무엇을 지울지" 를 정한다.**
// 틀리면 방문 기록이 cascade 로 사라지고 되돌릴 수 없다.
import { describe, test, expect } from 'vitest'
import { buildDuplicateUnitPreviews, normalizeAddress, normalizeUnitNumber, planDuplicateBuildingMerge } from './duplicateBuildingMerge'
import { testBuilding, testUnit } from '../test/territoryFixture'
import type { Building, VisitHistory } from '../types'

/** 같은 주소를 쓰는 건물을 만든다 */
const at = (id: number, address: string, units: string[], cardId = 1): Building => ({
  ...testBuilding(id, cardId, `건물${id}`, units.map((n, i) => testUnit(id * 100 + i, n))),
  address,
})

describe('planDuplicateBuildingMerge', () => {
  test('중복이 없으면 아무것도 안 한다', () => {
    const plan = planDuplicateBuildingMerge([at(1, '언동로 1', ['101호']), at(2, '언동로 2', ['101호'])])
    expect(plan.merge).toEqual([])
    expect(plan.conflicts).toEqual([])
  })

  test('호수가 안 겹치면 합친다 — id 가 작은 쪽을 남긴다', () => {
    const plan = planDuplicateBuildingMerge([
      at(5, '언동로 1', ['101호', '102호']),
      at(2, '언동로 1', ['201호']),
    ])
    expect(plan.merge).toHaveLength(1)
    expect(plan.merge[0].primary.id).toBe(2)
    expect(plan.merge[0].absorbed.map((b) => b.id)).toEqual([5])
    expect(plan.merge[0].movingUnits).toBe(2)
  })

  test('호수가 겹치면 기록 통합 대상으로 표시한다', () => {
    const plan = planDuplicateBuildingMerge([
      at(1, '언동로 1', ['101호', '102호']),
      at(2, '언동로 1', ['102호', '103호']),
    ])
    expect(plan.conflicts).toEqual([])
    expect(plan.merge).toHaveLength(1)
    expect(plan.merge[0].duplicateUnitNumbers).toEqual(['102호'])
    expect(plan.merge[0].primary.id).toBe(1)
  })

  test('겹치는 묶음과 일반 묶음을 모두 합치기 계획에 넣는다', () => {
    const plan = planDuplicateBuildingMerge([
      at(1, '가로 1', ['101호']), at(2, '가로 1', ['202호']),      // 안 겹침
      at(3, '나로 2', ['101호']), at(4, '나로 2', ['101호']),      // 겹침
    ])
    expect(plan.merge.map((g) => g.primary.id)).toEqual([1, 3])
    expect(plan.merge[1].duplicateUnitNumbers).toEqual(['101호'])
    expect(plan.conflicts).toEqual([])
  })

  test('셋 이상이어도 겹치는 호수를 기록 통합 대상으로 모은다', () => {
    const plan = planDuplicateBuildingMerge([
      at(1, '언동로 1', ['101호']),
      at(2, '언동로 1', ['201호']),
      at(3, '언동로 1', ['101호']),   // 1번과 겹친다
    ])
    expect(plan.merge).toHaveLength(1)
    expect(plan.merge[0].duplicateUnitNumbers).toEqual(['101호'])
  })

  test('겹치는 호수를 여러 개면 모두 알려 준다 (중복 없이)', () => {
    const plan = planDuplicateBuildingMerge([
      at(1, '언동로 1', ['101호', '102호']),
      at(2, '언동로 1', ['102호', '101호']),
    ])
    expect(plan.merge[0].duplicateUnitNumbers).toEqual(['101호', '102호'])
  })

  test('카드가 다르면 주소가 같아도 남남이다', () => {
    const plan = planDuplicateBuildingMerge([
      at(1, '언동로 1', ['101호'], 1),
      at(2, '언동로 1', ['201호'], 2),
    ])
    expect(plan.merge).toEqual([])
  })

  test('공백과 하이픈 차이는 같은 주소로 본다', () => {
    expect(normalizeAddress(' 언동로 1-2 ')).toBe(normalizeAddress('언동로1-2'))
    const plan = planDuplicateBuildingMerge([
      at(1, '언동로 1-2', ['101호']),
      at(2, '언동로1-2', ['201호']),
    ])
    expect(plan.merge).toHaveLength(1)
  })

  test('카드를 지정하면 그 카드만 본다', () => {
    const plan = planDuplicateBuildingMerge([
      at(1, '언동로 1', ['101호'], 1), at(2, '언동로 1', ['201호'], 1),
      at(3, '가로 9', ['101호'], 2), at(4, '가로 9', ['201호'], 2),
    ], { scopeCardId: 2 })
    expect(plan.merge.map((g) => g.primary.id)).toEqual([3])
  })

  test('고른 묶음만 합친다', () => {
    const plan = planDuplicateBuildingMerge([
      at(1, '가로 1', ['101호']), at(2, '가로 1', ['201호']),
      at(3, '나로 2', ['101호']), at(4, '나로 2', ['201호']),
    ], { selectedPrimaryIds: [3] })
    expect(plan.merge.map((g) => g.primary.id)).toEqual([3])
  })
})

describe('normalizeUnitNumber — 실제 데이터가 섞여 있다', () => {
  test("'호' 가 붙든 안 붙든 같은 호수다", () => {
    // 백업 기준 1,572개 중 숫자만 394 · '호' 붙은 것 337
    expect(normalizeUnitNumber('101')).toBe(normalizeUnitNumber('101호'))
    expect(normalizeUnitNumber('101 호')).toBe(normalizeUnitNumber('101호'))
  })

  test('지하 표기도 같은 호수로 본다', () => {
    expect(normalizeUnitNumber('B02')).toBe(normalizeUnitNumber('B02호'))
    expect(normalizeUnitNumber('b02')).toBe(normalizeUnitNumber('B02'))
  })

  test('앞의 0 은 무시한다', () => {
    expect(normalizeUnitNumber('0101')).toBe(normalizeUnitNumber('101'))
  })

  test('글자 라벨은 공백만 없앤다', () => {
    expect(normalizeUnitNumber('호별 방문')).toBe(normalizeUnitNumber('호별방문'))
    expect(normalizeUnitNumber('2층')).not.toBe(normalizeUnitNumber('2'))
  })

  test('서로 다른 호수는 그대로 다르다', () => {
    expect(normalizeUnitNumber('101')).not.toBe(normalizeUnitNumber('102'))
    expect(normalizeUnitNumber('B101')).not.toBe(normalizeUnitNumber('101'))
  })
})

describe('충돌 판정이 표기 차이에 속지 않는다', () => {
  test("'101' 과 '101호' 가 겹치면 기록 통합 대상으로 잡는다", () => {
    const plan = planDuplicateBuildingMerge([
      at(1, '언동로 1', ['101']),
      at(2, '언동로 1', ['101호']),
    ])
    expect(plan.merge).toHaveLength(1)
    expect(plan.merge[0].duplicateUnitNumbers).toEqual(['101호'])
  })

  test("'B02' 와 'B02호' 도 마찬가지", () => {
    const plan = planDuplicateBuildingMerge([
      at(1, '언동로 1', ['B02']),
      at(2, '언동로 1', ['B02호']),
    ])
    expect(plan.merge[0].duplicateUnitNumbers).toEqual(['B02호'])
  })

  test('표기만 다른 게 아니면 정상 병합한다', () => {
    const plan = planDuplicateBuildingMerge([
      at(1, '언동로 1', ['101호']),
      at(2, '언동로 1', ['202']),
    ])
    expect(plan.merge).toHaveLength(1)
    expect(plan.merge[0].movingUnits).toBe(1)
  })
})

describe('buildDuplicateUnitPreviews', () => {
  test('최근 방문 세대의 현재 분류를 남기고 양쪽 기록 수를 합산한다', () => {
    const oldBuilding = at(1, '언동로 1', ['201호'])
    oldBuilding.units[0].isChinese = true
    const recentBuilding = at(2, '언동로 1', ['201'])
    recentBuilding.type = '상가'
    recentBuilding.units[0].isRestaurant = true
    recentBuilding.units[0].isChinese = false
    const plan = planDuplicateBuildingMerge([oldBuilding, recentBuilding])
    const histories: VisitHistory[] = [
      { id: 1, buildingId: 1, unitId: oldBuilding.units[0].id, visitor: '가', result: '만남', visitedAt: '2026-07-18', timeSlot: '오전' },
      { id: 2, buildingId: 2, unitId: recentBuilding.units[0].id, visitor: '나', result: '대상외', visitedAt: '2026-09-19', timeSlot: '오후' },
    ]

    const [preview] = buildDuplicateUnitPreviews(plan.merge[0], histories)
    expect(preview.keptBuildingName).toBe('건물2')
    expect(preview.latestResult).toBe('대상외')
    expect(preview.visitCount).toBe(2)
    expect(preview.isChinese).toBe(false)
    expect(preview.isRestaurant).toBe(true)
    expect(preview.usageType).toBe('상가')
  })

  test('방문 기록이 없으면 기준 건물 세대를 남긴다', () => {
    const primary = at(1, '언동로 1', ['201호'])
    const absorbed = at(2, '언동로 1', ['201'])
    const plan = planDuplicateBuildingMerge([primary, absorbed])

    const [preview] = buildDuplicateUnitPreviews(plan.merge[0], [])
    expect(preview.keptBuildingName).toBe('건물1')
    expect(preview.latestVisitedAt).toBeNull()
  })
})
