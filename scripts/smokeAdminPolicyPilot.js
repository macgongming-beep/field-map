#!/usr/bin/env node
// app_settings/notices는 공개로 읽되 관리자·개발자만 써야 한다.
// 테스트 DB 전용이며 testEnvGuard가 운영 DB 쓰기를 막는다.
import { loadTestEnv } from './testEnvGuard.js'

const env = loadTestEnv()
if (!env.allowWrites) {
  console.error('x 쓰기 가드가 열리지 않았습니다')
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
const body = async (response) => response.json().catch(() => null)
const blocked = async (response) => !response.ok || (await rows(response)).length === 0
const login = async (loginId, pin) => {
  const response = await rpc('auth_login', {
    p_login_id: loginId, p_pin: pin, p_device_label: 'security-pilot', p_user_agent: 'smoke',
  })
  const value = await body(response)
  return Array.isArray(value) ? value[0] : value
}

let failures = 0
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'OK' : 'FAIL'} ${label}${detail ? ` - ${detail}` : ''}`)
  if (!ok) failures += 1
}

const marker = `_security_pilot_${Date.now()}`
const settingKey = `${marker}_setting`
const userIds = []
const noticeIds = []
let developerToken = null

try {
  developerToken = (await login('test-admin', '1234'))?.token ?? null
  if (!developerToken) throw new Error('테스트 개발자로 로그인하지 못했습니다')

  const actors = []
  for (const role of ['user', 'leader', 'admin']) {
    const loginId = `${marker}_${role}`
    const created = await rest('app_users?select=id', {
      method: 'POST',
      body: JSON.stringify({
        login_id: loginId, name: `${marker}_${role}_name`, pin: '4321', role,
        approval_status: 'approved', is_active: true,
      }),
    }, developerToken)
    const id = (await rows(created))[0]?.id ?? null
    if (!id) throw new Error(`${role} fixture를 만들지 못했습니다`)
    userIds.push(id)
    const token = (await login(loginId, '4321'))?.token ?? null
    if (!token) throw new Error(`${role} fixture로 로그인하지 못했습니다`)
    actors.push({ role, token })
  }

  const adminToken = actors.find(({ role }) => role === 'admin')?.token
  if (!adminToken) throw new Error('관리자 fixture 토큰이 없습니다')

  const publicSettingsRead = await rest('app_settings?select=key&limit=1')
  check('app_settings 공개 읽기를 유지한다', publicSettingsRead.ok, `HTTP ${publicSettingsRead.status}`)
  const publicNoticesRead = await rest('notices?select=id&limit=1')
  check('notices 공개 읽기를 유지한다', publicNoticesRead.ok, `HTTP ${publicNoticesRead.status}`)

  const noSessionSetting = await rest('app_settings?select=key', {
    method: 'POST', body: JSON.stringify({ key: settingKey, value: 'none' }),
  })
  check('무세션은 설정을 만들지 못한다', await blocked(noSessionSetting), `HTTP ${noSessionSetting.status}`)

  for (const actor of actors.filter(({ role }) => role !== 'admin')) {
    const setting = await rest('app_settings?select=key', {
      method: 'POST', body: JSON.stringify({ key: settingKey, value: actor.role }),
    }, actor.token)
    check(`${actor.role}는 설정을 만들지 못한다`, await blocked(setting), `HTTP ${setting.status}`)

    const directNotice = await rest('notices?select=id', {
      method: 'POST',
      body: JSON.stringify({ title: `${marker}_${actor.role}`, content: '', priority: 'normal', author: actor.role }),
    }, actor.token)
    check(`${actor.role}는 공지를 직접 만들지 못한다`, await blocked(directNotice), `HTTP ${directNotice.status}`)

    const noticeRpc = await rpc('create_notice_tx', {
      p_token: actor.token, p_title: `${marker}_${actor.role}_rpc`, p_content: '',
      p_priority: 'normal', p_notify: false,
    }, actor.token)
    const rpcValue = await body(noticeRpc)
    check(`${actor.role}는 공지 RPC도 실행하지 못한다`, !noticeRpc.ok || rpcValue?.ok !== true,
      `HTTP ${noticeRpc.status}`)
  }

  const adminSetting = await rest('app_settings?select=key,value', {
    method: 'POST', body: JSON.stringify({ key: settingKey, value: 'created' }),
  }, adminToken)
  check('관리자는 설정을 만든다', (await rows(adminSetting))[0]?.value === 'created', `HTTP ${adminSetting.status}`)

  const adminSettingUpdate = await rest(`app_settings?key=eq.${encodeURIComponent(settingKey)}&select=key,value`, {
    method: 'PATCH', body: JSON.stringify({ value: 'updated' }),
  }, adminToken)
  check('관리자는 설정을 수정한다', (await rows(adminSettingUpdate))[0]?.value === 'updated',
    `HTTP ${adminSettingUpdate.status}`)

  for (const actor of actors.filter(({ role }) => role !== 'admin')) {
    const update = await rest(`app_settings?key=eq.${encodeURIComponent(settingKey)}&select=key`, {
      method: 'PATCH', body: JSON.stringify({ value: actor.role }),
    }, actor.token)
    check(`${actor.role}는 기존 설정을 수정하지 못한다`, (await rows(update)).length === 0,
      `HTTP ${update.status}`)
    const remove = await rest(`app_settings?key=eq.${encodeURIComponent(settingKey)}&select=key`, {
      method: 'DELETE',
    }, actor.token)
    check(`${actor.role}는 기존 설정을 삭제하지 못한다`, (await rows(remove)).length === 0,
      `HTTP ${remove.status}`)
  }

  const unchangedSetting = (await rows(await rest(
    `app_settings?key=eq.${encodeURIComponent(settingKey)}&select=key,value`, {}, adminToken,
  )))[0]
  check('차단된 요청 뒤 설정값은 그대로다', unchangedSetting?.value === 'updated')

  const createdNoticeResponse = await rpc('create_notice_tx', {
    p_token: adminToken, p_title: marker, p_content: '권한 시험', p_priority: 'normal', p_notify: false,
  }, adminToken)
  const createdNotice = await body(createdNoticeResponse)
  const noticeId = Number(createdNotice?.id ?? createdNotice?.notice_id ?? 0) || null
  if (noticeId) noticeIds.push(noticeId)
  check('관리자는 공지 RPC를 실행한다', createdNoticeResponse.ok && createdNotice?.ok === true,
    `HTTP ${createdNoticeResponse.status}`)

  const noticeRows = await rows(await rest(
    `notices?title=eq.${encodeURIComponent(marker)}&select=id,title`, {}, adminToken,
  ))
  const persistedNoticeId = noticeRows[0]?.id ?? null
  if (persistedNoticeId && !noticeIds.includes(persistedNoticeId)) noticeIds.push(persistedNoticeId)
  check('공지 RPC 결과가 저장됐다', Boolean(persistedNoticeId))

  if (persistedNoticeId) {
    const noSessionDelete = await rest(`notices?id=eq.${persistedNoticeId}&select=id`, { method: 'DELETE' })
    check('무세션은 공지를 삭제하지 못한다', (await rows(noSessionDelete)).length === 0,
      `HTTP ${noSessionDelete.status}`)
    for (const actor of actors.filter(({ role }) => role !== 'admin')) {
      const remove = await rest(`notices?id=eq.${persistedNoticeId}&select=id`, { method: 'DELETE' }, actor.token)
      check(`${actor.role}는 공지를 삭제하지 못한다`, (await rows(remove)).length === 0,
        `HTTP ${remove.status}`)
    }
    const adminDelete = await rest(`notices?id=eq.${persistedNoticeId}&select=id`, { method: 'DELETE' }, adminToken)
    check('관리자는 공지를 삭제한다', (await rows(adminDelete)).length === 1, `HTTP ${adminDelete.status}`)
  }

  const adminSettingDelete = await rest(`app_settings?key=eq.${encodeURIComponent(settingKey)}&select=key`, {
    method: 'DELETE',
  }, adminToken)
  check('관리자는 설정을 삭제한다', (await rows(adminSettingDelete)).length === 1,
    `HTTP ${adminSettingDelete.status}`)
} catch (error) {
  console.error(`FAIL smoke 중단 - ${error?.message ?? error}`)
  failures += 1
} finally {
  if (developerToken) {
    await rest(`app_settings?key=eq.${encodeURIComponent(settingKey)}&select=key`, { method: 'DELETE' }, developerToken).catch(() => null)
    await rest(`notices?title=like.${encodeURIComponent(`${marker}*`)}&select=id`, { method: 'DELETE' }, developerToken).catch(() => null)
    for (const id of userIds) {
      await rest(`app_users?id=eq.${id}&select=id`, { method: 'DELETE' }, developerToken).catch(() => null)
    }
  }
}

console.log(`\n${failures === 0 ? 'OK 관리자 정책 파일럿 smoke 통과' : `FAIL ${failures}개 실패`}\n`)
process.exit(failures === 0 ? 0 : 1)

