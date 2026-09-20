import { describe, expect, test } from 'vitest'
import type { ClassifiedRestaurantPlace } from './restaurantPlaceCandidate'
import { candidateBuildingName, candidateBuildingType, candidateFirstUnitName } from './searchedPlaceDraft'

const candidate = (overrides: Partial<ClassifiedRestaurantPlace> = {}): ClassifiedRestaurantPlace => ({
  name: '카멜리아힐',
  address: '경기도 용인시 기흥구 언동로 213',
  category: '카페,디저트',
  lat: 37.275,
  lng: 127.118,
  source: 'place',
  buildingId: null,
  buildingIds: [],
  status: 'new',
  scope: 'card',
  ...overrides,
})

describe('검색 장소 등록 초기값', () => {
  test('순수 주소 결과는 주택과 상가를 임의로 결정하지 않는다', () => {
    expect(candidateBuildingType(candidate({ source: 'address', category: '주소' }))).toBeNull()
  })

  test('원룸·고시원·하숙은 주택으로 판정한다', () => {
    expect(candidateBuildingType(candidate({ category: '부동산>원룸' }))).toBe('주택')
    expect(candidateBuildingType(candidate({ category: '생활,편의>고시원' }))).toBe('주택')
    expect(candidateBuildingType(candidate({ category: '하숙' }))).toBe('주택')
  })

  test('식당과 편의점은 상가로 판정한다', () => {
    expect(candidateBuildingType(candidate({ category: '한식>육류,고기' }))).toBe('상가')
    expect(candidateBuildingType(candidate({ category: '편의점' }))).toBe('상가')
    expect(candidateBuildingType(candidate({ category: '숙박>펜션' }))).toBe('상가')
  })

  test('상가는 짧은 도로명을 건물명으로, 상호를 세대명으로 쓴다', () => {
    const place = candidate()
    expect(candidateBuildingName(place, '상가')).toBe('언동로 213')
    expect(candidateFirstUnitName(place, '상가')).toBe('카멜리아힐')
  })

  test('주거 장소는 검색된 건물명을 보존한다', () => {
    const place = candidate({ name: '에버그린원룸', category: '부동산>원룸' })
    expect(candidateBuildingName(place, '주택')).toBe('에버그린원룸')
  })
})
