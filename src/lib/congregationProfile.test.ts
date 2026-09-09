import { beforeEach, describe, expect, it } from 'vitest'
import {
  applyCongregationSettings,
  CONGREGATION_PROFILE_KEY,
  DEFAULT_CONGREGATION_PROFILE,
  getCongregationProfile,
  parseCongregationProfile,
} from './congregationProfile'

beforeEach(() => applyCongregationSettings({}))

describe('회중 설정', () => {
  it('설정이 없거나 깨졌으면 특정 회중 자료가 없는 중립값을 쓴다', () => {
    expect(parseCongregationProfile(undefined)).toBe(DEFAULT_CONGREGATION_PROFILE)
    expect(parseCongregationProfile('{')).toBe(DEFAULT_CONGREGATION_PROFILE)
  })

  it('다른 회중의 주소권역·지도·번역을 한 묶음으로 읽는다', () => {
    applyCongregationSettings({
      [CONGREGATION_PROFILE_KEY]: JSON.stringify({
        name: '인천 회중',
        province: '인천광역시',
        provinceShort: '인천',
        defaultCity: '인천광역시',
        mapCenter: { lat: 37.4563, lng: 126.7052 },
        territoryBoundary: [[126.7, 37.4], [126.8, 37.4], [126.8, 37.5]],
        placeNames: [['남동구', '南洞区', 'Namdong-gu']],
      }),
    })

    expect(getCongregationProfile()).toMatchObject({
      name: '인천 회중',
      province: '인천광역시',
      defaultCity: '인천광역시',
      mapCenter: { lat: 37.4563, lng: 126.7052 },
      placeNames: [['남동구', '南洞区', 'Namdong-gu']],
    })
  })

  it('좌표나 경계가 깨지면 중립 기본값으로 돌아간다', () => {
    const profile = parseCongregationProfile(JSON.stringify({
      mapCenter: { lat: 999, lng: 999 },
      territoryBoundary: [[1, 2]],
    }))
    expect(profile.mapCenter).toEqual(DEFAULT_CONGREGATION_PROFILE.mapCenter)
    expect(profile.territoryBoundary).toBe(DEFAULT_CONGREGATION_PROFILE.territoryBoundary)
  })

  it('새 회중이 빈 경계를 명시하면 다른 경계를 대신 그리지 않는다', () => {
    const profile = parseCongregationProfile(JSON.stringify({ territoryBoundary: [] }))
    expect(profile.territoryBoundary).toEqual([])
  })
})
