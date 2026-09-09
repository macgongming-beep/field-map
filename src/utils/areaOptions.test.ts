import { describe, it, expect } from 'vitest'
import {
  normalizeAreaName,
  getAreaOptions,
  getAreaFilterOptions,
  findSimilarArea,
} from './areaOptions'
import type { TerritoryCard } from '../types'

function card(region: string, area: string, name = `${region} ${area} 1`): TerritoryCard {
  return { id: Math.random(), name, region, area } as TerritoryCard
}

describe('동 목록 뽑기', () => {
  const cards = [
    card('처인구', '백암면'),
    card('처인구', '백암면', '처인구 백암면 2'),
    card('처인구', '고림동'),
    card('기흥구', '서천동'),
  ]

  it('실제 카드에 쓰인 동을 돌려준다 (하드코딩에 없어도)', () => {
    // 백암면은 territoryStructure 에 없지만 카드가 45장 있던 동이다
    expect(getAreaOptions(cards, '처인구')).toEqual(['고림동', '백암면'])
  })

  it('다른 지역의 동은 섞이지 않는다', () => {
    expect(getAreaOptions(cards, '기흥구')).toEqual(['서천동'])
  })

  it('카드가 없는 지역에 다른 회중의 옛 동 목록을 섞지 않는다', () => {
    const options = getAreaOptions(cards, '수지구')
    expect(options).toEqual([])
  })

  it('공백만 다른 이름을 하나로 본다', () => {
    const messy = [card('처인구', '백암면 '), card('처인구', '백암면')]
    expect(getAreaOptions(messy, '처인구')).toEqual(['백암면'])
  })

  it("'미배정' 은 목록에 섞지 않는다", () => {
    const withUnassigned = [...cards, card('처인구', '미배정')]
    expect(getAreaOptions(withUnassigned, '처인구')).not.toContain('미배정')
  })
})

describe('필터용 목록', () => {
  it("미배정 카드가 있으면 맨 뒤에 붙인다", () => {
    const cards = [card('처인구', '백암면'), card('처인구', '미배정')]
    expect(getAreaFilterOptions(cards, '처인구')).toEqual(['백암면', '미배정'])
  })

  it('미배정 카드가 없으면 붙이지 않는다', () => {
    expect(getAreaFilterOptions([card('처인구', '백암면')], '처인구')).toEqual(['백암면'])
  })
})

describe('이름 정리', () => {
  it('앞뒤 공백과 겹친 공백을 없앤다', () => {
    expect(normalizeAreaName('  백암면 ')).toBe('백암면')
    expect(normalizeAreaName('백암  면')).toBe('백암 면')
  })
})

describe('오타 잡기 — 동이 둘로 갈라지는 걸 막는다', () => {
  const existing = ['백암면', '고림동', '원삼면']

  it('한 글자 다른 이름을 찾아낸다', () => {
    expect(findSimilarArea('백앙면', existing)).toBe('백암면')
  })

  it('공백만 다른 이름을 찾아낸다', () => {
    expect(findSimilarArea('백암 면', existing)).toBe('백암면')
  })

  it('한 글자 빠진 이름도 찾아낸다', () => {
    expect(findSimilarArea('백암', existing)).toBe('백암면')
  })

  it('똑같은 이름은 오타가 아니다', () => {
    expect(findSimilarArea('백암면', existing)).toBeNull()
  })

  it('진짜 다른 동은 경고하지 않는다 — 잘못된 경고가 더 나쁘다', () => {
    expect(findSimilarArea('남사읍', existing)).toBeNull()
    expect(findSimilarArea('양지면', existing)).toBeNull()
  })

  it('빈 값은 조용히 넘어간다', () => {
    expect(findSimilarArea('', existing)).toBeNull()
  })
})
