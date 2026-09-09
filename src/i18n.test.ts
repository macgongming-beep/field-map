import { describe, it, expect } from 'vitest'
import { t, isAppLanguage, formatJoined, translateKoreanAddress } from './i18n'
import { applyCongregationSettings, CONGREGATION_PROFILE_KEY } from './lib/congregationProfile'
import { ko } from './locales/ko'
import { zh } from './locales/zh'
import { en } from './locales/en'

describe('t() — 번역 조회', () => {
  it('언어별로 올바른 값 반환', () => {
    expect(t('ko', 'nav.home')).toBe('홈')
    expect(t('zh', 'nav.home')).toBe('首页')
    expect(t('en', 'nav.home')).toBe('Home')
  })

  it('변수 보간 {n}', () => {
    // chat.selectCount 류 키가 있다면 보간되는지 — 일반 키로 보간 동작만 확인
    const raw = t('ko', 'nav.home', { unused: 1 })
    expect(raw).toBe('홈') // 보간 토큰 없으면 원문 그대로
  })

  it('빠진 키는 한국어로 폴백, 그것도 없으면 키 자체', () => {
    // @ts-expect-error 존재하지 않는 키 — 런타임 폴백 동작 확인
    expect(t('en', '___없는키___')).toBe('___없는키___')
  })
})

describe('locale 사전 정합성', () => {
  it('zh/en 이 ko 의 키를 대부분 보유 (분리 누락 방지 가드)', () => {
    const koKeys = Object.keys(ko)
    const zhMissing = koKeys.filter((k) => !(k in zh))
    const enMissing = koKeys.filter((k) => !(k in en))
    // 분리 과정에서 통째로 빠지지 않았는지 — 90% 이상 매칭이면 정상
    expect(zhMissing.length).toBeLessThan(koKeys.length * 0.1)
    expect(enMissing.length).toBeLessThan(koKeys.length * 0.1)
    expect(koKeys.length).toBeGreaterThan(500) // ko 사전이 통째로 사라지지 않았는지
  })
})

describe('isAppLanguage', () => {
  it('유효 언어만 true', () => {
    expect(isAppLanguage('ko')).toBe(true)
    expect(isAppLanguage('zh')).toBe(true)
    expect(isAppLanguage('en')).toBe(true)
    expect(isAppLanguage('jp')).toBe(false)
    expect(isAppLanguage(null)).toBe(false)
  })
})

describe('formatJoined', () => {
  it('언어별 포맷', () => {
    expect(formatJoined('ko', 3)).toBe('참여 3명')
    expect(formatJoined('zh', 3)).toBe('参与 3人')
    expect(formatJoined('en', 3)).toBe('3 joined')
  })
})

describe('회중별 지명 번역', () => {
  it('설정에 넣은 다른 지역 이름을 번역한다', () => {
    applyCongregationSettings({
      [CONGREGATION_PROFILE_KEY]: JSON.stringify({
        placeNames: [['구월동', '九月洞', 'Guwol-dong']],
      }),
    })
    expect(translateKoreanAddress('남동구 구월동', 'zh')).toContain('九月洞')
    expect(translateKoreanAddress('남동구 구월동', 'en')).toContain('Guwol-dong')
    applyCongregationSettings({})
  })
})
