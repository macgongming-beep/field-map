-- Run with psql --single-transaction; all fixtures and schema changes roll back.
\ir ../migrations/20260930_1000_team_card_scope.sql
do $$
declare
  v_admin integer; v_name text; v_token uuid; v_event integer;
  v_card integer; v_payload jsonb; v_result jsonb; v_shared text;
begin
  if not exists(select 1 from public.app_private_settings where key='environment' and value='test') then
    raise exception 'Test database required';
  end if;
  perform set_config('app.suppress_notifications','true',true);
  select id,name into v_admin,v_name from public.app_users where role in ('admin','developer')
    and is_active and approval_status='approved' order by id limit 1;
  if v_admin is null then raise exception 'Test admin required'; end if;
  insert into public.auth_sessions(user_id) values(v_admin) returning token into v_token;
  insert into public.calendar_events(event_date,title,leader_name) values(current_date,'scope smoke rollback',v_name) returning id into v_event;
  insert into public.event_participants(event_id,user_name,role) values(v_event,v_name,'입명');
  select b.card_id into v_card from public.buildings b join public.units u on u.building_id=b.id
    where btrim(u.number)<>'출입불가' and (u.is_restaurant or coalesce(u.usage_type,b.type)='상가') limit 1;
  if v_card is null then raise exception 'Commercial fixture required'; end if;
  v_payload:=jsonb_build_array(jsonb_build_object('userName',v_name,'teamKey','smoke-team','cardScope','상가','cardIds',jsonb_build_array(v_card)));
  execute 'set local role anon';
  v_result:=public.assign_scoped_cards_bulk_tx(v_token,v_event,v_payload,'shared',null);
  execute 'reset role';
  if v_result->>'ok'<>'true' then raise exception 'Save failed: %',v_result; end if;
  if not exists(select 1 from public.calendar_events where id=v_event and assignment_team_scopes->>'smoke-team'='상가') then raise exception 'Scope missing'; end if;
  select assignment_shared_at::text into v_shared from public.calendar_events where id=v_event;
  v_result:=public.assign_scoped_cards_bulk_tx(v_token,v_event,v_payload,'shared',null);
  if v_result->>'conflict'<>'true' then raise exception 'Null-start conflict not detected'; end if;
  begin
    perform public.assign_cards_bulk_tx(v_token,v_event,v_payload,'shared',v_shared);
    raise exception 'Legacy save accepted';
  exception when others then
    if sqlerrm not like '%새 버전%' then raise; end if;
  end;
  execute 'set local role anon';
  if (select count(*) from public.event_card_assignments where event_id=v_event) <> 1 then raise exception 'Scoped reads blocked'; end if;
  execute 'reset role';
  perform set_config('request.headers',jsonb_build_object('x-session-token',v_token)::text,true);
  execute 'set local role anon';
  if not public.session_can_manage_event(v_event) then raise exception 'Direct write test lacks actor'; end if;
  delete from public.event_card_assignments where event_id=v_event;
  if not exists(select 1 from public.event_card_assignments where event_id=v_event) then raise exception 'Direct delete bypass'; end if;
  execute 'reset role';
  begin
    perform public.assign_scoped_cards_bulk_tx(null,v_event,v_payload,'shared',v_shared);
    raise exception 'Unauthenticated save accepted';
  exception when others then
    if sqlerrm not like '%세션%' then raise; end if;
  end;
  v_payload:=jsonb_set(v_payload,'{0,cardScope}','"전체"');
  v_result:=public.assign_scoped_cards_bulk_tx(v_token,v_event,v_payload,'shared',v_shared);
  if v_result->>'ok'<>'true' then raise exception 'Scope reset failed'; end if;
  raise notice 'PASS: save/read, stable key metadata, stale-null conflict, legacy rejection, session rejection, scope reset';
end $$;
rollback;
