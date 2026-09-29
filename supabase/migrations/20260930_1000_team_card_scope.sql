-- Team scope is canonical event metadata, not a separately editable per-person copy.
-- Demo rollout first. Existing installations retain all-scope behaviour.
alter table public.calendar_events add column if not exists assignment_team_scopes jsonb not null default '{}'::jsonb;
alter table public.calendar_events add constraint calendar_event_team_scopes_object
  check (jsonb_typeof(assignment_team_scopes) = 'object');

create or replace function public.assign_scoped_cards_bulk_tx(
  p_token uuid, p_event_id integer, p_assignments jsonb,
  p_status text default null, p_expected_shared_at text default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor integer;
  v_shared timestamptz;
  v_scopes jsonb;
  v_result jsonb;
begin
  v_actor := public.verify_session(p_token);
  if v_actor is null then raise exception '세션이 유효하지 않습니다'; end if;
  select assignment_shared_at into v_shared from public.calendar_events where id = p_event_id for update;
  if not found or not private.user_can_manage_event(v_actor, p_event_id) then
    raise exception '이 일정의 배정을 관리할 권한이 없습니다';
  end if;
  if v_shared is distinct from p_expected_shared_at::timestamptz then
    return jsonb_build_object('ok', false, 'conflict', true, 'server_shared_at', v_shared);
  end if;
  if p_assignments is null or jsonb_typeof(p_assignments) <> 'array' then raise exception '배정 목록이 필요합니다'; end if;
  if p_status is not null and p_status not in ('confirmed', 'shared') then raise exception '배정 상태가 올바르지 않습니다'; end if;
  if exists (select 1 from jsonb_array_elements(p_assignments) a
    where coalesce(a->>'teamKey','') = '' or coalesce(a->>'cardScope','') not in ('전체','주택','상가')
      or coalesce(jsonb_typeof(a->'cardIds'),'') <> 'array'
      or not exists(select 1 from public.event_participants p where p.event_id=p_event_id and p.user_name=a->>'userName')) then
    raise exception '팀, 봉사 형태 또는 참가자가 올바르지 않습니다';
  end if;
  if exists(select 1 from jsonb_array_elements(p_assignments) a group by a->>'userName' having count(*) > 1) then
    raise exception '한 참가자는 한 팀에만 배정할 수 있습니다';
  end if;
  if exists(select 1 from jsonb_array_elements(p_assignments) a group by a->>'teamKey'
    having count(distinct a->>'cardScope') > 1 or count(distinct a->'cardIds') > 1) then
    raise exception '같은 팀의 카드와 봉사 형태가 다릅니다';
  end if;
  if exists(select 1 from jsonb_array_elements(p_assignments) a,
      lateral jsonb_array_elements_text(a->'cardIds') c(id)
    where not exists(select 1 from public.cards t where t.id=c.id::bigint)) then
    raise exception '존재하지 않는 구역 카드입니다';
  end if;
  if exists(select 1 from jsonb_array_elements(p_assignments) a,
      lateral jsonb_array_elements_text(a->'cardIds') c(id)
    where a->>'cardScope' <> '전체' and not exists(
      select 1 from public.buildings b join public.units u on u.building_id=b.id
      where b.card_id=c.id::bigint and btrim(u.number) <> '출입불가'
        and case when u.is_restaurant then '상가' else coalesce(u.usage_type,b.type) end = a->>'cardScope')) then
    raise exception '선택한 봉사 형태의 세대가 없는 카드가 있습니다';
  end if;
  select coalesce(jsonb_object_agg(a->>'teamKey', a->>'cardScope'),'{}'::jsonb)
    into v_scopes from jsonb_array_elements(p_assignments) a;
  v_result := public.assign_cards_bulk_tx_impl_20260907(p_token,p_event_id,p_assignments,p_status,p_expected_shared_at);
  if coalesce((v_result->>'ok')::boolean,false) then
    update public.calendar_events set assignment_team_scopes=v_scopes where id=p_event_id;
  end if;
  return v_result;
end $$;
revoke all on function public.assign_scoped_cards_bulk_tx(uuid,integer,jsonb,text,text) from public;
grant execute on function public.assign_scoped_cards_bulk_tx(uuid,integer,jsonb,text,text) to anon,authenticated;

-- An old editor must not silently turn a scoped assignment into an all-scope one.
create or replace function public.assign_cards_bulk_tx(
  p_token uuid,p_event_id integer,p_assignments jsonb,p_status text default null,p_expected_shared_at text default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor integer;
begin
  v_actor := public.verify_session(p_token);
  if v_actor is null then raise exception '세션이 유효하지 않습니다'; end if;
  perform 1 from public.calendar_events where id=p_event_id for update;
  if not private.user_can_manage_event(v_actor,p_event_id) then raise exception '이 일정의 배정을 관리할 권한이 없습니다'; end if;
  if exists(select 1 from public.calendar_events e, lateral jsonb_each_text(e.assignment_team_scopes) s
    where e.id=p_event_id and s.value <> '전체') then
    raise exception '봉사 형태가 지정된 배정입니다. 새 버전으로 업데이트해 주세요';
  end if;
  return public.assign_cards_bulk_tx_impl_20260907(p_token,p_event_id,p_assignments,p_status,p_expected_shared_at);
end $$;

-- Legacy direct writes cannot bypass the scoped RPC. Trusted backup restore bypasses RLS.
do $$ declare t text; begin
  foreach t in array array['event_card_assignments','event_card_assignment_cards'] loop
    execute format('create policy scoped_assignment_rpc_update on public.%I as restrictive for update to anon, authenticated
      using (not exists(select 1 from public.calendar_events e, lateral jsonb_each_text(e.assignment_team_scopes) s where e.id=event_id and s.value <> ''전체''))
      with check (not exists(select 1 from public.calendar_events e, lateral jsonb_each_text(e.assignment_team_scopes) s where e.id=event_id and s.value <> ''전체''))',t);
    execute format('create policy scoped_assignment_rpc_insert on public.%I as restrictive for insert to anon, authenticated
      with check (not exists(select 1 from public.calendar_events e, lateral jsonb_each_text(e.assignment_team_scopes) s where e.id=event_id and s.value <> ''전체''))',t);
    execute format('create policy scoped_assignment_rpc_delete on public.%I as restrictive for delete to anon, authenticated
      using (not exists(select 1 from public.calendar_events e, lateral jsonb_each_text(e.assignment_team_scopes) s where e.id=event_id and s.value <> ''전체''))',t);
  end loop;
end $$;
notify pgrst, 'reload schema';
