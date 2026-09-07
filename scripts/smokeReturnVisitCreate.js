#!/usr/bin/env node
// Test DB only: proves linked regular-visit creation, ownership protection,
// first-log atomicity, retry idempotence, and linked-address immutability.
import { createClient } from '@supabase/supabase-js'
import { loadTestEnv } from './testEnvGuard.js'

const env = loadTestEnv()
if (!env.allowWrites) throw new Error('PLAYWRIGHT_ALLOW_WRITES=true is required')

const db = createClient(env.url, env.anonKey)
const marker = `_smoke_return_visit_${Date.now()}`
const madeUsers = []
let madeBuilding = null
const madeBuildings = new Set()
let madeLooseVisit = null
let failures = 0

const check = (ok, label, detail = '') => {
  console.log(`${ok ? '✅' : '❌'} ${label}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures += 1
}
const login = async (id, pin) => {
  const { data, error } = await db.rpc('auth_login', { p_login_id: id, p_pin: pin })
  if (error) throw error
  return data?.[0]?.token
}
const client = (token) => createClient(env.url, env.anonKey, {
  global: { headers: { 'x-session-token': token } },
})

try {
  const adminToken = await login('test-admin', '1234')
  const admin = client(adminToken)
  const userLogin = `${marker}_user`
  const userName = `${marker}_사용자`
  const madeUser = await admin.from('app_users').insert({
    login_id: userLogin,
    name: userName,
    pin: '4321',
    role: 'user',
    approval_status: 'approved',
    is_active: true,
  }).select('id').single()
  if (madeUser.error) throw madeUser.error
  madeUsers.push(madeUser.data.id)
  const userToken = await login(userLogin, '4321')
  const user = client(userToken)
  const leaderLogin = `${marker}_leader`
  const leaderName = `${marker}_인도자`
  const madeLeader = await admin.from('app_users').insert({
    login_id: leaderLogin,
    name: leaderName,
    pin: '4321',
    role: 'leader',
    approval_status: 'approved',
    is_active: true,
  }).select('id').single()
  if (madeLeader.error) throw madeLeader.error
  madeUsers.push(madeLeader.data.id)
  const leaderToken = await login(leaderLogin, '4321')
  const leader = client(leaderToken)

  const card = await db.from('cards').select('id').limit(1).single()
  if (card.error || !card.data) throw card.error ?? new Error('test card missing')
  const building = await admin.from('buildings').insert({
    card_id: card.data.id,
    name: `${marker}_건물`,
    address: `${marker} 주소`,
    type: '주택',
    lat: 37.2,
    lng: 127.2,
  }).select('id').single()
  if (building.error) throw building.error
  madeBuilding = building.data.id
  madeBuildings.add(madeBuilding)
  const units = await admin.from('units').insert([
    { building_id: madeBuilding, number: '101', status: '미방문' },
    { building_id: madeBuilding, number: '102', status: '미방문' },
  ]).select('id,number')
  if (units.error || units.data.length !== 2) throw units.error ?? new Error('unit fixture missing')
  const ownUnit = units.data.find((row) => row.number === '101')
  const occupiedUnit = units.data.find((row) => row.number === '102')

  const blockedBuilding = await user.rpc('set_building_access_tx', {
    p_token: userToken, p_building_id: madeBuilding, p_blocked: true, p_note: '현장 확인',
  })
  const blockedState = await db.from('buildings')
    .select('access_status,warning,building_access_events(action,visitor_name,memo)')
    .eq('id', madeBuilding).single()
  check(!blockedBuilding.error && blockedState.data?.access_status === 'blocked'
    && blockedState.data?.warning === true
    && blockedState.data?.building_access_events?.some((event) => event.action === 'blocked'
      && event.visitor_name === userName && event.memo === '현장 확인'),
  '일반 사용자의 출입불가 확인을 건물 상태와 이력에 함께 남긴다')
  const reopenedBuilding = await user.rpc('set_building_access_tx', {
    p_token: userToken, p_building_id: madeBuilding, p_blocked: false, p_note: '재확인',
  })
  const reopenedState = await db.from('buildings').select('access_status,warning').eq('id', madeBuilding).single()
  check(!reopenedBuilding.error && reopenedState.data?.access_status === 'normal'
    && reopenedState.data?.warning === false,
  '출입불가 해제도 상태와 레거시 표시를 함께 맞춘다')

  const base = {
    p_token: userToken,
    p_display_name: `${marker}_별명`,
    p_address: '무시되어야 할 주소',
    p_memo: '첫 기록 메모',
    p_first_result: '만남',
    p_unit_id: ownUnit.id,
  }
  const noSession = await db.rpc('create_return_visit_tx', { ...base, p_token: null })
  check(Boolean(noSession.error), '무세션은 정기방문을 만들지 못한다')

  const created = await db.rpc('create_return_visit_tx', base)
  check(!created.error && created.data?.created === true, '기존 세대에 정기방문 두 표를 함께 만든다', created.error?.message)
  const visitId = created.data?.id
  const [regular, visit, logs] = await Promise.all([
    db.from('regular_visits').select('visitor_name').eq('unit_id', ownUnit.id),
    db.from('return_visits').select('id,address,assigned_user_name,last_result,last_visited_at').eq('unit_id', ownUnit.id),
    db.from('return_visit_logs').select('result,memo,created_by').eq('return_visit_id', visitId),
  ])
  check(regular.data?.length === 1 && regular.data[0].visitor_name === userName,
    '세대 정기방문 담당자는 로그인 사용자다')
  check(visit.data?.length === 1 && visit.data[0].address === `${marker} 주소` && visit.data[0].assigned_user_name === userName,
    '활동 정기방문은 건물 주소와 로그인 사용자를 쓴다')
  check(logs.data?.length === 1 && logs.data[0].result === '만남' && logs.data[0].memo === '첫 기록 메모',
    '첫 결과와 메모를 같은 요청에서 남긴다')
  check(visit.data?.[0]?.last_result === '만남' && Boolean(visit.data?.[0]?.last_visited_at),
    '첫 결과가 활동 정기방문 요약에도 반영된다')

  const retried = await db.rpc('create_return_visit_tx', base)
  const retryCounts = await Promise.all([
    db.from('regular_visits').select('id').eq('unit_id', ownUnit.id),
    db.from('return_visits').select('id').eq('unit_id', ownUnit.id),
    db.from('return_visit_logs').select('id').eq('return_visit_id', visitId),
  ])
  check(!retried.error && retried.data?.created === false
    && retryCounts.every((result) => result.data?.length === 1),
  '같은 날 재시도해도 담당·항목·첫 기록이 중복되지 않는다')

  // 계정 삭제 후의 실제 모양: 활동 항목은 남고 세대 담당 행은 제거된다.
  const orphaned = await admin.from('return_visits')
    .update({ assigned_user_name: '' }).eq('id', visitId).select('id')
  const removedRegular = await admin.from('regular_visits').delete().eq('unit_id', ownUnit.id)
  if (orphaned.error || removedRegular.error) throw orphaned.error ?? removedRegular.error

  const forbiddenReassign = await user.rpc('reassign_return_visit_tx', {
    p_token: userToken,
    p_return_visit_id: visitId,
    p_new_assignee: leaderName,
  })
  check(Boolean(forbiddenReassign.error), '일반 사용자는 끊긴 정기방문을 재배정하지 못한다')

  const reassigned = await admin.rpc('reassign_return_visit_tx', {
    p_token: adminToken,
    p_return_visit_id: visitId,
    p_new_assignee: leaderName,
  })
  const [reassignedVisit, reassignedRegular, preservedLogs] = await Promise.all([
    db.from('return_visits').select('assigned_user_name,created_by').eq('id', visitId).single(),
    db.from('regular_visits').select('visitor_name').eq('unit_id', ownUnit.id).single(),
    db.from('return_visit_logs').select('id').eq('return_visit_id', visitId),
  ])
  check(!reassigned.error
    && reassignedVisit.data?.assigned_user_name === leaderName
    && reassignedRegular.data?.visitor_name === leaderName,
  '관리자 재배정은 활동·세대 정기방문 담당자를 함께 복구한다', reassigned.error?.message)
  check(reassignedVisit.data?.created_by === userName && preservedLogs.data?.length === 1,
    '재배정해도 이전 등록자와 방문 기록은 보존한다')

  const linkedAddress = await leader.from('return_visits')
    .update({ address: '바뀌면 안 되는 주소' }).eq('id', visitId).select('id')
  check(Boolean(linkedAddress.error), '세대에 연결된 주소는 따로 바꾸지 못한다')

  const changedBuildingAddress = `${marker} 고친 건물 주소`
  const buildingAddress = await admin.from('buildings')
    .update({ address: changedBuildingAddress }).eq('id', madeBuilding).select('id')
  const syncedVisit = await db.from('return_visits').select('address').eq('id', visitId).single()
  check(!buildingAddress.error && syncedVisit.data?.address === changedBuildingAddress,
    '건물 주소를 고치면 연결된 정기방문 주소도 같은 트랜잭션에서 맞춘다')

  const occupied = await admin.from('regular_visits').insert({
    unit_id: occupiedUnit.id,
    visitor_name: '다른 담당자',
    registered_at: new Date().toISOString(),
  })
  if (occupied.error) throw occupied.error
  const rejected = await db.rpc('create_return_visit_tx', { ...base, p_unit_id: occupiedUnit.id })
  const partial = await db.from('return_visits').select('id').eq('unit_id', occupiedUnit.id)
  check(Boolean(rejected.error) && partial.data?.length === 0,
    '다른 담당자가 있으면 거부하고 반쪽 활동 항목도 남기지 않는다')

  const loose = await db.rpc('create_return_visit_tx', {
    ...base,
    p_display_name: `${marker}_미연결`,
    p_address: `${marker} 자유 주소`,
    p_memo: '',
    p_first_result: null,
    p_unit_id: null,
  })
  madeLooseVisit = loose.data?.id ?? null
  check(!loose.error && Boolean(madeLooseVisit), '세대에 잇지 않은 기존 흐름도 유지한다', loose.error?.message)
  const looseAddress = await user.from('return_visits')
    .update({ address: `${marker} 고친 주소` }).eq('id', madeLooseVisit).select('address')
  check(looseAddress.data?.[0]?.address === `${marker} 고친 주소`, '미연결 항목은 주소를 고칠 수 있다')

  const existingBuildingLocation = await db.rpc('create_return_visit_location_tx', {
    p_token: leaderToken,
    p_display_name: `${marker}_기존건물새세대`,
    p_address: `${marker} 주소`,
    p_memo: '',
    p_first_result: null,
    p_existing_building_id: madeBuilding,
    p_building_name: '',
    p_building_type: '주택',
    p_unit_number: '103',
    p_unit_usage_type: '상가',
    p_card_id: null,
    p_lat: null,
    p_lng: null,
  })
  const existingBuildingUnits = await db.from('units').select('id,number,usage_type').eq('building_id', madeBuilding)
  const addedCommercialUnit = existingBuildingUnits.data?.find((row) => row.number === '103')
  check(!existingBuildingLocation.error && existingBuildingLocation.data?.building_id === madeBuilding
    && existingBuildingUnits.data?.length === 3 && addedCommercialUnit?.usage_type === '상가',
  '인도자는 주택 건물에 상가 세대를 추가할 수 있다')

  const locationParams = {
    p_token: leaderToken,
    p_display_name: `${marker}_새장소`,
    p_address: `경기도 용인시 처인구 코덱스검증로${String(Date.now()).slice(-5)}번길 11`,
    p_memo: '새 장소 첫 메모',
    p_first_result: '부재',
    p_existing_building_id: null,
    p_building_name: `${marker}_새건물`,
    p_building_type: '상가',
    p_unit_number: '201',
    p_unit_usage_type: '상가',
    p_card_id: card.data.id,
    p_lat: 37.235,
    p_lng: 127.205,
  }
  const forbiddenLocation = await db.rpc('create_return_visit_location_tx', {
    ...locationParams,
    p_token: userToken,
  })
  check(Boolean(forbiddenLocation.error), '일반 사용자는 새 건물과 세대를 만들지 못한다')

  const madeLocation = await db.rpc('create_return_visit_location_tx', locationParams)
  const locationBuildingId = madeLocation.data?.building_id
  if (locationBuildingId) madeBuildings.add(locationBuildingId)
  const locationRows = await db.from('buildings')
    .select('id,name,address,type,units(id,number,is_chinese,usage_type,regular_visits(visitor_name),return_visits(id,last_result,return_visit_logs(result,memo)))')
    .eq('id', locationBuildingId).single()
  const locationUnit = locationRows.data?.units?.[0]
  check(!madeLocation.error && locationRows.data?.name === `${marker}_새건물`
    && locationRows.data?.type === '상가' && locationUnit?.number === '201'
    && locationUnit?.usage_type === null,
    '인도자는 선택한 기본 용도로 새 건물과 세대를 만든다', madeLocation.error?.message)
  const locationRegular = Array.isArray(locationUnit?.regular_visits)
    ? locationUnit.regular_visits[0]
    : locationUnit?.regular_visits
  check(locationUnit?.is_chinese === true && locationRegular?.visitor_name === leaderName,
    '새 세대는 중국어 대상이고 인도자 본인이 담당한다', JSON.stringify(locationUnit))
  check(locationUnit?.return_visits?.[0]?.last_result === '부재'
    && locationUnit?.return_visits?.[0]?.return_visit_logs?.[0]?.memo === '새 장소 첫 메모',
  '새 장소와 첫 기록이 한 요청에서 저장된다')

  const retriedLocation = await db.rpc('create_return_visit_location_tx', {
    ...locationParams,
    p_address: locationParams.p_address.replace('경기도 용인시 처인구 ', ''),
    p_lat: locationParams.p_lat + 0.0001,
    p_lng: locationParams.p_lng + 0.0001,
  })
  const nearbyBuildings = await db.from('buildings').select('id').eq('name', `${marker}_새건물`)
  check(!retriedLocation.error && retriedLocation.data?.building_id === locationBuildingId
    && nearbyBuildings.data?.length === 1,
  '주소 접두사와 좌표가 조금 달라도 200m 이내면 같은 건물을 재사용한다')

  const farLocation = await db.rpc('create_return_visit_location_tx', {
    ...locationParams,
    p_display_name: `${marker}_먼장소`,
    p_unit_number: '301',
    p_lat: locationParams.p_lat + 0.05,
    p_lng: locationParams.p_lng + 0.05,
  })
  if (farLocation.data?.building_id) madeBuildings.add(farLocation.data.building_id)
  check(!farLocation.error && farLocation.data?.building_id !== locationBuildingId,
    '같은 도로명 키라도 200m 밖이면 다른 건물로 만든다')
} catch (error) {
  console.error(`❌ smoke 중단 — ${error?.message ?? error}`)
  failures += 1
} finally {
  const adminToken = await login('test-admin', '1234').catch(() => null)
  if (adminToken) {
    const admin = client(adminToken)
    if (madeLooseVisit) await admin.from('return_visits').delete().eq('id', madeLooseVisit)
    if (madeBuildings.size) await admin.from('buildings').delete().in('id', [...madeBuildings])
    if (madeUsers.length) await admin.from('app_users').delete().in('id', madeUsers)
  }
}

console.log(failures ? `\n❌ ${failures}개 실패` : '\n✅ 정기방문 생성 smoke 통과')
process.exit(failures ? 1 : 0)
