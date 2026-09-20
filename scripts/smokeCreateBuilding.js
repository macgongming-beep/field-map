#!/usr/bin/env node
// Test DB only: every app building-creation path must converge on one building.
import { createClient } from '@supabase/supabase-js'
import { loadTestEnv } from './testEnvGuard.js'

const env = loadTestEnv()
if (!env.allowWrites) throw new Error('PLAYWRIGHT_ALLOW_WRITES=true is required')

const db = createClient(env.url, env.anonKey)
const marker = `_smoke_create_building_${Date.now()}`
const address = `경기도 용인시 처인구 ${marker}로 21`
let token = null
let admin = null
let buildingId = null
let failures = 0

const check = (ok, label, detail = '') => {
  console.log(`${ok ? '✅' : '❌'} ${label}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures += 1
}

try {
  const login = await db.rpc('auth_login', { p_login_id: env.loginId, p_pin: env.loginPin })
  if (login.error) throw login.error
  token = login.data?.[0]?.token
  if (!token) throw new Error('테스트 사용자로 로그인하지 못했습니다')

  admin = createClient(env.url, env.anonKey, {
    global: { headers: { 'x-session-token': token } },
  })
  const card = await db.from('cards').select('id').limit(1).single()
  if (card.error || !card.data) throw card.error ?? new Error('테스트 카드가 없습니다')

  const params = {
    p_token: token,
    p_card_id: card.data.id,
    p_name: marker,
    p_address: address,
    p_type: '주택',
    p_lat: 37.234567,
    p_lng: 127.234567,
  }
  const concurrent = await Promise.all([
    admin.rpc('create_building_tx', params),
    admin.rpc('create_building_tx', { ...params, p_address: `  ${address}  ` }),
  ])
  const actions = concurrent.map((result) => result.data?.action).sort()
  const ids = concurrent.map((result) => Number(result.data?.building_id)).filter(Number.isFinite)
  buildingId = ids[0] ?? null

  check(concurrent.every((result) => !result.error),
    '동시 건물 등록 요청이 모두 정상 응답한다',
    concurrent.find((result) => result.error)?.error?.message)
  check(actions.join(',') === 'created,existing',
    '동시 요청 하나만 생성되고 다른 하나는 기존 건물을 재사용한다', actions.join(','))
  check(ids.length === 2 && new Set(ids).size === 1,
    '두 요청이 같은 건물 ID를 반환한다', ids.join(','))

  const rows = await db.from('buildings').select('id,address').ilike('name', marker)
  check(!rows.error && rows.data?.length === 1,
    '데이터베이스에도 건물이 한 채만 남는다', rows.error?.message)
} catch (error) {
  console.error(error)
  failures += 1
} finally {
  if (buildingId != null && admin && token) {
    const cleanup = await admin.rpc('delete_place_or_request_tx', {
      p_token: token,
      p_target_type: 'building',
      p_target_id: buildingId,
      p_request_type: 'remove_place',
      p_note: '건물 생성 smoke 정리',
    })
    if (cleanup.error) {
      console.error(cleanup.error)
      failures += 1
    } else if (cleanup.data?.action === 'requested' && cleanup.data?.request_id) {
      const executed = await admin.rpc('execute_place_deletion_request_tx', {
        p_token: token,
        p_request_id: cleanup.data.request_id,
      })
      if (executed.error) {
        console.error(executed.error)
        failures += 1
      }
    }
  }
}

console.log(`\n${failures === 0 ? '✅ 건물 생성 smoke 통과' : `❌ ${failures}개 실패`}\n`)
process.exit(failures === 0 ? 0 : 1)
