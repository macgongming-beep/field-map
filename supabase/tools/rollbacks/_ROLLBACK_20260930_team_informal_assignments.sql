-- Export assignment_team_informal first. This rollback does not recreate cleared personal assignments.
do $$ declare t text; begin
  foreach t in array array['event_informal_assignments','event_card_assignments','event_card_assignment_cards'] loop
    execute format('drop policy team_service_rpc_insert on public.%I',t);
    execute format('drop policy team_service_rpc_update on public.%I',t);
    execute format('drop policy team_service_rpc_delete on public.%I',t);
  end loop;
end $$;
drop function public.assign_team_service_bulk_tx(uuid,integer,jsonb,text,text);
drop function public.assign_scoped_cards_bulk_tx(uuid,integer,jsonb,text,text);
drop function public.assign_cards_bulk_tx(uuid,integer,jsonb,text,text);
alter function private.assign_scoped_cards_bulk_tx(uuid,integer,jsonb,text,text) set schema public;
alter function private.assign_cards_bulk_tx(uuid,integer,jsonb,text,text) set schema public;
grant execute on function public.assign_scoped_cards_bulk_tx(uuid,integer,jsonb,text,text) to anon,authenticated;
grant execute on function public.assign_cards_bulk_tx(uuid,integer,jsonb,text,text) to anon,authenticated;
alter table public.calendar_events drop column assignment_team_informal;
notify pgrst, 'reload schema';
