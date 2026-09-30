\ir ../migrations/20260930_1600_atomic_team_participant_removal.sql
do $$
declare actor integer; member integer; who text; other_name text; tok uuid; member_tok uuid;
  ev integer; asset integer; result jsonb; stamp text; payload jsonb; sid integer;
begin
  if not exists(select 1 from public.app_private_settings where key='environment' and value='test') then raise exception 'Test DB required'; end if;
  perform set_config('app.suppress_notifications','true',true);
  select id,name into actor,who from public.app_users where role='admin' and is_active and approval_status='approved' order by id limit 1;
  select id,name into member,other_name from public.app_users where role='user' and is_active and approval_status='approved' order by id limit 1;
  if member is null then raise exception 'Approved member fixture required'; end if;
  insert into public.auth_sessions(user_id) values(actor) returning token into tok;
  insert into public.auth_sessions(user_id) values(member) returning token into member_tok;
  insert into public.calendar_events(event_date,title,leader_name) values(current_date,'synthetic atomic removal',who) returning id into ev;
  insert into public.informal_assets(name,image_url,image_path) values('synthetic atomic card','','') returning id into asset;
  insert into public.event_participants(event_id,user_name,role) values(ev,who,'입명'),(ev,other_name,'신청');
  payload:=jsonb_build_array(
    jsonb_build_object('userName',who,'teamKey','atomic-team','cardScope','전체','cardIds','[]'::jsonb,'informalAssetIds',jsonb_build_array(asset)),
    jsonb_build_object('userName',other_name,'teamKey','atomic-team','cardScope','전체','cardIds','[]'::jsonb,'informalAssetIds',jsonb_build_array(asset)));
  result:=public.assign_team_service_bulk_tx(tok,ev,payload,'shared',null);
  if result->>'ok'<>'true' then raise exception 'Fixture failed'; end if;
  select assignment_shared_at::text into stamp from public.calendar_events where id=ev;
  insert into public.service_sessions(user_name,calendar_event_id,source,time_slot,service_date)
    values(other_name,ev,'assigned','오전','2099-01-01') returning id into sid;
  execute 'set local role anon';
  begin
    perform public.remove_team_event_participant_tx(member_tok,ev,who,false,stamp);
    raise exception 'Unauthorized removal accepted';
  exception when insufficient_privilege then null; end;
  begin
    perform public.remove_team_event_participant_tx(member_tok,ev,who,true,stamp);
    raise exception 'Spoofed self accepted';
  exception when insufficient_privilege then null; end;
  result:=public.remove_team_event_participant_tx(tok,ev,other_name,false,null);
  if result->>'conflict'<>'true' then raise exception 'Stale removal accepted'; end if;
  result:=public.remove_team_event_participant_tx(member_tok,ev,other_name,true,stamp);
  execute 'reset role';
  if result->>'ok'<>'true' or exists(select 1 from public.event_card_assignments where event_id=ev and user_name=other_name)
    or exists(select 1 from public.event_participants where event_id=ev and user_name=other_name) then raise exception 'Self removal left assignment'; end if;
  if not exists(select 1 from public.event_card_assignments where event_id=ev and user_name=who)
    or (select assignment_team_informal->'atomic-team' from public.calendar_events where id=ev)<>jsonb_build_array(asset)
    or not exists(select 1 from public.service_sessions where id=sid and status='ended' and ended_at is not null) then
    raise exception 'Other member/team/session history damaged'; end if;
  result:=public.assign_team_service_bulk_tx(tok,ev,payload,'shared',stamp);
  if result->>'conflict'<>'true' then raise exception 'Stale editor resurrected member'; end if;
  select assignment_shared_at::text into stamp from public.calendar_events where id=ev;
  execute 'set local role anon';
  begin
    perform public.remove_team_event_participant_tx(tok,ev,who,true,stamp);
    raise exception 'Assigned member self removal accepted';
  exception when insufficient_privilege then null; end;
  result:=public.remove_team_event_participant_tx(tok,ev,who,false,stamp);
  execute 'reset role';
  if result->>'ok'<>'true' or exists(select 1 from public.event_card_assignments where event_id=ev)
    or (select assignment_team_informal from public.calendar_events where id=ev)<>'{}'::jsonb
    or (select assignment_team_scopes from public.calendar_events where id=ev)<>'{}'::jsonb then
    raise exception 'Last member cleanup failed'; end if;
  -- Older participant DELETE callers must also run the same cleanup atomically.
  insert into public.event_participants(event_id,user_name,role) values(ev,other_name,'신청');
  select assignment_shared_at::text into stamp from public.calendar_events where id=ev;
  result:=public.assign_team_service_bulk_tx(tok,ev,jsonb_build_array(payload->1),'shared',stamp);
  perform set_config('request.headers',jsonb_build_object('x-session-token',member_tok)::text,true);
  execute 'set local role anon';
  delete from public.event_participants where event_id=ev and user_name=other_name and role='신청';
  execute 'reset role';
  if exists(select 1 from public.event_card_assignments where event_id=ev) then raise exception 'Legacy DELETE left assignment'; end if;
  raise notice 'PASS: auth, self/admin removal, other member preservation, session history, stale editor, last member metadata, legacy DELETE';
end $$;
rollback;
