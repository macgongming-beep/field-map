-- All approved leaders can arrange service; only admins can change schedules.
create or replace function private.user_can_manage_event(p_user_id integer,p_event_id integer)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.app_users u join public.calendar_events e on e.id=p_event_id
    where u.id=p_user_id and u.is_active and u.approval_status='approved'
      and u.role in ('leader','admin','developer'));
$$;
create function private.user_can_edit_event(p_user_id integer,p_event_id integer)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.app_users u join public.calendar_events e on e.id=p_event_id
    where u.id=p_user_id and u.is_active and u.approval_status='approved'
      and u.role in ('admin','developer'));
$$;
revoke all on function private.user_can_edit_event(integer,integer) from public,anon,authenticated;

do $$ declare signature text; definition text; begin
  foreach signature in array array[
    'public.save_service_events_tx(uuid,jsonb,uuid,boolean)',
    'public.update_calendar_event_tx(uuid,integer,jsonb,boolean)',
    'public.update_calendar_event_series_tx(uuid,uuid,date,jsonb,boolean)'
  ] loop
    definition:=pg_get_functiondef(signature::regprocedure);
    if position('private.user_can_manage_event' in definition)=0 then raise exception 'Unexpected schedule function: %',signature; end if;
    execute replace(definition,'private.user_can_manage_event','private.user_can_edit_event');
  end loop;
end $$;

-- Supervisor bindings no longer grant or restrict access; profile group selects the tab.
create or replace function public.can_read_group_service_row(p_event_id integer,p_user_name text default null)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.calendar_events e where e.id=p_event_id and
    (not e.group_service_scope or exists(select 1 from public.app_users u
      where u.id=(select private.request_session_user_id()) and u.is_active and u.approval_status='approved'
        and (u.role in ('leader','admin','developer') or u.name=p_user_name
          or exists(select 1 from public.service_groups g where g.code=any(e.target_groups)
            and u.group_name in (g.code,g.label_ko,g.label_zh,g.legacy_name))))));
$$;

create function public.can_read_group_assignment(p_event_id integer,p_user_name text)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.calendar_events e where e.id=p_event_id and
    (not e.group_service_scope or exists(select 1 from public.app_users u
      where u.id=(select private.request_session_user_id()) and u.is_active and u.approval_status='approved'
        and (u.role in ('leader','admin','developer') or (e.assignment_status='shared' and
          (u.name=p_user_name or exists(
            select 1 from public.event_card_assignments mine
            join public.event_card_assignments peer on peer.event_id=mine.event_id and peer.team_key=mine.team_key
            where mine.event_id=e.id and mine.user_name=u.name and peer.user_name=p_user_name
              and nullif(mine.team_key,'') is not null)))))));
$$;
revoke all on function public.can_read_group_assignment(integer,text) from public;
grant execute on function public.can_read_group_assignment(integer,text) to anon,authenticated;
do $$ declare tab text; begin
  foreach tab in array array['event_card_assignments','event_card_assignment_cards','event_informal_assignments','event_restaurant_assignments'] loop
    execute format('drop policy group_service_scoped_read on public.%I',tab);
    execute format('create policy group_service_scoped_read on public.%I as restrictive for select using(public.can_read_group_assignment(event_id,user_name))',tab);
  end loop;
end $$;

create or replace function public.get_group_service_context(p_event_id integer) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare actor integer; e public.calendar_events; own_group text; result jsonb;
begin
  actor:=private.request_session_user_id();
  if not exists(select 1 from public.app_users where id=actor and is_active and approval_status='approved') then
    raise exception 'Approved session required' using errcode='42501';
  end if;
  select * into e from public.calendar_events where id=p_event_id and group_service_scope;
  if not found then raise exception 'Group event not found'; end if;
  select g.code into own_group from public.service_groups g join public.app_users u
    on u.group_name in (g.code,g.label_ko,g.label_zh,g.legacy_name) where u.id=actor;
  select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'groupCode',c.target_groups[1],
    'canManage',private.user_can_manage_event(actor,c.id),'canEdit',private.user_can_edit_event(actor,c.id),
    'canRead',public.can_read_group_service_row(c.id,null),
    'count',(select count(*) from public.event_participants where event_id=c.id)) order by c.id),'[]') into result
    from public.calendar_events c where c.group_service_scope and c.event_date=e.event_date
      and c.time=e.time and coalesce(c.end_time,'')=coalesce(e.end_time,'');
  return jsonb_build_object('ownGroup',own_group,'events',result);
end $$;
notify pgrst,'reload schema';
