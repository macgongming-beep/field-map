-- New independent group events only. Legacy combined events are not converted.
alter table public.calendar_events add column group_service_scope boolean not null default false;
alter table public.calendar_events add constraint group_service_scope_single_group
  check (not group_service_scope or (service_kind='group' and cardinality(target_groups)=1));

create table private.service_group_supervisors (
  group_code text primary key references public.service_groups(code),
  user_id integer not null unique references public.app_users(id) on delete cascade
);
revoke all on private.service_group_supervisors from public,anon,authenticated;

create or replace function private.user_can_manage_event(p_user_id integer,p_event_id integer)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.app_users u join public.calendar_events e on e.id=p_event_id
    where u.id=p_user_id and coalesce(u.is_active,true) and coalesce(u.approval_status,'approved')='approved'
      and (u.role in ('admin','developer') or (u.role='leader' and case when e.group_service_scope then
        exists(select 1 from private.service_group_supervisors s where s.user_id=u.id and s.group_code=any(e.target_groups))
      else u.name=any(select btrim(v) from unnest(string_to_array(coalesce(e.leader_name,''),',')) v) end)));
$$;
revoke all on function private.user_can_manage_event(integer,integer) from public,anon,authenticated;

-- Supervisors see their managed group; members see their home group. A person's
-- own row stays readable/cancellable even when applying to another group.
create function public.can_read_group_service_row(p_event_id integer,p_user_name text default null)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.calendar_events e where e.id=p_event_id and
    (not e.group_service_scope or exists(select 1 from public.app_users u
      where u.id=(select private.request_session_user_id()) and coalesce(u.is_active,true)
        and coalesce(u.approval_status,'approved')='approved' and (
          u.name=p_user_name or private.user_can_manage_event(u.id,e.id) or (
            not exists(select 1 from private.service_group_supervisors s where s.user_id=u.id)
            and exists(select 1 from public.service_groups g where g.code=any(e.target_groups)
              and u.group_name in (g.code,g.label_ko,g.label_zh,g.legacy_name))
          )
        ))));
$$;
revoke all on function public.can_read_group_service_row(integer,text) from public;
grant execute on function public.can_read_group_service_row(integer,text) to anon,authenticated;

do $$ declare tab text; begin
  foreach tab in array array['event_participants','event_card_assignments','event_card_assignment_cards','event_informal_assignments','event_restaurant_assignments'] loop
    execute format('create policy group_service_scoped_read on public.%I as restrictive for select to public using (public.can_read_group_service_row(event_id,user_name))',tab);
  end loop;
end $$;

-- Do not let an event editor remove its scope and restore the old leader policy.
create function private.guard_group_service_scope() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if old.group_service_scope and (not new.group_service_scope or new.target_groups is distinct from old.target_groups
    or new.service_kind is distinct from old.service_kind) then
    raise exception 'Group ownership cannot be changed' using errcode='42501';
  end if;
  return new;
end $$;
revoke all on function private.guard_group_service_scope() from public,anon,authenticated;
create trigger guard_group_service_scope before update on public.calendar_events
  for each row execute function private.guard_group_service_scope();

-- Add the creation flag without changing idempotency, version checks or notices.
do $$ declare def text; begin
  def:=pg_get_functiondef('public.save_service_events_tx(uuid,jsonb,uuid,boolean)'::regprocedure);
  if position('meeting_mode,series_id)' in def)=0 or position('nullif(p->>''series_id'','''')::uuid)' in def)=0 then
    raise exception 'Unexpected save_service_events_tx definition';
  end if;
  def:=replace(def,'meeting_mode,series_id)','meeting_mode,series_id,group_service_scope)');
  def:=replace(def,'nullif(p->>''series_id'','''')::uuid)','nullif(p->>''series_id'','''')::uuid,coalesce((p->>''group_service_scope'')::boolean,false))');
  execute def;
end $$;

create function public.get_group_service_context(p_event_id integer) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare actor integer; e public.calendar_events; own_group text; result jsonb;
begin
  actor:=private.request_session_user_id();
  if not exists(select 1 from public.app_users where id=actor and coalesce(is_active,true)
    and coalesce(approval_status,'approved')='approved') then raise exception 'Approved session required' using errcode='42501'; end if;
  select * into e from public.calendar_events where id=p_event_id and group_service_scope;
  if not found then raise exception 'Group event not found'; end if;
  select group_code into own_group from private.service_group_supervisors where user_id=actor;
  if own_group is null then
    select g.code into own_group from public.service_groups g join public.app_users u
      on u.group_name in (g.code,g.label_ko,g.label_zh,g.legacy_name) where u.id=actor;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'groupCode',c.target_groups[1],
    'canManage',private.user_can_manage_event(actor,c.id),'canRead',public.can_read_group_service_row(c.id,null),
    'count',(select count(*) from public.event_participants where event_id=c.id)) order by c.id),'[]') into result
    from public.calendar_events c where c.group_service_scope and c.event_date=e.event_date
      and c.time=e.time and c.end_time is not distinct from e.end_time;
  return jsonb_build_object('ownGroup',own_group,'events',result);
end $$;
revoke all on function public.get_group_service_context(integer) from public;
grant execute on function public.get_group_service_context(integer) to anon,authenticated;
notify pgrst,'reload schema';
