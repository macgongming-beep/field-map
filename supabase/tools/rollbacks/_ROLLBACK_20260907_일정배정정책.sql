-- 20260907_1100 일정·배정 정책을 직전 상태로 되돌린다.

drop policy if exists role_admin_calendar_events_insert on public.calendar_events;
drop policy if exists role_admin_calendar_events_update on public.calendar_events;
drop policy if exists role_admin_calendar_events_delete on public.calendar_events;
create policy "TEMP_session_gate_calendar_events_ins" on public.calendar_events
  for insert to public with check ((select private.request_session_user_id()) is not null);
create policy "TEMP_session_gate_calendar_events_upd" on public.calendar_events
  for update to public using ((select private.request_session_user_id()) is not null)
  with check ((select private.request_session_user_id()) is not null);
create policy "TEMP_session_gate_calendar_events_del" on public.calendar_events
  for delete to public using ((select private.request_session_user_id()) is not null);

drop policy if exists role_event_participants_insert on public.event_participants;
drop policy if exists role_event_participants_update on public.event_participants;
drop policy if exists role_event_participants_delete on public.event_participants;
create policy "TEMP_session_gate_event_participants_ins" on public.event_participants
  for insert to public with check ((select private.request_session_user_id()) is not null);
create policy "TEMP_session_gate_event_participants_upd" on public.event_participants
  for update to public using ((select private.request_session_user_id()) is not null)
  with check ((select private.request_session_user_id()) is not null);
create policy "TEMP_session_gate_event_participants_del" on public.event_participants
  for delete to public using ((select private.request_session_user_id()) is not null);

do $$
declare v_table text;
begin
  foreach v_table in array array['event_card_assignments','event_card_assignment_cards'] loop
    execute format('drop policy if exists %I on public.%I', 'role_' || v_table || '_insert', v_table);
    execute format('drop policy if exists %I on public.%I', 'role_' || v_table || '_update', v_table);
    execute format('drop policy if exists %I on public.%I', 'role_' || v_table || '_delete', v_table);
    execute format('create policy %I on public.%I for insert to anon with check ((select private.request_session_user_id()) is not null)', 'TEMP_session_gate_' || v_table || '_ins', v_table);
    execute format('create policy %I on public.%I for update to anon using ((select private.request_session_user_id()) is not null) with check ((select private.request_session_user_id()) is not null)', 'TEMP_session_gate_' || v_table || '_upd', v_table);
    execute format('create policy %I on public.%I for delete to anon using ((select private.request_session_user_id()) is not null)', 'TEMP_session_gate_' || v_table || '_del', v_table);
  end loop;
end $$;

do $$
declare v_table text;
begin
  foreach v_table in array array['card_assignments','card_leader_assignments'] loop
    execute format('drop policy if exists %I on public.%I', 'role_admin_' || v_table || '_insert', v_table);
    execute format('drop policy if exists %I on public.%I', 'role_admin_' || v_table || '_update', v_table);
    execute format('drop policy if exists %I on public.%I', 'role_admin_' || v_table || '_delete', v_table);
    execute format('create policy %I on public.%I for insert to anon with check ((select private.request_session_user_id()) is not null)', 'TEMP_session_gate_' || v_table || '_ins', v_table);
    execute format('create policy %I on public.%I for update to anon using ((select private.request_session_user_id()) is not null) with check ((select private.request_session_user_id()) is not null)', 'TEMP_session_gate_' || v_table || '_upd', v_table);
    execute format('create policy %I on public.%I for delete to anon using ((select private.request_session_user_id()) is not null)', 'TEMP_session_gate_' || v_table || '_del', v_table);
  end loop;
end $$;

-- 비공식·식당 배정은 직전의 '인도자 역할 전체' 계약으로 복구한다.
do $$
declare v_table text;
begin
  foreach v_table in array array['event_informal_assignments','event_restaurant_assignments'] loop
    execute format('drop policy if exists %I on public.%I', 'role_' || v_table || '_insert', v_table);
    execute format('drop policy if exists %I on public.%I', 'role_' || v_table || '_update', v_table);
    execute format('drop policy if exists %I on public.%I', 'role_' || v_table || '_delete', v_table);
    execute format('create policy %I on public.%I for insert to anon, authenticated with check ((select public.session_can_assign_service()))', 'role_' || v_table || '_insert', v_table);
    execute format('create policy %I on public.%I for update to anon, authenticated using ((select private.request_is_admin())) with check ((select private.request_is_admin()))', 'role_' || v_table || '_update', v_table);
    execute format('create policy %I on public.%I for delete to anon, authenticated using ((select public.session_can_assign_service()))', 'role_' || v_table || '_delete', v_table);
  end loop;
end $$;

drop function if exists public.assign_cards_bulk_tx(uuid, integer, jsonb, text, text);
drop function if exists public.update_calendar_event_tx(uuid, integer, jsonb, boolean);
drop function if exists public.update_calendar_event_series_tx(uuid, uuid, date, jsonb, boolean);

alter function public.assign_cards_bulk_tx_impl_20260907(uuid, integer, jsonb, text, text)
  rename to assign_cards_bulk_tx;
alter function public.update_calendar_event_tx_impl_20260907(uuid, integer, jsonb, boolean)
  rename to update_calendar_event_tx;
alter function public.update_calendar_event_series_tx_impl_20260907(uuid, uuid, date, jsonb, boolean)
  rename to update_calendar_event_series_tx;

grant execute on function public.assign_cards_bulk_tx(uuid, integer, jsonb, text, text) to anon, authenticated;
grant execute on function public.update_calendar_event_tx(uuid, integer, jsonb, boolean) to anon, authenticated;
grant execute on function public.update_calendar_event_series_tx(uuid, uuid, date, jsonb, boolean) to anon, authenticated;

drop function if exists public.session_can_manage_event(integer);
drop function if exists private.user_can_manage_event(integer, integer);

notify pgrst, 'reload schema';
