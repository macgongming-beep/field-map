-- Export notes/collections before rollback. This removes the feature's data.
do $$ begin
  if to_regprocedure('private.rename_user_name_references(uuid,text,text)') is null then
    raise exception 'Meeting notes rename wrapper is not installed; rollback stopped';
  end if;
end $$;
drop function public.rename_user_name_references(uuid,text,text);
alter function private.rename_user_name_references(uuid,text,text) set schema public;
grant execute on function public.rename_user_name_references(uuid,text,text) to anon, authenticated;
drop trigger snapshot_service_meeting_event_delete on public.calendar_events;
drop trigger snapshot_service_meeting_event_update on public.calendar_events;
drop function public.snapshot_service_meeting_event();
drop function public.save_service_meeting_note(uuid,integer,integer,integer,timestamptz,jsonb);
drop function public.save_service_meeting_collection(uuid,integer,timestamptz,jsonb);
drop table public.service_meeting_notes;
drop table public.service_meeting_collections;
