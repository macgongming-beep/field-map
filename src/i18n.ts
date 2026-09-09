import { ko } from './locales/ko'
import { zh } from './locales/zh'
import { en } from './locales/en'
import { getCongregationProfile } from './lib/congregationProfile'
import { getRegions } from './lib/regions'

export type AppLanguage = 'ko' | 'zh' | 'en'

export const languageLabels: Record<AppLanguage, string> = {
  ko: '한국어',
  zh: '简体中文',
  en: 'English',
}

const dictionary = { ko, zh, en } satisfies Record<AppLanguage, Record<string, string>>

// 현재 화면 언어 — App 이 언어를 바꿀 때마다 여기에 반영한다.
// ⚠ localStorage 를 직접 읽지 않는다: 언어는 사용자별 키(chsLanguage:<userId>)에
//   저장되어 있어서, 'language' 같은 키를 읽으면 항상 한국어로 떨어진다.
let activeLanguage: AppLanguage = 'ko'

export function setCurrentLang(language: AppLanguage): void {
  activeLanguage = language
}

/**
 * 컴포넌트 밖(이벤트 핸들러·mutation·모듈 상수)에서 t() 를 부를 때 쓰는 현재 언어.
 * props 로 language 를 받을 수 있는 곳에서는 그걸 그대로 쓰는 편이 낫다.
 */
export function currentLang(): AppLanguage {
  return activeLanguage
}

export function t(language: AppLanguage, key: keyof typeof dictionary.ko, vars?: Record<string, string | number>): string {
  const raw = dictionary[language][key] ?? dictionary.ko[key] ?? key
  if (!vars) return raw
  return raw.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ''))
}

export function formatLeaderOf(lang: AppLanguage, name: string): string {
  if (lang === 'en') return `Leader: ${name}`
  if (lang === 'zh') return `带头人 ${name}`
  return `${name} 인도자`
}

export function formatJoined(lang: AppLanguage, count: number): string {
  if (lang === 'en') return `${count} joined`
  if (lang === 'zh') return `参与 ${count}人`
  return `참여 ${count}명`
}

export function formatApplied(lang: AppLanguage, count: number): string {
  if (lang === 'en') return `${count} applied`
  if (lang === 'zh') return `申请 ${count}人`
  return `신청 ${count}명`
}

export function formatCardCount(lang: AppLanguage, count: number): string {
  if (lang === 'en') return `${count} cards`
  if (lang === 'zh') return `${count}张卡片`
  return `카드 ${count}개`
}

export function formatLeadSub(lang: AppLanguage, applied: number, _cards: number): string {
  return formatApplied(lang, applied)
}

export function formatPeriod(lang: AppLanguage, hour: number): string {
  if (lang === 'en') return hour < 12 ? 'AM' : hour < 18 ? 'PM' : 'Eve'
  if (lang === 'zh') return hour < 12 ? '上午' : hour < 18 ? '下午' : '晚上'
  return hour < 12 ? '오전' : hour < 18 ? '오후' : '저녁'
}

export const weekdayShortLabels: Record<AppLanguage, string[]> = {
  ko: ['일', '월', '화', '수', '목', '금', '토'],
  zh: ['日', '一', '二', '三', '四', '五', '六'],
  en: ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'],
}

// 한국 지명 번역 테이블 [한국어, 중국어, 영어]
const COMMON_PLACE_NAMES: [string, string, string][] = [
  ['기타', '其他', 'Other'],
  ['미배정', '未分配', 'Unassigned'],
]

// 긴 이름부터 바꾼다 — '남동' 같은 짧은 이름이 '강남동' 안을 먼저 바꿔버리지 않도록
function getSortedPlaceNames(): [string, string, string][] {
  const dynamic: [string, string, string][] = [
    ...getCongregationProfile().placeNames,
    ...getRegions().map((region): [string, string, string] => [region.name, region.nameZh, region.nameEn]),
  ]
  const seen = new Set<string>()
  return [...dynamic, ...COMMON_PLACE_NAMES]
    .filter(([ko]) => {
      if (!ko || seen.has(ko)) return false
      seen.add(ko)
      return true
    })
    .sort((a, b) => b[0].length - a[0].length)
}

/**
 * 한국어 주소/지명 문자열을 대상 언어로 번역.
 * ko면 그대로 반환. translatePlaceNames=false 면 그대로 반환.
 */
export function translateKoreanAddress(
  address: string,
  lang: AppLanguage,
  enabled = true,
): string {
  if (lang === 'ko' || !enabled) return address
  let result = address
  for (const [ko, zh, en] of getSortedPlaceNames()) {
    const translated = lang === 'zh' ? zh : en
    if (translated) result = result.replaceAll(ko, translated)
  }
  return result
}

export function isAppLanguage(value: unknown): value is AppLanguage {
  return value === 'ko' || value === 'zh' || value === 'en'
}
