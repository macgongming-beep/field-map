#!/usr/bin/env node
// 식당 신청은 봉사자가 올리고 관리자가 검토한다. 한 표에 두 계약이 섞여 있어
// "관리자만" 표들보다 볼 것이 많다.
//   · 아무나 올릴 수 있지만 **남의 이름으로는 못 올린다**
//   · 신청자는 자기 건의 **memo 만** 고칠 수 있다 (status 를 스스로 승인 못 함)
//   · 승인·거절·삭제는 관리자만
// 테스트 DB 전용이며 testEnvGuard 가 운영 DB 쓰기를 막는다.
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

const marker = `_smoke_req_${Date.now()}`
const userIds = []
let developerToken = null
let requestId = null

try {
  developerToken = (await login(env.loginId, env.loginPin))?.token ?? null
  if (!developerToken) throw new Error('테스트 개발자로 로그인하지 못했습니다')

  const actors = []
  for (const role of ['user', 'leader', 'admin']) {
    const loginId = `${marker}_${role}`
    const made = await rest('app_users?select=id,name', {
      method: 'POST',
      body: JSON.stringify({
        login_id: loginId,
        name: `${marker}_${role}_name`,
        pin: '4321',
        role,
        approval_status: 'approved',
        is_active: true,
      }),
    }, developerToken)
    const row = (await rows(made))[0]
    if (!row?.id) throw new Error(`${role} fixture를 만들지 못했습니다`)
    userIds.push(row.id)
    const token = (await login(loginId, '4321'))?.token ?? null
    if (!token) throw new Error(`${role} fixture로 로그인하지 못했습니다`)
    actors.push({ role, token, name: row.name })
  }
  const user = actors.find((a) => a.role === 'user')
  const leader = actors.find((a) => a.role === 'leader')
  const admin = actors.find((a) => a.role === 'admin')

  const base = { name: `${marker}_식당`, address: '용인시 어딘가' }

  // ── 신청 ──────────────────────────────────────────
  const noSession = await rest('restaurant_requests?select=id', {
    method: 'POST', body: JSON.stringify({ ...base, requested_by: user.name }),
  })
  check('무세션 사용자는 신청하지 못한다', !noSession.ok, `HTTP ${noSession.status}`)

  // ⚠ 여기가 이 표의 핵심이다. requested_by 는 localStorage 에서 오던 값이라
  //    바꿔 보내면 남의 이름으로 신청할 수 있었다.
  const impersonate = await rest('restaurant_requests?select=id', {
    method: 'POST', body: JSON.stringify({ ...base, requested_by: leader.name }),
  }, user.token)
  check('남의 이름으로는 신청하지 못한다', !impersonate.ok, `HTTP ${impersonate.status}`)

  const submitted = await rest('restaurant_requests?select=id,status,memo,requested_by,is_chinese,initial_status,regular_visitor', {
    method: 'POST',
    body: JSON.stringify({ ...base, requested_by: user.name, memo: '처음 메모', is_chinese: false, initial_status: '정기방문', regular_visitor: user.name }),
  }, user.token)
  const created = (await rows(submitted))[0]
  requestId = created?.id ?? null
  check('봉사자는 본인 이름으로 신청한다', submitted.ok && Boolean(requestId), `HTTP ${submitted.status}`)
  check('신청한 중국어 여부와 상태를 보존한다', created?.is_chinese === false && created?.initial_status === '정기방문' && created?.regular_visitor === user.name)
  if (!requestId) throw new Error('신청 fixture를 만들지 못했습니다')

  const publicRead = await rest(`restaurant_requests?id=eq.${requestId}&select=id`)
  check('무세션 공개 읽기를 유지한다', publicRead.ok && (await rows(publicRead)).length === 1,
    `HTTP ${publicRead.status}`)

  // ── 신청자의 수정 범위 ─────────────────────────────
  const ownMemo = await rest(`restaurant_requests?id=eq.${requestId}&select=id,memo`, {
    method: 'PATCH', body: JSON.stringify({ memo: '고친 메모' }),
  }, user.token)
  check('신청자는 자기 신청의 메모를 고친다', (await rows(ownMemo))[0]?.memo === '고친 메모',
    `HTTP ${ownMemo.status}`)

  // ⚠ 이게 막히지 않으면 신청자가 스스로 승인을 통과시킬 수 있다
  const selfApprove = await rest(`restaurant_requests?id=eq.${requestId}&select=id`, {
    method: 'PATCH', body: JSON.stringify({ status: 'approved' }),
  }, user.token)
  check('신청자는 스스로 승인하지 못한다', !selfApprove.ok, `HTTP ${selfApprove.status}`)

  const selfReviewer = await rest(`restaurant_requests?id=eq.${requestId}&select=id`, {
    method: 'PATCH', body: JSON.stringify({ reviewer: user.name }),
  }, user.token)
  check('신청자는 검토자를 적지 못한다', !selfReviewer.ok, `HTTP ${selfReviewer.status}`)

  const selfRename = await rest(`restaurant_requests?id=eq.${requestId}&select=id`, {
    method: 'PATCH', body: JSON.stringify({ requested_by: leader.name }),
  }, user.token)
  check('신청자는 신청자 이름을 바꾸지 못한다', !selfRename.ok, `HTTP ${selfRename.status}`)

  const selfState = await rest(`restaurant_requests?id=eq.${requestId}&select=id`, {
    method: 'PATCH', body: JSON.stringify({ initial_status: '미방문' }),
  }, user.token)
  check('신청자는 신청한 방문 상태를 바꾸지 못한다', !selfState.ok, `HTTP ${selfState.status}`)

  // ── 남의 신청 ─────────────────────────────────────
  const otherMemo = await rest(`restaurant_requests?id=eq.${requestId}&select=id`, {
    method: 'PATCH', body: JSON.stringify({ memo: 'leader가바꿈' }),
  }, leader.token)
  check('남의 신청은 메모도 고치지 못한다', (await rows(otherMemo)).length === 0,
    `HTTP ${otherMemo.status}`)

  const unchanged = (await rows(await rest(
    `restaurant_requests?id=eq.${requestId}&select=memo,status,reviewer,requested_by`, {}, developerToken,
  )))[0]
  check('차단된 요청 뒤 신청은 그대로다',
    unchanged?.memo === '고친 메모' && unchanged?.status !== 'approved'
    && !unchanged?.reviewer && unchanged?.requested_by === user.name)

  // ── 삭제 ──────────────────────────────────────────
  for (const actor of [user, leader]) {
    const remove = await rest(`restaurant_requests?id=eq.${requestId}&select=id`, {
      method: 'DELETE',
    }, actor.token)
    check(`${actor.role}는 신청을 삭제하지 못한다`, (await rows(remove)).length === 0,
      `HTTP ${remove.status}`)
  }

  // ── 관리자 ────────────────────────────────────────
  const approved = await rest(`restaurant_requests?id=eq.${requestId}&select=id,status,reviewer`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'approved', reviewer: admin.name, reviewed_at: new Date().toISOString() }),
  }, admin.token)
  const approvedRow = (await rows(approved))[0]
  check('관리자는 신청을 승인한다',
    approvedRow?.status === 'approved' && approvedRow?.reviewer === admin.name,
    `HTTP ${approved.status}`)

  const removed = await rest(`restaurant_requests?id=eq.${requestId}&select=id`, {
    method: 'DELETE',
  }, admin.token)
  check('관리자는 신청을 삭제한다', (await rows(removed)).length === 1, `HTTP ${removed.status}`)
  requestId = null
} catch (error) {
  console.error(`❌ smoke 중단 — ${error?.message ?? error}`)
  failures += 1
} finally {
  if (developerToken) {
    await rest(`restaurant_requests?name=like.${marker}*&select=id`, { method: 'DELETE' }, developerToken).catch(() => null)
    for (const id of userIds) {
      await rest(`app_users?id=eq.${id}&select=id`, { method: 'DELETE' }, developerToken).catch(() => null)
    }
  }
}

console.log(`\n${failures === 0 ? '✅ restaurant_requests 권한 smoke 통과' : `❌ ${failures}개 실패`}\n`)
process.exit(failures === 0 ? 0 : 1)
