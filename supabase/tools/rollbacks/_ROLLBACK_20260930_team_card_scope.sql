-- Back up calendar_events first. This removes scope metadata, not cards or visits.
drop policy if exists scoped_assignment_rpc_insert on public.event_card_assignments;
drop policy if exists scoped_assignment_rpc_update on public.event_card_assignments;
drop policy if exists scoped_assignment_rpc_delete on public.event_card_assignments;
drop policy if exists scoped_assignment_rpc_insert on public.event_card_assignment_cards;
drop policy if exists scoped_assignment_rpc_update on public.event_card_assignment_cards;
drop policy if exists scoped_assignment_rpc_delete on public.event_card_assignment_cards;
create or replace function public.assign_cards_bulk_tx(
  p_token uuid,p_event_id integer,p_assignments jsonb,p_status text default null,p_expected_shared_at text default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor integer;
begin
  v_actor := public.verify_session(p_token);
  if v_actor is null then raise exception '세션이 유효하지 않습니다'; end if;
  perform 1 from public.calendar_events where id=p_event_id for update;
  if not private.user_can_manage_event(v_actor,p_event_id) then raise exception '이 일정의 배정을 관리할 권한이 없습니다'; end if;
  return public.assign_cards_bulk_tx_impl_20260907(p_token,p_event_id,p_assignments,p_status,p_expected_shared_at);
end $$;
drop function public.assign_scoped_cards_bulk_tx(uuid,integer,jsonb,text,text);
alter table public.calendar_events drop column assignment_team_scopes;
notify pgrst, 'reload schema';
