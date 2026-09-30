-- Demo only; run with psql --single-transaction before applying the migration.
\ir ../migrations/20260930_1200_team_informal_assignments.sql
\ir ../migrations/20260930_1400_guard_team_service_sharing.sql
do $$
declare a integer; n text; tok uuid; ev integer; asset integer; payload jsonb; result jsonb; stamp text;
begin
  if not exists(select 1 from public.app_private_settings where key='environment' and value='test') then raise exception 'Test DB required'; end if;
  perform set_config('app.suppress_notifications','true',true);
  select id,name into a,n from public.app_users where role='admin' and is_active and approval_status='approved' order by id limit 1;
  select id into asset from public.informal_assets order by id limit 1;
  if asset is null then raise exception 'Informal fixture needed'; end if;
  insert into public.auth_sessions(user_id) values(a) returning token into tok;
  insert into public.calendar_events(event_date,title,leader_name) values(current_date,'team informal rollback smoke',n) returning id into ev;
  insert into public.event_participants(event_id,user_name,role) values(ev,n,'입명');
  payload := jsonb_build_array(jsonb_build_object('userName',n,'teamKey','stable-team','cardScope','전체','cardIds','[]'::jsonb,'informalAssetIds',jsonb_build_array(asset)));
  execute 'set local role anon';
  result := public.assign_team_service_bulk_tx(tok,ev,payload,'shared',null);
  execute 'reset role';
  if result->>'ok'<>'true' then raise exception 'Save failed'; end if;
  if not exists(select 1 from public.calendar_events where id=ev and assignment_team_informal->'stable-team'=jsonb_build_array(asset)) then raise exception 'Team assets missing'; end if;
  if exists(select 1 from public.event_informal_assignments where event_id=ev) then raise exception 'Personal copies remain'; end if;
  if not exists(select 1 from public.event_card_assignments where event_id=ev and team_key='stable-team') then raise exception 'Informal-only team lost'; end if;
  select assignment_shared_at::text into stamp from public.calendar_events where id=ev;
  result := public.assign_team_service_bulk_tx(tok,ev,payload,'shared',null);
  if result->>'conflict'<>'true' then raise exception 'Stale write accepted'; end if;
  begin
    perform public.assign_scoped_cards_bulk_tx(tok,ev,payload,'shared',stamp);
    raise exception 'Legacy write accepted';
  exception when others then if sqlerrm not like '%새 버전%' then raise; end if; end;
  begin
    perform public.assign_team_service_bulk_tx(null,ev,payload,'shared',stamp);
    raise exception 'Unauthenticated accepted';
  exception when others then if sqlerrm not like '%세션%' then raise; end if; end;
  begin
    perform public.assign_team_service_bulk_tx(tok,ev,jsonb_set(payload,'{0,informalAssetIds}','[-999]'),'shared',stamp);
    raise exception 'Unknown asset accepted';
  exception when others then if sqlerrm not like '%ID:%' then raise; end if; end;
  perform set_config('request.headers',jsonb_build_object('x-session-token',tok)::text,true);
  execute 'set local role anon';
  begin
    insert into public.event_informal_assignments(event_id,user_name,asset_id,assigned_by) values(ev,n,asset,n);
    raise exception 'Direct personal write accepted';
  exception when insufficient_privilege then null; end;
  execute 'reset role';
  result := public.assign_team_service_bulk_tx(tok,ev,'[]','shared',stamp);
  if result->>'ok'<>'true' or (select assignment_team_informal from public.calendar_events where id=ev)<>'{}'::jsonb then raise exception 'Clear all failed'; end if;
  raise notice 'PASS: informal-only team, canonical storage, personal cleanup, conflicts, auth, old client/direct write block, clear all';
end $$;
rollback;
