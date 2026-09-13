#!/usr/bin/env node
// 테스트 DB 에 앱과 같은 방식으로 붙어 본다.
//
// **개수 검사가 못 잡는 것을 잡는 게 목적이다.** 실제로 개수 열두 항목이 전부
// 맞은 채로 anon 이 app_users.pin(bcrypt 해시)을 읽을 수 있었다.
//
//   node scripts/smoke-test-db.js              읽기만
//   PLAYWRIGHT_ALLOW_WRITES=true node ...      쓰기까지
import { createClient } from '@supabase/supabase-js'
import { loadTestEnv } from './testEnvGuard.js'

const env = loadTestEnv()
const db = createClient(env.url, env.anonKey)
console.log(`\n  ${env.ref} 에 붙는다 (쓰기 ${env.allowWrites ? '허용' : '안 함'})\n`)

let failed = 0
const check = (ok, label, detail = '') => {
  console.log(`    ${ok ? '✓' : '✗'} ${label}${detail ? '  — ' + detail : ''}`)
  if (!ok) failed++
}

// ── 1. 로그인 (자체 인증 RPC) ────────────────────────────────────
const login = await db.rpc('auth_login', {
  p_login_id: env.loginId,
  p_pin: env.loginPin,
})
const session = login.data?.[0]
check(!login.error && Boolean(session?.token), '로그인', login.error?.message ?? `role=${session?.role}`)

// ── 2. PIN 이 새지 않는가 (제일 중요) ────────────────────────────
const pin = await db.from('app_users').select('pin').limit(1)
check(Boolean(pin.error), 'PIN 은 읽히지 않는다', pin.error ? '차단됨' : '⚠ 읽혔다!')

const users = await db.from('app_users').select('id,name,role').limit(5)
check(!users.error && (users.data?.length ?? 0) > 0, '허용된 컬럼은 읽힌다', users.error?.message)

// ── 3. 화면이 쓰는 주요 조회 ─────────────────────────────────────
// **개수를 본다.** 에러가 없는지만 보면 부족하다 — RLS 가 잘못 켜지면
// 에러 대신 빈 목록이 오고, 화면에서 그 기능이 조용히 사라진다.
// 실제로 special_periods 가 그랬다. 씨앗이 넣어 둔 최소 개수를 확인한다.
for (const [table, cols, least] of [
  ['cards', 'id,name,region,area', 2],
  ['buildings', 'id,name,address', 2],
  ['units', 'id,number,status', 4],
  ['visit_histories', 'id,result,visited_at', 2],
  ['territory_regions', 'id,name', 1],
  ['special_periods', 'id,label', 1],
]) {
  const r = await db.from(table).select(cols).limit(50)
  const n = r.data?.length ?? 0
  check(!r.error && n >= least, `${table} 조회`, r.error?.message ?? `${n}건 (최소 ${least})`)
}

// ── 4. 쓰기 (등록된 테스트 프로젝트에서만) ───────────────────────
if (env.allowWrites) {
  const name = `smoke-${Date.now()}`
  const card = await db.from('cards').select('id').like('name', '테스트구 %').limit(1).single()
  const ins = await db.from('buildings').insert({
    card_id: card.data?.id, name, address: '테스트 주소', type: '주택', lat: 37.5, lng: 127.1,
  }).select('id').single()
  check(!ins.error, '건물 추가', ins.error?.message)

  if (ins.data?.id) {
    const del = await db.from('buildings').delete().eq('id', ins.data.id)
    check(!del.error, '넣은 것 지우기 (뒷정리)', del.error?.message)
  }
} else {
  console.log('    – 쓰기는 건너뛴다 (PLAYWRIGHT_ALLOW_WRITES=true 로 켠다)')
}

console.log(`\n  ${failed === 0 ? '✅ 전부 통과' : `❌ ${failed}개 실패`}\n`)
process.exit(failed === 0 ? 0 : 1)
