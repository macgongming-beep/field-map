import { describe, it, expect, afterEach, vi } from 'vitest'
import { geocodeAddressFirstMatch, geocodeAddressQuery, geocodeQuery, geocodeFirstMatch, isNaverMapsReady } from './naverGeocode'

type GeocodeCb = (status: string, response: unknown) => void

// window.naver.maps.Service mock 설치
function installNaver(geocodeImpl: (opts: { query: string }, cb: GeocodeCb) => void) {
  ;(window as unknown as { naver: unknown }).naver = {
    maps: {
      Service: {
        Status: { OK: 'OK', ERROR: 'ERROR' },
        geocode: geocodeImpl,
      },
    },
  }
}

function okResponse(y: number, x: number) {
  return { v2: { addresses: [{ y: String(y), x: String(x) }] } }
}

afterEach(() => {
  delete (window as unknown as { naver?: unknown }).naver
})

describe('isNaverMapsReady', () => {
  it('SDK 없으면 false', () => {
    expect(isNaverMapsReady()).toBe(false)
  })
  it('SDK 있으면 true', () => {
    installNaver(() => {})
    expect(isNaverMapsReady()).toBe(true)
  })
})

describe('geocodeQuery', () => {
  it('OK 응답 → 좌표 반환 (y=lat, x=lng)', async () => {
    installNaver((_opts, cb) => cb('OK', okResponse(37.5, 127.0)))
    expect(await geocodeQuery('용인시 처인구')).toEqual({ lat: 37.5, lng: 127.0 })
  })

  it('SDK 미로드 → null', async () => {
    expect(await geocodeQuery('아무거나')).toBeNull()
  })

  it('빈 쿼리 → null (SDK 호출 안 함)', async () => {
    const spy = vi.fn()
    installNaver(spy)
    expect(await geocodeQuery('   ')).toBeNull()
    expect(spy).not.toHaveBeenCalled()
  })

  it('비-OK 상태 → null', async () => {
    installNaver((_opts, cb) => cb('ERROR', {}))
    expect(await geocodeQuery('주소')).toBeNull()
  })

  it('주소 0개 응답 → null', async () => {
    installNaver((_opts, cb) => cb('OK', { v2: { addresses: [] } }))
    expect(await geocodeQuery('주소')).toBeNull()
  })

  it('범위 밖 좌표 → null (normalizeMapCoordinates)', async () => {
    installNaver((_opts, cb) => cb('OK', okResponse(0, 0)))
    expect(await geocodeQuery('주소')).toBeNull()
  })
})

describe('geocodeFirstMatch', () => {
  it('첫 성공 후보의 좌표 반환 + 이후 후보는 시도 안 함', async () => {
    const calls: string[] = []
    installNaver((opts, cb) => {
      calls.push(opts.query)
      if (opts.query === '두번째') cb('OK', okResponse(37.1, 127.1))
      else cb('ERROR', {})
    })
    const result = await geocodeFirstMatch(['첫번째', '두번째', '세번째'])
    expect(result).toEqual({ lat: 37.1, lng: 127.1 })
    expect(calls).toEqual(['첫번째', '두번째']) // 세번째는 시도 안 함
  })

  it('모두 실패 → null', async () => {
    installNaver((_opts, cb) => cb('ERROR', {}))
    expect(await geocodeFirstMatch(['a', 'b'])).toBeNull()
  })
})

describe('geocodeAddressQuery', () => {
  it('정식 도로명 주소와 좌표를 함께 반환한다', async () => {
    installNaver((_opts, cb) => cb('OK', { v2: { addresses: [{
      roadAddress: '경기도 용인시 기흥구 언동로 213',
      jibunAddress: '경기도 용인시 기흥구 중동 1',
      y: '37.2',
      x: '127.2',
    }] } }))
    expect(await geocodeAddressQuery('언동로213')).toEqual([{
      address: '경기도 용인시 기흥구 언동로 213', lat: 37.2, lng: 127.2,
    }])
  })

  it('여러 표현 중 처음 성공한 주소 후보만 사용한다', async () => {
    const calls: string[] = []
    installNaver((opts, cb) => {
      calls.push(opts.query)
      if (opts.query === '용인시 언동로 213') cb('OK', { v2: { addresses: [{ roadAddress: '언동로 213', y: '37.2', x: '127.2' }] } })
      else cb('ERROR', {})
    })
    expect(await geocodeAddressFirstMatch(['언동로213', '용인시 언동로 213'])).toHaveLength(1)
    expect(calls).toEqual(['언동로213', '용인시 언동로 213'])
  })
})
