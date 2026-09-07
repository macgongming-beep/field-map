#!/usr/bin/env node
// 운영 DB를 변경하지 않고 TEMP 쓰기 정책과 SECURITY DEFINER 우회 경로를 정리한다.
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'

const REF = 'qdxemvdorasoryfysuoq'
const PSQL = process.env.PSQL_BIN ?? 'psql'
const OUTPUT = 'docs/보안-쓰기정책-교체지도-2026-09-07.md'
const die = (message) => { console.error(`\n  x ${message}\n`); process.exit(1) }
const envValue = (name) => {
  if (!existsSync('.env.local')) return null
  const line = readFileSync('.env.local', 'utf8').split('\n')
    .find((item) => item.trim().startsWith(`${name}=`))
  return line?.slice(line.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '') || null
}

const raw = envValue('SUPABASE_DB_URL')
if (!raw) die('.env.local에 운영 SUPABASE_DB_URL이 없습니다')

let url
try { url = new URL(raw) } catch { die('SUPABASE_DB_URL 형식이 잘못됐습니다') }
if (!`${url.username} ${url.hostname}`.includes(REF)) die(`운영 ref ${REF}가 아닌 DB입니다`)

const password = decodeURIComponent(url.password)
if (!password) die('운영 DB 비밀번호가 없습니다')
url.password = ''

const sql = String.raw`
begin transaction read only;

with temp_policies as (
  select tablename, cmd, policyname, roles, qual, with_check
  from pg_policies
  where schemaname = 'public'
    and policyname like 'TEMP_session_gate_%'
), temp_tables as (
  select distinct tablename from temp_policies
), definers as (
  select p.oid, n.nspname, p.proname,
         pg_get_function_identity_arguments(p.oid) as args,
         pg_get_function_result(p.oid) as result,
         p.prosrc,
         has_function_privilege('anon', p.oid, 'execute') as anon_execute
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'private')
    and p.prosecdef
), mutating_refs as (
  select t.tablename, d.*,
         array_remove(array[
           case when d.prosrc ~* format('insert[[:space:]]+into[[:space:]]+(public[.])?%s\M', t.tablename) then 'INSERT' end,
           case when d.prosrc ~* format('update[[:space:]]+(public[.])?%s\M', t.tablename) then 'UPDATE' end,
           case when d.prosrc ~* format('delete[[:space:]]+from[[:space:]]+(public[.])?%s\M', t.tablename) then 'DELETE' end,
           case when d.prosrc ~* format('truncate([[:space:]]+table)?[[:space:]]+(public[.])?%s\M', t.tablename) then 'TRUNCATE' end
         ], null) as operations
  from temp_tables t
  cross join definers d
), policy_overlaps as (
  select t.tablename, t.cmd, t.policyname as temp_policy, f.policyname as final_policy
  from temp_policies t
  join pg_policies f
    on f.schemaname = 'public'
   and f.tablename = t.tablename
   and (f.cmd = t.cmd or f.cmd = 'ALL' or t.cmd = 'ALL')
   and f.policyname not like 'TEMP_session_gate_%'
   and f.cmd in ('ALL', 'INSERT', 'UPDATE', 'DELETE')
), role_counts as (
  select role, count(*)::integer as count
  from public.app_users
  where coalesce(is_active, true)
    and coalesce(approval_status, 'approved') = 'approved'
  group by role
), dynamic_definers as (
  select nspname, proname, args, result, anon_execute
  from definers
  where prosrc ~* '\mexecute\M'
)
select json_build_object(
  'checked_at_kst', to_char(clock_timestamp() at time zone 'Asia/Seoul', 'YYYY-MM-DD HH24:MI:SS'),
  'policies', (select coalesce(json_agg(row_to_json(x) order by tablename, cmd, policyname), '[]'::json) from temp_policies x),
  'overlaps', (select coalesce(json_agg(row_to_json(x) order by tablename, cmd), '[]'::json) from policy_overlaps x),
  'roles', (select coalesce(json_agg(row_to_json(x) order by role), '[]'::json) from role_counts x),
  'definer_refs', (
    select coalesce(json_agg(row_to_json(x) order by tablename, function_name, args), '[]'::json)
    from (
      select tablename,
             nspname || '.' || proname as function_name,
             args,
             operations,
             result = 'trigger' as is_trigger,
             anon_execute
      from mutating_refs
      where cardinality(operations) > 0
    ) x
  ),
  'dynamic_definers', (
    select coalesce(json_agg(row_to_json(x) order by nspname, proname, args), '[]'::json)
    from dynamic_definers x
  )
);

commit;
`

let output
try {
  output = execFileSync(PSQL, [
    '-X', '-v', 'ON_ERROR_STOP=1', '-A', '-t', url.toString(), '-c', sql,
  ], {
    encoding: 'utf8',
    env: { ...process.env, PGPASSWORD: password, PGCONNECT_TIMEOUT: '10' },
  })
} catch {
  die('운영 보안 교체 지도를 읽지 못했습니다. DB 연결과 비밀번호를 확인하세요')
}

const jsonLine = output.split('\n').map((line) => line.trim()).find((line) => line.startsWith('{'))
if (!jsonLine) die('운영 감사 응답 형식이 예상과 다릅니다')
const data = JSON.parse(jsonLine)

const byCommand = Object.groupBy(data.policies, (policy) => policy.cmd)
const byTable = Object.groupBy(data.policies, (policy) => policy.tablename)
const refsByTable = Object.groupBy(data.definer_refs, (ref) => ref.tablename)
const code = (value) => `\`${String(value).replaceAll('`', '\\`')}\``
const compact = (value) => value == null ? '-' : code(value.replaceAll(/\s+/g, ' ').trim())

const lines = [
  '# 보안 쓰기 정책 교체 지도',
  '',
  `운영 DB 읽기 전용 실측: ${data.checked_at_kst} KST. 이 문서는 ${code('npm run audit:security-transition')}으로 다시 만들 수 있다.`,
  '',
  '## 범위와 불변 조건',
  '',
  `- TEMP 쓰기 정책: **${data.policies.length}칸** · 표 **${Object.keys(byTable).length}개** · DELETE ${byCommand.DELETE?.length ?? 0} · INSERT ${byCommand.INSERT?.length ?? 0} · UPDATE ${byCommand.UPDATE?.length ?? 0}`,
  `- 같은 표·명령의 TEMP/최종 쓰기 정책 공존: **${data.overlaps.length}칸**`,
  '- 이번 전환은 INSERT·UPDATE·DELETE만 다룬다. SELECT 정책은 Realtime 계약 때문에 변경하지 않는다.',
  '- 함수 연결은 PL/pgSQL 본문의 정적 INSERT·UPDATE·DELETE·TRUNCATE 참조다. 동적 SQL과 간접 호출은 수동 검토가 필요하다.',
  '- 트리거 함수는 직접 RPC 호출 대상은 아니지만, 해당 표 쓰기의 부수 효과이므로 목록에 남긴다.',
  '',
  '## 활성 승인 역할',
  '',
  '| 역할 | 인원 |',
  '|---|---:|',
  ...data.roles.map((row) => `| ${code(row.role)} | ${row.count} |`),
  '',
  '각 묶음 적용 전 이 분포와 실제 화면 노출 역할을 다시 대조한다.',
  '',
  '## 교체 순서',
  '',
  '1. 파일럿: `app_settings` 3칸 + `notices` INSERT·DELETE 2칸. 현재도 관리자 검사식이라 동작 변경 없이 이름과 검증 계약만 최종화한다.',
  '2. 일정·배정: `calendar_events`, `event_participants`, `event_card_assignments`, `event_card_assignment_cards`, `card_assignments`, `card_leader_assignments`.',
  '3. 개인 봉사 자료: `service_sessions`, `regular_visits`, `return_visits`, `return_visit_logs`.',
  '4. 구역 핵심: `cards`, `card_boundaries`, `buildings`, `units`, `visit_histories`.',
  '5. `app_users`: 역할 상승과 definer 우회를 함께 다루는 마지막 단독 묶음.',
  '',
  '각 묶음에는 preflight, 역할 매트릭스, 관련 definer 계약, 실제 앱 저장 확인, rollback을 함께 둔다.',
  '',
  `## TEMP 정책 ${data.policies.length}칸`,
  '',
  '| 표 | 명령 | 정책 | 대상 역할 | USING | WITH CHECK |',
  '|---|---|---|---|---|---|',
  ...data.policies.map((policy) => `| ${code(policy.tablename)} | ${policy.cmd} | ${code(policy.policyname)} | ${policy.roles.map(code).join(', ')} | ${compact(policy.qual)} | ${compact(policy.with_check)} |`),
  '',
  '## 연결된 SECURITY DEFINER 쓰기 후보',
  '',
  '| 표 | 함수 | 작업 | anon 실행 | 종류 |',
  '|---|---|---|---|---|',
  ...Object.keys(byTable).flatMap((table) => {
    const refs = refsByTable[table] ?? []
    if (refs.length === 0) return [`| ${code(table)} | 수동 확인 필요 | - | - | 정적 직접 참조 없음 |`]
    return refs.map((ref) => `| ${code(table)} | ${code(`${ref.function_name}(${ref.args})`)} | ${ref.operations.join(', ')} | ${ref.anon_execute ? '예' : '아니오'} | ${ref.is_trigger ? '트리거' : '함수'} |`)
  }),
  '',
  '## 동적 SQL 수동 검토',
  '',
  '아래 definer는 본문에 동적 SQL이 있어 위 정적 연결표만으로 안전 판정을 내리지 않는다.',
  '',
  ...data.dynamic_definers.map((fn) => `- ${code(`${fn.nspname}.${fn.proname}(${fn.args})`)} · anon 실행 ${fn.anon_execute ? '가능' : '불가'} · 반환 ${code(fn.result)}`),
  '',
  '## 묶음별 필수 계약',
  '',
  '- 토큰 없음 쓰기 차단',
  '- 일반 사용자의 허용 범위와 타인 자료 차단',
  '- 인도자와 관리자·개발자의 실제 업무 범위 허용',
  '- 연결된 definer 함수도 같은 역할·소유권 계약 준수',
  '- 불필요한 anon/PUBLIC execute 회수. 공개 로그인 함수와 트리거는 별도 근거 기록',
  '- SELECT 정책과 Realtime 수신 동작 불변',
  '- 최근 백업 확인, preflight, 적용, 실제 앱 저장, rollback 순서 보장',
  '',
]

writeFileSync(OUTPUT, `${lines.join('\n')}\n`)
console.log(`\n  보안 교체 지도 생성 완료: ${OUTPUT}`)
console.log(`  TEMP ${data.policies.length}칸 · 표 ${Object.keys(byTable).length}개 · definer 쓰기 후보 ${data.definer_refs.length}개`)
console.log(`  같은 표·명령의 TEMP/최종 공존 ${data.overlaps.length}칸`)
