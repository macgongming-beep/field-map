#!/usr/bin/env node
// special_periods는 모두 읽을 수 있지만 관리자만 쓸 수 있어야 한다.
// 테스트 DB 전용이며, testEnvGuard가 운영 ref와 미등록 프로젝트 쓰기를 막는다.
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
const rows = async (response) => {
  const body = await response.json().catch(() => null)
  return Array.isArray(body) ? body : []
}
const blocked = async (response) => !response.ok || (await rows(response)).length === 0
const login = async (loginId, pin) => {
  const response = await fetch(`${env.url}/rest/v1/rpc/auth_login`, {
    method: 'POST',
    headers: headers(null, false),
    body: JSON.stringify({ p_login_id: loginId, p_pin: pin }),
  })
  const body = await response.json().catch(() => null)
  return Array.isArray(body) ? body[0] : body
}

let failures = 0
const check = (label, ok, detail = '') => {
  console.log(`${ok ? '✅' : '❌'} ${label}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures += 1
}

const marker = `_smoke_special_${Date.now()}`
const period = { label: marker, start_date: '2031-01-01', end_date: '2031-01-02', color: '#123456', has_invitation: false }
let adminToken = null
let userId = null

try {
  adminToken = (await login('test-admin', '1234'))?.token ?? null
  if (!adminToken) throw new Error('테스트 관리자로 로그인하지 못했습니다')

  const createdResponse = await rest('special_periods?select=id,label', {
    method: 'POST', body: JSON.stringify(period),
  }, adminToken)
  const created = (await rows(createdResponse))[0]
  check('관리자는 특별기간을 만든다', createdResponse.ok && Boolean(created?.id), `HTTP ${createdResponse.status}`)
  if (!created?.id) throw new Error('유효한 특별기간 fixture를 만들지 못했습니다')

  const publicRead = await rest(`special_periods?id=eq.${created.id}&select=id`)
  check('세션 없이도 특별기간을 읽는다', (await rows(publicRead)).length === 1, `HTTP ${publicRead.status}`)

  const invalidRange = await rest('special_periods?select=id', {
    method: 'POST', body: JSON.stringify({ label: `${marker}_invalid`, start_date: '2026-09-10', end_date: '2026-09-09', color: '#5D5B54' }),
  }, adminToken)
  check('종료일이 시작일보다 빠른 기간은 DB가 거부한다', await blocked(invalidRange), `HTTP ${invalidRange.status}`)

  const noSessionInsert = await rest('special_periods?select=id', {
    method: 'POST', body: JSON.stringify({ ...period, label: `${marker}_no_session` }),
  })
  check('세션 없이 특별기간을 만들지 못한다', await blocked(noSessionInsert), `HTTP ${noSessionInsert.status}`)

  const loginId = `_smoke_special_user_${Date.now()}`
  const userResponse = await rest('app_users?select=id', {
    method: 'POST',
    body: JSON.stringify({ login_id: loginId, name: marker, pin: '4321', role: 'user', approval_status: 'approved' }),
  }, adminToken)
  userId = (await rows(userResponse))[0]?.id ?? null
  if (!userId) throw new Error('일반 사용자 fixture를 만들지 못했습니다')
  const userToken = (await login(loginId, '4321'))?.token ?? null
  if (!userToken) throw new Error('일반 사용자로 로그인하지 못했습니다')

  const userInsert = await rest('special_periods?select=id', {
    method: 'POST', body: JSON.stringify({ ...period, label: `${marker}_user` }),
  }, userToken)
  check('일반 사용자는 특별기간을 만들지 못한다', await blocked(userInsert), `HTTP ${userInsert.status}`)

  const adminUpdate = await rest(`special_periods?id=eq.${created.id}&select=id,label`, {
    method: 'PATCH', body: JSON.stringify({ label: `${marker}_updated` }),
  }, adminToken)
  check('관리자는 특별기간을 수정한다', (await rows(adminUpdate))[0]?.label === `${marker}_updated`, `HTTP ${adminUpdate.status}`)

  const adminDelete = await rest(`special_periods?id=eq.${created.id}&select=id`, { method: 'DELETE' }, adminToken)
  check('관리자는 특별기간을 삭제한다', (await rows(adminDelete)).length === 1, `HTTP ${adminDelete.status}`)
} catch (error) {
  console.error(`❌ smoke 중단 — ${error?.message ?? error}`)
  failures += 1
} finally {
  if (adminToken) {
    await rest(`special_periods?label=like.${marker}*&select=id`, { method: 'DELETE' }, adminToken).catch(() => null)
    if (userId) await rest(`app_users?id=eq.${userId}&select=id`, { method: 'DELETE' }, adminToken).catch(() => null)
  }
}

console.log(`\n${failures === 0 ? '✅ special_periods 권한 smoke 통과' : `❌ ${failures}개 실패`}\n`)
process.exit(failures === 0 ? 0 : 1)
