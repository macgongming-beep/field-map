-- Run after _TEST_service_meeting_notes.sql in a transaction that is rolled back.
do $$ declare tok uuid; c integer; n integer; r jsonb; oldbody text; olddate date; begin
tok:=current_setting('test.meeting.admin_token')::uuid;
-- The existing smoke test deletes its administrator, so create a transaction-only fixture.
insert into public.app_users(name,login_id,pin,role) values('Visibility smoke','visibility-'||gen_random_uuid(),gen_random_uuid()::text,'admin') returning id into c;
insert into public.auth_sessions(user_id) values(c) returning token into tok;
r:=public.save_service_meeting_collection(tok,null,null,'{"name_ko":"Toggle","start_date":"2026-09-29","end_date":"2026-10-04","home_enabled":false}');c:=(r->>'id')::integer;
if (select home_enabled from public.service_meeting_collections where id=c) then raise exception 'off failed'; end if;
r:=public.save_service_meeting_collection(tok,c,(select updated_at from public.service_meeting_collections where id=c),'{"name_ko":"Toggle","start_date":"2026-09-29","end_date":"2026-10-04","home_enabled":true}');
if not (select home_enabled from public.service_meeting_collections where id=c) then raise exception 'on failed'; end if;
r:=public.save_service_meeting_collection(tok,c,(select updated_at from public.service_meeting_collections where id=c),'{"name_ko":"Toggle","start_date":"2026-09-29","end_date":"2026-10-04","home_enabled":false}');
r:=public.save_service_meeting_collection(tok,c,(select updated_at from public.service_meeting_collections where id=c),'{"name_ko":"Toggle","start_date":"2026-09-29","end_date":"2026-10-04"}');
if (select home_enabled from public.service_meeting_collections where id=c) then raise exception 'legacy save enabled home'; end if;
end $$;
