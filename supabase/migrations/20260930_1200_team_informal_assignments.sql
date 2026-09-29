-- Team-owned informal assignments. NULL preserves historical personal assignments.
alter table public.calendar_events add column assignment_team_informal jsonb;
alter table public.calendar_events add constraint assignment_team_informal_object
  check (assignment_team_informal is null or jsonb_typeof(assignment_team_informal) = 'object');

alter function public.assign_scoped_cards_bulk_tx(uuid,integer,jsonb,text,text) set schema private;
alter function public.assign_cards_bulk_tx(uuid,integer,jsonb,text,text) set schema private;
revoke all on function private.assign_scoped_cards_bulk_tx(uuid,integer,jsonb,text,text) from public,anon,authenticated;
revoke all on function private.assign_cards_bulk_tx(uuid,integer,jsonb,text,text) from public,anon,authenticated;

create function public.assign_team_service_bulk_tx(
  p_token uuid, p_event_id integer, p_assignments jsonb,
  p_status text default null, p_expected_shared_at text default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor integer; v_shared timestamptz; v_result jsonb; v_assets jsonb;
begin
  v_actor := public.verify_session(p_token);
  if v_actor is null then raise exception '세션이 유효하지 않습니다'; end if;
  select assignment_shared_at into v_shared from public.calendar_events where id=p_event_id for update;
  if not found or not private.user_can_manage_event(v_actor,p_event_id) then
    raise exception '이 일정의 배정을 관리할 권한이 없습니다';
  end if;
  if v_shared is distinct from p_expected_shared_at::timestamptz then
    return jsonb_build_object('ok',false,'conflict',true,'server_shared_at',v_shared);
  end if;
  if p_assignments is null or jsonb_typeof(p_assignments)<>'array' then raise exception '배정 목록이 필요합니다'; end if;
  if exists(select 1 from jsonb_array_elements(p_assignments) a
    where coalesce(jsonb_typeof(a->'informalAssetIds'),'')<>'array') then
    raise exception '팀 비공식 목록이 필요합니다';
  end if;
  if exists(select 1 from jsonb_array_elements(p_assignments) a group by a->>'teamKey'
    having count(distinct a->'informalAssetIds')>1) then
    raise exception '같은 팀의 비공식 배정이 다릅니다';
  end if;
  if exists(select 1 from jsonb_array_elements(p_assignments) a,
    lateral jsonb_array_elements_text(a->'informalAssetIds') x(id)
    where not exists(select 1 from public.informal_assets i where i.id=x.id::integer and i.parent_id is null and not i.archived)) then
    raise exception '존재하지 않는 비공식 카드입니다';
  end if;
  select coalesce(jsonb_object_agg(a->>'teamKey',a->'informalAssetIds'),'{}'::jsonb)
    into v_assets from jsonb_array_elements(p_assignments) a;
  v_result := private.assign_scoped_cards_bulk_tx(p_token,p_event_id,p_assignments,p_status,p_expected_shared_at);
  if coalesce((v_result->>'ok')::boolean,false) then
    update public.calendar_events set assignment_team_informal=v_assets where id=p_event_id;
    -- Switching an event to the new model is explicit, never inferred from personal rows.
    delete from public.event_informal_assignments where event_id=p_event_id;
  end if;
  return v_result;
end $$;
revoke all on function public.assign_team_service_bulk_tx(uuid,integer,jsonb,text,text) from public;
grant execute on function public.assign_team_service_bulk_tx(uuid,integer,jsonb,text,text) to anon,authenticated;

-- Old clients must not change membership while silently retaining stale informal teams.
create function public.assign_scoped_cards_bulk_tx(
 p_token uuid,p_event_id integer,p_assignments jsonb,p_status text default null,p_expected_shared_at text default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if public.verify_session(p_token) is null then raise exception '세션이 유효하지 않습니다'; end if;
  perform 1 from public.calendar_events where id=p_event_id for update;
  if exists(select 1 from public.calendar_events where id=p_event_id and assignment_team_informal is not null) then
    raise exception '팀 비공식 배정입니다. 새 버전으로 업데이트해 주세요';
  end if;
  return private.assign_scoped_cards_bulk_tx(p_token,p_event_id,p_assignments,p_status,p_expected_shared_at);
end $$;
create function public.assign_cards_bulk_tx(
 p_token uuid,p_event_id integer,p_assignments jsonb,p_status text default null,p_expected_shared_at text default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if public.verify_session(p_token) is null then raise exception '세션이 유효하지 않습니다'; end if;
  perform 1 from public.calendar_events where id=p_event_id for update;
  if exists(select 1 from public.calendar_events where id=p_event_id and assignment_team_informal is not null) then
    raise exception '팀 비공식 배정입니다. 새 버전으로 업데이트해 주세요';
  end if;
  return private.assign_cards_bulk_tx(p_token,p_event_id,p_assignments,p_status,p_expected_shared_at);
end $$;
revoke all on function public.assign_scoped_cards_bulk_tx(uuid,integer,jsonb,text,text) from public;
revoke all on function public.assign_cards_bulk_tx(uuid,integer,jsonb,text,text) from public;
grant execute on function public.assign_scoped_cards_bulk_tx(uuid,integer,jsonb,text,text) to anon,authenticated;
grant execute on function public.assign_cards_bulk_tx(uuid,integer,jsonb,text,text) to anon,authenticated;

do $$ declare t text; begin
  foreach t in array array['event_informal_assignments','event_card_assignments','event_card_assignment_cards'] loop
    execute format('create policy team_service_rpc_insert on public.%I as restrictive for insert to anon,authenticated
      with check (not exists(select 1 from public.calendar_events e where e.id=event_id and e.assignment_team_informal is not null))',t);
    execute format('create policy team_service_rpc_update on public.%I as restrictive for update to anon,authenticated
      using (not exists(select 1 from public.calendar_events e where e.id=event_id and e.assignment_team_informal is not null))
      with check (not exists(select 1 from public.calendar_events e where e.id=event_id and e.assignment_team_informal is not null))',t);
    execute format('create policy team_service_rpc_delete on public.%I as restrictive for delete to anon,authenticated
      using (not exists(select 1 from public.calendar_events e where e.id=event_id and e.assignment_team_informal is not null))',t);
  end loop;
end $$;
notify pgrst, 'reload schema';
