-- Read the complete series on explicit edit, independent of the calendar's month window.
create function public.read_service_series_edit_targets(p_token uuid,p_roots jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor integer; r jsonb; root public.calendar_events; e public.calendar_events;
  result jsonb:='[]'; ids integer[]:='{}'; access jsonb;
begin
  actor:=public.verify_session(p_token);
  if not exists(select 1 from public.app_users where id=actor and is_active and approval_status='approved'
    and role in('admin','developer')) then raise exception 'Administrator required' using errcode='42501'; end if;
  if jsonb_typeof(p_roots) is distinct from 'array' or jsonb_array_length(p_roots) not between 1 and 200
    then raise exception 'Invalid roots'; end if;
  for r in select value from jsonb_array_elements(p_roots) loop
    select * into root from public.calendar_events where id=(r->>'id')::integer;
    if not found then raise exception 'Event not found' using errcode='PT409'; end if;
    if r->>'version' is null or (r->>'version')::bigint is distinct from root.edit_version
      then raise exception 'Event changed' using errcode='PT409'; end if;
    -- A legacy mixed-group series must not widen a scoped group's edit privileges.
    if root.series_id is not null and exists(select 1 from public.calendar_events c
      where c.series_id=root.series_id and c.event_date>=root.event_date
      and (c.service_kind is distinct from root.service_kind or c.target_groups is distinct from root.target_groups
        or c.group_service_scope is distinct from root.group_service_scope))
      then raise exception 'Mixed service series'; end if;
    if root.series_id is not null and exists(select 1 from public.calendar_events c
      where c.series_id=root.series_id and c.event_date>=root.event_date group by c.event_date having count(*)>1)
      then raise exception 'Multiple time slots in one series'; end if;
    for e in select * from public.calendar_events c where c.id=root.id
      or (root.series_id is not null and c.series_id=root.series_id and c.event_date>=root.event_date)
      order by c.event_date,c.id loop
      if e.id=any(ids) then raise exception 'Overlapping series'; end if;
      ids:=array_append(ids,e.id);
      if cardinality(ids)>200 then raise exception 'Too many events'; end if;
      select jsonb_build_object('joinUrl',join_url,'meetingNumber',meeting_number,'passcode',passcode)
        into access from public.event_meeting_access where event_id=e.id;
      result:=result||jsonb_build_array(jsonb_build_object('rootId',root.id,'id',e.id,'version',e.edit_version::text,
        'payload',jsonb_build_object('event_date',e.event_date,'time',e.time,'end_time',coalesce(e.end_time,''),
          'title',e.title,'place',coalesce(e.place,''),'leader_name',coalesce(e.leader_name,''),'memo',coalesce(e.memo,''),
          'meeting_map_url',coalesce(e.meeting_map_url,''),'allow_applications',coalesce(e.allow_applications,true),
          'service_kind',e.service_kind,'target_groups',e.target_groups,'primary_leader_user_id',e.primary_leader_user_id,
          'meeting_mode',e.meeting_mode,'group_service_scope',e.group_service_scope,
          'access',coalesce(access,'{"joinUrl":"","meetingNumber":"","passcode":""}'::jsonb))));
    end loop;
  end loop;
  return result;
end $$;
revoke all on function public.read_service_series_edit_targets(uuid,jsonb) from public;
grant execute on function public.read_service_series_edit_targets(uuid,jsonb) to anon,authenticated;
notify pgrst,'reload schema';
