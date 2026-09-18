import { describe, test, expect } from 'vitest'
import { buildPointRows, matchesPointKind, type PointFilters } from './buildPointRows'
import type { Building, Unit, VisitHistory } from '../types'

const unit = (id: number, over: Partial<Unit> = {}): Unit =>
  ({ id, number: `${id}`, status: '미방문', isChinese: false, isRestaurant: false, isRegularVisit: false, ...over } as Unit)
const bld = (id: number, units: Unit[], over: Partial<Building> = {}): Building =>
  ({ id, cardId: 1, name: `건물${id}`, address: '주소', type: '주택', lat: 0, lng: 0, isChineseHeavy: false, units, ...over } as Building)

const ALL: PointFilters = { kind: '전체', status: '전체', regularVisit: '전체', memo: '전체' }
const none = () => [] as VisitHistory[]
const nums = (rows: ReturnType<typeof buildPointRows>) => rows.map((r) => r.unit.id)

describe('matchesPointKind', () => {
  test('종류별로 하나만 고른다', () => {
    expect(matchesPointKind(unit(1, { isChinese: true }), '중국어')).toBe(true)
    expect(matchesPointKind(unit(1), '중국어')).toBe(false)
    expect(matchesPointKind(unit(1, { isRestaurant: true }), '식당')).toBe(true)
    expect(matchesPointKind(unit(1, { isChinese: true, status: '대상외' }), '점검 필요')).toBe(true)
    expect(matchesPointKind(unit(1, { isChinese: true, status: '만남' }), '점검 필요')).toBe(false)
    expect(matchesPointKind(unit(1), '전체')).toBe(true)
  })
})

describe('buildPointRows', () => {
  test('건물마다 세대를 한 줄씩 편다', () => {
    const list = [bld(1, [unit(1), unit(2)]), bld(2, [unit(3)])]
    expect(nums(buildPointRows(list, ALL, none))).toEqual([1, 2, 3])
  })

  test('가장 최근 방문을 붙인다 (기록의 첫 번째)', () => {
    const h = [{ id: 9, visitedAt: '2026-06-01' }, { id: 8, visitedAt: '2026-01-01' }] as VisitHistory[]
    const rows = buildPointRows([bld(1, [unit(1)])], ALL, () => h)
    expect(rows[0].latestHistory?.id).toBe(9)
  })

  test('기록이 없으면 undefined', () => {
    const rows = buildPointRows([bld(1, [unit(1)])], ALL, none)
    expect(rows[0].latestHistory).toBeUndefined()
  })

  test('상태로 거른다', () => {
    const list = [bld(1, [unit(1, { status: '만남' }), unit(2)])]
    expect(nums(buildPointRows(list, { ...ALL, status: '만남' }, none))).toEqual([1])
  })

  test('정기방문 있음/없음', () => {
    const list = [bld(1, [unit(1, { isRegularVisit: true }), unit(2)])]
    expect(nums(buildPointRows(list, { ...ALL, regularVisit: '있음' }, none))).toEqual([1])
    expect(nums(buildPointRows(list, { ...ALL, regularVisit: '없음' }, none))).toEqual([2])
  })

  test('⚠ 메모는 **세대 메모만** 본다 — 건물 메모는 안 본다', () => {
    // 건물 필터의 '메모' 는 건물+세대를 둘 다 보지만 여기는 다르다
    const list = [bld(1, [unit(1)], { memo: '건물 메모' }), bld(2, [unit(2, { memo: '세대 메모' })])]
    expect(nums(buildPointRows(list, { ...ALL, memo: '있음' }, none))).toEqual([2])
  })

  test('종류와 다른 조건이 겹치면 둘 다 만족해야 한다', () => {
    const list = [bld(1, [
      unit(1, { isChinese: true, status: '만남' }),
      unit(2, { isChinese: true }),
      unit(3, { status: '만남' }),
    ])]
    expect(nums(buildPointRows(list, { ...ALL, kind: '중국어', status: '만남' }, none))).toEqual([1])
  })

  test('세대가 없는 건물은 줄이 안 생긴다', () => {
    expect(nums(buildPointRows([bld(1, [])], ALL, none))).toEqual([])
  })
})
