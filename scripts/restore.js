#!/usr/bin/env node
/**
 * Supabase 복구 스크립트
 *
 * 왜 만들었나: 백업 파일은 잘 쌓이고 있었지만 한 번도 되돌려 본 적이 없었다.
 * 되돌릴 수 없는 백업은 백업이 아니고, 그 사실은 정작 필요한 날에 알게 된다.
 *
 * 기본은 **검사만** 한다. 아무것도 쓰지 않는다.
 *   npm run restore                     오늘 백업을 검사
 *   npm run restore -- 2026-08-22       그 날짜 백업을 검사
 *   npm run restore -- --table units    한 표만
 *   npm run restore -- --write          실제로 넣기 (빠진 행만, 지우지 않음)
 *   npm run restore -- --write --replace  있는 행도 덮어쓰기
 *
 * 안전 원칙
 *   · 아무것도 지우지 않는다. --replace 도 덮어쓰기지 삭제가 아니다
 *   · 기본값은 빠진 행만 넣는다 — 잘못 돌려도 멀쩡한 데이터가 상하지 않는다
 *   · 부모 표부터 넣는다. 순서가 틀리면 외래키에 막혀 중간에 멈춘다
 *
 * ⚠ 넣기가 끝나면 시퀀스(다음 id) 를 맞춰야 한다. 안 그러면 새 글을 쓸 때
 *   이미 쓰인 id 를 다시 내주어 충돌한다. 스크립트가 맨 끝에 SQL 을 찍어 준다.
 */

import { createClient } from '@supabase/supabase-js'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const projectRoot = join(__dirname, '..')
const envPath = join(projectRoot, '.env.local')

if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    const key = trimmed.slice(0, eq).trim()
    const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '')
    if (!process.env[key]) process.env[key] = value
  }
}

const SUPABASE_URL = process.env.VITE_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('❌ .env.local 에 VITE_SUPABASE_URL 과 SUPABASE_SERVICE_ROLE_KEY 가 필요합니다')
  process.exit(1)
}
const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

/**
 * 넣는 차례. 부모가 먼저다.
 * 예: 건물이 있어야 세대를 넣고, 세대가 있어야 방문 기록을 넣는다.
 * 여기 없는 표는 맨 뒤에 붙는다 (새 표를 만들면 여기에도 넣어 줄 것).
 */
const RESTORE_ORDER = [
  // 1. 남을 참조하지 않는 것
  'app_users', 'territory_regions', 'special_periods', 'notices', 'review_tasks',
  'app_settings', 'informal_groups',
  // 2. 구역
  'cards', 'card_assignments', 'card_leader_assignments', 'card_boundaries',
  // 3. 건물 → 세대
  'buildings', 'units',
  // 4. 일정 (봉사 세션이 참조한다)
  'calendar_events',
  'service_meeting_collections', 'service_meeting_notes',
  'service_sessions',
  // 5. 방문 (세대·세션을 참조한다)
  'visit_histories', 'building_access_events', 'regular_visits', 'return_visits', 'return_visit_logs',
  // 6. 배정
  'event_participants', 'event_card_assignments', 'event_card_assignment_cards',
  'event_informal_assignments', 'event_restaurant_assignments', 'informal_assets',
  // 7. 소통
  'chat_messages', 'chat_read_status', 'chat_message_signals', 'chat_room_mutes',
  'comments', 'notifications', 'notification_preferences', 'user_notification_prefs',
  'push_subscriptions',
  // 8. 나머지
  'phone_surveys', 'restaurant_requests', 'service_logs', 'service_suggestions',
  'login_logs',
]

/**
 * id 가 없는 표는 무엇으로 같은 행인지 알아볼지 적어 둔다.
 *
 * ⚠ 이게 없으면 upsert 가 기본키를 못 찾아 **전부 새 행으로 들어간다**.
 *   602개 구역선이 1204개가 되는 식이다. 모르는 표는 넣지 않고 건너뛴다.
 */
const CONFLICT_KEYS = {
  app_settings: 'key',
  card_boundaries: 'card_id',
  chat_read_status: 'event_id,user_id',
  notification_preferences: 'user_id',
}

/** 표가 아니라 뷰 — 되돌릴 대상이 아니다 (원본은 notification_preferences) */
const VIEWS = new Set(['user_notification_prefs'])

const args = process.argv.slice(2)
const write = args.includes('--write')
const replace = args.includes('--replace')
const tableArg = (() => {
  const i = args.indexOf('--table')
  return i >= 0 ? args[i + 1] : null
})()
const dateArg = args.find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a))

const backupsRoot = join(projectRoot, 'backups')
if (!existsSync(backupsRoot)) {
  console.error('❌ backups/ 폴더가 없습니다. 먼저 npm run backup 을 실행하세요')
  process.exit(1)
}
const stamp = dateArg ?? readdirSync(backupsRoot)
  .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
  .sort()
  .pop()
if (!stamp) {
  console.error('❌ 백업 폴더를 찾지 못했습니다')
  process.exit(1)
}
const dir = join(backupsRoot, stamp)
if (!existsSync(dir)) {
  console.error(`❌ backups/${stamp} 가 없습니다`)
  process.exit(1)
}

function loadTable(name) {
  const file = join(dir, `${name}.json`)
  if (!existsSync(file)) return null
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf-8'))
    return Array.isArray(parsed) ? parsed : null
  } catch (e) {
    return { error: e.message }
  }
}

async function countInDb(name) {
  const { count, error } = await supabase.from(name).select('*', { count: 'exact', head: true })
  return error ? null : (count ?? 0)
}

/**
 * 같은 행인지 알아볼 기준을 정한다. 못 정하면 null —
 * 그대로 넣으면 있는 행이 통째로 복제되므로 부르는 쪽에서 건너뛴다.
 */
function conflictKeyFor(name, rows) {
  if (CONFLICT_KEYS[name]) return CONFLICT_KEYS[name]
  if (rows.length > 0 && 'id' in rows[0]) return 'id'
  return null
}

async function insertRows(name, rows, onConflict) {
  const chunkSize = 500
  let done = 0
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize)
    const { error } = await supabase
      .from(name)
      .upsert(chunk, { onConflict, ignoreDuplicates: !replace })
    if (error) return { done, error }
    done += chunk.length
  }
  return { done, error: null }
}

async function main() {
  console.log(`\n📦 백업: backups/${stamp}`)
  console.log(write
    ? `✍️  넣기 모드${replace ? ' (있는 행도 덮어씀)' : ' (빠진 행만)'}\n`
    : '🔍 검사만 합니다. 아무것도 쓰지 않습니다. 실제로 넣으려면 --write\n')

  const files = readdirSync(dir).filter((f) => f.endsWith('.json') && !f.startsWith('_'))
  const known = new Set(RESTORE_ORDER)
  const extra = files.map((f) => f.slice(0, -5)).filter((t) => !known.has(t))
  if (extra.length > 0) {
    console.log(`⚠️  차례가 정해지지 않은 표: ${extra.join(', ')}`)
    console.log('   맨 뒤에 넣습니다. 외래키에 막히면 scripts/restore.js 의 RESTORE_ORDER 에 자리를 잡아 주세요.\n')
  }

  const order = tableArg ? [tableArg] : [...RESTORE_ORDER, ...extra]
  const problems = []
  const sequences = []
  let totalRows = 0

  for (const name of order) {
    if (VIEWS.has(name)) {
      console.log(`  ·  ${name.padEnd(28)} 뷰라서 건너뜁니다 (원본 표에서 되살아납니다)`)
      continue
    }
    const rows = loadTable(name)
    if (rows === null) {
      if (tableArg) console.log(`  ${name.padEnd(30)} 백업 파일 없음`)
      continue
    }
    if (rows.error) {
      console.log(`  ❌ ${name.padEnd(28)} 파일이 깨졌습니다 — ${rows.error}`)
      problems.push(`${name}: 파일 손상`)
      continue
    }

    const dbCount = await countInDb(name)
    if (dbCount === null) {
      console.log(`  ⚠️  ${name.padEnd(28)} DB 에 이 표가 없습니다 (백업 ${rows.length}행)`)
      problems.push(`${name}: DB 에 표 없음`)
      continue
    }

    totalRows += rows.length

    if (!write) {
      // 빈 표는 넣을 게 없으니 기준을 따지지 않는다.
      // 잘못된 경고가 섞이면 진짜 경고가 묻힌다.
      const key = rows.length === 0 ? 'n/a' : conflictKeyFor(name, rows)
      const mark = !key ? '⚠️ ' : rows.length === dbCount ? '✅' : rows.length > dbCount ? '↑ ' : '↓ '
      const note = key ? '' : '   ← 같은 행을 알아볼 기준 없음. 넣기에서 건너뜁니다'
      console.log(`  ${mark} ${name.padEnd(28)} 백업 ${String(rows.length).padStart(5)}행  /  지금 ${String(dbCount).padStart(5)}행${note}`)
      if (!key) problems.push(`${name}: CONFLICT_KEYS 에 기준을 적어 주세요`)
      if (rows.length > 0 && 'id' in rows[0]) {
        const maxId = Math.max(...rows.map((r) => Number(r.id) || 0))
        if (Number.isFinite(maxId) && maxId > 0) sequences.push({ name, maxId })
      }
      continue
    }

    if (rows.length === 0) { console.log(`  ·  ${name.padEnd(28)} 빈 백업 — 건너뜀`); continue }
    const onConflict = conflictKeyFor(name, rows)
    if (!onConflict) {
      // 기준 없이 넣으면 있는 행이 통째로 복제된다. 넣지 않는 편이 낫다.
      console.log(`  ⚠️  ${name.padEnd(28)} 같은 행을 알아볼 기준이 없어 건너뜁니다`)
      problems.push(`${name}: CONFLICT_KEYS 에 기준을 적어 주세요`)
      continue
    }
    const { done, error } = await insertRows(name, rows, onConflict)
    if (error) {
      console.log(`  ❌ ${name.padEnd(28)} ${done}행까지 넣고 막힘 — ${error.message}`)
      problems.push(`${name}: ${error.message}`)
    } else {
      const after = await countInDb(name)
      console.log(`  ✅ ${name.padEnd(28)} ${done}행 처리 · 지금 ${after}행`)
      if ('id' in rows[0]) {
        const maxId = Math.max(...rows.map((r) => Number(r.id) || 0))
        if (Number.isFinite(maxId) && maxId > 0) sequences.push({ name, maxId })
      }
    }
  }

  console.log(`\n${'─'.repeat(58)}`)
  if (problems.length > 0) {
    console.log(`⚠️  걸린 것 ${problems.length}개:`)
    for (const p of problems) console.log(`   · ${p}`)
  } else {
    console.log(write ? '🎉 넣기 완료' : '✅ 백업 파일에 문제 없음 — 되돌릴 수 있습니다')
  }

  if (write && sequences.length > 0) {
    console.log('\n📌 마지막으로 Supabase SQL Editor 에서 이걸 실행하세요.')
    console.log('   안 하면 새 글을 쓸 때 이미 쓰인 id 를 다시 내주어 충돌합니다.\n')
    for (const s of sequences) {
      console.log(`select setval(pg_get_serial_sequence('public.${s.name}', 'id'), ${s.maxId}, true);`)
    }
    console.log('')
  }
  if (!write) {
    console.log(`   백업 ${totalRows}행. 실제로 넣으려면:  npm run restore -- --write`)
  }
}

main().catch((e) => { console.error('❌', e); process.exit(1) })
