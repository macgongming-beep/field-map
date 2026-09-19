// 본문 속 URL·전화번호를 눌러서 열거나 전화할 수 있게 표시 (댓글·채팅 공용)
// - 네이버 지도 공유(https://naver.me/...) 처럼 붙여넣는 링크를 바로 열 수 있게
// - dangerouslySetInnerHTML 을 쓰지 않고 텍스트/링크 조각으로 나눠 렌더 (XSS 안전)
// - 새 탭 + noopener/noreferrer (탭 탈취 방지)

import { isUrlToken, LINK_TOKEN_PATTERN, splitTrailingPunctuation, toHref, toPhoneHref } from '../utils/linkify'

export function LinkifiedText({ text }: { text: string }) {
  const parts = text.split(LINK_TOKEN_PATTERN)

  return (
    <>
      {parts.map((part, index) => {
        // split 결과에서 홀수 인덱스가 매칭된 URL 또는 전화번호
        if (index % 2 === 0) return part
        const isUrl = isUrlToken(part)
        const [label, trailing] = isUrl ? splitTrailingPunctuation(part) : [part, '']
        const href = isUrl ? toHref(label) : toPhoneHref(label)
        return (
          <span key={index}>
            <a
              href={href}
              target={isUrl ? '_blank' : undefined}
              rel={isUrl ? 'noopener noreferrer' : undefined}
              aria-label={isUrl ? undefined : `${label} 전화 걸기`}
              onClick={(event) => event.stopPropagation()}
              style={{ color: 'var(--primary-600, #1E5BD0)', textDecoration: 'underline', overflowWrap: 'anywhere' }}
            >
              {label}
            </a>
            {trailing}
          </span>
        )
      })}
    </>
  )
}
