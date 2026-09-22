-- 새 회중 설치 뒤 실행하는 읽기 전용 안전 검사.
-- 개수는 기능이 늘 때마다 낡으므로 참고값으로만 보여 주고, 인계 필수 조건은 ok로 판정한다.

with checks as (
  select 10 as ord, 'TEMP 역할 미분리 정책' as item,
         count(*)::text as actual, '0' as expected,
         count(*) = 0 as ok
  from pg_policies
  where schemaname = 'public' and policyname like 'TEMP_session_gate_%'

  union all
  select 20, '데모 초기화 함수', count(*)::text, '0', count(*) = 0
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'reset_demo_environment_tx'

  union all
  select 30, '데모 환경 표식', count(*)::text, '0', count(*) = 0
  from public.app_private_settings where key = 'environment' and value = 'test'

  union all
  select 40, 'app_users 전체표 SELECT 권한', count(*)::text, '0', count(*) = 0
  from information_schema.role_table_grants
  where table_schema = 'public' and table_name = 'app_users'
    and grantee in ('anon', 'authenticated') and privilege_type = 'SELECT'

  union all
  select 45, 'app_users.pin 읽기 차단',
         case when has_column_privilege('anon', 'public.app_users', 'pin', 'SELECT')
                or has_column_privilege('authenticated', 'public.app_users', 'pin', 'SELECT')
              then 'open' else 'blocked' end,
         'blocked',
         not has_column_privilege('anon', 'public.app_users', 'pin', 'SELECT')
           and not has_column_privilege('authenticated', 'public.app_users', 'pin', 'SELECT')

  union all
  select 46, 'login_logs 직접 SELECT 차단',
         case when has_table_privilege('anon', 'public.login_logs', 'SELECT')
                or has_table_privilege('authenticated', 'public.login_logs', 'SELECT')
                or exists (
                  select 1 from information_schema.column_privileges
                  where table_schema = 'public' and table_name = 'login_logs'
                    and grantee in ('anon', 'authenticated') and privilege_type = 'SELECT'
                )
              then 'open' else 'blocked' end,
         'blocked',
         not has_table_privilege('anon', 'public.login_logs', 'SELECT')
           and not has_table_privilege('authenticated', 'public.login_logs', 'SELECT')
           and not exists (
             select 1 from information_schema.column_privileges
             where table_schema = 'public' and table_name = 'login_logs'
               and grantee in ('anon', 'authenticated') and privilege_type = 'SELECT'
           )

  union all
  select 50, '세션 역할 판정 helper', count(*)::text, '1', count(*) = 1
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'private' and p.proname = 'request_session_role'

  union all
  select 60, '건물 안전 등록 RPC', count(*)::text, '1', count(*) = 1
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'create_building_tx'

  union all
  select 70, '선택형 중복 건물 병합 RPC', count(*)::text, '1', count(*) = 1
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'merge_selected_duplicate_buildings_tx'

  union all
  select 80, '구역 보고서 공유 표', count(*)::text, '1', count(*) = 1
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname = 'territory_report_shares' and c.relkind = 'r'

  union all
  select 90, '회중별 설정 키', count(*)::text, '1', count(*) = 1
  from public.app_settings where key = 'congregation_profile'
)
select case when ok then 'ok' else 'FAIL' end as result, item, actual, expected
from checks
order by ord;

-- 아래 숫자는 운영과 대조할 때 참고만 한다. 정답값으로 사용하지 않는다.
select 'public tables' as item, count(*) as count
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r'
union all
select 'public views', count(*) from pg_views where schemaname = 'public'
union all
select 'public functions', count(*)
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.prokind in ('f', 'p')
union all
select 'realtime tables', count(*) from pg_publication_tables where schemaname = 'public'
union all
select 'cron jobs', count(*) from cron.job
union all
select 'storage policies', count(*) from pg_policies where schemaname = 'storage'
order by item;
