#!/usr/bin/env node
// 방문기록 작성자 소유권, 관리자 사유 정정, 무효 처리와 상태 재계산을 검증한다.
import { loadTestEnv } from './testEnvGuard.js'

const env = loadTestEnv()
if (!env.allowWrites) throw new Error('쓰기 가드가 열리지 않았습니다')
const headers = (token, representation = true) => ({ apikey: env.anonKey, 'Content-Type': 'application/json', ...(representation ? { Prefer: 'return=representation' } : {}), ...(token ? { 'x-session-token': token } : {}) })
const rest = (path, init = {}, token) => fetch(`${env.url}/rest/v1/${path}`, { ...init, headers: { ...headers(token), ...(init.headers ?? {}) } })
const rpc = (name, value, token) => rest(`rpc/${name}`, { method: 'POST', body: JSON.stringify(value), headers: headers(token, false) }, token)
const body = (response) => response.json().catch(() => null)
const rows = async (response) => { const value = await body(response); return Array.isArray(value) ? value : [] }
const login = async (loginId, pin) => { const value = await body(await rpc('auth_login', { p_login_id: loginId, p_pin: pin, p_device_label: 'visit-policy-smoke', p_user_agent: 'smoke' })); return Array.isArray(value) ? value[0] : value }
let failures = 0
const check = (label, ok, detail = '') => { console.log(`${ok ? 'OK' : 'FAIL'} ${label}${detail ? ` - ${detail}` : ''}`); if (!ok) failures++ }
const marker = `_visit_policy_${Date.now()}`
const made = { users: [], cards: [] }
let adminToken
try {
  adminToken = (await login('test-admin', '1234'))?.token
  if (!adminToken) throw new Error('테스트 개발자로 로그인하지 못했습니다')
  const actors = {}
  for (const role of ['user', 'leader']) {
    const name = `${marker}_${role}`
    const created = await rows(await rest('app_users?select=id', { method: 'POST', body: JSON.stringify({ login_id: name, name, pin: '4321', role, approval_status: 'approved', is_active: true }) }, adminToken))
    if (!created[0]?.id) throw new Error(`${role} fixture 생성 실패`)
    made.users.push(created[0].id)
    actors[role] = { id: created[0].id, name, token: (await login(name, '4321'))?.token }
  }
  const card = await rows(await rest('cards?select=id', { method: 'POST', body: JSON.stringify({ name: marker, area: marker, region: marker, type: '전체' }) }, adminToken))
  const cardId = card[0]?.id; if (!cardId) throw new Error('카드 fixture 생성 실패'); made.cards.push(cardId)
  const building = await rows(await rest('buildings?select=id', { method: 'POST', body: JSON.stringify({ card_id: cardId, name: marker, address: marker, type: '주택', lat: 37.1, lng: 127.1 }) }, actors.user.token))
  const buildingId = building[0]?.id
  const unit = await rows(await rest('units?select=id', { method: 'POST', body: JSON.stringify({ building_id: buildingId, number: '101', status: '미방문' }) }, actors.user.token))
  const unitId = unit[0]?.id; if (!unitId) throw new Error('세대 fixture 생성 실패')

  const forgedResponse = await rest('visit_histories?select=id,created_by_user_id', { method: 'POST', body: JSON.stringify({ unit_id: unitId, visitor_name: actors.user.name, result: '부재', time_slot: '오후', visited_at: '2026-09-06', created_by_user_id: actors.leader.id }) }, actors.user.token)
  const forgedBody = await body(forgedResponse)
  const forged = Array.isArray(forgedBody) ? forgedBody : []
  const historyId = forged[0]?.id
  check('INSERT 작성자는 클라이언트 값이 아니라 세션 사용자다', forged[0]?.created_by_user_id === actors.user.id, forged.length ? '' : `HTTP ${forgedResponse.status} ${JSON.stringify(forgedBody)}`)
  const stateAfterInsert = await rows(await rest(`units?id=eq.${unitId}&select=status`, {}, adminToken))
  check('기록 추가 뒤 세대 대표 상태를 서버가 계산한다', stateAfterInsert[0]?.status === '부재')

  const otherEdit = await rows(await rest(`visit_histories?id=eq.${historyId}&select=id`, { method: 'PATCH', body: JSON.stringify({ memo: 'forged' }) }, actors.leader.token))
  check('인도자도 다른 사람 기록을 표에서 직접 수정하지 못한다', otherEdit.length === 0)
  const ownerEdit = await rows(await rest(`visit_histories?id=eq.${historyId}&select=id,memo`, { method: 'PATCH', body: JSON.stringify({ memo: marker }) }, actors.user.token))
  check('작성자는 자기 기록을 직접 수정한다', ownerEdit[0]?.memo === marker)
  const ownerVisitorChange = await rest(`visit_histories?id=eq.${historyId}&select=id`, { method: 'PATCH', body: JSON.stringify({ visitor_name: actors.leader.name }) }, actors.user.token)
  check('작성자도 방문자를 직접 바꾸지 못한다', !ownerVisitorChange.ok)

  const noReason = await rpc('update_visit_history_tx', { p_token: actors.leader.token, p_history_id: historyId, p_result: '만남', p_time_slot: '저녁', p_memo: '', p_visited_at: '2026-09-06', p_visitor_name: actors.user.name, p_reason: '' }, actors.leader.token)
  check('인도자는 사유 없이 남의 기록을 정정하지 못한다', !noReason.ok)
  const corrected = await rpc('update_visit_history_tx', { p_token: actors.leader.token, p_history_id: historyId, p_result: '만남', p_time_slot: '저녁', p_memo: '정정', p_visited_at: '2026-09-06', p_visitor_name: actors.leader.name, p_reason: '담당자 확인' }, actors.leader.token)
  check('인도자는 사유를 남겨 남의 기록과 방문자를 정정한다', corrected.ok, `HTTP ${corrected.status} ${JSON.stringify(await body(corrected))}`)
  const stateAfterEdit = await rows(await rest(`units?id=eq.${unitId}&select=status`, {}, adminToken))
  check('기록 정정 뒤 세대 대표 상태도 맞는다', stateAfterEdit[0]?.status === '만남')

  const directDelete = await rows(await rest(`visit_histories?id=eq.${historyId}&select=id`, { method: 'DELETE' }, adminToken))
  check('관리자도 방문기록을 표에서 직접 삭제하지 못한다', directDelete.length === 0)
  const invalidated = await rpc('invalidate_visit_history_tx', { p_token: actors.leader.token, p_history_id: historyId, p_reason: '중복 입력' }, actors.leader.token)
  check('인도자는 사유를 남겨 기록을 무효 처리한다', invalidated.ok, `HTTP ${invalidated.status} ${JSON.stringify(await body(invalidated))}`)
  const stored = await rows(await rest(`visit_histories?id=eq.${historyId}&select=id,invalidated_at,invalidation_reason`, {}, adminToken))
  check('무효 처리해도 원본 행과 사유가 보존된다', Boolean(stored[0]?.invalidated_at) && stored[0]?.invalidation_reason === '중복 입력')
  const stateAfterInvalidation = await rows(await rest(`units?id=eq.${unitId}&select=status`, {}, adminToken))
  check('유효 기록이 없으면 세대 대표 상태는 미방문이다', stateAfterInvalidation[0]?.status === '미방문')
  const logs = await body(await rpc('get_service_logs', { p_token: adminToken, p_filter_event_id: null, p_filter_card_id: null, p_limit: 100 }, adminToken))
  check('정정과 무효 처리의 전후·사유가 감사 로그에 남는다', Array.isArray(logs) && logs.some((x) => x.action === 'visit_updated' && x.target_id === historyId && x.details?.reason === '담당자 확인') && logs.some((x) => x.action === 'visit_invalidated' && x.target_id === historyId && x.details?.reason === '중복 입력'))
} catch (error) {
  console.error(`FAIL smoke 중단 - ${error?.message ?? error}`); failures++
} finally {
  if (adminToken) {
    for (const id of made.cards) await rest(`cards?id=eq.${id}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } }, adminToken)
    if (made.users.length) await rest(`app_users?id=in.(${made.users.join(',')})`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } }, adminToken)
  }
}
if (failures) { console.error(`\n${failures}개 계약 실패`); process.exit(1) }
console.log('\n방문기록 정책 smoke 통과')
