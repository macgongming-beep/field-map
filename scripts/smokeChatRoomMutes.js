#!/usr/bin/env node
// chat_room_mutes 소유권 정책을 API 경유로 검증한다. 테스트 DB 전용이다.
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
const rpc = (name, body) => rest(`rpc/${name}`, {
  method: 'POST', body: JSON.stringify(body), headers: headers(null, false),
})
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

const marker = `_smoke_mute_${Date.now()}`
let adminToken = null
let eventId = null
const userIds = []

try {
  adminToken = (await login(env.loginId, env.loginPin))?.token ?? null
  if (!adminToken) throw new Error('테스트 관리자로 로그인하지 못했습니다')

  const eventResponse = await rest('calendar_events?select=id', {
    method: 'POST', body: JSON.stringify({ event_date: '2030-01-01', title: marker }),
  }, adminToken)
  eventId = (await rows(eventResponse))[0]?.id ?? null
  if (!eventId) throw new Error('일정 fixture를 만들지 못했습니다')

  const users = []
  for (const suffix of ['a', 'b']) {
    const loginId = `${marker}_${suffix}`
    const made = await rest('app_users?select=id', {
      method: 'POST',
      body: JSON.stringify({ login_id: loginId, name: loginId, pin: '4321', role: 'user', approval_status: 'approved' }),
    }, adminToken)
    const id = (await rows(made))[0]?.id ?? null
    if (!id) throw new Error(`사용자 ${suffix} fixture를 만들지 못했습니다`)
    userIds.push(id)
    const token = (await login(loginId, '4321'))?.token ?? null
    if (!token) throw new Error(`사용자 ${suffix} 로그인에 실패했습니다`)
    users.push({ id, token })
  }
  const [a, b] = users

  const noSession = await rest('chat_room_mutes?select=event_id', {
    method: 'POST', body: JSON.stringify({ event_id: eventId, user_id: a.id }),
  })
  check('무세션 INSERT를 막는다', !noSession.ok, `HTTP ${noSession.status}`)

  const ownInsert = await rest('chat_room_mutes?select=event_id,user_id', {
    method: 'POST', body: JSON.stringify({ event_id: eventId, user_id: a.id }),
  }, a.token)
  check('본인 행 INSERT를 허용한다', (await rows(ownInsert)).length === 1, `HTTP ${ownInsert.status}`)

  const publicRead = await rest(`chat_room_mutes?event_id=eq.${eventId}&user_id=eq.${a.id}&select=event_id`)
  check('무세션 SELECT는 행을 숨긴다', publicRead.ok && (await rows(publicRead)).length === 0, `HTTP ${publicRead.status}`)

  const ownRead = await rest(`chat_room_mutes?event_id=eq.${eventId}&user_id=eq.${a.id}&select=event_id`, {}, a.token)
  check('본인 SELECT를 허용한다', (await rows(ownRead)).length === 1, `HTTP ${ownRead.status}`)

  const otherRead = await rest(`chat_room_mutes?event_id=eq.${eventId}&user_id=eq.${a.id}&select=event_id`, {}, b.token)
  check('타인의 SELECT는 행을 숨긴다', otherRead.ok && (await rows(otherRead)).length === 0, `HTTP ${otherRead.status}`)

  const otherInsert = await rest('chat_room_mutes?select=event_id', {
    method: 'POST', body: JSON.stringify({ event_id: eventId, user_id: b.id }),
  }, a.token)
  check('남의 행 INSERT를 막는다', !otherInsert.ok, `HTTP ${otherInsert.status}`)

  const ownUpdate = await rest(`chat_room_mutes?event_id=eq.${eventId}&user_id=eq.${a.id}&select=muted_at`, {
    method: 'PATCH', body: JSON.stringify({ muted_at: '2030-01-02T00:00:00.000Z' }),
  }, a.token)
  check('본인 행 UPDATE를 허용한다', (await rows(ownUpdate)).length === 1, `HTTP ${ownUpdate.status}`)

  const stealOwner = await rest(`chat_room_mutes?event_id=eq.${eventId}&user_id=eq.${a.id}&select=user_id`, {
    method: 'PATCH', body: JSON.stringify({ user_id: b.id }),
  }, a.token)
  check('행 소유자를 남에게 바꾸지 못한다', !stealOwner.ok || (await rows(stealOwner)).length === 0, `HTTP ${stealOwner.status}`)

  const otherDelete = await rest(`chat_room_mutes?event_id=eq.${eventId}&user_id=eq.${a.id}&select=event_id`, {
    method: 'DELETE',
  }, b.token)
  check('남의 행 DELETE를 막는다', (await rows(otherDelete)).length === 0, `HTTP ${otherDelete.status}`)

  const stillThere = await rest(`chat_room_mutes?event_id=eq.${eventId}&user_id=eq.${a.id}&select=event_id`, {}, a.token)
  check('거부 뒤 본인 행이 남아 있다', (await rows(stillThere)).length === 1)

  const ownDelete = await rest(`chat_room_mutes?event_id=eq.${eventId}&user_id=eq.${a.id}&select=event_id`, {
    method: 'DELETE',
  }, a.token)
  check('본인 행 DELETE를 허용한다', (await rows(ownDelete)).length === 1, `HTTP ${ownDelete.status}`)
} catch (error) {
  console.error(`❌ smoke 중단 — ${error?.message ?? error}`)
  failures += 1
} finally {
  if (adminToken) {
    if (eventId) await rest(`calendar_events?id=eq.${eventId}&select=id`, { method: 'DELETE' }, adminToken).catch(() => null)
    for (const id of userIds) await rest(`app_users?id=eq.${id}&select=id`, { method: 'DELETE' }, adminToken).catch(() => null)
  }
}

console.log(`\n${failures === 0 ? '✅ chat_room_mutes 소유권 smoke 통과' : `❌ ${failures}개 실패`}\n`)
process.exit(failures === 0 ? 0 : 1)
