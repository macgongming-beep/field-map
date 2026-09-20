// 식당을 승인할 때 건물 이름을 만든다. 기존 건물 이름 모양과 맞아야 한다.
import { describe, test, expect } from 'vitest'
import { buildingAddressKey, shortAddress } from './shortAddress'

describe('shortAddress', () => {
  test.each([
    ['경기 용인시 처인구 유림로147번길 55-2 엠제이오사옥', '유림로147번길 55-2'],
    ['경기도 용인시 기흥구 신갈로 25', '신갈로 25'],
    ['용인시 기흥구 구갈로60번길 11-1', '구갈로60번길 11-1'],
    ['경기 용인시 수지구 죽전로 150-1', '죽전로 150-1'],
    ['중부대로1158번길 22', '중부대로1158번길 22'],
  ])('%s → %s', (input, expected) => {
    expect(shortAddress(input)).toBe(expected)
  })

  test('도로명이 없으면 그대로 둔다 — 지어내지 않는다', () => {
    expect(shortAddress('이름없는 곳')).toBe('이름없는 곳')
    expect(shortAddress('  ')).toBe('')
  })
})

describe('buildingAddressKey', () => {
  test('짧은 주소와 전체 주소를 같은 건물 후보로 본다', () => {
    expect(buildingAddressKey('갈천로 76')).toBe('갈천로76')
    expect(buildingAddressKey('경기도 용인시 기흥구 갈천로 76 (상갈동, 1층)')).toBe('갈천로76')
  })

  test('도로명에 들어 있는 동 글자를 지우지 않는다', () => {
    expect(buildingAddressKey('용인시 수지구 동천로 12')).toBe('동천로12')
  })
})
