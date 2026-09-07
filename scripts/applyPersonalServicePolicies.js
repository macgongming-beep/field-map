#!/usr/bin/env node
// 개인 봉사 자료 정책을 테스트 또는 운영 DB에 원자적으로 적용·복구한다.
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const PROD_REF = 'qdxemvdorasoryfysuoq'
const TEST_REF = 'itjlykpjmlcvanqpmkmc'
const MIGRATION = 'supabase/migrations/20260907_1200_finalize_personal_service_policies.sql'
const ROLLBACK = 'supabase/tools/_ROLLBACK_20260907_개인봉사정책.sql'
const VERIFY = 'supabase/tools/_VERIFY_20260907_개인봉사정책.sql'
const TABLES = ['service_sessions', 'regular_visits', 'return_visits', 'return_visit_logs']
const PSQL = process.env.PSQL_BIN ?? 'psql'

const die = (message) => { console.error(`\n  x ${message}\n`); process.exit(1) }
const hasArg = (name) => process.argv.includes(name)
const arg = (name) => {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : null
}
const envValue = (name) => {
  if (!existsSync('.env.local')) return null
  const line = readFileSync('.env.local', 'utf8').split('\n')
    .find((item) => item.trim().startsWith(`${name}=`))
  return line?.slice(line.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '') || null
}
const connection = (raw, expectedRef) => {
  if (!raw) die(`.env.local에 ${expectedRef === PROD_REF ? 'SUPABASE_DB_URL' : 'SUPABASE_TEST_DB_URL'}이 없습니다`)
  let url
  try { url = new URL(raw) } catch { die('DB URL 형식이 잘못됐습니다') }
  if (!`${url.username} ${url.hostname}`.includes(expectedRef)) die(`대상 ref가 ${expectedRef}가 아닙니다`)
  const password = decodeURIComponent(url.password)
  if (!password) die('DB 비밀번호가 없습니다')
  url.password = ''
  return { safeUrl: url.toString(), env: { ...process.env, PGPASSWORD: password, PGCONNECT_TIMEOUT: '10' } }
}
const psql = (conn, args, capture = false) => execFileSync(PSQL, [
  '-X', '-v', 'ON_ERROR_STOP=1', conn.safeUrl, ...args,
], { encoding: capture ? 'utf8' : undefined, stdio: capture ? 'pipe' : 'inherit', env: conn.env })
const newestBackup = () => {
  if (!existsSync('backups')) return null
  const backups = []
  for (const dir of readdirSync('backups')) {
    const path = join('backups', dir)
    const metaPath = join(path, '_meta.json')
    if (!existsSync(metaPath)) continue
    try {
      const meta = JSON.parse(readFileSync(metaPath, 'utf8'))
      const time = new Date(meta.backedUpAt).getTime()
      const files = readdirSync(path).filter((name) => name.endsWith('.json') && name !== '_meta.json')
      if (Number.isFinite(time)) backups.push({ path, meta, time, files })
    } catch { /* 미완료 백업은 제외한다. */ }
  }
  return backups.sort((a, b) => b.time - a.time)[0] ?? null
}

for (const file of [MIGRATION, ROLLBACK, VERIFY]) if (!existsSync(file)) die(`${file}이 없습니다`)

const isTest = hasArg('--test')
const isRollback = hasArg('--rollback')
const expectedRef = isTest ? TEST_REF : PROD_REF
const conn = connection(envValue(isTest ? 'SUPABASE_TEST_DB_URL' : 'SUPABASE_DB_URL'), expectedRef)
const tableList = TABLES.map((name) => `'${name}'`).join(',')
const preflight = String.raw`
begin transaction read only;
select json_build_object(
  'roles', (select coalesce(json_object_agg(role, count), '{}'::json) from (
    select role, count(*)::integer count from public.app_users
    where coalesce(is_active,true) and coalesce(approval_status,'approved')='approved'
    group by role order by role) x),
  'environment', (select value from public.app_private_settings where key='environment'),
  'temp', (select count(*) from pg_policies where schemaname='public'
    and tablename in (${tableList}) and policyname like 'TEMP\_session\_gate\_%'),
  'final', (select count(*) from pg_policies where schemaname='public'
    and policyname like 'role\_owner\_%' and tablename in (${tableList})),
  'selects', (select count(distinct tablename) from pg_policies where schemaname='public'
    and tablename in (${tableList}) and cmd='SELECT' and qual='true'),
  'helpers', (select count(*) from (values
    ('private.request_session_user_name()'), ('private.request_is_service_manager()')
  ) helper(signature) where to_regprocedure(signature) is not null
    and has_function_privilege('anon', signature, 'EXECUTE')
    and has_function_privilege('authenticated', signature, 'EXECUTE'))
);
commit;`

let state
try {
  const line = psql(conn, ['-A', '-t', '-c', preflight], true).split('\n')
    .map((item) => item.trim()).find((item) => item.startsWith('{'))
  state = JSON.parse(line)
} catch { die('읽기 전용 preflight에 실패했습니다. 아직 변경하지 않았습니다') }

console.log(`\n  대상          ${isTest ? '테스트' : '운영'} ${expectedRef}`)
console.log(`  작업          ${isRollback ? 'rollback' : '적용'}`)
console.log(`  정책          TEMP ${state.temp} · 최종 ${state.final} · SELECT 표 ${state.selects}/4`)
console.log(`  역할          ${JSON.stringify(state.roles)}`)
console.log(`  정책 helper   ${state.helpers}/2`)

if (!((state.temp === 12 && state.final === 0 && state.helpers === 0)
  || (state.temp === 0 && state.final === 12 && state.helpers === 2))) {
  die(`예상하지 않은 상태입니다 (TEMP ${state.temp}, 최종 ${state.final})`)
}
if (state.selects !== 4) die('Realtime에 필요한 SELECT 정책이 빠졌습니다')
if (isTest && state.environment !== 'test') die('테스트 DB 표식이 없습니다')
if (!isTest && state.environment === 'test') die('운영 DB가 테스트로 표시돼 있습니다')

if (isRollback && state.temp === 12) { console.log('\n  이미 TEMP 상태입니다.\n'); process.exit(0) }
if (!isRollback && state.final === 12) {
  console.log('\n  이미 최종 상태입니다. 검증만 실행합니다.\n')
  psql(conn, ['-f', VERIFY])
  process.exit(0)
}

if (!isTest) {
  const backup = newestBackup()
  const ageMinutes = backup ? (Date.now() - backup.time) / 60_000 : Infinity
  const complete = backup
    && backup.meta.supabaseUrl?.includes(PROD_REF)
    && backup.meta.tablesFailed === 0
    && backup.meta.tablesSucceeded >= 39
    && backup.meta.tablesSucceeded + backup.meta.tablesSkipped >= 40
    && backup.files.length === backup.meta.tablesSucceeded
  console.log(`  최신 백업     ${backup ? `${Math.round(ageMinutes)}분 전 (${backup.path})` : '없음'}`)
  if (arg('--confirm') !== PROD_REF) {
    console.log('\n  운영에는 적용하지 않았습니다.')
    console.log(`  적용: npm run apply:personal-service-policies -- --confirm ${PROD_REF}`)
    console.log(`  복구: npm run apply:personal-service-policies -- --rollback --confirm ${PROD_REF}\n`)
    process.exit(0)
  }
  if (!complete || ageMinutes > 30) die('30분 이내 완료된 전체 백업이 필요합니다')
}

try {
  psql(conn, ['--single-transaction', '-f', isRollback ? ROLLBACK : MIGRATION])
  if (!isRollback) psql(conn, ['-f', VERIFY])
} catch { die(`${isRollback ? 'rollback' : '적용'} 실패. 단일 트랜잭션이라 변경은 롤백됐습니다`) }

console.log(`\n  OK ${isRollback ? 'rollback' : '정책 적용'} 완료\n`)
