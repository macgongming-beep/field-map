#!/usr/bin/env node
// 카드·경계·건물·세대의 역할 계약과 삭제 감사 경로를 실제 REST 요청으로 검증한다.
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
const rpc = (name, value, token) => rest(`rpc/${name}`, {
  method: 'POST', body: JSON.stringify(value), headers: headers(token, false),
}, token)
const body = (response) => response.json().catch(() => null)
const rows = async (response) => { const value = await body(response); return Array.isArray(value) ? value : [] }
const login = async (loginId, pin) => {
  const value = await body(await rpc('auth_login', {
    p_login_id: loginId, p_pin: pin, p_device_label: 'territory-structure-smoke', p_user_agent: 'smoke',
  }))
  return Array.isArray(value) ? value[0] : value
}
let failures = 0
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'OK' : 'FAIL'} ${label}${detail ? ` - ${detail}` : ''}`)
  if (!ok) failures += 1
}

const marker = `_territory_structure_${Date.now()}`
const made = { users: [], cards: [] }
let developerToken
try {
  developerToken = (await login('test-admin', '1234'))?.token
  if (!developerToken) throw new Error('테스트 개발자로 로그인하지 못했습니다')
  const actors = {}
  for (const role of ['user', 'leader']) {
    const name = `${marker}_${role}`
    const created = await rows(await rest('app_users?select=id', {
      method: 'POST', body: JSON.stringify({ login_id: name, name, pin: '4321', role, approval_status: 'approved', is_active: true }),
    }, developerToken))
    if (!created[0]?.id) throw new Error(`${role} fixture 생성 실패`)
    made.users.push(created[0].id)
    actors[role] = { name, token: (await login(name, '4321'))?.token }
  }

  for (const table of ['cards', 'card_boundaries', 'buildings', 'units']) {
    const response = await rest(`${table}?select=*&limit=1`)
    check(`${table} 공개 읽기를 유지한다`, response.ok, `HTTP ${response.status}`)
  }
  const deniedCard = await rows(await rest('cards?select=id', {
    method: 'POST', body: JSON.stringify({ name: marker, area: marker, region: marker, type: '전체' }),
  }, actors.leader.token))
  check('인도자는 카드를 만들지 못한다', deniedCard.length === 0)
  const card = await rows(await rest('cards?select=id', {
    method: 'POST', body: JSON.stringify({ name: marker, area: marker, region: marker, type: '전체' }),
  }, developerToken))
  const cardId = card[0]?.id
  if (!cardId) throw new Error('관리자 카드 fixture 생성 실패')
  made.cards.push(cardId)

  const points = [{ lat: 37.1, lng: 127.1 }, { lat: 37.2, lng: 127.1 }, { lat: 37.1, lng: 127.2 }]
  const leaderBoundary = await rows(await rest('card_boundaries?on_conflict=card_id&select=card_id', {
    method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=representation' }, body: JSON.stringify({ card_id: cardId, points }),
  }, actors.leader.token))
  check('인도자는 구역선을 쓰지 못한다', leaderBoundary.length === 0)
  const adminBoundary = await rows(await rest('card_boundaries?on_conflict=card_id&select=card_id', {
    method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=representation' }, body: JSON.stringify({ card_id: cardId, points }),
  }, developerToken))
  check('관리자는 구역선을 쓴다', adminBoundary[0]?.card_id === cardId)

  const noSession = await rows(await rest('buildings?select=id', {
    method: 'POST', body: JSON.stringify({ card_id: cardId, name: marker, address: marker, type: '주택', lat: 37.1, lng: 127.1 }),
  }))
  check('무세션은 건물을 만들지 못한다', noSession.length === 0)
  const building = await rows(await rest('buildings?select=id,name', {
    method: 'POST', body: JSON.stringify({ card_id: cardId, name: marker, address: marker, type: '주택', lat: 37.1, lng: 127.1 }),
  }, actors.user.token))
  const buildingId = building[0]?.id
  if (!buildingId) throw new Error('일반 사용자 건물 생성 실패')
  check('일반 사용자는 건물을 등록한다', true)

  const userBuildingEdit = await rows(await rest(`buildings?id=eq.${buildingId}&select=id`, {
    method: 'PATCH', body: JSON.stringify({ name: `${marker}_forged` }),
  }, actors.user.token))
  check('일반 사용자는 기존 건물 구조를 수정하지 못한다', userBuildingEdit.length === 0)
  const surveyedResponse = await rest(`buildings?id=eq.${buildingId}&select=id,units_surveyed`, {
    method: 'PATCH', body: JSON.stringify({ units_surveyed: true }),
  }, actors.user.token)
  const surveyedBody = await body(surveyedResponse)
  const surveyed = Array.isArray(surveyedBody) ? surveyedBody : []
  check('일반 사용자는 전수조사 뒤 세대 확인 완료를 표시한다', surveyed[0]?.units_surveyed === true,
    surveyed.length ? '' : `HTTP ${surveyedResponse.status} ${JSON.stringify(surveyedBody)}`)
  const leaderBuildingEdit = await rows(await rest(`buildings?id=eq.${buildingId}&select=id,name`, {
    method: 'PATCH', body: JSON.stringify({ name: `${marker}_leader` }),
  }, actors.leader.token))
  check('인도자는 건물 구조를 수정한다', leaderBuildingEdit[0]?.name === `${marker}_leader`)

  const unit = await rows(await rest('units?select=id,number', {
    method: 'POST', body: JSON.stringify({ building_id: buildingId, number: '101', status: '미방문' }),
  }, actors.user.token))
  const unitId = unit[0]?.id
  if (!unitId) throw new Error('일반 사용자 세대 생성 실패')
  check('일반 사용자는 세대를 등록한다', true)
  const operational = await rows(await rest(`units?id=eq.${unitId}&select=id,status,memo,is_chinese`, {
    method: 'PATCH', body: JSON.stringify({ status: '부재', memo: marker, is_chinese: true }),
  }, actors.user.token))
  check('일반 사용자는 현장 상태·메모·중국어 표시를 수정한다', operational[0]?.status === '부재' && operational[0]?.memo === marker && operational[0]?.is_chinese === true)
  const structural = await rest(`units?id=eq.${unitId}&select=id`, {
    method: 'PATCH', body: JSON.stringify({ number: '999', usage_type: '상가' }),
  }, actors.user.token)
  check('일반 사용자는 호수·용도를 수정하지 못한다', !structural.ok)
  const leaderUnitEdit = await rows(await rest(`units?id=eq.${unitId}&select=id,number,usage_type`, {
    method: 'PATCH', body: JSON.stringify({ number: '102', usage_type: '상가' }),
  }, actors.leader.token))
  check('인도자는 호수·용도를 수정한다', leaderUnitEdit[0]?.number === '102' && leaderUnitEdit[0]?.usage_type === '상가')

  const directDelete = await rows(await rest(`units?id=eq.${unitId}&select=id`, { method: 'DELETE' }, developerToken))
  check('관리자도 세대를 표에서 직접 삭제하지 못한다', directDelete.length === 0)
  const history = await rows(await rest('visit_histories?select=id', {
    method: 'POST', body: JSON.stringify({ unit_id: unitId, visitor_name: actors.user.name, result: '부재', time_slot: '오후' }),
  }, developerToken))
  if (!history[0]?.id) throw new Error('연결 방문기록 fixture 생성 실패')
  const deleted = await body(await rpc('delete_place_or_request_tx', {
    p_token: actors.leader.token, p_target_type: 'unit', p_target_id: unitId,
    p_request_type: 'remove_place', p_note: 'smoke linked deletion',
  }, actors.leader.token))
  check('인도자는 연결 자료가 있는 세대도 감사 RPC로 삭제한다', deleted?.action === 'deleted' && deleted?.impact?.visit_history_count === 1)
  const gone = await rows(await rest(`units?id=eq.${unitId}&select=id`, {}, developerToken))
  check('삭제 대상이 실제로 사라진다', gone.length === 0)
  const logs = await body(await rpc('get_service_logs', {
    p_token: developerToken, p_filter_event_id: null, p_filter_card_id: cardId, p_limit: 20,
  }, developerToken))
  check('삭제 감사 기록에 행위자·대상·영향이 남는다', Array.isArray(logs) && logs.some((log) => log.action === 'unit_deleted' && log.target_id === unitId && log.details?.actor_role === 'leader' && log.details?.impact?.visit_history_count === 1))
} catch (error) {
  console.error(`FAIL smoke 중단 - ${error?.message ?? error}`)
  failures += 1
} finally {
  if (developerToken) {
    for (const id of made.cards) await rest(`cards?id=eq.${id}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } }, developerToken)
    if (made.users.length) await rest(`app_users?id=in.(${made.users.join(',')})`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } }, developerToken)
  }
}
if (failures) { console.error(`\n${failures}개 계약 실패`); process.exit(1) }
console.log('\n구역 구조 정책 smoke 통과')
