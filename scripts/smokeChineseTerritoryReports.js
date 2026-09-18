#!/usr/bin/env node
// 중국어 세대 보고서의 공개 범위, 좌표 익명화, 선택 암호 계약을 실제 HTTP 경로로 검증한다.
import { loadTestEnv } from './testEnvGuard.js'

const env = loadTestEnv()
if (!env.allowWrites) process.exit(1)

const headers = (token = null, prefer = false) => ({
  apikey: env.anonKey,
  'Content-Type': 'application/json',
  ...(token ? { 'x-session-token': token } : {}),
  ...(prefer ? { Prefer: 'return=representation' } : {}),
})
const rpcResponse = async (name, body) => {
  const response = await fetch(`${env.url}/rest/v1/rpc/${name}`, {
    method: 'POST', headers: headers(), body: JSON.stringify(body),
  })
  const data = await response.json().catch(() => null)
  return { response, data }
}
const rpc = async (name, body) => {
  const { response, data } = await rpcResponse(name, body)
  if (!response.ok) throw new Error(`${name}: HTTP ${response.status} ${JSON.stringify(data)}`)
  return data
}
const rest = async (path, init = {}, sessionToken = null) => {
  const response = await fetch(`${env.url}/rest/v1/${path}`, {
    ...init,
    headers: { ...headers(sessionToken, true), ...(init.headers ?? {}) },
  })
  const data = await response.json().catch(() => null)
  return { response, data }
}

let failures = 0
const check = (label, ok) => {
  console.log(`${ok ? '✅' : '❌'} ${label}`)
  if (!ok) failures += 1
}

const login = await rpc('auth_login', { p_login_id: env.loginId, p_pin: env.loginPin })
const token = (Array.isArray(login) ? login[0] : login)?.token
if (!token) throw new Error('테스트 관리자로 로그인하지 못했습니다')

const sampleBoundary = [{
  region: '테스트구',
  points: [{ lat: 37.3, lng: 127.1 }, { lat: 37.31, lng: 127.1 }, { lat: 37.3, lng: 127.11 }],
}]
const create = (pin, includeAreaDetails = false) => rpc('create_chinese_territory_report_share_v2_tx', {
  p_token: token,
  p_period_start: '2026-03-01',
  p_period_end: '2026-09-01',
  p_expires_at: new Date(Date.now() + 3_600_000).toISOString(),
  p_pin: pin,
  p_note: 'smoke',
  p_include_area_details: includeAreaDetails,
  p_region_boundaries: sampleBoundary,
})

const createdIds = []
const createdUserIds = []
const fixtureMarker = `_report_majority_${Date.now()}`
let fixtureCardId = null
const fixtureBuildingIds = []
try {
  const fixtureCard = await rest('cards?select=id', {
    method: 'POST',
    body: JSON.stringify({
      name: fixtureMarker,
      region: fixtureMarker,
      area: fixtureMarker,
      type: '전체',
      status: '미배정',
    }),
  }, token)
  fixtureCardId = Array.isArray(fixtureCard.data) ? fixtureCard.data[0]?.id : null
  if (!fixtureCard.response.ok || !fixtureCardId) throw new Error('과반 좌표 시험 카드를 만들지 못했습니다')

  const fixtureBuildings = await rest('buildings?select=id', {
    method: 'POST',
    body: JSON.stringify([
      { card_id: fixtureCardId, name: `${fixtureMarker}_A`, address: `${fixtureMarker} A`, type: '주택', lat: 37.31, lng: 127.11 },
      { card_id: fixtureCardId, name: `${fixtureMarker}_B`, address: `${fixtureMarker} B`, type: '주택', lat: 37.32, lng: 127.12 },
      { card_id: fixtureCardId, name: `${fixtureMarker}_C`, address: `${fixtureMarker} C`, type: '주택', lat: 37.33, lng: 127.13 },
    ]),
  }, token)
  if (!fixtureBuildings.response.ok || fixtureBuildings.data?.length !== 3) {
    throw new Error('과반 좌표 시험 건물 3개를 만들지 못했습니다')
  }
  fixtureBuildingIds.push(...fixtureBuildings.data.map(row => row.id))

  const fixtureUnits = await rest('units?select=id', {
    method: 'POST',
    body: JSON.stringify(fixtureBuildingIds.flatMap((buildingId, index) =>
      Array.from({ length: [5, 2, 1][index] }, (_, unitIndex) => ({
        building_id: buildingId,
        number: `${index + 1}0${unitIndex + 1}`,
        status: '미방문',
        is_chinese: true,
      })),
    )),
  }, token)
  if (!fixtureUnits.response.ok || fixtureUnits.data?.length !== 8) {
    throw new Error('과반 좌표 시험 세대 8개를 만들지 못했습니다')
  }

  const openShare = await create(null, true)
  createdIds.push(openShare.id)
  const openResult = await rpc('get_chinese_territory_report_share', { p_share_token: openShare.shareToken, p_pin: null })
  check('암호를 끄면 링크만으로 보고서를 연다', openResult.ok === true)
  check('선택한 동별 상세 설정을 공유 스냅샷에 고정한다',
    openResult.snapshot?.includeAreaDetails === true && openResult.snapshot?.areas?.length > 0)
  check('구 단위 합성 경계를 공유 스냅샷에 고정한다',
    openResult.snapshot?.regionBoundaries?.[0]?.region === '테스트구')
  check('구별 최근 180일 방문 세대를 집계한다',
    openResult.snapshot?.regions?.every(row => Number.isInteger(row.managed180d)))
  const majorityArea = openResult.snapshot?.areas?.find(row =>
    row.region === fixtureMarker && row.area === fixtureMarker)
  check('건물 3곳 중 한 곳이 중국어 세대 과반이면 중심 좌표를 공개하지 않는다',
    majorityArea?.total === 8 && majorityArea.centerLat == null && majorityArea.centerLng == null)

  const pinShare = await create('123456')
  createdIds.push(pinShare.id)
  const gated = await rpc('get_chinese_territory_report_share', { p_share_token: pinShare.shareToken, p_pin: null })
  check('암호를 켜면 보고서 대신 암호 입력을 요구한다', gated.code === 'pin_required')
  const wrong = await rpc('get_chinese_territory_report_share', { p_share_token: pinShare.shareToken, p_pin: '000000' })
  check('틀린 암호는 거부한다', wrong.code === 'invalid_pin')
  const correct = await rpc('get_chinese_territory_report_share', { p_share_token: pinShare.shareToken, p_pin: '123456' })
  check('맞는 암호는 보고서를 연다', correct.ok === true && correct.snapshot?.summary)
  check('동별 상세 기본값은 제외다', correct.snapshot?.includeAreaDetails === false && correct.snapshot?.areas?.length === 0)

  const serialized = JSON.stringify(correct.snapshot ?? {}).toLowerCase()
  check('공개 스냅샷에 개인정보 열쇠가 없다', !/(address|unit_number|visitor_name|phone|memo)/.test(serialized))
  const coordinateRows = [...(correct.snapshot?.regions ?? []), ...(correct.snapshot?.areas ?? [])]
  check('공개 중심 좌표는 소수 3자리 이하로 제한한다', coordinateRows.every(row =>
    [row.centerLat, row.centerLng].every(value => value == null || Math.abs(value * 1000 - Math.round(value * 1000)) < 1e-7)
  ))
  await rpc('revoke_chinese_territory_report_share_tx', { p_token: token, p_share_id: pinShare.id })
  const revoked = await rpc('get_chinese_territory_report_share', { p_share_token: pinShare.shareToken, p_pin: '123456' })
  check('관리자가 공유를 종료하면 즉시 열리지 않는다', revoked.code === 'unavailable')

  const lockShare = await create('654321')
  createdIds.push(lockShare.id)
  let lockResult = null
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    lockResult = await rpc('get_chinese_territory_report_share', { p_share_token: lockShare.shareToken, p_pin: '000000' })
    check(`틀린 암호 ${attempt}회째 응답`, lockResult.code === (attempt < 5 ? 'invalid_pin' : 'locked'))
  }
  lockResult = await rpc('get_chinese_territory_report_share', { p_share_token: lockShare.shareToken, p_pin: '654321' })
  check('5회 잠금 뒤에는 맞는 암호도 거부한다', lockResult.code === 'locked' && Boolean(lockResult.lockedUntil))

  const expiringShare = await rpc('create_chinese_territory_report_share_v2_tx', {
    p_token: token,
    p_period_start: '2026-03-01',
    p_period_end: '2026-09-01',
    p_expires_at: new Date(Date.now() + 1_500).toISOString(),
    p_pin: null,
    p_note: 'smoke expiry',
    p_include_area_details: false,
    p_region_boundaries: [],
  })
  createdIds.push(expiringShare.id)
  await new Promise(resolve => setTimeout(resolve, 1_800))
  const expired = await rpc('get_chinese_territory_report_share', { p_share_token: expiringShare.shareToken, p_pin: null })
  check('만료된 공유 링크는 열리지 않는다', expired.code === 'unavailable')

  for (const role of ['user', 'leader']) {
    const marker = `_smoke_report_${role}_${Date.now()}`
    const created = await rest('app_users?select=id', {
      method: 'POST',
      body: JSON.stringify({ login_id: marker, name: marker, pin: '4321', role, approval_status: 'approved', is_active: true }),
    }, token)
    const userId = Array.isArray(created.data) ? created.data[0]?.id : null
    if (!created.response.ok || !userId) throw new Error(`${role} 시험 계정을 만들지 못했습니다`)
    createdUserIds.push(userId)
    const roleLogin = await rpc('auth_login', { p_login_id: marker, p_pin: '4321' })
    const roleToken = (Array.isArray(roleLogin) ? roleLogin[0] : roleLogin)?.token
    if (!roleToken) throw new Error(`${role} 시험 계정으로 로그인하지 못했습니다`)

    const preview = await rpcResponse('preview_chinese_territory_report_v2_tx', {
      p_token: roleToken, p_period_start: '2026-03-01', p_period_end: '2026-09-01', p_note: '',
      p_include_area_details: false, p_region_boundaries: [],
    })
    const listing = await rpcResponse('list_chinese_territory_report_shares_tx', { p_token: roleToken })
    const creating = await rpcResponse('create_chinese_territory_report_share_v2_tx', {
      p_token: roleToken, p_period_start: '2026-03-01', p_period_end: '2026-09-01',
      p_expires_at: new Date(Date.now() + 3_600_000).toISOString(), p_pin: null, p_note: '',
      p_include_area_details: false, p_region_boundaries: [],
    })
    check(`${role}는 보고서 미리보기를 못 한다`, !preview.response.ok)
    check(`${role}는 공유 목록을 못 본다`, !listing.response.ok)
    check(`${role}는 공유 링크를 못 만든다`, !creating.response.ok)
  }
} finally {
  for (const id of createdIds) {
    await rpc('revoke_chinese_territory_report_share_tx', { p_token: token, p_share_id: id }).catch(() => null)
  }
  for (const id of createdUserIds) {
    await rest(`app_users?id=eq.${id}&select=id`, { method: 'DELETE' }, token).catch(() => null)
  }
  if (fixtureBuildingIds.length) {
    const ids = fixtureBuildingIds.join(',')
    await rest(`units?building_id=in.(${ids})&select=id`, { method: 'DELETE' }, token).catch(() => null)
    await rest(`buildings?id=in.(${ids})&select=id`, { method: 'DELETE' }, token).catch(() => null)
  }
  if (fixtureCardId) {
    await rest(`cards?id=eq.${fixtureCardId}&select=id`, { method: 'DELETE' }, token).catch(() => null)
  }
}

console.log(`\n${failures ? `❌ ${failures}개 실패` : '✅ 중국어 세대 보고서 smoke 통과'}\n`)
process.exit(failures ? 1 : 0)
