-- app_settings/notices 파일럿 적용 결과. 읽기만 한다.

do $$
declare
  v_final integer;
  v_temp integer;
  v_bad integer;
  v_select_before text[];
begin
  select count(*) into v_final
  from pg_policies
  where schemaname = 'public'
    and (
      (tablename = 'app_settings' and policyname in (
        'role_admin_app_settings_insert',
        'role_admin_app_settings_update',
        'role_admin_app_settings_delete'
      ))
      or (tablename = 'notices' and policyname in (
        'role_admin_notices_insert',
        'role_admin_notices_delete'
      ))
    );

  select count(*) into v_temp
  from pg_policies
  where schemaname = 'public'
    and tablename in ('app_settings', 'notices')
    and policyname like 'TEMP\_session\_gate\_%';

  select count(*) into v_bad
  from pg_policies
  where schemaname = 'public'
    and tablename in ('app_settings', 'notices')
    and cmd in ('INSERT', 'UPDATE', 'DELETE')
    and not (coalesce(qual, '') || ' ' || coalesce(with_check, '') ~* 'request_is_admin');

  select array_agg(tablename || ':' || policyname order by tablename, policyname)
  into v_select_before
  from pg_policies
  where schemaname = 'public'
    and tablename in ('app_settings', 'notices')
    and cmd = 'SELECT';

  if v_final <> 5 or v_temp <> 0 or v_bad <> 0 then
    raise exception '관리자 파일럿 검증 실패 (최종 %, TEMP %, 잘못된 조건 %)', v_final, v_temp, v_bad;
  end if;

  if v_select_before is distinct from array[
    'app_settings:app_settings_read',
    'notices:anyone can read notices',
    'notices:read'
  ]::text[] then
    raise exception 'SELECT 정책이 예상과 다릅니다: %', v_select_before;
  end if;

  if has_table_privilege('anon', 'public.app_settings', 'TRUNCATE')
     or has_table_privilege('authenticated', 'public.app_settings', 'TRUNCATE')
     or has_table_privilege('anon', 'public.notices', 'TRUNCATE')
     or has_table_privilege('authenticated', 'public.notices', 'TRUNCATE') then
    raise exception '관리자 표에 TRUNCATE 권한이 남았습니다';
  end if;
end $$;

select tablename, cmd, policyname, roles, qual, with_check
from pg_policies
where schemaname = 'public'
  and tablename in ('app_settings', 'notices')
order by tablename, cmd, policyname;

