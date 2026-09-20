#!/usr/bin/env node
/**
 * Supabase 전체 백업 스크립트
 *
 * 모든 테이블을 JSON 파일로 백업합니다.
 * 백업 위치: backups/YYYY-MM-DD/<table>.json
 *
 * 실행:
 *   npm run backup
 *
 * 환경 변수 (.env.local):
 *   VITE_SUPABASE_URL=...
 *   SUPABASE_SERVICE_ROLE_KEY=...   ← Supabase Dashboard → Settings → API
 *   SUPABASE_DB_URL=...             ← private 병합 감사 스냅샷 백업
 *
 * SERVICE_ROLE_KEY 는 RLS 를 우회하므로 절대 클라이언트에 노출 금지.
 * .env.local 은 .gitignore 에 등록되어 있어 커밋되지 않습니다.
 */

import { createClient } from '@supabase/supabase-js'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

// ── .env.local 로드 (dotenv 의존성 없이 직접 파싱) ──────────────
const __dirname = dirname(fileURLToPath(import.meta.url))
const projectRoot = join(__dirname, '..')
const envPath = join(projectRoot, '.env.local')

if (existsSync(envPath)) {
  const envContent = readFileSync(envPath, 'utf-8')
  envContent.split('\n').forEach((line) => {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) return
    const eqIdx = trimmed.indexOf('=')
    if (eqIdx === -1) return
    const key = trimmed.slice(0, eqIdx).trim()
    const value = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '')
    if (!process.env[key]) process.env[key] = value
  })
}

const SUPABASE_URL = process.env.VITE_SUPABASE_URL
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY
const DB_URL = process.env.SUPABASE_DB_URL

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('❌ 환경변수 설정 필요:')
  console.error('   .env.local 에 VITE_SUPABASE_URL 과 SUPABASE_SERVICE_ROLE_KEY 추가')
  console.error('   SERVICE_ROLE_KEY: Supabase Dashboard → Settings → API → service_role')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
})

// 백업 대상 테이블 (의존 순서 무관 — JSON 백업)
const TABLES = [
  // 사용자/인증
  'app_users',
  'login_logs',
  'app_sessions',          // 향후 추가될 수 있음 (없으면 자동 스킵)

  // 구역/카드
  'cards',
  'card_assignments',
  'card_leader_assignments',
  'card_boundaries',

  // 건물/세대
  'buildings',
  'units',

  // 방문/봉사
  'visit_histories',
  'building_access_events',
  'regular_visits',
  'service_sessions',

  // 캘린더/일정
  'calendar_events',
  'event_participants',
  'event_card_assignments',
  'event_card_assignment_cards',

  // 구역/방문 (추가)
  'territory_regions',     // 지역 목록 — 없으면 카드의 region 을 해석할 수 없다
  'return_visits',
  'return_visit_logs',
  'phone_surveys',         // 전화 조사 대장 — 어디에 걸었는지의 유일한 기록
  'restaurant_requests',

  // 배정 (추가)
  'event_restaurant_assignments',
  'event_informal_assignments',
  'informal_groups',
  'informal_assets',

  // 소통 (추가)
  'chat_messages',
  'chat_read_status',
  'chat_message_signals',
  'chat_room_mutes',
  'comments',
  'notifications',
  'notification_preferences',
  'user_notification_prefs',
  'push_subscriptions',    // 없으면 복구 후 전원에게 알림을 다시 켜 달라고 해야 한다

  // 기타
  'notices',
  'special_periods',
  'review_tasks',
  'app_settings',
  'service_logs',
  'service_suggestions',
]

// 일부러 백업하지 않는 표 — 왜인지 적어 둔다. 안 그러면 "빠뜨렸나?" 를 매번 다시 조사하게 된다.
//   auth_sessions              로그인 토큰. 되살리면 옛 세션이 되살아난다. 다시 로그인하면 그만이다
//   app_private_settings       푸시 비밀키 등. 평문 파일로 내려받지 않는다
//   app_users_backup_20260430  2026-04-30 작업 때의 임시 사본. 평문 PIN 이 담겨 있고
//                              anon 키로 읽히던 것을 확인해 제거했다
//                              (supabase/applied/v3_drop_leaked_user_backup.sql)

function todayStamp() {
  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/**
 * 한 테이블을 통째로 받아온다.
 *
 * ⚠ Supabase(PostgREST)는 한 번에 최대 1,000행만 준다. 페이지 처리를 안 하면
 *   백업이 조용히 1,000행에서 잘린다 — 실제로 세대(units) 1,553개 중 1,000개만
 *   저장돼 있었다. 잘린 백업은 없는 것보다 위험하므로 끝까지 받는다.
 */
async function dumpTable(name) {
  const pageSize = 1000
  const rows = []
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from(name)
      .select('*')
      .range(from, from + pageSize - 1)
    if (error) {
      if (error.message?.includes('does not exist') || error.code === 'PGRST205' || error.code === '42P01') {
        return { status: 'skipped' }
      }
      console.error(`❌ ${name}: ${error.message}`)
      return { status: 'failed' }
    }
    const page = data ?? []
    rows.push(...page)
    if (page.length < pageSize) break
  }
  return { status: 'ok', rows }
}

function findPgDump() {
  return [
    process.env.PG_DUMP_BIN,
    '/opt/homebrew/opt/libpq/bin/pg_dump',
    '/usr/local/opt/libpq/bin/pg_dump',
    'pg_dump',
  ].filter(Boolean).find((candidate) => {
    const result = spawnSync(candidate, ['--version'], { stdio: 'ignore' })
    return result.status === 0
  }) ?? null
}

/** private 스키마는 PostgREST로 읽을 수 없어서 pg_dump로 별도 보존한다. */
function dumpPrivateMergeAudits(dir) {
  if (!DB_URL) {
    return { status: 'failed', reason: '.env.local에 SUPABASE_DB_URL이 없습니다' }
  }
  const pgDump = findPgDump()
  if (!pgDump) return { status: 'failed', reason: 'pg_dump를 찾지 못했습니다' }

  let url
  try {
    url = new URL(DB_URL)
  } catch {
    return { status: 'failed', reason: 'SUPABASE_DB_URL 형식이 잘못됐습니다' }
  }
  const password = decodeURIComponent(url.password)
  url.password = ''
  const file = join(dir, 'private_duplicate_building_merge_audits.sql')
  const result = spawnSync(pgDump, [
    '--data-only',
    '--column-inserts',
    '--no-owner',
    '--no-privileges',
    '--table=private.duplicate_building_merge_audits',
    '--file', file,
    url.toString(),
  ], {
    env: { ...process.env, PGPASSWORD: password },
    encoding: 'utf8',
  })
  if (result.status !== 0) {
    return { status: 'failed', reason: result.stderr?.trim() || 'pg_dump 실패' }
  }
  return { status: 'ok', file }
}

async function main() {
  const stamp = todayStamp()
  const dir = join(projectRoot, 'backups', stamp)
  mkdirSync(dir, { recursive: true })

  console.log(`📦 Supabase 백업 시작`)
  console.log(`📁 위치: backups/${stamp}/\n`)

  let total = 0
  let success = 0
  let skipped = 0
  let failed = 0

  for (const t of TABLES) {
    const result = await dumpTable(t)
    if (result.status === 'skipped') {
      skipped++
      console.log(`⏭  ${t.padEnd(32)} 테이블 없음 (스킵)`)
      continue
    }
    if (result.status === 'failed') {
      failed++
      continue
    }
    const file = join(dir, `${t}.json`)
    writeFileSync(file, JSON.stringify(result.rows, null, 2), 'utf-8')
    total += result.rows.length
    success++
    console.log(`✅ ${t.padEnd(32)} ${String(result.rows.length).padStart(5)} 행`)
  }

  const privateAudit = dumpPrivateMergeAudits(dir)
  if (privateAudit.status === 'ok') {
    console.log(`✅ ${'private.merge_audits'.padEnd(32)} SQL 스냅샷`)
  } else {
    failed++
    console.error(`❌ private.merge_audits: ${privateAudit.reason}`)
  }

  // 메타 정보 저장
  const meta = {
    backedUpAt: new Date().toISOString(),
    supabaseUrl: SUPABASE_URL,
    tablesSucceeded: success,
    tablesSkipped: skipped,
    tablesFailed: failed,
    totalRows: total,
    privateAuditBackedUp: privateAudit.status === 'ok',
  }
  writeFileSync(join(dir, '_meta.json'), JSON.stringify(meta, null, 2), 'utf-8')

  console.log(`\n🎉 백업 완료`)
  console.log(`   성공: ${success}개 테이블 / ${total}행`)
  if (skipped > 0) console.log(`   스킵: ${skipped}개 (테이블 없음)`)
  if (failed > 0) console.log(`   ❌ 실패: ${failed}개 (위 로그 확인)`)
  console.log(`   📁 backups/${stamp}/`)
  if (failed > 0) process.exitCode = 1
}

main().catch((e) => {
  console.error('💥 백업 중단:', e)
  process.exit(1)
})
