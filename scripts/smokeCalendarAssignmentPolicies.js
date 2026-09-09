#!/usr/bin/env node
// 일정·신청·배정 역할 계약. 테스트 DB 전용이다.
import { loadTestEnv } from './testEnvGuard.js'

const env = loadTestEnv()
if (!env.allowWrites) { console.error('x 쓰기 가드가 열리지 않았습니다'); process.exit(1) }

const headers = (token, prefer = true) => ({
  apikey: env.anonKey, 'Content-Type': 'application/json',
  ...(prefer ? { Prefer: 'return=representation' } : {}),
  ...(token ? { 'x-session-token': token } : {}),
})
const rest = (path, init = {}, token) => fetch(`${env.url}/rest/v1/${path}`, {
  ...init, headers: { ...headers(token), ...(init.headers ?? {}) },
})
const rpc = (name, payload, token) => rest(`rpc/${name}`, {
  method: 'POST', body: JSON.stringify(payload), headers: headers(token, false),
}, token)
const json = (response) => response.json().catch(() => null)
const rows = async (response) => {
  const value = await json(response)
  return Array.isArray(value) ? value : []
}
const login = async (loginId, pin) => {
  const value = await json(await rpc('auth_login', {
    p_login_id: loginId, p_pin: pin, p_device_label: 'calendar-policy-smoke', p_user_agent: 'smoke',
  }))
  return (Array.isArray(value) ? value[0] : value)?.token ?? null
}

let failures = 0
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'OK' : 'FAIL'} ${label}${detail ? ` - ${detail}` : ''}`)
  if (!ok) failures += 1
}
const marker = `_calendar_policy_${Date.now()}`
const ids = { users: [], events: [], cards: [] }
let developerToken = null

const createRow = async (table, payload, token) => {
  // app_users.pin 등은 의도적으로 SELECT 권한이 없다. fixture 생성 결과도 공개 열만 받는다.
  const selection = table === 'app_users' ? 'id,name,role' : '*'
  const response = await rest(`${table}?select=${selection}`, { method: 'POST', body: JSON.stringify(payload) }, token)
  const value = await json(response)
  return {
    response,
    row: Array.isArray(value) ? value[0] ?? null : null,
    error: Array.isArray(value) ? null : value,
  }
}
const patchRows = (table, query, payload, token) => rest(`${table}?${query}&select=*`, {
  method: 'PATCH', body: JSON.stringify(payload),
}, token)
const deleteRows = (table, query, token) => {
  const selection = table === 'app_users' ? 'id' : '*'
  return rest(`${table}?${query}&select=${selection}`, { method: 'DELETE' }, token)
}

try {
  developerToken = await login('test-admin', '1234')
  if (!developerToken) throw new Error('테스트 개발자로 로그인하지 못했습니다')
  await deleteRows('app_users', `name=like.${encodeURIComponent('_calendar_policy_*')}`, developerToken)

  const actors = {}
  for (const role of ['user', 'leader', 'leader', 'admin']) {
    const key = role === 'leader' && actors.leader ? 'otherLeader' : role
    const loginId = `${marker}_${key}`
    const name = `${marker}_${key}_name`
    const { row, error } = await createRow('app_users', {
      login_id: loginId, name, pin: '4321', role,
      approval_status: 'approved', is_active: true,
    }, developerToken)
    if (!row?.id) throw new Error(`${key} fixture를 만들지 못했습니다: ${JSON.stringify(error)}`)
    ids.users.push(row.id)
    const token = await login(loginId, '4321')
    if (!token) throw new Error(`${key} fixture 로그인이 실패했습니다`)
    actors[key] = { id: row.id, name, token }
  }
  const inactiveName = `${marker} inactive name`
  const inactive = await createRow('app_users', {
    login_id: `${marker}_inactive`, name: inactiveName, pin: '4321', role: 'user',
    approval_status: 'approved', is_active: false,
  }, developerToken)
  if (!inactive.row?.id) throw new Error(`inactive fixture를 만들지 못했습니다: ${JSON.stringify(inactive.error)}`)
  ids.users.push(inactive.row.id)
  actors.inactive = { id: inactive.row.id, name: inactiveName, token: null }

  const cardResult = await createRow('cards', {
    name: `${marker}_card`, area: marker, region: marker, type: '전체', status: '미배정',
  }, actors.admin.token)
  const card = cardResult.row
  if (!card?.id) throw new Error(`카드 fixture를 만들지 못했습니다: ${JSON.stringify(cardResult.error)}`)
  ids.cards.push(card.id)

  const eventPayload = (leaderName, suffix, allowApplications = true) => ({
    event_date: '2099-09-07', time: '10:00', title: `${marker}_${suffix}`,
    type: '주택', place: marker, leader_name: leaderName, card_name: '', memo: '',
    has_meeting: false, allow_applications: allowApplications,
  })
  for (const [leaderName, suffix, allow] of [
    [actors.leader.name, 'owned', true],
    [actors.otherLeader.name, 'other', true],
    [actors.leader.name, 'closed', false],
  ]) {
    const { row, error } = await createRow('calendar_events', eventPayload(leaderName, suffix, allow), actors.admin.token)
    if (!row?.id) throw new Error(`${suffix} 일정 fixture를 만들지 못했습니다: ${JSON.stringify(error)}`)
    ids.events.push(row.id)
  }
  const [ownedEventId, otherEventId, closedEventId] = ids.events

  check('일정 SELECT는 공개 상태를 유지한다', (await rest('calendar_events?select=id&limit=1')).ok)
  for (const [label, token] of [
    ['무세션', null], ['일반 사용자', actors.user.token], ['인도자', actors.leader.token],
  ]) {
    const { row, response } = await createRow('calendar_events', eventPayload(actors.leader.name, `blocked_${label}`), token)
    check(`${label}는 일정을 만들지 못한다`, !row, `HTTP ${response.status}`)
  }

  const leaderDirectUpdate = await rows(await patchRows(
    'calendar_events', `id=eq.${ownedEventId}`, { memo: 'direct-bypass' }, actors.leader.token,
  ))
  check('인도자는 일정 표를 직접 수정하지 못한다', leaderDirectUpdate.length === 0)
  const unchanged = (await rows(await rest(`calendar_events?id=eq.${ownedEventId}&select=memo`, {}, actors.admin.token)))[0]
  check('차단된 직접 수정 뒤 일정은 그대로다', unchanged?.memo === '')

  const ownUpdate = await rpc('update_calendar_event_tx', {
    p_token: actors.leader.token, p_event_id: ownedEventId,
    p_payload: { memo: 'leader-rpc' }, p_notify: false,
  }, actors.leader.token)
  const ownUpdateValue = await json(ownUpdate)
  check('해당 일정 인도자는 RPC로 수정한다', ownUpdate.ok && ownUpdateValue?.ok === true)

  for (const [label, actor] of [['일반 사용자', actors.user], ['다른 인도자', actors.otherLeader]]) {
    const response = await rpc('update_calendar_event_tx', {
      p_token: actor.token, p_event_id: ownedEventId,
      p_payload: { memo: `${label}-bypass` }, p_notify: false,
    }, actor.token)
    const value = await json(response)
    check(`${label}는 이 일정을 RPC로 수정하지 못한다`, !response.ok || value?.ok !== true, `HTTP ${response.status}`)
  }
  const afterRpcBlocks = (await rows(await rest(`calendar_events?id=eq.${ownedEventId}&select=memo`, {}, actors.admin.token)))[0]
  check('차단된 RPC 뒤 일정값은 유지된다', afterRpcBlocks?.memo === 'leader-rpc')

  const selfApply = await createRow('event_participants', {
    event_id: ownedEventId, user_name: actors.user.name, role: '신청',
  }, actors.user.token)
  check('일반 사용자는 본인을 신청한다', selfApply.row?.user_name === actors.user.name)
  const staleReapplyResponse = await rest('event_participants?on_conflict=event_id,user_name&select=id', {
    method: 'POST',
    body: JSON.stringify({ event_id: ownedEventId, user_name: actors.user.name, role: '신청' }),
    headers: { Prefer: 'resolution=ignore-duplicates,return=representation' },
  }, actors.user.token)
  const staleReapplyValue = await json(staleReapplyResponse)
  const staleReapplyRows = Array.isArray(staleReapplyValue) ? staleReapplyValue : []
  check('낡은 화면에서 같은 신청을 다시 보내도 오류 없이 기존 행을 유지한다',
    staleReapplyResponse.ok && staleReapplyRows.length === 0,
    `HTTP ${staleReapplyResponse.status} ${JSON.stringify(staleReapplyValue)}`)
  const forgedApply = await createRow('event_participants', {
    event_id: ownedEventId, user_name: actors.otherLeader.name, role: '신청',
  }, actors.user.token)
  check('일반 사용자는 다른 이름으로 신청하지 못한다', !forgedApply.row)
  const forgedRole = await createRow('event_participants', {
    event_id: otherEventId, user_name: actors.user.name, role: '게스트',
  }, actors.user.token)
  check('일반 사용자는 자기 역할을 손님으로 만들지 못한다', !forgedRole.row)
  const closedApply = await createRow('event_participants', {
    event_id: closedEventId, user_name: actors.user.name, role: '신청',
  }, actors.user.token)
  check('신청을 받지 않는 일정에는 신청하지 못한다', !closedApply.row)

  const managerAdd = await createRow('event_participants', {
    event_id: ownedEventId, user_name: actors.admin.name, role: '신청',
  }, actors.leader.token)
  check('일정 인도자는 다른 참가자를 추가한다', managerAdd.row?.user_name === actors.admin.name)
  const otherLeaderAdd = await createRow('event_participants', {
    event_id: ownedEventId, user_name: actors.leader.name, role: '신청',
  }, actors.otherLeader.token)
  check('다른 인도자는 참가자를 추가하지 못한다', !otherLeaderAdd.row)

  const inactiveAdd = await createRow('event_participants', {
    event_id: ownedEventId, user_name: actors.inactive.name, role: '신청',
  }, actors.leader.token)
  check('일정 인도자도 비활성 계정을 참가자로 추가하지 못한다', !inactiveAdd.row)
  const registeredAsGuest = await createRow('event_participants', {
    event_id: ownedEventId, user_name: actors.inactive.name, role: '게스트',
  }, actors.leader.token)
  check('비활성 계정 이름을 게스트로 우회하지 못한다', !registeredAsGuest.row)
  const registeredAsGuestWithSpacing = await createRow('event_participants', {
    event_id: ownedEventId,
    user_name: actors.inactive.name.replace(/ /g, '  ').toUpperCase(),
    role: '게스트',
  }, actors.leader.token)
  check('공백·대소문자를 바꾼 비활성 계정 이름도 게스트로 우회하지 못한다', !registeredAsGuestWithSpacing.row)
  const guestName = `${marker}_real_guest`
  const guestAdd = await createRow('event_participants', {
    event_id: ownedEventId, user_name: guestName, role: '게스트',
  }, actors.leader.token)
  check('일정 인도자는 계정 없는 게스트를 추가한다', guestAdd.row?.role === '게스트')

  const selfCancel = await rows(await deleteRows('event_participants',
    `event_id=eq.${ownedEventId}&user_name=eq.${encodeURIComponent(actors.user.name)}`, actors.user.token))
  check('일반 사용자는 자기 신청을 취소한다', selfCancel.length === 1)
  const assignedUser = await createRow('event_participants', {
    event_id: ownedEventId, user_name: actors.user.name, role: '입명',
  }, actors.leader.token)
  check('일정 인도자는 참가자를 직접 배정한다', assignedUser.row?.role === '입명')
  const selfAssignedCancel = await rows(await deleteRows('event_participants',
    `event_id=eq.${ownedEventId}&user_name=eq.${encodeURIComponent(actors.user.name)}`, actors.user.token))
  check('일반 사용자는 인도자가 추가한 참가 줄을 스스로 지우지 못한다', selfAssignedCancel.length === 0)
  const managerAssignedCancel = await rows(await deleteRows('event_participants',
    `event_id=eq.${ownedEventId}&user_name=eq.${encodeURIComponent(actors.user.name)}`, actors.leader.token))
  check('일정 인도자는 직접 추가한 참가자를 제외한다', managerAssignedCancel.length === 1)
  const otherRemove = await rows(await deleteRows('event_participants',
    `event_id=eq.${ownedEventId}&user_name=eq.${encodeURIComponent(actors.admin.name)}`, actors.otherLeader.token))
  check('다른 인도자는 참가자를 제외하지 못한다', otherRemove.length === 0)

  for (const [label, actor] of [['일반 사용자', actors.user], ['다른 인도자', actors.otherLeader]]) {
    const { row } = await createRow('event_card_assignments', {
      event_id: ownedEventId, user_name: `${marker}_${label}`, assigned_card_id: card.id, assigned_by: actor.name,
    }, actor.token)
    check(`${label}는 일정 구역을 배정하지 못한다`, !row)
  }
  const leaderAssignment = await createRow('event_card_assignments', {
    event_id: ownedEventId, user_name: actors.leader.name, assigned_card_id: card.id, assigned_by: actors.leader.name,
  }, actors.leader.token)
  check('해당 일정 인도자는 구역을 배정한다', leaderAssignment.row?.event_id === ownedEventId)

  for (const [label, actor] of [['일반 사용자', actors.user], ['다른 인도자', actors.otherLeader]]) {
    const response = await rpc('assign_cards_bulk_tx', {
      p_token: actor.token, p_event_id: ownedEventId,
      p_assignments: [{ userName: actors.user.name, cardIds: [card.id], teamKey: null }],
      p_status: null, p_expected_shared_at: null,
    }, actor.token)
    const value = await json(response)
    check(`${label}는 일괄 배정 RPC를 실행하지 못한다`, !response.ok || value?.ok !== true, `HTTP ${response.status}`)
  }
  const leaderBulk = await rpc('assign_cards_bulk_tx', {
    p_token: actors.leader.token, p_event_id: ownedEventId,
    p_assignments: [{ userName: actors.user.name, cardIds: [card.id], teamKey: null }],
    p_status: 'confirmed', p_expected_shared_at: null,
  }, actors.leader.token)
  const leaderBulkValue = await json(leaderBulk)
  check('해당 일정 인도자는 일괄 배정 RPC를 실행한다', leaderBulk.ok && leaderBulkValue?.ok === true)

  for (const [table, payload] of [
    ['card_assignments', { card_id: card.id, user_name: actors.user.name }],
    ['card_leader_assignments', { card_id: card.id, user_name: actors.leader.name }],
  ]) {
    check(`일반 사용자는 ${table}를 쓰지 못한다`, !(await createRow(table, payload, actors.user.token)).row)
    check(`인도자는 ${table}를 쓰지 못한다`, !(await createRow(table, payload, actors.leader.token)).row)
    check(`관리자는 ${table}를 쓴다`, Boolean((await createRow(table, payload, actors.admin.token)).row?.id))
  }

  const leaderDeleteEvent = await rows(await deleteRows('calendar_events', `id=eq.${ownedEventId}`, actors.leader.token))
  check('인도자는 일정을 삭제하지 못한다', leaderDeleteEvent.length === 0)
  const eventStillExists = await rows(await rest(`calendar_events?id=eq.${ownedEventId}&select=id`, {}, actors.admin.token))
  check('차단된 삭제 뒤 일정은 남아 있다', eventStillExists.length === 1)
} catch (error) {
  console.error(`FAIL smoke 중단 - ${error?.message ?? error}`)
  failures += 1
} finally {
  if (developerToken) {
    for (const eventId of ids.events) await deleteRows('calendar_events', `id=eq.${eventId}`, developerToken).catch(() => null)
    for (const cardId of ids.cards) await deleteRows('cards', `id=eq.${cardId}`, developerToken).catch(() => null)
    for (const userId of ids.users) await deleteRows('app_users', `id=eq.${userId}`, developerToken).catch(() => null)
  }
}

console.log(`\n${failures === 0 ? 'OK 일정·배정 정책 smoke 통과' : `FAIL ${failures}개 실패`}\n`)
process.exit(failures === 0 ? 0 : 1)
