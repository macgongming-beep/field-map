import { describe, expect, it } from 'vitest'
import { isAddressLikePlaceQuery } from './placeSearch'

describe('통합 장소 검색어 판정', () => {
  it('도로명 주소는 주소 검색을 우선한다', () => {
    expect(isAddressLikePlaceQuery('언동로213')).toBe(true)
    expect(isAddressLikePlaceQuery('죽전로 152-1')).toBe(true)
  })

  it('상호명은 장소 검색을 우선한다', () => {
    expect(isAddressLikePlaceQuery('만리장성')).toBe(false)
    expect(isAddressLikePlaceQuery('스타벅스 죽전점')).toBe(false)
  })
})
