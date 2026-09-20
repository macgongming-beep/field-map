import { describe, test, expect } from 'vitest'
import { getBuildingPin, getPinGroup, isForbiddenBuilding } from './buildingPin'
import type { Building, Unit } from '../types'

const unit = (over: Partial<Unit> = {}): Unit =>
  ({ id: 1, buildingId: 1, number: '101호', status: '미방문', isChinese: true, ...over }) as Unit

const bld = (over: Partial<Building> = {}): Building =>
  ({ id: 1, cardId: 1, name: '집', address: '', type: '주택', lat: 0, lng: 0, units: [], ...over }) as Building

describe('핀 — 색(성격)과 채움(가야 하나)을 나눈다', () => {
  test('방문금지는 채운 검정 — 더 갈 일이 없다', () => {
    expect(getBuildingPin(bld({ warning: true, units: [unit()] })))
      .toEqual({ tone: '방문금지', filled: true, ring: null })
  })

  test('⚠ 거절 세대가 있어도 **갈 곳이 남으면 방문금지가 아니다**', () => {
    // 세대 하나가 거절이라고 건물을 검정으로 칠하면, 같은 건물의 미방문
    // 세대를 아무도 안 간다. 정기방문에서 겪은 실수와 같은 모양이다.
    const b = bld({ units: [unit({ id: 1, status: '거절' }), unit({ id: 2, status: '미방문' })] })
    expect(isForbiddenBuilding(b)).toBe(false)
    expect(getBuildingPin(b)).toEqual({ tone: '보통', filled: false, ring: null })
    expect(getPinGroup(b)).toBe('방문필요')
  })

  test('부재도 갈 곳이다 — 다시 가 봐야 한다', () => {
    const b = bld({ units: [unit({ id: 1, status: '거절' }), unit({ id: 2, status: '부재' })] })
    expect(getPinGroup(b)).toBe('방문필요')
  })

  test('갈 곳이 하나도 안 남으면 그때 방문금지다', () => {
    const b = bld({ units: [unit({ id: 1, status: '거절' }), unit({ id: 2, status: '만남' })] })
    expect(isForbiddenBuilding(b)).toBe(true)
    expect(getPinGroup(b)).toBe('방문금지')
  })

  test('건물 통째 금지(warning)는 갈 곳이 남아도 금지 — 들어갈 수가 없다', () => {
    const b = bld({ warning: true, units: [unit({ status: '미방문' })] })
    expect(isForbiddenBuilding(b)).toBe(true)
    expect(getPinGroup(b)).toBe('방문금지')
  })

  test('명시적인 건물 출입불가 상태는 레거시 warning 없이도 금지다', () => {
    const b = bld({ accessStatus: 'blocked', warning: false, units: [unit({ status: '미방문' })] })
    expect(isForbiddenBuilding(b)).toBe(true)
    expect(getPinGroup(b)).toBe('방문금지')
  })

  test('⚠ 정기방문 세대가 있어도 **갈 곳이 남으면 테두리**', () => {
    // 예전에는 정기방문이 먼저 판정돼 금색으로 꽉 차 보였고, 나머지 세대를 지나쳤다
    const b = bld({ units: [unit({ id: 1, isRegularVisit: true, status: '만남' }), unit({ id: 2, status: '미방문' })] })
    expect(getBuildingPin(b)).toEqual({ tone: '정기방문', filled: false, ring: '정기방문' })
    expect(getPinGroup(b)).toBe('방문필요')
  })

  test('정기방문이고 다 갔고 파악됐으면 채운 금색', () => {
    const b = bld({ unitsSurveyed: true, units: [unit({ isRegularVisit: true, status: '만남' })] })
    expect(getBuildingPin(b)).toEqual({ tone: '정기방문', filled: true, ring: null })
    expect(getPinGroup(b)).toBe('정기방문')
  })
})

describe('세대를 다 파악했나', () => {
  const 다감 = [unit({ id: 1, status: '만남' }), unit({ id: 2, status: '대상외' })]

  test('⚠ 파악 표시가 없으면 **완료가 아니다** — 이게 이번 변경의 핵심이다', () => {
    // 104·105호만 등록된 건물에서 둘 다 방문 → 예전에는 '완료'(초록)라 아무도 안 갔다
    const b = bld({ units: 다감 })
    expect(getBuildingPin(b).filled).toBe(false)
    expect(getPinGroup(b)).toBe('확인필요')
  })

  test('파악했다고 표시하면 완료', () => {
    const b = bld({ units: 다감, unitsSurveyed: true })
    expect(getBuildingPin(b).filled).toBe(true)
    expect(getPinGroup(b)).toBe('완료')
  })

  test('⚠ 파악했다고 해도 **안 간 세대가 있으면** 완료가 아니다', () => {
    const b = bld({ unitsSurveyed: true, units: [unit({ id: 1, status: '만남' }), unit({ id: 2, status: '부재' })] })
    expect(getBuildingPin(b).filled).toBe(false)
    expect(getPinGroup(b)).toBe('방문필요')
  })

  test('부재는 아직 가야 할 곳이다 (만남·대상외만 끝난 것)', () => {
    expect(getPinGroup(bld({ unitsSurveyed: true, units: [unit({ status: '부재' })] }))).toBe('방문필요')
  })

  test('세대가 하나도 없으면 완료가 아니다', () => {
    expect(getBuildingPin(bld({ unitsSurveyed: true, units: [] })).filled).toBe(false)
    expect(getPinGroup(bld({ unitsSurveyed: true, units: [] }))).toBe('방문필요')
  })

  test('정기방문 전용 지도에서 세대를 못 찾아도 금색 성격을 유지한다', () => {
    expect(getBuildingPin(bld({ units: [], mapPinToneOverride: '정기방문' })))
      .toEqual({ tone: '정기방문', filled: false, ring: '정기방문' })
  })
})

describe('범례 분류 — 건물 하나는 정확히 한 곳에', () => {
  test('방문금지가 가장 먼저', () => {
    const b = bld({ warning: true, unitsSurveyed: true, units: [unit({ isRegularVisit: true, status: '미방문' })] })
    expect(getPinGroup(b)).toBe('방문금지')
  })
})

describe('테두리 — 왜 눈여겨봐야 하는지', () => {
  test('⚠ 등록된 건 다 갔지만 미확인 → **초록 테두리에 파란 속**', () => {
    const b = bld({ units: [unit({ status: '만남' })] })
    expect(getBuildingPin(b)).toEqual({ tone: '보통', filled: false, ring: '보통' })
  })

  test('아직 안 간 보통 건물은 **테두리가 없다** — 헷갈릴 것이 없다', () => {
    const b = bld({ units: [unit({ status: '미방문' })] })
    expect(getBuildingPin(b)).toEqual({ tone: '보통', filled: false, ring: null })
  })

  test('갈 곳 남은 정기방문은 금색 테두리', () => {
    const b = bld({ units: [unit({ id: 1, isRegularVisit: true, status: '만남' }), unit({ id: 2, status: '미방문' })] })
    expect(getBuildingPin(b).ring).toBe('정기방문')
  })

  test('채운 핀에는 테두리를 안 준다 (색이 이미 성격을 말한다)', () => {
    const b = bld({ unitsSurveyed: true, units: [unit({ status: '만남' })] })
    expect(getBuildingPin(b)).toEqual({ tone: '보통', filled: true, ring: null })
  })
})
