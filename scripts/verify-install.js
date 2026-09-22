#!/usr/bin/env node
/**
 * 새 회중 프로젝트가 제대로 세워졌는지 우리 프로젝트와 대조한다.
 *
 * 왜 이렇게 만드나: '프로토타입 DB' 를 따로 만들어 두면 반드시 낡는다.
 * 우리 DB 에 새 SQL 을 돌릴 때 프로토타입에도 돌리는 일을 사람이 계속
 * 기억해야 하기 때문이다. 그래서 얼린 사본 대신 **살아 있는 우리 DB 와
 * 비교**한다. 표나 함수를 새로 만들어도 검사 항목에 저절로 들어온다.
 *
 * 실행:
 *   TARGET_SUPABASE_URL=https://xxx.supabase.co \
 *   TARGET_SUPABASE_SERVICE_ROLE_KEY=<service_role> npm run verify-install
 *
 * 기준(우리 프로젝트)은 .env.local 의 VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 를 쓴다.
 *
 * ⚠ 이 스크립트는 **읽기만 한다.** 아무것도 만들거나 고치지 않는다.
 *
 * 검사하지 못하는 것 (REST 로 보이지 않는다 — docs/새-회중-설치.md 의 절차로 확인)
 *   · pg_cron 작업        cron 스키마
 *   · 스토리지 버킷·정책   storage 스키마 (지금은 안 쓴다)
 *   · Edge Function       DB 가 아니다
 *   · 푸시 열쇠(VAPID)     회중마다 새로 만들어야 한다
 */

import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const envPath = join(projectRoot, '.env.local')
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const i = t.indexOf('=')
    if (i === -1) continue
    const k = t.slice(0, i).trim()
    if (!process.env[k]) process.env[k] = t.slice(i + 1).trim().replace(/^["']|["']$/g, '')
  }
}

const args = process.argv.slice(2)
const argOf = (name) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : null
}

const baseUrl = process.env.VITE_SUPABASE_URL
const baseKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const targetUrl = process.env.TARGET_SUPABASE_URL ?? argOf('--target-url')
const targetKey = process.env.TARGET_SUPABASE_SERVICE_ROLE_KEY

if (!baseUrl || !baseKey) {
  console.error('❌ .env.local 에 VITE_SUPABASE_URL 과 SUPABASE_SERVICE_ROLE_KEY 가 필요합니다')
  process.exit(1)
}
if (!targetUrl || !targetKey) {
  console.error('❌ 검사할 프로젝트를 알려 주세요:')
  console.error('   TARGET_SUPABASE_URL=https://xxx.supabase.co \\')
  console.error('   TARGET_SUPABASE_SERVICE_ROLE_KEY=<service_role> npm run verify-install')
  console.error('\n   service_role 키: 그 프로젝트 Dashboard → Settings → API')
  console.error('   키는 셸 기록에 남지 않도록 .env.local 또는 현재 셸 환경변수로 넣으세요.')
  process.exit(1)
}

/** REST 의 OpenAPI 문서에서 표·뷰·함수 목록을 읽는다 */
async function introspect(url, key) {
  const res = await fetch(`${url.replace(/\/$/, '')}/rest/v1/`, {
    headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: 'application/openapi+json' },
  })
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`)
  const spec = await res.json()
  const paths = Object.keys(spec.paths ?? {})
  return {
    tables: new Set(paths.filter((p) => p.startsWith('/') && p !== '/' && !p.startsWith('/rpc') && !p.includes('{')).map((p) => p.slice(1))),
    functions: new Set(paths.filter((p) => p.startsWith('/rpc/')).map((p) => p.replace('/rpc/', ''))),
  }
}

/** 우리 쪽에만 있고 저쪽에 없는 것 */
function missing(base, target) {
  return [...base].filter((x) => !target.has(x)).sort()
}

async function main() {
  console.log('\n📋 새 회중 프로젝트 검사')
  console.log(`   기준   ${baseUrl}`)
  console.log(`   검사   ${targetUrl}\n`)

  const [base, target] = await Promise.all([
    introspect(baseUrl, baseKey),
    introspect(targetUrl, targetKey),
  ])

  // 우리 쪽에만 있고 새 회중에 없어야 할 것 — 옮길 필요가 없는 것들
  const SKIP = new Set(['app_users_backup_20260430'])

  const missingTables = missing(base.tables, target.tables).filter((t) => !SKIP.has(t))
  const missingFunctions = missing(base.functions, target.functions)
  const extraTables = missing(target.tables, base.tables)

  const line = (ok, label, items) => {
    console.log(`  ${ok ? '✅' : '❌'} ${label.padEnd(22)} ${ok ? '모두 있음' : `${items.length}개 없음`}`)
    if (!ok) for (const x of items) console.log(`       · ${x}`)
  }

  line(missingTables.length === 0, `표·뷰 (${base.tables.size}개)`, missingTables)
  line(missingFunctions.length === 0, `함수 (${base.functions.size}개)`, missingFunctions)

  if (extraTables.length > 0) {
    console.log(`\n  ℹ️  우리 쪽에 없는 표가 ${extraTables.length}개 있습니다 (그 회중이 따로 만든 것일 수 있음)`)
    for (const x of extraTables) console.log(`       · ${x}`)
  }

  console.log(`\n${'─'.repeat(60)}`)
  if (missingTables.length === 0 && missingFunctions.length === 0) {
    console.log('✅ DB 구조는 우리와 같습니다.')
  } else {
    console.log('⚠️  빠진 것이 있습니다. 구조 SQL 을 다시 실행하세요.')
  }
  console.log('\n이 검사로는 알 수 없는 것 — docs/새-회중-설치.md 의 절차로 확인:')
  console.log('   · pg_cron 작업 (매일 정리·봉사 알림·세션 자동 종료)')
  console.log('   · Edge Function (send-push, cleanup-chat-images)')
  console.log('   · 푸시 열쇠(VAPID) — 회중마다 새로 만들어야 합니다')
  console.log('   · 첫 관리자 계정\n')
  console.log('그다음 새 프로젝트 SQL Editor에서 supabase/tools/_VERIFY_new_project.sql을 실행해')
  console.log('TEMP 정책·권한·데모 함수가 없는지도 확인하세요.\n')
}

main().catch((e) => { console.error('❌', e.message); process.exit(1) })
