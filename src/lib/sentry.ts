// Sentry 에러 모니터링 + 성능 추적
// DSN은 환경변수로 (VITE_SENTRY_DSN), 없으면 비활성화 (개발/PR 환경에서 조용히 꺼짐)
import * as Sentry from '@sentry/react'

const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined

const SECRET_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi

/** 세션 토큰은 UUID 다. 보낼 기록 안의 UUID 를 모두 가린다 (다른 UUID 도 가려지지만 진단에는 지장 없다). */
export function scrubSecrets<T>(value: T): T {
  if (value == null) return value
  try {
    return JSON.parse(JSON.stringify(value).replace(SECRET_PATTERN, '[redacted]')) as T
  } catch {
    return value
  }
}

export function initSentry() {
  if (!dsn) {
    // DSN 없으면 비활성화 — 콘솔 경고만
    if (import.meta.env.PROD) {
      console.warn('[sentry] VITE_SENTRY_DSN not set, Sentry disabled')
    }
    return
  }

  Sentry.init({
    dsn,
    integrations: [
      Sentry.browserTracingIntegration(),
      // 화면에는 이름·주소·전화·방문 메모가 있다. 오류 리플레이에 글자와 사진이 그대로 담기지 않게 가린다.
      Sentry.replayIntegration({
        maskAllText: true,
        maskAllInputs: true,
        blockAllMedia: true,
      }),
    ],
    // 성능 샘플링 (production 10%)
    tracesSampleRate: import.meta.env.PROD ? 0.1 : 1.0,
    // 세션 리플레이 (에러 발생 시 100%, 평소 0%)
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 1.0,
    environment: import.meta.env.PROD ? 'production' : 'development',
    // 봉사자 정보 자동 추적 (login 시 setUser 호출)
    sendDefaultPii: false, // 기본 PII 자동 수집 X (privacy)
    // 무한 루프 / 알 수 없는 에러 자동 무시
    // 세션 토큰(UUID)이 콘솔·요청 기록에 섞여 들어가도 Sentry 로 보내지 않는다.
    beforeBreadcrumb: (breadcrumb) => scrubSecrets(breadcrumb),
    beforeSend: (event) => scrubSecrets(event),
    ignoreErrors: [
      'ResizeObserver loop limit exceeded',
      'Non-Error promise rejection captured',
    ],
  })
}

/** 로그인 후 호출 — Sentry 이슈 추적에 사용자 식별 추가 */
export function setSentryUser(user: { id: number; name: string }) {
  if (!dsn) return
  Sentry.setUser({
    id: String(user.id),
    username: user.name,
  })
}

export function clearSentryUser() {
  if (!dsn) return
  Sentry.setUser(null)
}

export { Sentry }
