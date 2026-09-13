#!/usr/bin/env node
// 대화 방법 제안은 공개로 읽되 관리자·개발자만 써야 한다.
// 테스트 DB 전용이며 testEnvGuard가 운영 DB 쓰기를 막는다.
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

const marker = `_smoke_suggestion_${Date.now()}`
const userIds = []
let developerToken = null
let suggestionId = null

try {
  developerToken = (await login(env.loginId, env.loginPin))?.token ?? null
  if (!developerToken) throw new Error('테스트 개발자로 로그인하지 못했습니다')

  const actors = []
  for (const role of ['user', 'leader', 'admin']) {
    const loginId = `${marker}_${role}`
    const made = await rest('app_users?select=id', {
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
    const id = (await rows(made))[0]?.id ?? null
    if (!id) throw new Error(`${role} fixture를 만들지 못했습니다`)
    userIds.push(id)
    const token = (await login(loginId, '4321'))?.token ?? null
    if (!token) throw new Error(`${role} fixture로 로그인하지 못했습니다`)
    actors.push({ role, token })
  }
  const adminToken = actors.find((actor) => actor.role === 'admin')?.token ?? null
  if (!adminToken) throw new Error('admin fixture 토큰이 없습니다')

  const suggestion = {
    title: marker,
    show_title_on_home: false,
    tags: ['smoke'],
    is_visible: false,
    content: [],
  }

  const noSessionInsert = await rest('service_suggestions?select=id', {
    method: 'POST', body: JSON.stringify({ ...suggestion, title: `${marker}_none` }),
  })
  check('무세션 사용자는 제안을 만들지 못한다', !noSessionInsert.ok, `HTTP ${noSessionInsert.status}`)

  for (const actor of actors.filter(({ role }) => role !== 'admin')) {
    const response = await rest('service_suggestions?select=id', {
      method: 'POST', body: JSON.stringify({ ...suggestion, title: `${marker}_${actor.role}` }),
    }, actor.token)
    check(`${actor.role}는 제안을 만들지 못한다`, !response.ok, `HTTP ${response.status}`)
  }

  const createdResponse = await rest('service_suggestions?select=id,title', {
    method: 'POST', body: JSON.stringify(suggestion),
  }, developerToken)
  const created = (await rows(createdResponse))[0]
  suggestionId = created?.id ?? null
  check('개발자는 제안을 만든다', createdResponse.ok && Boolean(suggestionId), `HTTP ${createdResponse.status}`)
  if (!suggestionId) throw new Error('제안 fixture를 만들지 못했습니다')

  const publicRead = await rest(`service_suggestions?id=eq.${suggestionId}&select=id,title`)
  check('무세션 공개 읽기를 유지한다', publicRead.ok && (await rows(publicRead)).length === 1,
    `HTTP ${publicRead.status}`)

  const noSessionUpdate = await rest(`service_suggestions?id=eq.${suggestionId}&select=id`, {
    method: 'PATCH', body: JSON.stringify({ title: `${marker}_changed` }),
  })
  check('무세션 사용자는 제안을 수정하지 못한다', (await rows(noSessionUpdate)).length === 0,
    `HTTP ${noSessionUpdate.status}`)

  const noSessionDelete = await rest(`service_suggestions?id=eq.${suggestionId}&select=id`, {
    method: 'DELETE',
  })
  check('무세션 사용자는 제안을 삭제하지 못한다', (await rows(noSessionDelete)).length === 0,
    `HTTP ${noSessionDelete.status}`)

  for (const actor of actors.filter(({ role }) => role !== 'admin')) {
    const update = await rest(`service_suggestions?id=eq.${suggestionId}&select=id`, {
      method: 'PATCH', body: JSON.stringify({ title: `${marker}_${actor.role}_changed` }),
    }, actor.token)
    check(`${actor.role}는 제안을 수정하지 못한다`, (await rows(update)).length === 0,
      `HTTP ${update.status}`)

    const remove = await rest(`service_suggestions?id=eq.${suggestionId}&select=id`, {
      method: 'DELETE',
    }, actor.token)
    check(`${actor.role}는 제안을 삭제하지 못한다`, (await rows(remove)).length === 0,
      `HTTP ${remove.status}`)
  }

  const unchanged = (await rows(await rest(
    `service_suggestions?id=eq.${suggestionId}&select=id,title`, {}, developerToken,
  )))[0]
  check('차단된 요청 뒤 제안은 그대로다', unchanged?.title === marker)

  const updated = await rest(`service_suggestions?id=eq.${suggestionId}&select=id,title`, {
    method: 'PATCH', body: JSON.stringify({ title: `${marker}_admin` }),
  }, adminToken)
  check('관리자는 제안을 수정한다', (await rows(updated))[0]?.title === `${marker}_admin`,
    `HTTP ${updated.status}`)

  const removed = await rest(`service_suggestions?id=eq.${suggestionId}&select=id`, {
    method: 'DELETE',
  }, adminToken)
  check('관리자는 제안을 삭제한다', (await rows(removed)).length === 1, `HTTP ${removed.status}`)
  suggestionId = null
} catch (error) {
  console.error(`❌ smoke 중단 — ${error?.message ?? error}`)
  failures += 1
} finally {
  if (developerToken) {
    await rest(`service_suggestions?title=like.${marker}*&select=id`, { method: 'DELETE' }, developerToken).catch(() => null)
    for (const id of userIds) {
      await rest(`app_users?id=eq.${id}&select=id`, { method: 'DELETE' }, developerToken).catch(() => null)
    }
  }
}

console.log(`\n${failures === 0 ? '✅ service_suggestions 권한 smoke 통과' : `❌ ${failures}개 실패`}\n`)
process.exit(failures === 0 ? 0 : 1)
