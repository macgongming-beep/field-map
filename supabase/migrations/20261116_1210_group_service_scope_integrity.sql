-- Updates must not produce two indistinguishable tabs for one group/time.
create unique index group_service_scope_slot on public.calendar_events(event_date,time,target_groups)
  where group_service_scope;

-- Assignment creates sessions. Protect the derived names as well as the roster.
create policy group_service_scoped_read on public.service_sessions as restrictive for select to public
  using (calendar_event_id is null or public.can_read_group_service_row(calendar_event_id,user_name));
notify pgrst,'reload schema';
