#!/usr/bin/env node
// 봉사 배정(비공식·식당)은 해당 일정 인도자와 관리자가 한다.
//   · 전도인(user)은 배정하지도 해제하지도 못한다 — 라우터가 /assignment 를
//     막지 않으므로 여기가 실질적인 문이다
//   · 일정 인도자는 배정·수정·해제하고, 다른 일정 인도자는 못 한다
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
    method: 'POST', headers: headers(null, false),
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

const marker = `_smoke_asn_${Date.now()}`
const userIds = []
let developerToken = null
let eventId = null
let assetId = null

try {
  developerToken = (await login('test-admin', '1234'))?.token ?? null
  if (!developerToken) throw new Error('테스트 개발자로 로그인하지 못했습니다')

  const actors = []
  for (const key of ['user', 'leader', 'otherLeader', 'admin']) {
    const role = key === 'otherLeader' ? 'leader' : key
    const loginId = `${marker}_${key}`
    const made = await rest('app_users?select=id,name', {
      method: 'POST',
      body: JSON.stringify({
        login_id: loginId, name: `${marker}_${key}_name`, pin: '4321', role,
        approval_status: 'approved', is_active: true,
      }),
    }, developerToken)
    const row = (await rows(made))[0]
    if (!row?.id) throw new Error(`${key} fixture를 만들지 못했습니다`)
    userIds.push(row.id)
    const token = (await login(loginId, '4321'))?.token ?? null
    if (!token) throw new Error(`${key} fixture로 로그인하지 못했습니다`)
    actors.push({ key, role, token, name: row.name })
  }
  const user = actors.find((a) => a.key === 'user')
  const leader = actors.find((a) => a.key === 'leader')
  const otherLeader = actors.find((a) => a.key === 'otherLeader')
  const admin = actors.find((a) => a.key === 'admin')

  // 배정이 걸릴 일정과 비공식 자료
  const event = (await rows(await rest('calendar_events?select=id', {
    method: 'POST',
    body: JSON.stringify({
      event_date: '2026-09-05', time: '09:00', title: `${marker}_일정`, type: '봉사',
      leader_name: leader.name,
    }),
  }, developerToken)))[0]
  eventId = event?.id ?? null
  if (!eventId) throw new Error('일정 fixture를 만들지 못했습니다')

  const asset = (await rows(await rest('informal_assets?select=id', {
    method: 'POST',
    body: JSON.stringify({ name: `${marker}_장소`, image_url: '', image_path: marker, uploaded_by: marker }),
  }, developerToken)))[0]
  assetId = asset?.id ?? null
  if (!assetId) throw new Error('비공식 자료 fixture를 만들지 못했습니다')

  const body = (who) => JSON.stringify({
    event_id: eventId, user_name: who, asset_id: assetId, assigned_by: who,
  })

  // ── 배정 ──────────────────────────────────────────
  const noSession = await rest('event_informal_assignments?select=id', {
    method: 'POST', body: body(user.name),
  })
  check('무세션 사용자는 배정하지 못한다', !noSession.ok, `HTTP ${noSession.status}`)

  // ⚠ 여기가 이 표의 핵심이다. /assignment 는 주소로 그냥 열리므로 전도인이
  //    인도자 화면을 띄울 수 있다. 표가 막아야 실제로 막힌다.
  const byUser = await rest('event_informal_assignments?select=id', {
    method: 'POST', body: body(user.name),
  }, user.token)
  check('전도인은 배정하지 못한다', !byUser.ok, `HTTP ${byUser.status}`)

  const byLeader = await rest('event_informal_assignments?select=id', {
    method: 'POST', body: body(leader.name),
  }, leader.token)
  const leaderAssignmentId = (await rows(byLeader))[0]?.id ?? null
  check('해당 일정 인도자는 배정한다', byLeader.ok && Boolean(leaderAssignmentId), `HTTP ${byLeader.status}`)

  const byOtherLeader = await rest('event_informal_assignments?select=id', {
    method: 'POST', body: body(otherLeader.name),
  }, otherLeader.token)
  check('다른 일정 인도자는 배정하지 못한다', !byOtherLeader.ok, `HTTP ${byOtherLeader.status}`)

  const publicRead = await rest(`event_informal_assignments?event_id=eq.${eventId}&select=id`)
  check('무세션 공개 읽기를 유지한다', publicRead.ok && (await rows(publicRead)).length === 1,
    `HTTP ${publicRead.status}`)

  // ── 수정 ──
  for (const actor of [user, otherLeader]) {
    const patched = await rest(`event_informal_assignments?id=eq.${leaderAssignmentId}&select=id`, {
      method: 'PATCH', body: JSON.stringify({ user_name: `${marker}_바꿈` }),
    }, actor.token)
    check(`${actor.key}는 배정을 고치지 못한다`, (await rows(patched)).length === 0,
      `HTTP ${patched.status}`)
  }
  const leaderPatch = await rest(`event_informal_assignments?id=eq.${leaderAssignmentId}&select=id,user_name`, {
    method: 'PATCH', body: JSON.stringify({ user_name: leader.name }),
  }, leader.token)
  check('해당 일정 인도자는 배정을 고친다',
    (await rows(leaderPatch))[0]?.user_name === leader.name, `HTTP ${leaderPatch.status}`)
  const adminPatch = await rest(`event_informal_assignments?id=eq.${leaderAssignmentId}&select=id,user_name`, {
    method: 'PATCH', body: JSON.stringify({ user_name: leader.name }),
  }, admin.token)
  check('관리자는 배정을 고친다 (이름 바꾸기 폴백)',
    (await rows(adminPatch))[0]?.user_name === leader.name, `HTTP ${adminPatch.status}`)

  // ── 해제 ──────────────────────────────────────────
  const userDelete = await rest(`event_informal_assignments?id=eq.${leaderAssignmentId}&select=id`, {
    method: 'DELETE',
  }, user.token)
  check('전도인은 배정을 해제하지 못한다', (await rows(userDelete)).length === 0,
    `HTTP ${userDelete.status}`)

  const otherLeaderDelete = await rest(`event_informal_assignments?id=eq.${leaderAssignmentId}&select=id`, {
    method: 'DELETE',
  }, otherLeader.token)
  check('다른 일정 인도자는 배정을 해제하지 못한다', (await rows(otherLeaderDelete)).length === 0,
    `HTTP ${otherLeaderDelete.status}`)

  const stillThere = await rows(await rest(
    `event_informal_assignments?id=eq.${leaderAssignmentId}&select=id`, {}, developerToken))
  check('차단된 요청 뒤 배정은 그대로다', stillThere.length === 1)

  const leaderDelete = await rest(`event_informal_assignments?id=eq.${leaderAssignmentId}&select=id`, {
    method: 'DELETE',
  }, leader.token)
  check('해당 일정 인도자는 배정을 해제한다', (await rows(leaderDelete)).length === 1,
    `HTTP ${leaderDelete.status}`)

  // ── 식당 배정도 같은 규칙이다 ──────────────────────
  // ⚠ building_id 는 NOT NULL 이다. null 로 보내면 권한이 아니라 스키마에
  //    걸려 400 이 오고, "막혔다" 로 잘못 읽힌다 — 실제로 그렇게 헛돌았다.
  const building = (await rows(await rest('buildings?select=id&limit=1')))[0]
  if (!building?.id) throw new Error('식당 배정을 시험할 건물이 테스트 DB 에 없습니다')

  const restaurantBody = (who) => JSON.stringify({
    event_id: eventId, user_name: who, building_id: building.id, assigned_by: who,
  })
  const restaurantByUser = await rest('event_restaurant_assignments?select=id', {
    method: 'POST', body: restaurantBody(user.name),
  }, user.token)
  check('전도인은 식당도 배정하지 못한다', !restaurantByUser.ok, `HTTP ${restaurantByUser.status}`)

  const restaurantByOtherLeader = await rest('event_restaurant_assignments?select=id', {
    method: 'POST', body: restaurantBody(otherLeader.name),
  }, otherLeader.token)
  check('다른 일정 인도자는 식당을 배정하지 못한다', !restaurantByOtherLeader.ok,
    `HTTP ${restaurantByOtherLeader.status}`)

  // 막혔다는 것을 같은 요청이 인도자에게는 통하는 것으로 확인한다.
  // 이게 없으면 스키마 오류를 권한으로 착각한다.
  const restaurantByLeader = await rest('event_restaurant_assignments?select=id', {
    method: 'POST', body: restaurantBody(leader.name),
  }, leader.token)
  check('해당 일정 인도자는 식당을 배정한다', restaurantByLeader.ok, `HTTP ${restaurantByLeader.status}`)
} catch (error) {
  console.error(`❌ smoke 중단 — ${error?.message ?? error}`)
  failures += 1
} finally {
  if (developerToken) {
    if (eventId) {
      await rest(`event_informal_assignments?event_id=eq.${eventId}&select=id`, { method: 'DELETE' }, developerToken).catch(() => null)
      await rest(`event_restaurant_assignments?event_id=eq.${eventId}&select=id`, { method: 'DELETE' }, developerToken).catch(() => null)
      await rest(`calendar_events?id=eq.${eventId}&select=id`, { method: 'DELETE' }, developerToken).catch(() => null)
    }
    if (assetId) {
      await rest(`informal_assets?id=eq.${assetId}&select=id`, { method: 'DELETE' }, developerToken).catch(() => null)
    }
    for (const id of userIds) {
      await rest(`app_users?id=eq.${id}&select=id`, { method: 'DELETE' }, developerToken).catch(() => null)
    }
  }
}

console.log(`\n${failures === 0 ? '✅ 봉사 배정 권한 smoke 통과' : `❌ ${failures}개 실패`}\n`)
process.exit(failures === 0 ? 0 : 1)
