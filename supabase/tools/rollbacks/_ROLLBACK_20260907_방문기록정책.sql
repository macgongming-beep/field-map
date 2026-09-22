drop policy if exists role_member_visit_histories_insert on public.visit_histories;
drop policy if exists role_owner_visit_histories_update on public.visit_histories;
create policy "TEMP_session_gate_visit_histories_ins" on public.visit_histories for insert to anon, authenticated
  with check ((select private.request_session_user_id()) is not null);
create policy "TEMP_session_gate_visit_histories_upd" on public.visit_histories for update to anon, authenticated
  using ((select private.request_session_user_id()) is not null) with check ((select private.request_session_user_id()) is not null);
create policy "TEMP_session_gate_visit_histories_del" on public.visit_histories for delete to anon, authenticated
  using ((select private.request_session_user_id()) is not null);

drop trigger if exists visit_histories_recompute_unit_status on public.visit_histories;
drop trigger if exists visit_histories_guard_write on public.visit_histories;
create or replace function public.guard_visit_visitor_change()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.visitor_name is not distinct from old.visitor_name then return new; end if;
  if current_user in ('postgres', 'supabase_admin', 'service_role') then return new; end if;
  if (select public.session_can_change_visitor()) then return new; end if;
  raise exception '방문자는 관리자·인도자만 바꿀 수 있습니다';
end;
$$;
create trigger visit_histories_guard_visitor
  before update on public.visit_histories
  for each row execute function public.guard_visit_visitor_change();
drop function if exists private.after_visit_history_change();
drop function if exists public.guard_visit_history_write();
drop function if exists private.visit_history_is_owned_by_requester(bigint);
drop function if exists public.visit_history_request_user_id();
-- 새 열과 RPC는 롤백 때 보존한다. 이미 쌓인 작성자·무효 감사 자료를 잃지 않고,
-- 옛 클라이언트 호출과도 충돌하지 않는다.
notify pgrst, 'reload schema';
