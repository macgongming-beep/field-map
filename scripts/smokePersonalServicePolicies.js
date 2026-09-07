#!/usr/bin/env node
// 개인 봉사 자료의 본인·인도자·관리자 소유권 계약을 실제 REST 요청으로 검증한다.
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
const rpc = (name, payload, token) => rest(`rpc/${name}`, {
  method: 'POST', body: JSON.stringify(payload), headers: headers(token, false),
}, token)
const json = async (response) => response.json().catch(() => null)
const rows = async (response) => {
  const value = await json(response)
  return Array.isArray(value) ? value : []
}
const blocked = async (response) => !response.ok || (await rows(response)).length === 0
const login = async (loginId, pin) => {
  const value = await json(await rpc('auth_login', {
    p_login_id: loginId, p_pin: pin, p_device_label: 'personal-service-smoke', p_user_agent: 'smoke',
  }))
  return Array.isArray(value) ? value[0] : value
}

let failures = 0
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'OK' : 'FAIL'} ${label}${detail ? ` - ${detail}` : ''}`)
  if (!ok) failures += 1
}

const marker = `_personal_service_${Date.now()}`
const ids = { users: [], sessions: [], regulars: [], returns: [], logs: [], events: [], buildings: [] }
let developerToken = null

try {
  developerToken = (await login('test-admin', '1234'))?.token ?? null
  if (!developerToken) throw new Error('테스트 개발자로 로그인하지 못했습니다')

  const actors = {}
  for (const role of ['user', 'user', 'leader', 'admin']) {
    const key = role === 'user' && actors.user ? 'other' : role
    const loginId = `${marker}_${key}`
    const name = `${marker}_${key}_name`
    const created = await rows(await rest('app_users?select=id', {
      method: 'POST', body: JSON.stringify({
        login_id: loginId, name, pin: '4321', role,
        approval_status: 'approved', is_active: true,
      }),
    }, developerToken))
    const id = created[0]?.id
    if (!id) throw new Error(`${key} fixture를 만들지 못했습니다`)
    ids.users.push(id)
    const token = (await login(loginId, '4321'))?.token
    if (!token) throw new Error(`${key} fixture로 로그인하지 못했습니다`)
    actors[key] = { id, name, token, role }
  }

  const card = await rows(await rest('cards?select=id&limit=1', {}, developerToken))
  const cardId = card[0]?.id
  if (!cardId) throw new Error('기존 카드 fixture를 찾지 못했습니다')

  const buildingResponse = await rest('buildings?select=id', {
    method: 'POST', body: JSON.stringify({
      card_id: cardId, name: marker, address: marker, type: '주택', lat: 37.5, lng: 127.1,
    }),
  }, developerToken)
  const buildingBody = await json(buildingResponse)
  const building = Array.isArray(buildingBody) ? buildingBody : []
  const buildingId = building[0]?.id
  if (!buildingId) throw new Error(`건물 fixture를 만들지 못했습니다: ${JSON.stringify(buildingBody)}`)
  ids.buildings.push(buildingId)
  const units = await rows(await rest('units?select=id', {
    method: 'POST', body: JSON.stringify([
      { building_id: buildingId, number: '101', status: '미방문' },
      { building_id: buildingId, number: '102', status: '미방문' },
    ]),
  }, developerToken))
  if (units.length !== 2) throw new Error('세대 fixture를 만들지 못했습니다')

  const event = await rows(await rest('calendar_events?select=id', {
    method: 'POST', body: JSON.stringify({
      title: `${marker}_event`, event_date: '2099-12-29', time: '10:00',
      leader_name: actors.leader.name, allow_applications: true,
    }),
  }, developerToken))
  const eventId = event[0]?.id
  if (!eventId) throw new Error('일정 fixture를 만들지 못했습니다')
  ids.events.push(eventId)

  for (const table of ['service_sessions', 'regular_visits', 'return_visits', 'return_visit_logs']) {
    const response = await rest(`${table}?select=*&limit=1`)
    check(`${table} 공개 읽기를 유지한다`, response.ok, `HTTP ${response.status}`)
  }

  const noSessionService = await rest('service_sessions?select=id', {
    method: 'POST', body: JSON.stringify({
      user_name: actors.user.name, role: 'user', service_date: '2099-12-29',
      time_slot: '오전', status: 'active', source: 'manual',
    }),
  })
  check('무세션은 봉사 세션을 만들지 못한다', await blocked(noSessionService))

  const ownSessionResponse = await rest('service_sessions?select=id,memo', {
    method: 'POST', body: JSON.stringify({
      user_name: actors.user.name, role: 'user', service_date: '2099-12-29',
      time_slot: '오전', status: 'active', source: 'manual', memo: marker,
    }),
  }, actors.user.token)
  const ownSessionBody = await json(ownSessionResponse)
  const ownSessionRows = Array.isArray(ownSessionBody) ? ownSessionBody : []
  const ownSessionId = ownSessionRows[0]?.id
  if (ownSessionId) ids.sessions.push(ownSessionId)
  check('사용자는 본인 봉사 세션을 만든다', Boolean(ownSessionId),
    ownSessionId ? '' : JSON.stringify(ownSessionBody))

  const forgedRole = await rest('service_sessions?select=id', {
    method: 'POST', body: JSON.stringify({
      user_name: actors.user.name, role: 'admin', service_date: '2099-12-29',
      time_slot: '오후', status: 'active', source: 'manual',
    }),
  }, actors.user.token)
  check('사용자는 봉사 세션 역할을 높이지 못한다', await blocked(forgedRole))

  const otherSessionUpdate = await rows(await rest(`service_sessions?id=eq.${ownSessionId}&select=id`, {
    method: 'PATCH', body: JSON.stringify({ memo: 'other' }),
  }, actors.other.token))
  check('다른 사용자는 봉사 세션을 수정하지 못한다', otherSessionUpdate.length === 0)
  const ownSessionUpdate = await rows(await rest(`service_sessions?id=eq.${ownSessionId}&select=id,memo`, {
    method: 'PATCH', body: JSON.stringify({ memo: 'owner' }),
  }, actors.user.token))
  check('사용자는 본인 봉사 세션을 수정한다', ownSessionUpdate[0]?.memo === 'owner')

  const eventSession = await rows(await rest('service_sessions?select=id', {
    method: 'POST', body: JSON.stringify({
      user_name: actors.other.name, role: 'user', calendar_event_id: eventId,
      service_date: '2099-12-29', time_slot: '저녁', status: 'active', source: 'assigned',
    }),
  }, developerToken))
  const eventSessionId = eventSession[0]?.id
  if (eventSessionId) ids.sessions.push(eventSessionId)
  const removedEventSession = await rows(await rest(`service_sessions?id=eq.${eventSessionId}&select=id`, {
    method: 'DELETE',
  }, actors.leader.token))
  check('해당 일정 인도자는 참가자의 자동 봉사 세션을 정리한다', removedEventSession.length === 1)

  const ownRegular = await rows(await rest('regular_visits?select=id,visitor_name', {
    method: 'POST', body: JSON.stringify({ unit_id: units[0].id, visitor_name: actors.user.name }),
  }, actors.user.token))
  const ownRegularId = ownRegular[0]?.id
  if (ownRegularId) ids.regulars.push(ownRegularId)
  check('사용자는 본인 정기방문을 등록한다', ownRegular[0]?.visitor_name === actors.user.name)

  const forgedRegular = await rest('regular_visits?select=id', {
    method: 'POST', body: JSON.stringify({ unit_id: units[1].id, visitor_name: actors.other.name }),
  }, actors.user.token)
  check('사용자는 타인 이름으로 정기방문을 등록하지 못한다', await blocked(forgedRegular))
  const otherRegularDelete = await rows(await rest(`regular_visits?id=eq.${ownRegularId}&select=id`, {
    method: 'DELETE',
  }, actors.other.token))
  check('다른 사용자는 정기방문을 해제하지 못한다', otherRegularDelete.length === 0)

  const leaderRegular = await rows(await rest('regular_visits?select=id', {
    method: 'POST', body: JSON.stringify({ unit_id: units[1].id, visitor_name: actors.other.name }),
  }, actors.leader.token))
  if (leaderRegular[0]?.id) ids.regulars.push(leaderRegular[0].id)
  check('인도자는 담당자를 지정해 정기방문을 등록한다', leaderRegular.length === 1)

  const ownReturn = await rows(await rest('return_visits?select=id,nickname', {
    method: 'POST', body: JSON.stringify({
      display_name: `${marker}_return`, nickname: '', address: marker,
      assigned_user_name: actors.user.name, created_by: actors.user.name,
    }),
  }, actors.user.token))
  const returnId = ownReturn[0]?.id
  if (returnId) ids.returns.push(returnId)
  check('사용자는 본인 활동 정기방문을 만든다', Boolean(returnId))

  const forgedReturn = await rest('return_visits?select=id', {
    method: 'POST', body: JSON.stringify({
      display_name: `${marker}_forged`, assigned_user_name: actors.other.name,
      created_by: actors.user.name,
    }),
  }, actors.user.token)
  check('사용자는 타인 담당 활동을 만들지 못한다', await blocked(forgedReturn))
  const otherReturnUpdate = await rows(await rest(`return_visits?id=eq.${returnId}&select=id`, {
    method: 'PATCH', body: JSON.stringify({ nickname: 'other' }),
  }, actors.other.token))
  check('다른 사용자는 활동 정기방문을 수정하지 못한다', otherReturnUpdate.length === 0)
  const ownerReturnUpdate = await rows(await rest(`return_visits?id=eq.${returnId}&select=id,nickname`, {
    method: 'PATCH', body: JSON.stringify({ nickname: 'owner' }),
  }, actors.user.token))
  check('담당자는 활동 정기방문의 별칭을 수정한다', ownerReturnUpdate[0]?.nickname === 'owner')
  const ownerHardDelete = await rows(await rest(`return_visits?id=eq.${returnId}&select=id`, {
    method: 'DELETE',
  }, actors.user.token))
  check('담당자도 활동과 과거 기록을 영구 삭제하지 못한다', ownerHardDelete.length === 0)

  const ownLog = await rows(await rest('return_visit_logs?select=id,memo', {
    method: 'POST', body: JSON.stringify({
      return_visit_id: returnId, result: '만남', memo: 'owner', created_by: actors.user.name,
    }),
  }, actors.user.token))
  const logId = ownLog[0]?.id
  if (logId) ids.logs.push(logId)
  check('담당자는 자기 정기방문에 기록을 추가한다', Boolean(logId))

  const otherLogInsert = await rest('return_visit_logs?select=id', {
    method: 'POST', body: JSON.stringify({
      return_visit_id: returnId, result: '부재', memo: 'other', created_by: actors.other.name,
    }),
  }, actors.other.token)
  check('다른 사용자는 남의 정기방문에 기록을 추가하지 못한다', await blocked(otherLogInsert))
  const otherLogUpdate = await rpc('update_return_visit_log_tx', {
    p_token: actors.other.token, p_log_id: logId, p_result: '부재', p_memo: 'other', p_reason: '',
  }, actors.other.token)
  check('다른 사용자는 기록을 수정하지 못한다', !otherLogUpdate.ok)
  const ownerLogUpdate = await rpc('update_return_visit_log_tx', {
    p_token: actors.user.token, p_log_id: logId, p_result: '만남', p_memo: 'owner-updated', p_reason: '',
  }, actors.user.token)
  const ownerLogUpdateValue = await json(ownerLogUpdate)
  const updatedLog = await rows(await rest(`return_visit_logs?id=eq.${logId}&select=memo`, {}, developerToken))
  check('작성자는 자기 기록을 수정한다', ownerLogUpdate.ok && ownerLogUpdateValue?.ok === true && updatedLog[0]?.memo === 'owner-updated')

  const ownerDirectDelete = await rows(await rest(`return_visit_logs?id=eq.${logId}&select=id`, {
    method: 'DELETE',
  }, actors.user.token))
  const leaderDirectDelete = await rows(await rest(`return_visit_logs?id=eq.${logId}&select=id`, {
    method: 'DELETE',
  }, actors.leader.token))
  check('작성자도 방문기록을 표에서 직접 삭제하지 못한다', ownerDirectDelete.length === 0)
  check('인도자도 방문기록을 표에서 직접 삭제하지 못한다', leaderDirectDelete.length === 0)

  const leaderWithoutReason = await rpc('update_return_visit_log_tx', {
    p_token: actors.leader.token, p_log_id: logId, p_result: '부재', p_memo: 'leader-edit', p_reason: '',
  }, actors.leader.token)
  check('관리자가 남의 기록을 고칠 때는 사유가 필요하다', !leaderWithoutReason.ok)
  const leaderWithReason = await rpc('update_return_visit_log_tx', {
    p_token: actors.leader.token, p_log_id: logId, p_result: '부재', p_memo: 'leader-edit', p_reason: 'smoke correction',
  }, actors.leader.token)
  check('관리자는 사유를 남기고 다른 사람의 기록을 고친다', leaderWithReason.ok)

  const leaderLog = await rows(await rest('return_visit_logs?select=id', {
    method: 'POST', body: JSON.stringify({
      return_visit_id: returnId, result: '부재', memo: 'leader', created_by: actors.leader.name,
    }),
  }, actors.leader.token))
  if (leaderLog[0]?.id) ids.logs.push(leaderLog[0].id)
  check('인도자는 담당 활동에 기록을 추가한다', leaderLog.length === 1)

  const invalidated = await rpc('invalidate_return_visit_log_tx', {
    p_token: actors.leader.token, p_log_id: leaderLog[0]?.id, p_reason: '',
  }, actors.leader.token)
  const invalidatedValue = await json(invalidated)
  const invalidatedRow = await rows(await rest(
    `return_visit_logs?id=eq.${leaderLog[0]?.id}&select=id,invalidated_at`, {}, developerToken,
  ))
  check('작성자는 자기 기록을 취소한다', invalidated.ok && invalidatedValue?.ok === true && Boolean(invalidatedRow[0]?.invalidated_at))
  check('취소한 기록의 원본 행은 감사용으로 남는다', invalidatedRow.length === 1)

  const endByOther = await rpc('end_return_visit_tx', {
    p_token: actors.other.token, p_return_visit_id: returnId,
    p_reason: 'no_longer_assigned', p_issue_type: null, p_issue_note: '',
  }, actors.other.token)
  check('다른 일반 사용자는 정기방문을 종료하지 못한다', !endByOther.ok)
  const endByOwner = await rpc('end_return_visit_tx', {
    p_token: actors.user.token, p_return_visit_id: returnId,
    p_reason: 'no_longer_assigned', p_issue_type: null, p_issue_note: '',
  }, actors.user.token)
  const endValue = await json(endByOwner)
  check('담당자는 본인 정기방문을 종료한다', endByOwner.ok && endValue?.ok === true)

  const endedRow = await rows(await rest(`return_visits?id=eq.${returnId}&select=ended_at`, {}, developerToken))
  check('종료 결과가 실제 행에 남는다', Boolean(endedRow[0]?.ended_at))
} catch (error) {
  console.error(`FAIL smoke 중단 - ${error?.message ?? error}`)
  failures += 1
} finally {
  if (developerToken) {
    for (const id of ids.logs) await rest(`return_visit_logs?id=eq.${id}&select=id`, { method: 'DELETE' }, developerToken).catch(() => null)
    for (const id of ids.returns) await rest(`return_visits?id=eq.${id}&select=id`, { method: 'DELETE' }, developerToken).catch(() => null)
    for (const id of ids.regulars) await rest(`regular_visits?id=eq.${id}&select=id`, { method: 'DELETE' }, developerToken).catch(() => null)
    for (const id of ids.sessions) await rest(`service_sessions?id=eq.${id}&select=id`, { method: 'DELETE' }, developerToken).catch(() => null)
    for (const id of ids.events) await rest(`calendar_events?id=eq.${id}&select=id`, { method: 'DELETE' }, developerToken).catch(() => null)
    for (const id of ids.buildings) await rest(`buildings?id=eq.${id}&select=id`, { method: 'DELETE' }, developerToken).catch(() => null)
    for (const id of ids.users) await rest(`app_users?id=eq.${id}&select=id`, { method: 'DELETE' }, developerToken).catch(() => null)
  }
}

if (failures) {
  console.error(`\nFAIL ${failures}개 실패\n`)
  process.exit(1)
}
console.log('\nOK 개인 봉사 자료 정책 smoke 통과\n')
