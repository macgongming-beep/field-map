-- Run after the migration in one transaction, then ROLLBACK. Test DB only.
select set_config('app.suppress_notifications','on',true);
do $$
declare admin_id integer; member_id integer; tok uuid; member_tok uuid; ev integer; ev2 integer; series uuid; c integer; n integer; r jsonb; stamp timestamptz; before_special integer; before_notifications integer;
begin
  select count(*) into before_special from public.special_periods;
  insert into public.app_users(name,login_id,pin,role) values('Meeting smoke admin','meeting-smoke-'||gen_random_uuid(),gen_random_uuid()::text,'admin') returning id into admin_id;
  insert into public.app_users(name,login_id,pin,role) values('Meeting smoke member','meeting-smoke-'||gen_random_uuid(),gen_random_uuid()::text,'user') returning id into member_id;
  insert into public.auth_sessions(user_id) values(admin_id) returning token into tok;
  insert into public.auth_sessions(user_id) values(member_id) returning token into member_tok;
  perform set_config('test.meeting.admin_token',tok::text,true);
  perform set_config('test.meeting.member_token',member_tok::text,true);
  r := public.save_service_meeting_collection(tok,null,null,'{"name_ko":"모임 시험","start_date":"2026-10-01","end_date":"2026-10-05"}');
  c := (r->>'id')::integer;
  if (select home_visible_until from public.service_meeting_collections where id=c) <> '2026-10-19'::date then raise exception 'display default'; end if;
  if (select count(*) from public.special_periods) <> before_special then raise exception 'special periods changed'; end if;
  insert into public.calendar_events(event_date,time,title,place,leader_name,series_id) values('2026-10-01','10:00','Meeting smoke','Original','Meeting smoke admin',gen_random_uuid()) returning id into ev;
  select count(*) into before_notifications from public.notifications;
  perform set_config('app.suppress_notifications','off',true);
  r := public.save_service_meeting_note(tok,null,ev,c,null,'{"title_ko":"글 제목","body_ko":"## 제목\n\n본문","body_zh":"","author_user_id":999999}');
  if (select count(*) from public.notifications) <> before_notifications then raise exception 'note sent notifications'; end if;
  perform set_config('app.suppress_notifications','on',true);
  n := (r->>'id')::integer;
  if (select author_user_id from public.service_meeting_notes where id=n) <> admin_id then raise exception 'author'; end if;
  select updated_at into stamp from public.service_meeting_notes where id=n;
  r := public.save_service_meeting_note(tok,n,ev,c,stamp - interval '1 second','{"title_ko":"덮어씀","body_ko":"본문"}');
  if r->>'conflict' <> 'true' or (select title_ko from public.service_meeting_notes where id=n) <> '글 제목' then raise exception 'conflict overwritten'; end if;
  r := public.save_service_meeting_note(tok,null,ev,c,null,'{"title_ko":"중복","body_ko":"본문"}');
  if r->>'conflict' <> 'true' then raise exception 'duplicate event'; end if;
  select series_id into series from public.calendar_events where id=ev;
  insert into public.calendar_events(event_date,time,title,place,leader_name,series_id) values('2026-10-02','10:00','Meeting smoke 2','Original','Meeting smoke admin',series) returning id into ev2;
  perform public.save_service_meeting_note(tok,null,ev2,c,null,'{"title_ko":"다음 모임","body_ko":"다음 본문"}');
  perform public.update_calendar_event_series_tx(tok,series,'2026-10-01','{"time":"11:00","place":"Final place"}',false);
  if (select event_time_snapshot from public.service_meeting_notes where id=n) <> '11:00' then raise exception 'update snapshot'; end if;
  if (select event_time_snapshot from public.service_meeting_notes where event_id=ev2) <> '11:00' then raise exception 'series snapshot'; end if;
  delete from public.calendar_events where series_id=series;
  if not exists(select 1 from public.service_meeting_notes where id=n and event_id is null and event_place_snapshot='Final place' and body_ko like '%본문%') then raise exception 'delete lost note'; end if;
  if (select count(*) from public.service_meeting_notes where collection_id=c and event_id is null) <> 2 then raise exception 'series delete lost notes'; end if;
  perform public.rename_user_name_references(tok,'Meeting smoke admin','Meeting renamed');
  if (select event_leader_snapshot from public.service_meeting_notes where id=n) <> 'Meeting renamed' then raise exception 'orphan rename'; end if;
  select updated_at into stamp from public.service_meeting_notes where id=n;
  perform public.save_service_meeting_note(tok,n,null,c,stamp,'{"title_ko":"글 제목","body_ko":"보관 본문","archive":true}');
  perform public.rename_user_name_references(tok,'Meeting renamed','Meeting final');
  if (select event_leader_snapshot from public.service_meeting_notes where id=n) <> 'Meeting final' then raise exception 'archived rename'; end if;
  delete from public.app_users where id=admin_id;
  if not exists(select 1 from public.service_meeting_notes where id=n and author_user_id is null and event_leader_snapshot='Meeting final') then raise exception 'user deletion lost note'; end if;
  perform set_config('test.meeting.collection',c::text,true);
  perform set_config('test.meeting.archived_note',n::text,true);
end $$;

set local role anon;
select set_config('request.headers','{}',true);
do $$ begin
  if exists(select 1 from public.service_meeting_notes) or exists(select 1 from public.service_meeting_collections) then raise exception 'anonymous read leaked'; end if;
  begin
    perform public.save_service_meeting_collection(null,null,null,'{}');
    raise exception 'unauthenticated write accepted';
  exception when others then
    if SQLERRM='unauthenticated write accepted' then raise; end if;
  end;
  begin
    perform public.save_service_meeting_collection(current_setting('test.meeting.member_token')::uuid,null,null,'{"name_ko":"Denied","start_date":"2026-10-01","end_date":"2026-10-05"}');
    raise exception 'member write accepted';
  exception when others then
    if SQLERRM <> '관리자만 모임 정리를 수정할 수 있습니다' then raise; end if;
  end;
  begin
    delete from public.service_meeting_notes;
    raise exception 'direct delete accepted';
  exception when insufficient_privilege then null; end;
end $$;
select set_config('request.headers',jsonb_build_object('x-session-token',current_setting('test.meeting.member_token'))::text,true);
do $$ begin
  if not exists(select 1 from public.service_meeting_collections where id=current_setting('test.meeting.collection')::integer) then raise exception 'member cannot read'; end if;
  if exists(select 1 from public.service_meeting_notes where id=current_setting('test.meeting.archived_note')::integer) then raise exception 'archived note leaked'; end if;
  if not exists(select 1 from public.service_meeting_notes where collection_id=current_setting('test.meeting.collection')::integer) then raise exception 'member cannot read note'; end if;
end $$;
reset role;
