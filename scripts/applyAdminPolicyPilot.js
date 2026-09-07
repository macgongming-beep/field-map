#!/usr/bin/env node
// app_settings/notices 관리자 정책 파일럿을 테스트 또는 운영 DB에 적용·rollback한다.
// 운영은 기본적으로 preflight만 하며, 신선한 전체 백업과 명시적 ref 확인이 필요하다.
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const PROD_REF = 'qdxemvdorasoryfysuoq'
const TEST_REF = 'itjlykpjmlcvanqpmkmc'
const MIGRATION = 'supabase/migrations/20260907_1000_finalize_admin_settings_notices.sql'
const ROLLBACK = 'supabase/tools/_ROLLBACK_20260907_관리자정책_파일럿.sql'
const VERIFY = 'supabase/tools/_VERIFY_20260907_관리자정책_파일럿.sql'
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
  return {
    safeUrl: url.toString(),
    env: { ...process.env, PGPASSWORD: password, PGCONNECT_TIMEOUT: '10' },
  }
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
      const tableFiles = readdirSync(path).filter((name) => name.endsWith('.json') && name !== '_meta.json')
      if (Number.isFinite(time)) backups.push({ path, meta, time, tableFiles })
    } catch { /* 완료 메타가 아닌 백업은 무시한다. */ }
  }
  return backups.sort((a, b) => b.time - a.time)[0] ?? null
}

for (const file of [MIGRATION, ROLLBACK, VERIFY]) {
  if (!existsSync(file)) die(`${file}이 없습니다`)
}

const isTest = hasArg('--test')
const isRollback = hasArg('--rollback')
const expectedRef = isTest ? TEST_REF : PROD_REF
const conn = connection(envValue(isTest ? 'SUPABASE_TEST_DB_URL' : 'SUPABASE_DB_URL'), expectedRef)
const preflightSql = String.raw`
begin transaction read only;
select json_build_object(
  'users', (select count(*) from public.app_users
    where coalesce(is_active,true) and coalesce(approval_status,'approved')='approved'),
  'roles', (select coalesce(json_object_agg(role, count), '{}'::json) from (
    select role, count(*)::integer count from public.app_users
    where coalesce(is_active,true) and coalesce(approval_status,'approved')='approved'
    group by role order by role
  ) x),
  'environment', (select value from public.app_private_settings where key='environment'),
  'temp', (select count(*) from pg_policies where schemaname='public'
    and tablename in ('app_settings','notices') and policyname like 'TEMP\_session\_gate\_%'),
  'final', (select count(*) from pg_policies where schemaname='public'
    and tablename in ('app_settings','notices') and policyname like 'role\_admin\_%'),
  'bad_write', (select count(*) from pg_policies where schemaname='public'
    and tablename in ('app_settings','notices') and cmd in ('INSERT','UPDATE','DELETE')
    and not (coalesce(qual,'') || ' ' || coalesce(with_check,'') ~* 'request_is_admin')),
  'select_policies', (select array_agg(tablename || ':' || policyname order by tablename,policyname)
    from pg_policies where schemaname='public' and tablename in ('app_settings','notices') and cmd='SELECT'),
  'notice_rpc_anon', (select has_function_privilege('anon',p.oid,'execute')
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='create_notice_tx'
      and pg_get_function_identity_arguments(p.oid)='p_token uuid, p_title text, p_content text, p_priority text, p_notify boolean'),
  'notice_rpc_admin_guard', (select
      p.prosrc ~* 'verify_session'
      and p.prosrc ~* 'v_actor_role'
      and p.prosrc ~* 'admin'
      and p.prosrc ~* 'developer'
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='create_notice_tx'
      and pg_get_function_identity_arguments(p.oid)='p_token uuid, p_title text, p_content text, p_priority text, p_notify boolean')
);
commit;
`

let state
try {
  const line = psql(conn, ['-A', '-t', '-c', preflightSql], true)
    .split('\n').map((item) => item.trim()).find((item) => item.startsWith('{'))
  state = JSON.parse(line)
} catch {
  die('읽기 전용 preflight에 실패했습니다. 아직 아무것도 적용하지 않았습니다')
}

console.log(`\n  대상          ${isTest ? '테스트' : '운영'} ${expectedRef}`)
console.log(`  작업          ${isRollback ? 'rollback' : '적용'}`)
console.log(`  정책          TEMP ${state.temp} · 최종 ${state.final} · 잘못된 쓰기 조건 ${state.bad_write}`)
console.log(`  활성 역할     ${JSON.stringify(state.roles)}`)
console.log(`  공지 RPC      anon 실행 ${state.notice_rpc_anon} · 관리자 검사 ${state.notice_rpc_admin_guard}`)

if (!((state.temp === 5 && state.final === 0) || (state.temp === 0 && state.final === 5))) {
  die(`정책 상태가 예상과 다릅니다 (TEMP ${state.temp}, 최종 ${state.final})`)
}
if (state.bad_write !== 0) die(`관리자 검사가 아닌 쓰기 정책이 ${state.bad_write}개 있습니다`)
if (!state.notice_rpc_anon || !state.notice_rpc_admin_guard) die('create_notice_tx 공개 호출·관리자 검사 계약이 다릅니다')
if (isTest && state.environment !== 'test') die('테스트 DB에 environment=test 표식이 없습니다')
if (!isTest && state.environment === 'test') die('운영 DB에 테스트 표식이 있습니다')

if (isRollback && state.temp === 5) {
  console.log('\n  이미 TEMP 상태입니다. 변경하지 않습니다.\n')
  process.exit(0)
}
if (!isRollback && state.final === 5) {
  console.log('\n  이미 최종 정책 상태입니다. 검증만 실행합니다.\n')
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
    && backup.tableFiles.length === backup.meta.tablesSucceeded
  console.log(`  최신 백업     ${backup ? `${Math.round(ageMinutes)}분 전 (${backup.path})` : '없음'}`)
  if (arg('--confirm') !== PROD_REF) {
    console.log('\n  운영에는 아직 적용하지 않았습니다.')
    console.log(`  적용: npm run apply:admin-policy-pilot -- --confirm ${PROD_REF}`)
    console.log(`  복구: npm run apply:admin-policy-pilot -- --rollback --confirm ${PROD_REF}\n`)
    process.exit(0)
  }
  if (!complete || ageMinutes > 30) die('30분 이내 완료된 전체 백업이 필요합니다. npm run backup을 먼저 실행하세요')
}

try {
  if (isRollback) {
    psql(conn, ['--single-transaction', '-f', ROLLBACK])
    const after = JSON.parse(psql(conn, ['-A', '-t', '-c', String.raw`
      select json_build_object(
        'temp',(select count(*) from pg_policies where schemaname='public'
          and tablename in ('app_settings','notices') and policyname like 'TEMP\_session\_gate\_%'),
        'final',(select count(*) from pg_policies where schemaname='public'
          and tablename in ('app_settings','notices') and policyname like 'role\_admin\_%')
      );
    `], true).trim())
    if (after.temp !== 5 || after.final !== 0) die(`rollback 검증 실패 (TEMP ${after.temp}, 최종 ${after.final})`)
  } else {
    psql(conn, ['--single-transaction', '-f', MIGRATION, '-f', VERIFY])
  }
} catch {
  die(`${isRollback ? 'rollback' : '적용'}에 실패했습니다. 단일 트랜잭션이라 변경은 롤백됐습니다`)
}

console.log(`\n  OK ${isRollback ? 'rollback' : '정책 적용'} 완료\n`)
