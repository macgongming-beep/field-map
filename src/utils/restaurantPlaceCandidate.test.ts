import { describe, expect, it } from 'vitest'
import type { Building, CardBoundary } from '../types'
import { classifyRestaurantPlaces } from './restaurantPlaceCandidate'

const buildings = [{
  id: 1, cardId: 10, name: '우정원', address: '우정원길 1', type: '상가', lat: 37.2, lng: 127.2,
  units: [{ id: 11, buildingId: 1, number: '등록식당', status: '미방문', isRestaurant: true }],
}] as Building[]

const boundaries = [{ cardId: 10, points: [
  { lat: 37.19, lng: 127.19 }, { lat: 37.19, lng: 127.21 },
  { lat: 37.21, lng: 127.21 }, { lat: 37.21, lng: 127.19 },
] }] as CardBoundary[]

describe('classifyRestaurantPlaces', () => {
  it('같은 위치와 이름의 식당은 이미 등록됨으로 판정한다', () => {
    const [result] = classifyRestaurantPlaces([
      { name: '등록식당', address: '용인시 우정원길 1', category: '중식', lat: 37.2, lng: 127.2 },
    ], buildings, boundaries)
    expect(result).toMatchObject({ status: 'registered', buildingId: 1, scope: 'card' })
  })

  it('같은 건물의 새 이름은 기존 건물 추가로 판정한다', () => {
    const [result] = classifyRestaurantPlaces([
      { name: '새식당', address: '경기도 용인시 우정원길 1', category: '중식', lat: 37.2002, lng: 127.2002 },
    ], buildings, boundaries)
    expect(result).toMatchObject({ status: 'existing-building', buildingId: 1 })
  })

  it('멀리 떨어진 후보는 봉사 범위 밖으로 표시하지만 결과에서 버리지 않는다', () => {
    const results = classifyRestaurantPlaces([
      { name: '먼식당', address: '서울시 먼길 1', category: '중식', lat: 37.6, lng: 126.9 },
    ], buildings, boundaries)
    expect(results).toHaveLength(1)
    expect(results[0]).toMatchObject({ status: 'new', scope: 'outside' })
  })

  it('같은 주소 건물이 여러 개면 새 건물로 오판하지 않고 확인 대상으로 둔다', () => {
    const duplicated = [
      buildings[0],
      { ...buildings[0], id: 2, name: '우정원 별관', units: [] },
    ] as Building[]
    const [result] = classifyRestaurantPlaces([
      { name: '새식당', address: '용인시 우정원길 1', category: '중식', lat: 37.2, lng: 127.2 },
    ], duplicated, boundaries)
    expect(result).toMatchObject({
      status: 'ambiguous-building',
      buildingId: null,
      buildingIds: [1, 2],
    })
  })
})
