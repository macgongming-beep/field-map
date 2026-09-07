-- 이미 관리자·개발자만 쓸 수 있는 app_settings와 notices의 TEMP 정책 이름을
-- 최종 역할 정책으로 바꾼다. 조건식과 SELECT 범위는 바꾸지 않는다.

alter table public.app_settings enable row level security;
alter table public.notices enable row level security;

revoke truncate, references, trigger on public.app_settings from public, anon, authenticated;
revoke truncate, references, trigger on public.notices from public, anon, authenticated;

do $$
declare
  v_temp integer;
  v_final integer;
  v_bad integer;
begin
  select count(*) into v_temp
  from pg_policies
  where schemaname = 'public'
    and (
      (tablename = 'app_settings' and policyname in (
        'TEMP_session_gate_app_settings_ins',
        'TEMP_session_gate_app_settings_upd',
        'TEMP_session_gate_app_settings_del'
      ))
      or (tablename = 'notices' and policyname in (
        'TEMP_session_gate_notices_ins',
        'TEMP_session_gate_notices_del'
      ))
    );

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

  if not ((v_temp = 5 and v_final = 0) or (v_temp = 0 and v_final = 5)) then
    raise exception '관리자 정책 전환 전 상태가 예상과 다릅니다 (TEMP %, 최종 %)', v_temp, v_final;
  end if;

  select count(*) into v_bad
  from pg_policies
  where schemaname = 'public'
    and tablename in ('app_settings', 'notices')
    and cmd in ('INSERT', 'UPDATE', 'DELETE')
    and not (coalesce(qual, '') || ' ' || coalesce(with_check, '') ~* 'request_is_admin');

  if v_bad <> 0 then
    raise exception '관리자 검사식이 아닌 쓰기 정책이 %개 있습니다', v_bad;
  end if;
end $$;

do $$
begin
  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'app_settings'
      and policyname = 'TEMP_session_gate_app_settings_ins'
  ) then
    alter policy "TEMP_session_gate_app_settings_ins" on public.app_settings
      rename to role_admin_app_settings_insert;
    alter policy "TEMP_session_gate_app_settings_upd" on public.app_settings
      rename to role_admin_app_settings_update;
    alter policy "TEMP_session_gate_app_settings_del" on public.app_settings
      rename to role_admin_app_settings_delete;
    alter policy "TEMP_session_gate_notices_ins" on public.notices
      rename to role_admin_notices_insert;
    alter policy "TEMP_session_gate_notices_del" on public.notices
      rename to role_admin_notices_delete;
  end if;
end $$;

do $$
declare
  v_final integer;
  v_temp integer;
  v_bad integer;
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

  if v_final <> 5 or v_temp <> 0 or v_bad <> 0 then
    raise exception '관리자 정책 전환 검증 실패 (최종 %, TEMP %, 잘못된 조건 %)', v_final, v_temp, v_bad;
  end if;

  if has_table_privilege('anon', 'public.app_settings', 'TRUNCATE')
     or has_table_privilege('authenticated', 'public.app_settings', 'TRUNCATE')
     or has_table_privilege('anon', 'public.notices', 'TRUNCATE')
     or has_table_privilege('authenticated', 'public.notices', 'TRUNCATE') then
    raise exception '관리자 표에 TRUNCATE 권한이 남았습니다';
  end if;
end $$;

notify pgrst, 'reload schema';

