// 지오코딩 후보 만들기. 사람이 적은 주소는 지도가 못 알아듣는 모양이 많다.
import { describe, test, expect, beforeEach } from 'vitest'
import { getGeocodeCandidates } from './geocodeCandidates'
import { setRegions } from '../lib/regions'
import { applyCongregationSettings, CONGREGATION_PROFILE_KEY } from '../lib/congregationProfile'

beforeEach(() => {
  applyCongregationSettings({
    [CONGREGATION_PROFILE_KEY]: JSON.stringify({
      province: '경기도',
      provinceShort: '경기',
      defaultCity: '용인시',
    }),
  })
  setRegions([
    { id: 1, name: '처인구', city: '용인시', sortOrder: 1, nameZh: '', nameEn: '' },
    { id: 2, name: '기흥구', city: '용인시', sortOrder: 2, nameZh: '', nameEn: '' },
  ])
})

describe('getGeocodeCandidates', () => {
  test('뒤에 붙은 건물 이름을 뗀 후보가 들어간다', () => {
    // 실제로 여기서 막혔다 — '엠제이오사옥' 때문에 좌표를 못 찾았다
    const c = getGeocodeCandidates('경기 용인시 처인구 유림로147번길 55-2 엠제이오사옥')
    expect(c.some((x) => x.endsWith('유림로147번길 55-2'))).toBe(true)
  })

  test('시가 없으면 구를 보고 시를 붙인다', () => {
    const c = getGeocodeCandidates('처인구 유림로147번길 55-2')
    expect(c.some((x) => x.startsWith('경기도 용인시'))).toBe(true)
  })

  test('도로명 앞의 동을 뗀 후보도 만든다', () => {
    const c = getGeocodeCandidates('경기 용인시 처인구 유방동 유림로147번길 55-2')
    expect(c.some((x) => !x.includes('유방동'))).toBe(true)
  })

  test('원래 주소는 항상 후보에 있다', () => {
    const raw = '경기 용인시 기흥구 신갈로 25'
    expect(getGeocodeCandidates(raw)).toContain(raw)
  })

  test('빈 주소는 후보가 없다 — 지도를 괜히 부르지 않는다', () => {
    expect(getGeocodeCandidates('')).toEqual([])
    expect(getGeocodeCandidates('   ')).toEqual([])
  })

  test('다른 회중은 자기 주소권역을 붙이고 용인시를 섞지 않는다', () => {
    applyCongregationSettings({
      [CONGREGATION_PROFILE_KEY]: JSON.stringify({
        province: '인천광역시',
        provinceShort: '인천',
        defaultCity: '인천광역시',
      }),
    })
    setRegions([
      { id: 9, name: '남동구', city: '인천광역시', sortOrder: 1, nameZh: '', nameEn: '' },
    ])

    const candidates = getGeocodeCandidates('남동구 구월로 10')
    expect(candidates).toContain('인천광역시 남동구 구월로 10')
    expect(candidates.some((candidate) => candidate.includes('용인시'))).toBe(false)
  })
})
