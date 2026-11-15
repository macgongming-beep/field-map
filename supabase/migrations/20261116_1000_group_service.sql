-- Demo first. Apply only through the project-guarded tool after a backup.
create table public.service_groups (
  code text primary key, label_ko text not null, label_zh text not null, legacy_name text unique not null
);
insert into public.service_groups values
  ('dongtan','동탄','东滩','东滩'), ('singal','신갈','新葛','新葛'),
  ('cheoin','처인','处仁','处仁'), ('dongbaek','동백','东柏','东柏');
alter table public.service_groups enable row level security;
revoke all on public.service_groups from public, anon, authenticated;
grant select on public.service_groups to anon, authenticated;
create policy service_groups_read on public.service_groups for select using (true);

alter table public.calendar_events
  add column service_kind text check (service_kind in ('congregation','group')),
  add column target_groups text[] not null default '{}',
  add column primary_leader_user_id integer references public.app_users(id) on delete set null,
  add column meeting_mode text check (meeting_mode in ('none','in_person','virtual')),
  add column edit_version bigint not null default 1;

create table public.event_meeting_access (
  event_id integer primary key references public.calendar_events(id) on delete cascade,
  join_url text not null default '', meeting_number text not null default '', passcode text not null default ''
);
alter table public.event_meeting_access enable row level security;
revoke all on public.event_meeting_access from public, anon, authenticated;
-- Deliberately no policies and no Realtime publication membership.
create table private.service_event_imports (
  actor_id integer not null, request_id uuid not null, fingerprint text not null, result jsonb not null,
  primary key(actor_id, request_id)
);
revoke all on private.service_event_imports from public, anon, authenticated;

create function private.guard_service_event() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_name text;
begin
  if tg_op='UPDATE' then new.edit_version := old.edit_version + 1;
  else new.edit_version := 1; end if;
  if exists(select 1 from unnest(new.target_groups) g where not exists(select 1 from public.service_groups s where s.code=g))
    or cardinality(new.target_groups) <> (select count(distinct g) from unnest(new.target_groups) g)
    or array_position(new.target_groups,null) is not null then raise exception 'Invalid target groups'; end if;
  select coalesce(array_agg(g order by g),'{}') into new.target_groups from unnest(new.target_groups) g;
  if new.service_kind='group' and cardinality(new.target_groups) not between 1 and 2 then raise exception 'Choose one or two groups'; end if;
  if new.service_kind is distinct from 'group' and cardinality(new.target_groups)<>0 then raise exception 'Only group service has target groups'; end if;
  if new.primary_leader_user_id is not null and (tg_op='INSERT' or new.primary_leader_user_id is distinct from old.primary_leader_user_id or new.leader_name is distinct from old.leader_name) then
    select name into v_name from public.app_users where id=new.primary_leader_user_id
      and coalesce(is_active,true) and coalesce(approval_status,'approved')='approved' and role in ('leader','admin','developer');
    if v_name is null or not (v_name=any(regexp_split_to_array(coalesce(new.leader_name,''),'\s*,\s*'))) then
      raise exception 'Primary leader must be an active approved event leader';
    end if;
  end if;
  return new;
end $$;
revoke all on function private.guard_service_event() from public, anon, authenticated;
create trigger service_event_guard before insert or update on public.calendar_events
for each row execute function private.guard_service_event();

create function public.get_event_meeting_access(p_event_id integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_actor integer; v_result jsonb;
begin
  v_actor := private.request_session_user_id();
  if v_actor is null then raise exception 'Approved session required' using errcode='42501'; end if;
  select jsonb_build_object('joinUrl',a.join_url,'meetingNumber',a.meeting_number,'passcode',a.passcode,'version',e.edit_version::text)
  into v_result from public.calendar_events e left join public.event_meeting_access a on a.event_id=e.id
  where e.id=p_event_id and e.meeting_mode='virtual';
  return v_result;
end $$;
revoke all on function public.get_event_meeting_access(integer) from public;
grant execute on function public.get_event_meeting_access(integer) to anon, authenticated;

create function public.get_event_application_overlaps(p_event_id integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_actor integer; v_name text; v_event public.calendar_events; v_result jsonb;
begin
  v_actor:=private.request_session_user_id();
  if v_actor is null then raise exception 'Approved session required' using errcode='42501'; end if;
  select name into v_name from public.app_users where id=v_actor;
  select * into strict v_event from public.calendar_events where id=p_event_id;
  select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'title',e.title,'date',e.event_date,'time',e.time,'endTime',e.end_time,
    'unknown',not(coalesce(e.time,'') ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' and coalesce(e.end_time,'') ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
      and coalesce(v_event.time,'') ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' and coalesce(v_event.end_time,'') ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')) order by e.time,e.id),'[]')
  into v_result from public.calendar_events e
  where e.id<>p_event_id and e.event_date=v_event.event_date
    and exists(select 1 from public.event_participants p where p.event_id=e.id and p.user_name=v_name)
    and (coalesce(e.time,'') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or coalesce(e.end_time,'') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
      or coalesce(v_event.time,'') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or coalesce(v_event.end_time,'') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
      or (e.time<v_event.end_time and v_event.time<e.end_time));
  return v_result;
end $$;
revoke all on function public.get_event_application_overlaps(integer) from public;
grant execute on function public.get_event_application_overlaps(integer) to anon, authenticated;

create function private.service_event_notify(p_before jsonb, p_ids integer[], p_actor integer, p_access_changed integer[] default '{}') returns void
language plpgsql security definer set search_path = '' as $$
declare v_changed integer[]; v_recipients integer[];
begin
  select array_agg(e.id) into v_changed from public.calendar_events e
  join jsonb_array_elements(p_before) b on (b->>'id')::integer=e.id
  where e.id=any(p_ids) and e.event_date >= (now() at time zone 'Asia/Seoul')::date and (
    e.id=any(p_access_changed) or exists(select 1 from unnest(array['event_date','time','end_time','title','place','leader_name','meeting_map_url','meeting_mode','service_kind','target_groups','primary_leader_user_id','allow_applications']) k
      where nullif(to_jsonb(e)->>k,'') is distinct from nullif(b->>k,'')));
  if coalesce(cardinality(v_changed),0)=0 then return; end if;
  select array_agg(distinct id) into v_recipients from (
    select u.id from public.event_participants p join public.app_users u on u.name=p.user_name where p.event_id=any(v_changed)
    union select unnest(public.user_ids_in_name_list(e.leader_name)) from public.calendar_events e where e.id=any(v_changed)
    union select unnest(public.user_ids_in_name_list(b->>'leader_name')) from jsonb_array_elements(p_before) b where (b->>'id')::integer=any(v_changed)
  ) recipients where id is not null and id is distinct from p_actor;
  v_recipients:=public.filter_notification_recipients(v_recipients,'event_change');
  if coalesce(cardinality(v_recipients),0)>0 then
    perform public.insert_notifications(v_recipients,'event_change','봉사 일정이 변경되었습니다','상세 일정에서 변경 내용을 확인해 주세요.', '/calendar?openEvent='||v_changed[1],v_changed[1]);
    perform public.dispatch_push_notification(v_recipients,'event_change','봉사 일정이 변경되었습니다','상세 일정에서 변경 내용을 확인해 주세요.', '/calendar?openEvent='||v_changed[1],v_changed[1]);
  end if;
end $$;
revoke all on function private.service_event_notify(jsonb,integer[],integer,integer[]) from public, anon, authenticated;

create function private.validate_service_event_input(p jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if length(coalesce(p->>'title','')) not between 1 and 200 then raise exception 'Title required'; end if;
  if coalesce(p->>'time','') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
    or coalesce(p->>'end_time','') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
    or p->>'time'>=p->>'end_time' then raise exception 'Valid start and end times required'; end if;
  if coalesce(p->>'service_kind','') not in ('group','congregation') then raise exception 'Invalid service kind'; end if;
  if coalesce(p->>'meeting_mode','') not in ('none','in_person','virtual') then raise exception 'Invalid meeting mode'; end if;
  if coalesce(p->>'leader_name','')='' or jsonb_typeof(p->'target_groups') is distinct from 'array' then raise exception 'Leader and groups required'; end if;
  if p->>'meeting_mode'='virtual' then
    if coalesce(p#>>'{access,joinUrl}','')='' and coalesce(p#>>'{access,meetingNumber}','')='' then raise exception 'Meeting link or number required'; end if;
    if coalesce(p#>>'{access,joinUrl}','')<>'' and p#>>'{access,joinUrl}' !~ '^https://[^[:space:]]+$' then raise exception 'HTTPS meeting link required'; end if;
    if length(coalesce(p#>>'{access,joinUrl}',''))>2048 or length(coalesce(p#>>'{access,meetingNumber}',''))>100 or length(coalesce(p#>>'{access,passcode}',''))>100 then raise exception 'Meeting access too long'; end if;
  end if;
end $$;
revoke all on function private.validate_service_event_input(jsonb) from public, anon, authenticated;

create function public.save_service_events_tx(p_token uuid,p_rows jsonb,p_request_id uuid,p_notify boolean default true) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_actor integer; v_role text; r jsonb; p jsonb; e public.calendar_events; v_ids integer[]:='{}';
  v_before jsonb:='[]'; v_access integer[]:='{}'; v_id integer; v_existing jsonb; v_hash text; v_old_access jsonb;
  v_suppress text; v_result jsonb; v_is_create boolean;
begin
  v_actor:=public.verify_session(p_token);
  if v_actor is null then raise exception 'Approved session required' using errcode='42501'; end if;
  select role into v_role from public.app_users where id=v_actor;
  if jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows) not between 1 and 200 or p_request_id is null then raise exception 'Invalid batch'; end if;
  perform pg_advisory_xact_lock(hashtextextended('service-events:'||v_actor||':'||p_request_id,0));
  select result,fingerprint into v_existing,v_hash from private.service_event_imports where actor_id=v_actor and request_id=p_request_id;
  if found then
    if v_hash<>md5(p_rows::text) then raise exception 'Request ID already used'; end if;
    return v_existing;
  end if;
  if (select count(*)<>count(distinct (x->>'id')::integer) from jsonb_array_elements(p_rows) x where x->>'id' is not null) then raise exception 'Duplicate event IDs'; end if;
  -- Lock exact IDs in a stable order, then check every version and permission.
  perform 1 from public.calendar_events where id in (select (x->>'id')::integer from jsonb_array_elements(p_rows) x) order by id for update;
  for r in select value from jsonb_array_elements(p_rows) loop
    v_is_create:=r->>'id' is null;
    if v_is_create then
      if v_role not in ('admin','developer') then raise exception 'Administrator required' using errcode='42501'; end if;
    else
      select * into e from public.calendar_events where id=(r->>'id')::integer;
      if not found or not private.user_can_manage_event(v_actor,e.id) then raise exception 'Event permission denied' using errcode='42501'; end if;
      if r->>'version' is null or (r->>'version')::bigint<>e.edit_version then raise exception 'Event changed; reload before saving' using errcode='40001'; end if;
      v_before:=v_before||jsonb_build_array(to_jsonb(e));
    end if;
  end loop;
  v_suppress:=current_setting('app.suppress_notifications',true);
  perform set_config('app.suppress_notifications','on',true);
  for r in select value from jsonb_array_elements(p_rows) loop
    p:=r->'payload';
    perform private.validate_service_event_input(p);
    if r->>'id' is null then
      if nullif(p->>'series_id','') is not null and exists(select 1 from public.calendar_events where series_id=(p->>'series_id')::uuid and time is distinct from p->>'time') then raise exception 'Different time slots require separate series'; end if;
      perform pg_advisory_xact_lock(hashtextextended('service-slot:'||(p->>'event_date'),0));
      if exists(select 1 from public.calendar_events c where c.event_date=(p->>'event_date')::date and c.time=p->>'time'
        and c.service_kind=p->>'service_kind' and c.target_groups @> array(select jsonb_array_elements_text(p->'target_groups'))
        and c.target_groups <@ array(select jsonb_array_elements_text(p->'target_groups'))) then raise exception 'An event already occupies this service slot'; end if;
      insert into public.calendar_events(event_date,time,end_time,title,place,leader_name,memo,has_meeting,allow_applications,meeting_map_url,service_kind,target_groups,primary_leader_user_id,meeting_mode,series_id)
      values ((p->>'event_date')::date,p->>'time',p->>'end_time',p->>'title',coalesce(p->>'place',''),p->>'leader_name',coalesce(p->>'memo',''),p->>'meeting_mode'<>'none',coalesce((p->>'allow_applications')::boolean,true),nullif(p->>'meeting_map_url',''),p->>'service_kind',array(select jsonb_array_elements_text(p->'target_groups')),nullif(p->>'primary_leader_user_id','')::integer,p->>'meeting_mode',nullif(p->>'series_id','')::uuid)
      returning id into v_id;
    else
      v_id:=(r->>'id')::integer;
      update public.calendar_events set event_date=(p->>'event_date')::date,time=p->>'time',end_time=p->>'end_time',title=p->>'title',place=coalesce(p->>'place',''),leader_name=p->>'leader_name',memo=coalesce(p->>'memo',''),has_meeting=p->>'meeting_mode'<>'none',allow_applications=coalesce((p->>'allow_applications')::boolean,true),meeting_map_url=nullif(p->>'meeting_map_url',''),service_kind=p->>'service_kind',target_groups=array(select jsonb_array_elements_text(p->'target_groups')),primary_leader_user_id=nullif(p->>'primary_leader_user_id','')::integer,meeting_mode=p->>'meeting_mode'
      where id=v_id;
    end if;
    select jsonb_build_object('joinUrl',join_url,'meetingNumber',meeting_number,'passcode',passcode) into v_old_access from public.event_meeting_access where event_id=v_id;
    if p->>'meeting_mode'='virtual' then
      if v_old_access is distinct from p->'access' then v_access:=array_append(v_access,v_id); end if;
      insert into public.event_meeting_access values(v_id,coalesce(p#>>'{access,joinUrl}',''),coalesce(p#>>'{access,meetingNumber}',''),coalesce(p#>>'{access,passcode}',''))
      on conflict(event_id) do update set join_url=excluded.join_url,meeting_number=excluded.meeting_number,passcode=excluded.passcode;
    else
      if v_old_access is not null then v_access:=array_append(v_access,v_id); end if;
      delete from public.event_meeting_access where event_id=v_id;
    end if;
    v_ids:=array_append(v_ids,v_id);
  end loop;
  perform set_config('app.suppress_notifications',coalesce(v_suppress,''),true);
  if p_notify then perform private.service_event_notify(v_before,v_ids,v_actor,v_access); end if;
  v_result:=jsonb_build_object('ok',true,'ids',v_ids);
  insert into private.service_event_imports values(v_actor,p_request_id,md5(p_rows::text),v_result);
  return v_result;
end $$;
revoke all on function public.save_service_events_tx(uuid,jsonb,uuid,boolean) from public;
grant execute on function public.save_service_events_tx(uuid,jsonb,uuid,boolean) to anon, authenticated;

-- Cover direct/legacy single updates too, without altering assignment notifications.
create or replace function public.notify_on_calendar_event_change() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if current_setting('app.suppress_notifications',true)='on' then return new; end if;
  perform private.service_event_notify(jsonb_build_array(to_jsonb(old)),array[new.id],nullif(current_setting('app.actor_id',true),'')::integer);
  return new;
end $$;
drop trigger on_calendar_event_update on public.calendar_events;
create trigger on_calendar_event_update after update of event_date,time,end_time,place,meeting_map_url,leader_name,title,meeting_mode,service_kind,target_groups,primary_leader_user_id,allow_applications
on public.calendar_events for each row execute function public.notify_on_calendar_event_change();

create or replace function public.update_calendar_event_series_tx(p_token uuid,p_series_id uuid,p_from_date date,p_payload jsonb,p_notify boolean default true) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_actor integer; v_before jsonb; v_ids integer[]; v_result jsonb;
begin
  v_actor:=public.verify_session(p_token);
  if v_actor is null then raise exception 'Approved session required' using errcode='42501'; end if;
  perform 1 from public.calendar_events where series_id=p_series_id and event_date>=p_from_date order by id for update;
  if exists(select 1 from public.calendar_events e where e.series_id=p_series_id and e.event_date>=p_from_date and not private.user_can_manage_event(v_actor,e.id)) then raise exception 'Event permission denied' using errcode='42501'; end if;
  -- Dated primary assignments cannot be overwritten by a weekly template.
  if p_payload ? 'leader_name' and exists(select 1 from public.calendar_events where series_id=p_series_id and event_date>=p_from_date and primary_leader_user_id is not null and leader_name is distinct from p_payload->>'leader_name') then raise exception 'Edit dated primary leaders one date at a time'; end if;
  select coalesce(jsonb_agg(to_jsonb(e)),'[]'),array_agg(e.id) into v_before,v_ids from public.calendar_events e where series_id=p_series_id and event_date>=p_from_date;
  v_result:=public.update_calendar_event_series_tx_impl_20260907(p_token,p_series_id,p_from_date,p_payload,false);
  if p_notify then perform private.service_event_notify(v_before,v_ids,v_actor); end if;
  return v_result;
end $$;
revoke all on function public.update_calendar_event_series_tx(uuid,uuid,date,jsonb,boolean) from public;
grant execute on function public.update_calendar_event_series_tx(uuid,uuid,date,jsonb,boolean) to anon, authenticated;
notify pgrst,'reload schema';
