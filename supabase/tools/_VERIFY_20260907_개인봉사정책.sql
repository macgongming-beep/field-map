do $$
declare
  v_temp integer;
  v_final integer;
  v_select integer;
  v_helpers integer;
begin
  select count(*) into v_temp from pg_policies
  where schemaname = 'public'
    and tablename in ('service_sessions', 'regular_visits', 'return_visits', 'return_visit_logs')
    and policyname like 'TEMP_session_gate_%';

  select count(*) into v_final from pg_policies
  where schemaname = 'public'
    and policyname in (
      'role_owner_service_sessions_insert', 'role_owner_service_sessions_update', 'role_owner_service_sessions_delete',
      'role_owner_regular_visits_insert', 'role_owner_regular_visits_update', 'role_owner_regular_visits_delete',
      'role_owner_return_visits_insert', 'role_owner_return_visits_update', 'role_owner_return_visits_delete',
      'role_owner_return_visit_logs_insert', 'role_owner_return_visit_logs_update', 'role_owner_return_visit_logs_delete'
    );

  select count(distinct tablename) into v_select from pg_policies
  where schemaname = 'public'
    and tablename in ('service_sessions', 'regular_visits', 'return_visits', 'return_visit_logs')
    and cmd = 'SELECT' and qual = 'true';

  select count(*) into v_helpers
  from (values
    ('private.request_session_user_name()'),
    ('private.request_is_service_manager()')
  ) as helper(signature)
  where has_function_privilege('anon', signature, 'EXECUTE')
    and has_function_privilege('authenticated', signature, 'EXECUTE');

  if v_temp <> 0 or v_final <> 12 or v_select <> 4 or v_helpers <> 2 then
    raise exception '개인 봉사 VERIFY 실패: TEMP %, final %, SELECT %/4, helpers %/2',
      v_temp, v_final, v_select, v_helpers;
  end if;
end
$$;

select tablename, cmd, policyname, roles, qual, with_check
from pg_policies
where schemaname = 'public'
  and tablename in ('service_sessions', 'regular_visits', 'return_visits', 'return_visit_logs')
order by tablename, cmd, policyname;
