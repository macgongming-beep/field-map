// 본문 속 URL 감지 (댓글·채팅 링크화 공용 로직)

// http(s):// 로 시작하거나 www. 로 시작하는 토큰
// split() 에 쓰므로 캡처 그룹 1개 유지 — 홀수 인덱스가 URL 이 된다.
export const URL_PATTERN = /(https?:\/\/[^\s<>()[\]{}"']+|www\.[^\s<>()[\]{}"']+)/gi

// 한국 전화번호. 휴대전화, 02, 지역번호(031 등), 070을 공백/하이픈 없이 쓴 경우도 받는다.
// 날짜나 시간 같은 짧은 숫자는 링크로 오인하지 않도록 마지막 7~8자리를 요구한다.
export const PHONE_PATTERN = /((?:\+82[-.\s]?(?:10|1[16789]|2|[3-6][1-5]|70)|0(?:10|1[16789]|2|[3-6][1-5]|70))[-.\s]?\d{3,4}[-.\s]?\d{4})/g

// LinkifiedText의 split()용. 캡처 그룹은 전체 토큰 하나만 유지해야 홀수 인덱스가 링크가 된다.
export const LINK_TOKEN_PATTERN = /(https?:\/\/[^\s<>()[\]{}"']+|www\.[^\s<>()[\]{}"']+|(?:\+82[-.\s]?(?:10|1[16789]|2|[3-6][1-5]|70)|0(?:10|1[16789]|2|[3-6][1-5]|70))[-.\s]?\d{3,4}[-.\s]?\d{4})/gi

/** 링크 끝에 붙기 쉬운 문장부호를 링크에서 분리 ("...naver.me/x." → ["...naver.me/x", "."]) */
export function splitTrailingPunctuation(raw: string): [string, string] {
  const match = raw.match(/[.,;:!?)\]}]+$/)
  if (!match) return [raw, '']
  return [raw.slice(0, raw.length - match[0].length), match[0]]
}

/** www. 로 시작하면 https 를 붙여 실제 이동 가능한 주소로 */
export function toHref(url: string): string {
  return /^www\./i.test(url) ? `https://${url}` : url
}

export function isUrlToken(value: string): boolean {
  return /^(?:https?:\/\/|www\.)/i.test(value)
}

/** tel:에는 구분자를 제거한 번호만 넣는다. +82는 국제 형식을 그대로 보존한다. */
export function toPhoneHref(phone: string): string {
  const compact = phone.trim().replace(/[\s.-]/g, '')
  return `tel:${compact}`
}
