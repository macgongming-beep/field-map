#!/usr/bin/env node
// 사용자 계정의 본인 수정 범위와 관리자 비활성화 계약을 실제 REST 요청으로 검증한다.
import { loadTestEnv } from './testEnvGuard.js'

const env = loadTestEnv()
if (!env.allowWrites) throw new Error('쓰기 가드가 열리지 않았습니다')

const headers = (token, representation = true) => ({
  apikey: env.anonKey, 'Content-Type': 'application/json',
  ...(representation ? { Prefer: 'return=representation' } : {}),
  ...(token ? { 'x-session-token': token } : {}),
})
const rest = (path, init = {}, token) => fetch(`${env.url}/rest/v1/${path}`, {
  ...init, headers: { ...headers(token), ...(init.headers ?? {}) },
})
const rpc = (name, payload, token) => rest(`rpc/${name}`, {
  method: 'POST', body: JSON.stringify(payload), headers: headers(token, false),
}, token)
const body = (response) => response.json().catch(() => null)
const rows = async (response) => { const value = await body(response); return Array.isArray(value) ? value : [] }
const login = async (loginId, pin) => {
  const response = await rpc('auth_login', {
    p_login_id: loginId, p_pin: pin, p_device_label: 'app-user-policy-smoke', p_user_agent: 'smoke',
  })
  const value = await body(response)
  return { response, value: Array.isArray(value) ? value[0] : value }
}

let failures = 0
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'OK' : 'FAIL'} ${label}${detail ? ` - ${detail}` : ''}`)
  if (!ok) failures += 1
}

const marker = `_app_user_policy_${Date.now()}`
const made = []
let developerToken = null

try {
  developerToken = (await login('test-admin', '1234')).value?.token ?? null
  if (!developerToken) throw new Error('테스트 개발자로 로그인하지 못했습니다')

  const createUser = async (key, role = 'user') => {
    const loginId = `${marker}_${key}`
    const name = `${marker}_${key}_name`
    const created = await rows(await rest('app_users?select=id,name,role', {
      method: 'POST', body: JSON.stringify({
        login_id: loginId, name, pin: '4321', role,
        approval_status: 'approved', is_active: true, group_name: '기존',
      }),
    }, developerToken))
    if (!created[0]?.id) throw new Error(`${key} fixture 생성 실패`)
    made.push(created[0].id)
    const session = await login(loginId, '4321')
    if (!session.value?.token) throw new Error(`${key} fixture 로그인 실패`)
    return { id: created[0].id, loginId, name, token: session.value.token }
  }

  const user = await createUser('user')
  const victim = await createUser('victim')
  const admin = await createUser('admin', 'admin')

  const ownAllowed = await rows(await rest(`app_users?id=eq.${user.id}&select=id,name,phone`, {
    method: 'PATCH', body: JSON.stringify({ name: `${user.name}_edited`, phone: '010-0000-0000', pin: '9876' }),
  }, user.token))
  check('사용자는 본인 이름·전화·PIN을 수정한다',
    ownAllowed[0]?.name === `${user.name}_edited` && ownAllowed[0]?.phone === '010-0000-0000')
  const relogin = await login(user.loginId, '9876')
  check('바꾼 PIN으로 다시 로그인한다', Boolean(relogin.value?.token))

  for (const [column, value] of [
    ['login_id', `${marker}_hijack`], ['group_name', '탈취'], ['role', 'admin'],
    ['approval_status', 'blocked'], ['is_active', false],
    ['created_at', '2000-01-01T00:00:00Z'], ['last_login_at', '2000-01-01T00:00:00Z'],
  ]) {
    const response = await rest(`app_users?id=eq.${user.id}&select=id`, {
      method: 'PATCH', body: JSON.stringify({ [column]: value }),
    }, user.token)
    check(`사용자는 본인 ${column} 값을 바꾸지 못한다`, !response.ok)
  }

  const unchanged = await rows(await rest(
    `app_users?id=eq.${user.id}&select=id,login_id,group_name,role,approval_status,is_active`, {}, developerToken,
  ))
  check('차단된 권한 상승 뒤 계정값은 그대로다',
    unchanged[0]?.login_id === user.loginId
      && unchanged[0]?.group_name === '기존'
      && unchanged[0]?.role === 'user'
      && unchanged[0]?.approval_status === 'approved'
      && unchanged[0]?.is_active === true)

  const adminUpdate = await rows(await rest(`app_users?id=eq.${victim.id}&select=id,group_name,role,approval_status`, {
    method: 'PATCH', body: JSON.stringify({ group_name: '변경', role: 'leader', approval_status: 'approved' }),
  }, admin.token))
  check('관리자는 사용자 그룹·역할·승인을 관리한다',
    adminUpdate[0]?.group_name === '변경' && adminUpdate[0]?.role === 'leader')

  const adminDirectDelete = await rows(await rest(`app_users?id=eq.${victim.id}&select=id`, {
    method: 'DELETE',
  }, admin.token))
  check('관리자도 사용자 행을 직접 영구 삭제하지 못한다', adminDirectDelete.length === 0)

  const noReason = await rpc('deactivate_app_user_tx', {
    p_token: admin.token, p_user_id: victim.id, p_reason: '',
  }, admin.token)
  check('사용자 제거에는 사유가 필요하다', !noReason.ok)
  const deactivated = await rpc('deactivate_app_user_tx', {
    p_token: admin.token, p_user_id: victim.id, p_reason: 'smoke account cleanup',
  }, admin.token)
  const deactivatedValue = await body(deactivated)
  check('관리자는 사용자를 물리 삭제하지 않고 비활성화한다', deactivated.ok && deactivatedValue?.ok === true)

  const retained = await rows(await rest(
    `app_users?id=eq.${victim.id}&select=id,name,login_id,approval_status,is_active`, {}, developerToken,
  ))
  check('비활성 계정 행은 과거 기록 연결을 위해 남는다',
    retained.length === 1
      && retained[0]?.is_active === false
      && retained[0]?.approval_status === 'blocked'
      && retained[0]?.name?.includes('비활성 #')
      && retained[0]?.login_id?.startsWith('__inactive__'))

  const oldToken = await rpc('verify_session', { p_token: victim.token }, victim.token)
  check('비활성화한 사용자의 기존 세션은 즉시 무효다', !oldToken.ok)
  const oldLogin = await login(victim.loginId, '4321')
  check('비활성화한 사용자는 이전 로그인 ID로 로그인하지 못한다', !oldLogin.response.ok || !oldLogin.value?.token)
} catch (error) {
  console.error(`FAIL smoke 중단 - ${error?.message ?? error}`)
  failures += 1
} finally {
  if (developerToken) {
    for (const id of made) {
      await rest(`app_users?id=eq.${id}&select=id`, { method: 'DELETE' }, developerToken).catch(() => null)
    }
  }
}

if (failures) { console.error(`\nFAIL ${failures}개 실패\n`); process.exit(1) }
console.log('\nOK 사용자 계정 정책 smoke 통과\n')
