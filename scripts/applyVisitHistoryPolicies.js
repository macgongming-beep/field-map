#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const PROD_REF = 'qdxemvdorasoryfysuoq'
const TEST_REF = 'itjlykpjmlcvanqpmkmc'
const FILES = {
  apply: [
    'supabase/migrations/20260907_1400_finalize_visit_history_policies.sql',
    'supabase/migrations/20260907_1410_fix_visit_history_null_ownership.sql',
  ],
  rollback: 'supabase/tools/_ROLLBACK_20260907_방문기록정책.sql',
  verify: 'supabase/tools/_VERIFY_20260907_방문기록정책.sql',
}
const die = (message) => { console.error(`\n  x ${message}\n`); process.exit(1) }
const has = (name) => process.argv.includes(name)
const arg = (name) => { const i = process.argv.indexOf(name); return i < 0 ? null : process.argv[i + 1] }
const envValue = (name) => {
  const line = existsSync('.env.local') && readFileSync('.env.local', 'utf8').split('\n').find((x) => x.trim().startsWith(`${name}=`))
  return line ? line.slice(line.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '') : null
}
const connect = (raw, ref) => {
  if (!raw) die('DB URL이 없습니다')
  const url = new URL(raw)
  if (!`${url.username} ${url.hostname}`.includes(ref)) die(`대상 ref가 ${ref}가 아닙니다`)
  const password = decodeURIComponent(url.password); url.password = ''
  return { url: url.toString(), env: { ...process.env, PGPASSWORD: password, PGCONNECT_TIMEOUT: '10' } }
}
const psql = (conn, args, capture = false) => execFileSync(process.env.PSQL_BIN ?? 'psql', ['-X', '-v', 'ON_ERROR_STOP=1', conn.url, ...args], {
  encoding: capture ? 'utf8' : undefined, stdio: capture ? 'pipe' : 'inherit', env: conn.env,
})
const newestBackup = () => {
  if (!existsSync('backups')) return null
  return readdirSync('backups').flatMap((dir) => {
    const path = join('backups', dir), metaPath = join(path, '_meta.json')
    if (!existsSync(metaPath)) return []
    try {
      const meta = JSON.parse(readFileSync(metaPath, 'utf8'))
      return [{ path, meta, time: new Date(meta.backedUpAt).getTime(), files: readdirSync(path).filter((x) => x.endsWith('.json') && x !== '_meta.json') }]
    } catch { return [] }
  }).sort((a, b) => b.time - a.time)[0] ?? null
}

Object.values(FILES).flat().forEach((file) => { if (!existsSync(file)) die(`${file}이 없습니다`) })
const isTest = has('--test'), rollback = has('--rollback'), ref = isTest ? TEST_REF : PROD_REF
const conn = connect(envValue(isTest ? 'SUPABASE_TEST_DB_URL' : 'SUPABASE_DB_URL'), ref)
const preflight = `begin transaction read only; select json_build_object(
 'environment',(select value from public.app_private_settings where key='environment'),
 'temp',(select count(*) from pg_policies where schemaname='public' and tablename='visit_histories' and policyname like 'TEMP\\_session\\_gate\\_%'),
 'final',(select count(*) from pg_policies where schemaname='public' and tablename='visit_histories' and policyname in ('role_member_visit_histories_insert','role_owner_visit_histories_update')),
 'selects',(select count(*) from pg_policies where schemaname='public' and tablename='visit_histories' and cmd='SELECT' and qual='true'),
 'rows',(select count(*) from public.visit_histories),
 'roles',(select json_object_agg(role,count) from (select role,count(*) count from app_users where coalesce(is_active,true) and approval_status='approved' group by role) x)); commit;`
let state
try {
  const line = psql(conn, ['-A', '-t', '-c', preflight], true).split('\n').find((x) => x.trim().startsWith('{'))
  state = JSON.parse(line)
} catch { die('읽기 전용 preflight에 실패했습니다') }
console.log(`\n  대상 ${isTest ? '테스트' : '운영'} ${ref} · TEMP ${state.temp} · 최종 ${state.final} · 기록 ${state.rows}`)
console.log(`  역할 ${JSON.stringify(state.roles)}`)
if (!((state.temp === 3 && state.final === 0) || (state.temp === 0 && state.final === 2))) die('예상하지 않은 정책 상태입니다')
if (state.selects < 1) die('공개 SELECT 계약이 빠졌습니다')
if (isTest && state.environment !== 'test') die('테스트 DB 표식이 없습니다')
if (!isTest && state.environment === 'test') die('운영 DB가 테스트로 표시돼 있습니다')
if (!isTest) {
  const backup = newestBackup(), age = backup ? (Date.now() - backup.time) / 60000 : Infinity
  const complete = backup && backup.meta.supabaseUrl?.includes(PROD_REF) && backup.meta.tablesFailed === 0
    && backup.meta.tablesSucceeded >= 39 && backup.files.length === backup.meta.tablesSucceeded
  console.log(`  최신 백업 ${backup ? `${Math.round(age)}분 전 (${backup.path})` : '없음'}`)
  if (arg('--confirm') !== PROD_REF) {
    console.log(`\n  운영에는 적용하지 않았습니다.\n  적용: npm run apply:visit-history-policies -- --confirm ${PROD_REF}\n`)
    process.exit(0)
  }
  if (!complete || age > 30) die('30분 이내 완료된 전체 백업이 필요합니다')
}
if (rollback && state.temp === 3) process.exit(0)
psql(conn, rollback
  ? ['--single-transaction', '-f', FILES.rollback]
  : ['--single-transaction', ...FILES.apply.flatMap((file) => ['-f', file])])
if (!rollback) psql(conn, ['-f', FILES.verify])
console.log(`\n  OK ${rollback ? 'rollback' : '정책 적용'} 완료\n`)
