import { describe, it, expect } from 'vitest'
import { PHONE_PATTERN, splitTrailingPunctuation, toHref, toPhoneHref, URL_PATTERN } from './linkify'

// split 결과에서 홀수 인덱스가 URL — 컴포넌트와 동일한 방식으로 추출
function extractUrls(text: string): string[] {
  return text.split(URL_PATTERN).filter((_, i) => i % 2 === 1)
}

describe('URL_PATTERN', () => {
  it('네이버 지도 공유 링크를 찾는다', () => {
    const text = '[네이버지도]\n요커 광교숲속마을점\n경기 용인시 수지구 광교호수로378번길 4-3 1층 102호\nhttps://naver.me/xG08hWlg'
    expect(extractUrls(text)).toEqual(['https://naver.me/xG08hWlg'])
  })

  it('한 댓글에 여러 링크도 모두 찾는다', () => {
    expect(extractUrls('a https://a.com b http://b.co/x c')).toEqual(['https://a.com', 'http://b.co/x'])
  })

  it('www. 로 시작하는 주소도 찾는다', () => {
    expect(extractUrls('지도: www.naver.com 확인')).toEqual(['www.naver.com'])
  })

  it('링크가 없으면 빈 배열', () => {
    expect(extractUrls('여기 3시에 모여요')).toEqual([])
  })

  it('링크 아닌 텍스트 조각은 그대로 보존된다 (본문 유실 방지)', () => {
    const text = '앞 https://a.com 뒤'
    expect(text.split(URL_PATTERN).join('')).toBe(text)
  })
})

describe('splitTrailingPunctuation', () => {
  it('문장 끝 마침표는 링크에서 뺀다', () => {
    expect(splitTrailingPunctuation('https://naver.me/x.')).toEqual(['https://naver.me/x', '.'])
  })
  it('괄호·쉼표도 분리', () => {
    expect(splitTrailingPunctuation('https://a.com),')).toEqual(['https://a.com', '),'])
  })
  it('경로 끝 문자는 그대로 둔다', () => {
    expect(splitTrailingPunctuation('https://naver.me/xG08hWlg')).toEqual(['https://naver.me/xG08hWlg', ''])
  })
})

describe('toHref', () => {
  it('www. 는 https 를 붙인다', () => {
    expect(toHref('www.naver.com')).toBe('https://www.naver.com')
  })
  it('http(s) 주소는 그대로', () => {
    expect(toHref('https://naver.me/x')).toBe('https://naver.me/x')
    expect(toHref('http://a.co')).toBe('http://a.co')
  })
})

describe('전화번호 링크', () => {
  it('휴대전화와 지역번호를 찾고 날짜·시간은 무시한다', () => {
    const text = '9/16 13:30, 휴대전화 010-1234-5678, 사무실 031 123 4567'
    expect(text.split(PHONE_PATTERN).filter((_, i) => i % 2 === 1)).toEqual([
      '010-1234-5678',
      '031 123 4567',
    ])
  })

  it('tel 링크에서는 공백과 구분자를 제거한다', () => {
    expect(toPhoneHref('010-1234 5678')).toBe('tel:01012345678')
    expect(toPhoneHref('+82 10-1234-5678')).toBe('tel:+821012345678')
  })
})
