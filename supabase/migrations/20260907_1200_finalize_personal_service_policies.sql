-- 개인 봉사 자료의 쓰기 권한을 로그인 여부에서 실제 소유권으로 좁힌다.
-- SELECT 정책은 Realtime 계약 때문에 변경하지 않는다.

create or replace function private.request_session_user_name()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select u.name
  from public.app_users u
  where u.id = private.request_session_user_id()
$$;

create or replace function private.request_is_service_manager()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(private.request_session_role() in ('leader', 'admin', 'developer'), false)
$$;

revoke all on function private.request_session_user_name() from public, anon, authenticated;
revoke all on function private.request_is_service_manager() from public, anon, authenticated;
-- private 스키마는 API에 노출되지 않지만 RLS 식은 요청 역할로 함수를 실행한다.
grant execute on function private.request_session_user_name() to anon, authenticated;
grant execute on function private.request_is_service_manager() to anon, authenticated;

-- 봉사 세션: 본인, 해당 일정 인도자, 관리자만 수정·삭제한다.
drop policy if exists "TEMP_session_gate_service_sessions_ins" on public.service_sessions;
drop policy if exists "TEMP_session_gate_service_sessions_upd" on public.service_sessions;
drop policy if exists "TEMP_session_gate_service_sessions_del" on public.service_sessions;
drop policy if exists "role_owner_service_sessions_insert" on public.service_sessions;
drop policy if exists "role_owner_service_sessions_update" on public.service_sessions;
drop policy if exists "role_owner_service_sessions_delete" on public.service_sessions;

create policy "role_owner_service_sessions_insert" on public.service_sessions
  for insert to anon
  with check (
    (select private.request_is_admin())
    or (
      user_name = (select private.request_session_user_name())
      and role = case
        when (select private.request_session_role()) = 'developer' then 'admin'
        else (select private.request_session_role())
      end
    )
  );

create policy "role_owner_service_sessions_update" on public.service_sessions
  for update to anon
  using (
    (select private.request_is_admin())
    or user_name = (select private.request_session_user_name())
    or (calendar_event_id is not null and public.session_can_manage_event(calendar_event_id))
  )
  with check (
    (select private.request_is_admin())
    or user_name = (select private.request_session_user_name())
    or (calendar_event_id is not null and public.session_can_manage_event(calendar_event_id))
  );

create policy "role_owner_service_sessions_delete" on public.service_sessions
  for delete to anon
  using (
    (select private.request_is_admin())
    or user_name = (select private.request_session_user_name())
    or (calendar_event_id is not null and public.session_can_manage_event(calendar_event_id))
  );

-- 정기방문 담당: 본인은 자기 항목을 관리하고 인도자·관리자는 업무상 관리한다.
drop policy if exists "TEMP_session_gate_regular_visits_ins" on public.regular_visits;
drop policy if exists "TEMP_session_gate_regular_visits_upd" on public.regular_visits;
drop policy if exists "TEMP_session_gate_regular_visits_del" on public.regular_visits;
drop policy if exists "role_owner_regular_visits_insert" on public.regular_visits;
drop policy if exists "role_owner_regular_visits_update" on public.regular_visits;
drop policy if exists "role_owner_regular_visits_delete" on public.regular_visits;

create policy "role_owner_regular_visits_insert" on public.regular_visits
  for insert to anon
  with check (
    visitor_name = (select private.request_session_user_name())
    or (select private.request_is_service_manager())
  );

create policy "role_owner_regular_visits_update" on public.regular_visits
  for update to anon
  using (
    visitor_name = (select private.request_session_user_name())
    or (select private.request_is_service_manager())
  )
  with check (
    visitor_name = (select private.request_session_user_name())
    or (select private.request_is_service_manager())
  );

create policy "role_owner_regular_visits_delete" on public.regular_visits
  for delete to anon
  using (
    visitor_name = (select private.request_session_user_name())
    or (select private.request_is_service_manager())
  );

-- 활동 정기방문: 담당자는 자기 항목을, 인도자·관리자는 전체를 관리한다.
drop policy if exists "TEMP_session_gate_return_visits_ins" on public.return_visits;
drop policy if exists "TEMP_session_gate_return_visits_upd" on public.return_visits;
drop policy if exists "TEMP_session_gate_return_visits_del" on public.return_visits;
drop policy if exists "role_owner_return_visits_insert" on public.return_visits;
drop policy if exists "role_owner_return_visits_update" on public.return_visits;
drop policy if exists "role_owner_return_visits_delete" on public.return_visits;

create policy "role_owner_return_visits_insert" on public.return_visits
  for insert to public
  with check (
    (
      assigned_user_name = (select private.request_session_user_name())
      and created_by = (select private.request_session_user_name())
    )
    or (select private.request_is_service_manager())
  );

create policy "role_owner_return_visits_update" on public.return_visits
  for update to public
  using (
    assigned_user_name = (select private.request_session_user_name())
    or (select private.request_is_service_manager())
  )
  with check (
    assigned_user_name = (select private.request_session_user_name())
    or (select private.request_is_service_manager())
  );

create policy "role_owner_return_visits_delete" on public.return_visits
  for delete to public
  using ((select private.request_is_admin()));

-- 정기방문 기록: 담당 정기방문에 본인 이름으로 추가한다.
-- 수정·삭제는 작성자 본인 또는 인도자·관리자만 가능하다.
drop policy if exists "TEMP_session_gate_return_visit_logs_ins" on public.return_visit_logs;
drop policy if exists "TEMP_session_gate_return_visit_logs_upd" on public.return_visit_logs;
drop policy if exists "TEMP_session_gate_return_visit_logs_del" on public.return_visit_logs;
drop policy if exists "role_owner_return_visit_logs_insert" on public.return_visit_logs;
drop policy if exists "role_owner_return_visit_logs_update" on public.return_visit_logs;
drop policy if exists "role_owner_return_visit_logs_delete" on public.return_visit_logs;

create policy "role_owner_return_visit_logs_insert" on public.return_visit_logs
  for insert to public
  with check (
    created_by = (select private.request_session_user_name())
    and exists (
      select 1
      from public.return_visits rv
      where rv.id = return_visit_id
        and rv.ended_at is null
        and (
          rv.assigned_user_name = (select private.request_session_user_name())
          or (select private.request_is_service_manager())
        )
    )
  );

create policy "role_owner_return_visit_logs_update" on public.return_visit_logs
  for update to public
  using (
    created_by = (select private.request_session_user_name())
    or (select private.request_is_service_manager())
  )
  with check (
    created_by = (select private.request_session_user_name())
    or (select private.request_is_service_manager())
  );

create policy "role_owner_return_visit_logs_delete" on public.return_visit_logs
  for delete to public
  using (
    created_by = (select private.request_session_user_name())
    or (select private.request_is_service_manager())
  );

notify pgrst, 'reload schema';

do $$
declare
  v_temp integer;
  v_final integer;
  v_helpers integer;
begin
  select count(*) into v_temp
  from pg_policies
  where schemaname = 'public'
    and tablename in ('service_sessions', 'regular_visits', 'return_visits', 'return_visit_logs')
    and policyname like 'TEMP_session_gate_%';

  select count(*) into v_final
  from pg_policies
  where schemaname = 'public'
    and policyname in (
      'role_owner_service_sessions_insert', 'role_owner_service_sessions_update', 'role_owner_service_sessions_delete',
      'role_owner_regular_visits_insert', 'role_owner_regular_visits_update', 'role_owner_regular_visits_delete',
      'role_owner_return_visits_insert', 'role_owner_return_visits_update', 'role_owner_return_visits_delete',
      'role_owner_return_visit_logs_insert', 'role_owner_return_visit_logs_update', 'role_owner_return_visit_logs_delete'
    );

  select count(*) into v_helpers
  from (values
    ('private.request_session_user_name()'),
    ('private.request_is_service_manager()')
  ) as helper(signature)
  where has_function_privilege('anon', signature, 'EXECUTE')
    and has_function_privilege('authenticated', signature, 'EXECUTE');

  if v_temp <> 0 or v_final <> 12 or v_helpers <> 2 then
    raise exception '개인 봉사 정책 검증 실패: TEMP %, final %, helpers %/2', v_temp, v_final, v_helpers;
  end if;
end
$$;
