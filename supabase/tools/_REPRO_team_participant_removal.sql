-- Diagnostic for the legacy multi-request removal path. Synthetic rows only.
-- Run with psql --single-transaction; no changes survive.
do $$
declare actor integer; who text; tok uuid; ev integer; asset integer; result jsonb; removed integer;
begin
  if not exists(select 1 from public.app_private_settings where key='environment' and value='test') then raise exception 'Test DB required'; end if;
  perform set_config('app.suppress_notifications','true',true);
  select id,name into actor,who from public.app_users where role='admin' and is_active and approval_status='approved' order by id limit 1;
  insert into public.auth_sessions(user_id) values(actor) returning token into tok;
  insert into public.calendar_events(event_date,title,leader_name) values(current_date,'synthetic cancellation diagnostic',who) returning id into ev;
  insert into public.informal_assets(name,image_url,image_path) values('synthetic cancellation card','','') returning id into asset;
  insert into public.event_participants(event_id,user_name,role) values(ev,who,'입명');
  result:=public.assign_team_service_bulk_tx(tok,ev,jsonb_build_array(jsonb_build_object(
    'userName',who,'teamKey','cancel-team','cardScope','전체','cardIds','[]'::jsonb,
    'informalAssetIds',jsonb_build_array(asset))),'shared',null);
  if result->>'ok'<>'true' then raise exception 'Fixture sharing failed'; end if;
  perform set_config('request.headers',jsonb_build_object('x-session-token',tok)::text,true);
  execute 'set local role anon';
  delete from public.event_card_assignment_cards where event_id=ev and user_name=who;
  delete from public.event_card_assignments where event_id=ev and user_name=who;
  get diagnostics removed=row_count;
  raise notice 'Legacy assignment DELETE affected % rows',removed;
  delete from public.event_informal_assignments where event_id=ev and user_name=who;
  delete from public.event_restaurant_assignments where event_id=ev and user_name=who;
  delete from public.service_sessions where calendar_event_id=ev and user_name=who and source='assigned';
  delete from public.event_participants where event_id=ev and user_name=who;
  get diagnostics removed=row_count;
  raise notice 'Participant DELETE affected % rows',removed;
  execute 'reset role';
  if exists(select 1 from public.event_participants where event_id=ev and user_name=who)
    or not exists(select 1 from public.event_card_assignments where event_id=ev and user_name=who) then
    raise exception 'Expected legacy orphan was not reproduced; reassess this diagnostic';
  end if;
  raise notice 'REPRODUCED: participant removed but team assignment survives';
end $$;
rollback;
