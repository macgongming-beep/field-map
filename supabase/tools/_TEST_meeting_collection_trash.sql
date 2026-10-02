-- Fixtures only; caller must roll back the transaction.
select set_config('app.suppress_notifications','on',true);
do $$ declare a integer; u integer; l integer; tok uuid; ut uuid; lt uuid; c integer; n integer; ev integer; r jsonb; stamp timestamptz; denied boolean; act text; who uuid;
begin
  insert into public.app_users(name,login_id,pin,role) values('Trash smoke admin','trash-'||gen_random_uuid(),gen_random_uuid()::text,'admin') returning id into a;
  insert into public.app_users(name,login_id,pin,role) values('Trash smoke user','trash-'||gen_random_uuid(),gen_random_uuid()::text,'user') returning id into u;
  insert into public.app_users(name,login_id,pin,role) values('Trash smoke leader','trash-'||gen_random_uuid(),gen_random_uuid()::text,'leader') returning id into l;
  insert into public.auth_sessions(user_id) values(a) returning token into tok;
  insert into public.auth_sessions(user_id) values(u) returning token into ut;
  insert into public.auth_sessions(user_id) values(l) returning token into lt;
  r:=public.save_service_meeting_collection(tok,null,null,'{"name_ko":"Trash fixture","start_date":"2000-01-01","end_date":"2000-01-02"}'); c:=(r->>'id')::integer;
  insert into public.calendar_events(event_date,time,title) values('2026-10-01','10:00','Trash fixture') returning id into ev;
  r:=public.save_service_meeting_note(tok,null,ev,c,null,'{"title_ko":"Keep me","body_ko":"Original body"}'); n:=(r->>'id')::integer;
  select updated_at into stamp from public.service_meeting_collections where id=c;
  foreach who in array array[ut,lt] loop
    foreach act in array array['trash','restore','purge'] loop
      denied:=false;
      begin perform public.change_service_meeting_collection(who,c,stamp,act);
      exception when others then if SQLERRM='관리자만 모임 정리를 수정할 수 있습니다' then denied:=true; else raise; end if; end;
      if not denied then raise exception 'unauthorized % accepted',act; end if;
    end loop;
  end loop;
  denied:=false;
  begin perform public.change_service_meeting_collection(tok,c,stamp,'purge');
  exception when others then if SQLERRM='휴지통의 모음만 처리할 수 있습니다' then denied:=true; else raise; end if; end;
  if not denied then raise exception 'active purge accepted'; end if;
  r:=public.change_service_meeting_collection(tok,c,stamp-interval '1 second','trash');
  if r->>'conflict' <> 'true' then raise exception 'missing conflict'; end if;
  perform public.change_service_meeting_collection(tok,c,stamp,'trash');
  if not exists(select 1 from public.service_meeting_notes where id=n and body_ko='Original body' and archived_at is null) then raise exception 'trash altered body'; end if;
  if not exists(select 1 from public.service_meeting_collections where id=c and archived_at is not null and not home_enabled) then raise exception 'trash failed'; end if;
  perform set_config('test.trash.collection',c::text,true);
  perform set_config('test.trash.note',n::text,true);
  perform set_config('test.trash.admin',tok::text,true);
  perform set_config('test.trash.user',ut::text,true);
  perform set_config('test.trash.event',ev::text,true);
end $$;
set local role anon;
select set_config('request.headers',jsonb_build_object('x-session-token',current_setting('test.trash.user'))::text,true);
do $$ begin
  if exists(select 1 from public.service_meeting_notes where id=current_setting('test.trash.note')::integer) then raise exception 'trashed parent note leaked'; end if;
  if exists(select 1 from public.service_meeting_collections where id=current_setting('test.trash.collection')::integer) then raise exception 'trash leaked'; end if;
end $$;
reset role;
do $$ declare c integer:=current_setting('test.trash.collection')::integer; tok uuid:=current_setting('test.trash.admin')::uuid;
begin
  perform public.change_service_meeting_collection(tok,c,(select updated_at from public.service_meeting_collections where id=c),'restore');
  if not exists(select 1 from public.service_meeting_collections where id=c and archived_at is null and not home_enabled) then raise exception 'restore must be OFF'; end if;
  if not exists(select 1 from public.service_meeting_notes where id=current_setting('test.trash.note')::integer and body_ko='Original body') then raise exception 'restore lost body'; end if;
  perform public.change_service_meeting_collection(tok,c,(select updated_at from public.service_meeting_collections where id=c),'trash');
  perform public.change_service_meeting_collection(tok,c,(select updated_at from public.service_meeting_collections where id=c),'purge');
  if exists(select 1 from public.service_meeting_collections where id=c) or exists(select 1 from public.service_meeting_notes where collection_id=c) then raise exception 'purge failed'; end if;
  if not exists(select 1 from public.calendar_events where id=current_setting('test.trash.event')::integer) then raise exception 'purge deleted event'; end if;
end $$;
