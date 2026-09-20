import { describe, expect, test } from 'vitest'
import { testBuilding, testUnit } from '../test/territoryFixture'
import type { ReturnVisit } from '../types'
import { findReturnVisitBuilding, findReturnVisitUnit, getUserReturnVisits } from './returnVisits'

function visit(extra: Partial<ReturnVisit> = {}): ReturnVisit {
  return {
    id: 1,
    unitId: 101,
    buildingId: 10,
    displayName: '명지로 116 101호',
    nickname: '',
    address: '경기도 용인시 처인구 명지로 116',
    unitNumber: '101',
    assignedUserName: '홍길동',
    createdBy: '인도자',
    lastVisitedAt: null,
    lastResult: null,
    createdAt: '2026-09-20T00:00:00Z',
    ...extra,
  }
}

describe('정기방문 지도 소유권', () => {
  test('담당자에게 배정된 항목만 보여 주고 생성자에게는 타인 항목을 노출하지 않는다', () => {
    const rows = [
      visit({ id: 1, assignedUserName: '홍 길동', createdBy: '인도자' }),
      visit({ id: 2, assignedUserName: '김철수', createdBy: '홍길동' }),
    ]

    expect(getUserReturnVisits(rows, '홍길동').map((row) => row.id)).toEqual([1])
  })

  test('담당자가 비어 있는 옛 자료만 생성자를 fallback으로 사용한다', () => {
    expect(getUserReturnVisits([
      visit({ assignedUserName: '', createdBy: '홍길동' }),
    ], '홍길동')).toHaveLength(1)
  })
})

describe('정기방문 건물 복구', () => {
  const target = testBuilding(10, 1, '명지로 116', [testUnit(101, '101호')])
  target.address = '경기도 용인시 처인구 명지로 116'
  const other = testBuilding(20, 1, '명지로 118', [testUnit(201, '201호')])

  test('건물 ID가 오래됐으면 세대 ID로 현재 건물을 찾는다', () => {
    expect(findReturnVisitBuilding(visit({ buildingId: 999 }), [target, other])?.id).toBe(10)
  })

  test('연결 ID가 없으면 정확히 일치하는 유일한 주소로 찾는다', () => {
    expect(findReturnVisitBuilding(visit({ buildingId: null, unitId: null }), [target, other])?.id).toBe(10)
  })

  test('같은 주소가 여러 건물이면 임의로 고르지 않는다', () => {
    const duplicate = { ...other, address: target.address }
    expect(findReturnVisitBuilding(visit({ buildingId: null, unitId: null }), [target, duplicate])).toBeNull()
  })

  test('도로번호의 하이픈 위치가 다른 주소를 같은 곳으로 보지 않는다', () => {
    const first = { ...target, address: '만현로 82-6' }
    const second = { ...other, address: '만현로 8-26' }
    expect(findReturnVisitBuilding(
      visit({ buildingId: null, unitId: null, address: '만현로 82-6' }),
      [first, second],
    )?.id).toBe(10)
  })

  test('세대 ID가 오래됐으면 호수 표기로 현재 세대를 찾는다', () => {
    expect(findReturnVisitUnit(visit({ unitId: 999, unitNumber: '101호' }), target)?.id).toBe(101)
  })
})
