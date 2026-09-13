#!/usr/bin/env node
// login_logs는 직접 접근할 수 없고 인증 함수와 get_login_logs RPC만 통해야 한다.
import { loadTestEnv } from './testEnvGuard.js'

const env = loadTestEnv()
if (!env.allowWrites) {
  console.error('✗ 쓰기 가드가 열리지 않았습니다')
  process.exit(1)
}

const headers = (token, prefer = true) => ({
  apikey: env.anonKey,
  'Content-Type': 'application/json',
  ...(prefer ? { Prefer: 'return=representation' } : {}),
  ...(token ? { 'x-session-token': token } : {}),
})
const rest = (path, init = {}, token) => fetch(`${env.url}/rest/v1/${path}`, {
  ...init,
  headers: { ...headers(token), ...(init.headers ?? {}) },
})
const rpc = (name, body, token) => rest(`rpc/${name}`, {
  method: 'POST', body: JSON.stringify(body), headers: headers(token, false),
}, token)
const rows = async (response) => {
  const body = await response.json().catch(() => null)
  return Array.isArray(body) ? body : []
}
const login = async (loginId, pin) => {
  const response = await rpc('auth_login', { p_login_id: loginId, p_pin: pin })
  const body = await response.json().catch(() => null)
  return Array.isArray(body) ? body[0] : body
}

let failures = 0
const check = (label, ok, detail = '') => {
  console.log(`${ok ? '✅' : '❌'} ${label}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures += 1
}

const marker = `_smoke_login_log_${Date.now()}`
let adminToken = null
let userId = null

try {
  adminToken = (await login(env.loginId, env.loginPin))?.token ?? null
  if (!adminToken) throw new Error('테스트 관리자로 로그인하지 못했습니다')

  const createUser = await rest('app_users?select=id', {
    method: 'POST',
    body: JSON.stringify({ login_id: marker, name: marker, pin: '4321', role: 'user', approval_status: 'approved' }),
  }, adminToken)
  userId = (await rows(createUser))[0]?.id ?? null
  if (!userId) throw new Error('사용자 fixture를 만들지 못했습니다')

  const directNoSession = await rest('login_logs?select=id', {
    method: 'POST', body: JSON.stringify({ user_id: userId }),
  })
  check('세션 없이 로그인 기록을 직접 넣지 못한다', !directNoSession.ok, `HTTP ${directNoSession.status}`)

  const directAdmin = await rest('login_logs?select=id', {
    method: 'POST', body: JSON.stringify({ user_id: userId }),
  }, adminToken)
  check('관리자도 표에 직접 로그인 기록을 넣지 못한다', !directAdmin.ok, `HTTP ${directAdmin.status}`)

  const user = await login(marker, '4321')
  const userToken = user?.token ?? null
  check('인증 함수 로그인은 계속 동작한다', Boolean(userToken))
  if (!userToken) throw new Error('일반 사용자 로그인이 실패했습니다')

  const ownLogs = await rpc('get_login_logs', { p_user_id: userId, p_since: null, p_limit: 10 }, userToken)
  const ownRows = await rows(ownLogs)
  check('본인은 RPC로 자기 로그인 기록을 읽는다', ownLogs.ok && ownRows.length >= 1, `${ownRows.length}행`)

  const otherLogs = await rpc('get_login_logs', { p_user_id: 1, p_since: null, p_limit: 10 }, userToken)
  check('일반 사용자는 남의 로그인 기록을 읽지 못한다', !otherLogs.ok, `HTTP ${otherLogs.status}`)
} catch (error) {
  console.error(`❌ smoke 중단 — ${error?.message ?? error}`)
  failures += 1
} finally {
  if (adminToken && userId) {
    await rest(`app_users?id=eq.${userId}&select=id`, { method: 'DELETE' }, adminToken).catch(() => null)
  }
}

console.log(`\n${failures === 0 ? '✅ login_logs 권한 smoke 통과' : `❌ ${failures}개 실패`}\n`)
process.exit(failures === 0 ? 0 : 1)
