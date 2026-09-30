-- Keep legacy participant DELETE callers safe without reopening assignment writes.
create or replace function private.cleanup_team_participant_removal()
returns trigger language plpgsql security definer set search_path='' as $$
declare e public.calendar_events%rowtype; k text;
begin
  select * into e from public.calendar_events where id=old.event_id for update;
  if not found or (e.assignment_team_informal is null and e.assignment_team_scopes='{}'::jsonb) then
    return old;
  end if;
  select team_key into k from public.event_card_assignments
    where event_id=old.event_id and user_name=old.user_name;
  delete from public.event_card_assignment_cards where event_id=old.event_id and user_name=old.user_name;
  delete from public.event_card_assignments where event_id=old.event_id and user_name=old.user_name;
  delete from public.event_informal_assignments where event_id=old.event_id and user_name=old.user_name;
  delete from public.event_restaurant_assignments where event_id=old.event_id and user_name=old.user_name;
  -- Preserve session IDs and all visit/log references, including completed history.
  update public.service_sessions set status='ended',ended_at=clock_timestamp()
    where calendar_event_id=old.event_id and user_name=old.user_name
      and source='assigned' and status='active';
  if k is not null and not exists(select 1 from public.event_card_assignments
    where event_id=old.event_id and team_key=k) then
    update public.calendar_events set assignment_team_scopes=assignment_team_scopes-k,
      assignment_team_informal=assignment_team_informal-k where id=old.event_id;
  end if;
  -- Invalidate editors opened before this removal, even within one transaction.
  update public.calendar_events set assignment_shared_at=greatest(clock_timestamp(),
    coalesce(assignment_shared_at,'-infinity'::timestamptz)+interval '1 microsecond')
    where id=old.event_id;
  return old;
end $$;
revoke all on function private.cleanup_team_participant_removal() from public,anon,authenticated;
create or replace trigger cleanup_team_participant_removal before delete on public.event_participants
  for each row execute function private.cleanup_team_participant_removal();

create or replace function public.remove_team_event_participant_tx(
  p_token uuid,p_event_id integer,p_user_name text,p_self boolean,
  p_expected_shared_at text default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor integer; who text; e public.calendar_events%rowtype; participant_role text;
begin
  actor:=public.verify_session(p_token);
  if actor is null then raise exception '세션이 유효하지 않습니다' using errcode='42501'; end if;
  select name into who from public.app_users where id=actor;
  select * into e from public.calendar_events where id=p_event_id for update;
  if not found then raise exception '일정을 찾을 수 없습니다'; end if;
  if p_self is null or (p_self and who is distinct from p_user_name)
    or (not p_self and not private.user_can_manage_event(actor,p_event_id)) then
    raise exception '참가자를 제외할 권한이 없습니다' using errcode='42501';
  end if;
  if e.assignment_team_informal is null and e.assignment_team_scopes='{}'::jsonb then
    raise exception '팀 배정 일정이 아닙니다';
  end if;
  if e.assignment_shared_at is distinct from p_expected_shared_at::timestamptz then
    return jsonb_build_object('ok',false,'conflict',true);
  end if;
  select role into participant_role from public.event_participants
    where event_id=p_event_id and user_name=p_user_name for update;
  if not found then return jsonb_build_object('ok',true,'changed',false); end if;
  if p_self and participant_role<>'신청' then
    raise exception '배정된 참가자는 인도자에게 취소를 요청해 주세요' using errcode='42501';
  end if;
  delete from public.event_participants where event_id=p_event_id and user_name=p_user_name;
  return jsonb_build_object('ok',true,'changed',true);
end $$;
revoke all on function public.remove_team_event_participant_tx(uuid,integer,text,boolean,text) from public,anon,authenticated;
grant execute on function public.remove_team_event_participant_tx(uuid,integer,text,boolean,text) to anon,authenticated;
notify pgrst,'reload schema';
