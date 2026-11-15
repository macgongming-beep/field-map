-- Demo only. Deploy the previous app first; this removes application-kind metadata.
drop function public.apply_service_activity_tx(uuid,integer,text);
drop trigger guard_service_application_activity on public.event_participants;
drop function private.guard_service_application_activity();
do $$ declare tab text; begin
  foreach tab in array array['event_card_assignments','event_card_assignment_cards','event_informal_assignments','event_restaurant_assignments'] loop
    execute format('drop trigger guard_return_visit_assignment on public.%I',tab);
  end loop;
end $$;
drop function private.guard_return_visit_assignment();
alter table public.event_participants drop column service_activity;
notify pgrst,'reload schema';
