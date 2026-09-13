#!/usr/bin/env node
// Test DB only: proves direct restaurant registration and cleans every fixture.
import { createClient } from '@supabase/supabase-js'
import { loadTestEnv } from './testEnvGuard.js'

const env = loadTestEnv()
if (!env.allowWrites) throw new Error('PLAYWRIGHT_ALLOW_WRITES=true is required')
const db = createClient(env.url, env.anonKey)
const marker = `_smoke_restaurant_${Date.now()}`
const madeUsers = []
let madeBuilding = null
const madeBuildings = new Set()
let madeRequest = null
let failedRequest = null
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

try {
  const adminToken = await login(env.loginId, env.loginPin)
  const client = (token) => createClient(env.url, env.anonKey, { global: { headers: { 'x-session-token': token } } })
  for (const role of ['user', 'leader']) {
    const id = `${marker}_${role}`
    const { data, error } = await client(adminToken).from('app_users').insert({ login_id: id, name: id, pin: '4321', role, approval_status: 'approved', is_active: true }).select('id').single()
    if (error) throw error
    madeUsers.push(data.id)
  }
  const [userToken, leaderToken] = await Promise.all([login(`${marker}_user`, '4321'), login(`${marker}_leader`, '4321')])
  const { data: card } = await db.from('cards').select('id').limit(1).single()
  if (!card) throw new Error('test card missing')
  const params = { p_token: userToken, p_name: `${marker}_식당1`, p_address: `${marker} 주소`, p_existing_building_id: null, p_card_id: card.id, p_lat: 37.5, p_lng: 127.1, p_is_chinese: false, p_initial_state: '부재', p_regular_visitor: null, p_building_name: `${marker} 짧은주소` }

  const noSession = await db.rpc('register_restaurant_v2_tx', { ...params, p_token: null })
  check(Boolean(noSession.error), '무세션은 등록하지 못한다')
  const user = await db.rpc('register_restaurant_v2_tx', params)
  check(Boolean(user.error), '일반 사용자는 등록하지 못한다')
  const leader = await db.rpc('register_restaurant_v2_tx', { ...params, p_token: leaderToken })
  check(!leader.error && Boolean(leader.data?.building_id && leader.data?.unit_id), '인도자는 새 상가와 식당을 등록한다', leader.error?.message)
  madeBuilding = leader.data?.building_id ?? null
  if (madeBuilding) madeBuildings.add(madeBuilding)

  const made = await db.from('buildings').select('id,name,address,type,is_restaurant,units(id,number,status,is_chinese,is_restaurant,usage_type)').eq('id', madeBuilding).single()
  check(made.data?.type === '상가' && made.data?.is_restaurant === true && made.data?.name === `${marker} 짧은주소`, '건물은 짧은 주소 이름의 상가·식당으로 저장된다')
  check(made.data?.units?.[0]?.number === `${marker}_식당1` && made.data?.units?.[0]?.status === '부재'
    && made.data?.units?.[0]?.is_chinese === false && made.data?.units?.[0]?.is_restaurant === true
    && made.data?.units?.[0]?.usage_type === '상가',
  '선택한 상태·중국어 여부와 상가 용도로 식당을 저장한다')

  const residential = await client(adminToken).from('buildings').insert({
    card_id: card.id, name: `${marker}_주택건물`, address: `${marker} 주택 주소`,
    type: '주택', lat: 37.5005, lng: 127.1005,
  }).select('id').single()
  if (residential.error) throw residential.error
  madeBuildings.add(residential.data.id)
  const mixedRestaurant = await db.rpc('register_restaurant_v2_tx', {
    ...params, p_token: leaderToken, p_name: `${marker}_주택1층식당`,
    p_address: `${marker} 주택 주소`, p_existing_building_id: residential.data.id,
  })
  const mixed = await db.from('buildings')
    .select('type,units(number,is_restaurant,usage_type)').eq('id', residential.data.id).single()
  check(!mixedRestaurant.error && mixed.data?.type === '주택'
    && mixed.data?.units?.[0]?.is_restaurant === true
    && mixed.data?.units?.[0]?.usage_type === '상가',
  '주택 건물 유형은 보존하고 식당 세대만 상가로 추가한다', mixedRestaurant.error?.message)

  const second = await db.rpc('register_restaurant_v2_tx', { ...params, p_token: leaderToken, p_name: `${marker}_식당2`, p_existing_building_id: madeBuilding, p_is_chinese: true, p_initial_state: '정기방문', p_regular_visitor: `${marker}_leader` })
  check(!second.error && second.data?.building_id === madeBuilding, '기존 상가에 두 번째 식당을 추가한다', second.error?.message)
  const regular = await db.from('units').select('status,is_chinese,regular_visits(visitor_name)').eq('id', second.data?.unit_id).single()
  const regularRow = Array.isArray(regular.data?.regular_visits) ? regular.data.regular_visits[0] : regular.data?.regular_visits
  check(regular.data?.status === '만남' && regular.data?.is_chinese === true && regularRow?.visitor_name === `${marker}_leader`, '정기방문은 만남 상태와 담당자를 함께 저장한다', JSON.stringify(regular.data ?? regular.error))
  const retry = await db.rpc('register_restaurant_v2_tx', { ...params, p_token: leaderToken })
  check(!retry.error && retry.data?.unit_id === leader.data?.unit_id, '중복 탭은 같은 식당을 다시 만들지 않는다', retry.error?.message)
  const historyAfterRetry = await db.from('visit_histories').select('id').eq('unit_id', leader.data?.unit_id).eq('visit_type', 'restaurant')
  check(historyAfterRetry.data?.length === 1, '같은 날 재시도해도 방문기록은 중복되지 않는다')

  const stopRegular = await db.rpc('register_restaurant_v2_tx', {
    ...params, p_token: leaderToken, p_name: `${marker}_식당2`, p_existing_building_id: madeBuilding,
    p_is_chinese: true, p_initial_state: '미방문', p_regular_visitor: null,
  })
  const regularAfterStop = await db.from('regular_visits').select('unit_id').eq('unit_id', second.data?.unit_id)
  check(!stopRegular.error && regularAfterStop.data?.length === 1, '일반 상태로 다시 등록해도 기존 정기방문 담당은 유지된다')

  const stealRegular = await db.rpc('register_restaurant_v2_tx', {
    ...params, p_token: leaderToken, p_name: `${marker}_식당2`, p_existing_building_id: madeBuilding,
    p_is_chinese: true, p_initial_state: '정기방문', p_regular_visitor: `${marker}_다른담당`,
  })
  const regularAfterSteal = await db.from('regular_visits').select('visitor_name').eq('unit_id', second.data?.unit_id).single()
  check(Boolean(stealRegular.error) && regularAfterSteal.data?.visitor_name === `${marker}_leader`, '다른 담당자가 있는 정기방문은 뺏지 못한다')

  // 신청 승인: 같은 이름의 일반 세대를 재사용해도 식당 표시와 선택값을 모두 반영해야 한다.
  const approvalName = `${marker}_승인식당`
  const plainUnit = await client(adminToken).from('units').insert({
    building_id: madeBuilding, number: approvalName, status: '대상외', is_chinese: false, is_restaurant: false,
  }).select('id').single()
  if (plainUnit.error) throw plainUnit.error
  const request = await client(userToken).from('restaurant_requests').insert({
    name: approvalName,
    address: `${marker} 주소`,
    requested_by: `${marker}_user`,
    visited_at: null,
    is_chinese: true,
    initial_status: '미방문',
  }).select('id').single()
  if (request.error) throw request.error
  madeRequest = request.data.id
  const approved = await db.rpc('approve_restaurant_request_tx', {
    p_token: adminToken,
    p_request_id: madeRequest,
    p_name: approvalName,
    p_address: `${marker} 주소`,
    p_existing_building_id: madeBuilding,
    p_card_id: null,
    p_lat: 0,
    p_lng: 0,
    p_building_name: `${marker} 짧은주소`,
  })
  check(!approved.error && approved.data?.unit_id === plainUnit.data.id, '승인은 같은 이름의 기존 세대를 재사용한다', approved.error?.message)
  const approvedUnit = await db.from('units').select('id,status,is_chinese,is_restaurant,visit_histories(result,visit_type)').eq('id', plainUnit.data.id).single()
  check(approvedUnit.data?.is_restaurant === true && approvedUnit.data?.is_chinese === true && approvedUnit.data?.status === '대상외', '대상외 상태는 보존하고 확인된 중국어 여부는 false에서 true로 켠다')
  check(approvedUnit.data?.visit_histories?.length === 0, '미방문 신청은 방문기록을 만들지 않는다')
  const approvedRequest = await db.from('restaurant_requests').select('status,building_id').eq('id', madeRequest).single()
  check(approvedRequest.data?.status === 'approved' && approvedRequest.data?.building_id === madeBuilding, '건물·세대 처리 후에 신청을 승인한다')

  const freshVisitName = `${marker}_새방문식당`
  const freshVisitUnit = await client(adminToken).from('units').insert({
    building_id: madeBuilding, number: freshVisitName, status: '미방문', is_chinese: false, is_restaurant: false,
  }).select('id').single()
  if (freshVisitUnit.error) throw freshVisitUnit.error
  const freshVisitRequest = await client(userToken).from('restaurant_requests').insert({
    name: freshVisitName, address: `${marker} 주소`, requested_by: `${marker}_user`,
    visited_at: new Date().toISOString(), is_chinese: true, initial_status: '부재',
  }).select('id').single()
  if (freshVisitRequest.error) throw freshVisitRequest.error
  const freshVisitApproval = await db.rpc('approve_restaurant_request_tx', {
    p_token: adminToken, p_request_id: freshVisitRequest.data.id, p_name: freshVisitName,
    p_address: `${marker} 주소`, p_existing_building_id: madeBuilding, p_card_id: null,
    p_lat: 0, p_lng: 0, p_building_name: `${marker} 짧은주소`,
  })
  const freshVisitAfter = await db.from('units').select('status,is_chinese').eq('id', freshVisitUnit.data.id).single()
  check(!freshVisitApproval.error && freshVisitAfter.data?.status === '부재' && freshVisitAfter.data?.is_chinese === true,
    '미방문 기존 세대는 최신 방문 결과와 확인된 중국어 여부를 반영한다')
  await client(adminToken).from('restaurant_requests').delete().eq('id', freshVisitRequest.data.id)

  // 동명 세대가 둘이면 임의로 고르지 않고, 신청도 pending 그대로여야 한다.
  const duplicateName = `${marker}_중복`
  const duplicates = await client(adminToken).from('units').insert([
    { building_id: madeBuilding, number: duplicateName, status: '미방문', is_chinese: true, is_restaurant: false },
    { building_id: madeBuilding, number: duplicateName.toUpperCase(), status: '미방문', is_chinese: true, is_restaurant: false },
  ])
  if (duplicates.error) throw duplicates.error
  const pending = await client(userToken).from('restaurant_requests').insert({
    name: duplicateName, address: `${marker} 주소`, requested_by: `${marker}_user`, initial_status: '만남', is_chinese: true,
  }).select('id').single()
  if (pending.error) throw pending.error
  failedRequest = pending.data.id
  const rejectedApproval = await db.rpc('approve_restaurant_request_tx', {
    p_token: adminToken, p_request_id: failedRequest, p_name: duplicateName, p_address: `${marker} 주소`,
    p_existing_building_id: madeBuilding, p_card_id: null, p_lat: 0, p_lng: 0, p_building_name: `${marker} 짧은주소`,
  })
  const stillPending = await db.from('restaurant_requests').select('status,building_id').eq('id', failedRequest).single()
  check(Boolean(rejectedApproval.error) && stillPending.data?.status === 'pending' && stillPending.data?.building_id == null, '중복 세대로 승인이 멈추면 신청도 반쪽 승인되지 않는다')

  // 주소 접두사가 달라도 같은 좌표·도로명 주소면 동시 요청을 한 건물로 모은다.
  const addressNumber = String(Date.now()).slice(-5)
  const shortRoad = `코덱스검증로${addressNumber}번길 11`
  const fullRoad = `경기도 수원시 영통구 ${shortRoad}`
  const addressParams = {
    ...params, p_token: leaderToken, p_name: `${marker}_주소식당`, p_card_id: card.id,
    p_lat: 37.2461, p_lng: 127.0567, p_building_name: shortRoad,
  }
  const [shortResult, fullResult] = await Promise.all([
    db.rpc('register_restaurant_v2_tx', { ...addressParams, p_address: shortRoad }),
    db.rpc('register_restaurant_v2_tx', { ...addressParams, p_address: fullRoad }),
  ])
  if (shortResult.data?.building_id) madeBuildings.add(shortResult.data.building_id)
  if (fullResult.data?.building_id) madeBuildings.add(fullResult.data.building_id)
  check(!shortResult.error && !fullResult.error && shortResult.data?.building_id === fullResult.data?.building_id,
    '시·구 접두사가 다른 같은 주소의 동시 등록은 건물 하나만 만든다')

  const otherCity = await db.rpc('register_restaurant_v2_tx', {
    ...addressParams, p_name: `${marker}_다른도시식당`, p_address: `경기도 용인시 처인구 ${shortRoad}`,
    p_lat: 37.1512, p_lng: 127.2865,
  })
  if (otherCity.data?.building_id) madeBuildings.add(otherCity.data.building_id)
  check(!otherCity.error && otherCity.data?.building_id !== shortResult.data?.building_id,
    '다른 도시의 같은 도로명·번지는 별도 건물로 남는다')

  const diagonal = await db.rpc('register_restaurant_v2_tx', {
    ...addressParams, p_name: `${marker}_대각선식당`, p_address: `경기도 수원시 팔달구 ${shortRoad}`,
    p_lat: addressParams.p_lat + 0.0019, p_lng: addressParams.p_lng + 0.0019,
  })
  if (diagonal.data?.building_id) madeBuildings.add(diagonal.data.building_id)
  check(!diagonal.error && diagonal.data?.building_id !== shortResult.data?.building_id,
    '위·경도 차가 각각 0.002 이내여도 실거리 200m 밖이면 별도 건물로 남는다')

  const noGeoRoad = `코덱스무좌표로${addressNumber}번길 7`
  const noGeoBuilding = await client(adminToken).from('buildings').insert({
    card_id: card.id, name: noGeoRoad, address: noGeoRoad, type: '상가',
    lat: 0, lng: 0, is_restaurant: true,
  }).select('id').single()
  if (noGeoBuilding.error) throw noGeoBuilding.error
  madeBuildings.add(noGeoBuilding.data.id)
  const noGeo = await db.rpc('register_restaurant_v2_tx', {
    ...params, p_token: leaderToken, p_name: `${marker}_무좌표식당`,
    p_address: `경기도 용인시 처인구 ${noGeoRoad}`, p_lat: 0, p_lng: 0,
  })
  check(!noGeo.error && noGeo.data?.building_id === noGeoBuilding.data.id,
    '지오코딩이 실패해도 긴 주소와 짧은 주소의 유일한 기존 건물을 재사용한다')

  const noGeoDuplicate = await client(adminToken).from('buildings').insert({
    card_id: card.id, name: `${noGeoRoad} 다른도시`, address: `경기도 화성시 ${noGeoRoad}`,
    type: '상가', lat: 0, lng: 0, is_restaurant: true,
  }).select('id').single()
  if (noGeoDuplicate.error) throw noGeoDuplicate.error
  madeBuildings.add(noGeoDuplicate.data.id)
  const ambiguousNoGeo = await db.rpc('register_restaurant_v2_tx', {
    ...params, p_token: leaderToken, p_name: `${marker}_모호한무좌표식당`,
    p_address: `경기도 수원시 ${noGeoRoad}`, p_lat: 0, p_lng: 0,
  })
  check(Boolean(ambiguousNoGeo.error),
    '지오코딩 없이 같은 주소 key가 여러 개면 임의로 고르거나 새로 만들지 않는다')

  const keepChinese = await db.rpc('register_restaurant_v2_tx', {
    ...params, p_token: leaderToken, p_name: `${marker}_식당2`,
    p_existing_building_id: madeBuilding, p_is_chinese: false, p_initial_state: '미방문',
  })
  const chineseAfterFalse = await db.from('units').select('is_chinese').eq('id', second.data?.unit_id).single()
  check(!keepChinese.error && chineseAfterFalse.data?.is_chinese === true,
    '이미 켠 중국어 여부는 false 요청으로 끄지 않는다')
} finally {
  const adminToken = await login(env.loginId, env.loginPin).catch(() => null)
  if (adminToken) {
    const admin = createClient(env.url, env.anonKey, { global: { headers: { 'x-session-token': adminToken } } })
    if (madeRequest) await admin.from('restaurant_requests').delete().eq('id', madeRequest)
    if (failedRequest) await admin.from('restaurant_requests').delete().eq('id', failedRequest)
    if (madeBuildings.size) await admin.from('buildings').delete().in('id', [...madeBuildings])
    if (madeUsers.length) await admin.from('app_users').delete().in('id', madeUsers)
  }
}
console.log(failures ? `\n❌ ${failures}개 실패` : '\n✅ 직접 식당 등록 smoke 통과')
process.exit(failures ? 1 : 0)
