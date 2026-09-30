-- Run before team_informal_assignments, then team_card_scope; single transaction.
drop trigger cleanup_team_participant_removal on public.event_participants;
drop function private.cleanup_team_participant_removal();
drop function public.remove_team_event_participant_tx(uuid,integer,text,boolean,text);
notify pgrst,'reload schema';
