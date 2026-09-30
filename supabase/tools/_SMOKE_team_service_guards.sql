-- Requires the team-scope and team-informal migrations. All fixtures roll back.
\ir ../migrations/20260930_1400_guard_team_service_sharing.sql
do $$
declare actor integer; who text; tok uuid; ev integer; asset integer; payload jsonb; result jsonb; stamp text; before_event jsonb;
begin
  if not exists(select 1 from public.app_private_settings where key='environment' and value='test') then raise exception 'Test DB required'; end if;
  perform set_config('app.suppress_notifications','true',true);
  select id,name into actor,who from public.app_users where role='admin' and is_active and approval_status='approved' order by id limit 1;
  insert into public.auth_sessions(user_id) values(actor) returning token into tok;
  insert into public.calendar_events(event_date,title,leader_name) values(current_date-7,'synthetic guard smoke',who) returning id into ev;
  insert into public.informal_assets(name,image_url,image_path) values('synthetic guard card','','') returning id into asset;
  insert into public.event_participants(event_id,user_name,role) values(ev,who,'입명');
  insert into public.event_informal_assignments(event_id,user_name,asset_id,assigned_by)
    select ev,'synthetic-person-'||i,asset,who from generate_series(1,18) i;
  select to_jsonb(e) into before_event from public.calendar_events e where id=ev;
  payload:=jsonb_build_array(jsonb_build_object('userName',who,'teamKey','guard-team','cardScope','전체','cardIds','[]'::jsonb,'informalAssetIds','[]'::jsonb));
  execute 'set local role anon';
  begin
    perform public.assign_team_service_bulk_tx(tok,ev,payload,'shared',null);
    raise exception 'Legacy personal data was accepted';
  exception when others then if sqlerrm not like '%개인 비공식 배정%' then raise; end if; end;
  execute 'reset role';
  if (select count(*) from public.event_informal_assignments where event_id=ev)<>18
    or (select to_jsonb(e) from public.calendar_events e where id=ev)<>before_event then
    raise exception 'Legacy history/event changed';
  end if;
  raise notice 'PASS: legacy share refused; 18 personal links and event metadata unchanged';
  -- Only this synthetic fixture is explicitly cleared, outside the sharing RPC.
  delete from public.event_informal_assignments where event_id=ev;
  payload:=jsonb_set(payload,'{0,informalAssetIds}',jsonb_build_array(asset));
  result:=public.assign_team_service_bulk_tx(tok,ev,payload,'shared',null);
  if result->>'ok'<>'true' then raise exception 'Initial share failed'; end if;
  select assignment_shared_at::text into stamp from public.calendar_events where id=ev;
  update public.informal_assets set archived=true where id=asset;
  execute 'set local role anon';
  begin
    perform public.assign_team_service_bulk_tx(tok,ev,payload,'shared',stamp);
    raise exception 'Archived selection accepted';
  exception when others then
    if sqlerrm not like '%ID: '||asset::text||'%' then raise; end if;
  end;
  execute 'reset role';
  delete from public.informal_assets where id=asset;
  begin
    perform public.assign_team_service_bulk_tx(tok,ev,payload,'shared',stamp);
    raise exception 'Deleted selection accepted';
  exception when others then
    if sqlerrm not like '%ID: '||asset::text||'%' then raise; end if;
  end;
  payload:=jsonb_set(payload,'{0,informalAssetIds}','[]'::jsonb);
  execute 'set local role anon';
  result:=public.assign_team_service_bulk_tx(tok,ev,payload,'shared',stamp);
  execute 'reset role';
  if result->>'ok'<>'true' then raise exception 'Share after deselection failed'; end if;
  raise notice 'PASS: archived/deleted ID reported; explicit deselection restores sharing';
end $$;
rollback;
