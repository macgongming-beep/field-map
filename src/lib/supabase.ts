import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string

// Database 타입 주입은 기존 코드 타입 충돌로 보류
// src/types/supabase.ts는 참고용으로 유지 (필요 시 수동 import:
//   import type { Database } from '../types/supabase'
//   const rows: Database['public']['Tables']['notifications']['Row'][] = data
// )
// 추후 점진적으로 마이그레이션 후 createClient<Database> 적용
/**
 * 모든 요청에 지금 로그인한 사람의 세션 토큰을 붙인다.
 *
 * 왜: anon 키는 앱 번들에 들어 있어 누구나 꺼낼 수 있다. 지금은 그 키만으로
 * 회중 데이터를 지울 수 있다. DB 정책이 이 헤더를 보고 '로그인한 사람인가' 를
 * 판단하게 하려고 붙인다 (private.request_session_user_id).
 *
 * 매 요청마다 저장소에서 새로 읽는다 — 로그아웃하면 즉시 안 붙는다.
 * 붙이는 곳이 여기 한 곳뿐이라 쓰기 287곳을 고칠 필요가 없다.
 *
 * ⚠ Realtime(WebSocket)에는 안 붙는다. 직접 구독하는 표의 SELECT 정책은
 *   별도 인증 설계가 필요하다. 구독하지 않는 상세 표는 이 헤더로 보호하며,
 *   지도는 별도 변경 신호를 받은 뒤 인증된 HTTP 요청으로 상세를 읽는다.
 */
export const fetchWithSessionToken: typeof fetch = (input, init) => {
  let token: string | null = null
  try {
    token = localStorage.getItem('auth_token') ?? sessionStorage.getItem('auth_token')
  } catch {
    token = null   // 저장소가 막힌 브라우저에서도 앱은 돌아야 한다
  }
  if (!token) return fetch(input, init)
  const headers = new Headers(init?.headers ?? {})
  headers.set('x-session-token', token)
  return fetch(input, { ...init, headers })
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  global: { fetch: fetchWithSessionToken },
})
