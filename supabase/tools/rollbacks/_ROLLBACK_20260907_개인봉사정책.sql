do $$
declare
  v_temp integer;
  v_final integer;
begin
  select count(*) into v_temp from pg_policies
  where schemaname = 'public'
    and tablename in ('service_sessions', 'regular_visits', 'return_visits', 'return_visit_logs')
    and policyname like 'TEMP_session_gate_%';
  select count(*) into v_final from pg_policies
  where schemaname = 'public'
    and policyname like 'role_owner_%'
    and tablename in ('service_sessions', 'regular_visits', 'return_visits', 'return_visit_logs');
  if v_temp = 12 and v_final = 0 then return; end if;
  if v_temp <> 0 or v_final <> 12 then
    raise exception '롤백 시작 상태가 예상과 다릅니다: TEMP %, final %', v_temp, v_final;
  end if;
end
$$;

drop policy if exists "role_owner_service_sessions_insert" on public.service_sessions;
drop policy if exists "role_owner_service_sessions_update" on public.service_sessions;
drop policy if exists "role_owner_service_sessions_delete" on public.service_sessions;
create policy "TEMP_session_gate_service_sessions_ins" on public.service_sessions for insert to anon
  with check ((select private.request_session_user_id()) is not null);
create policy "TEMP_session_gate_service_sessions_upd" on public.service_sessions for update to anon
  using ((select private.request_session_user_id()) is not null)
  with check ((select private.request_session_user_id()) is not null);
create policy "TEMP_session_gate_service_sessions_del" on public.service_sessions for delete to anon
  using ((select private.request_session_user_id()) is not null);

drop policy if exists "role_owner_regular_visits_insert" on public.regular_visits;
drop policy if exists "role_owner_regular_visits_update" on public.regular_visits;
drop policy if exists "role_owner_regular_visits_delete" on public.regular_visits;
create policy "TEMP_session_gate_regular_visits_ins" on public.regular_visits for insert to anon
  with check ((select private.request_session_user_id()) is not null);
create policy "TEMP_session_gate_regular_visits_upd" on public.regular_visits for update to anon
  using ((select private.request_session_user_id()) is not null)
  with check ((select private.request_session_user_id()) is not null);
create policy "TEMP_session_gate_regular_visits_del" on public.regular_visits for delete to anon
  using ((select private.request_session_user_id()) is not null);

drop policy if exists "role_owner_return_visits_insert" on public.return_visits;
drop policy if exists "role_owner_return_visits_update" on public.return_visits;
drop policy if exists "role_owner_return_visits_delete" on public.return_visits;
create policy "TEMP_session_gate_return_visits_ins" on public.return_visits for insert to public
  with check ((select private.request_session_user_id()) is not null);
create policy "TEMP_session_gate_return_visits_upd" on public.return_visits for update to public
  using ((select private.request_session_user_id()) is not null)
  with check ((select private.request_session_user_id()) is not null);
create policy "TEMP_session_gate_return_visits_del" on public.return_visits for delete to public
  using ((select private.request_session_user_id()) is not null);

drop policy if exists "role_owner_return_visit_logs_insert" on public.return_visit_logs;
drop policy if exists "role_owner_return_visit_logs_update" on public.return_visit_logs;
drop policy if exists "role_owner_return_visit_logs_delete" on public.return_visit_logs;
create policy "TEMP_session_gate_return_visit_logs_ins" on public.return_visit_logs for insert to public
  with check ((select private.request_session_user_id()) is not null);
create policy "TEMP_session_gate_return_visit_logs_upd" on public.return_visit_logs for update to public
  using ((select private.request_session_user_id()) is not null)
  with check ((select private.request_session_user_id()) is not null);
create policy "TEMP_session_gate_return_visit_logs_del" on public.return_visit_logs for delete to public
  using ((select private.request_session_user_id()) is not null);

drop function if exists private.request_session_user_name();
drop function if exists private.request_is_service_manager();
notify pgrst, 'reload schema';
