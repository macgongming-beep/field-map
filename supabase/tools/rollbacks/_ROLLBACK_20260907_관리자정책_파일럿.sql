-- 20260907_1000의 정책 이름만 원래 TEMP 이름으로 되돌린다.
-- 조건식과 SELECT 정책은 변경하지 않는다.

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

  if not ((v_final = 5 and v_temp = 0) or (v_final = 0 and v_temp = 5)) or v_bad <> 0 then
    raise exception '관리자 정책 rollback 전 상태가 예상과 다릅니다 (최종 %, TEMP %, 잘못된 조건 %)',
      v_final, v_temp, v_bad;
  end if;

  if v_final = 5 then
    alter policy role_admin_app_settings_insert on public.app_settings
      rename to "TEMP_session_gate_app_settings_ins";
    alter policy role_admin_app_settings_update on public.app_settings
      rename to "TEMP_session_gate_app_settings_upd";
    alter policy role_admin_app_settings_delete on public.app_settings
      rename to "TEMP_session_gate_app_settings_del";
    alter policy role_admin_notices_insert on public.notices
      rename to "TEMP_session_gate_notices_ins";
    alter policy role_admin_notices_delete on public.notices
      rename to "TEMP_session_gate_notices_del";
  end if;
end $$;

notify pgrst, 'reload schema';

