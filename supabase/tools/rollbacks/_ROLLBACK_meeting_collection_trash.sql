-- Purged articles cannot be recovered by this rollback; restore a backup if needed.
drop function public.change_service_meeting_collection(uuid,integer,timestamptz,text);
drop policy meeting_notes_read on public.service_meeting_notes;
create policy meeting_notes_read on public.service_meeting_notes for select to anon, authenticated
using ((select private.request_session_user_id()) is not null and (archived_at is null or (select private.request_is_admin())));
