-- An edit-version conflict is a user decision, not a retryable serialization failure.
do $$
declare definition text;
begin
  select pg_get_functiondef('public.save_service_events_tx(uuid,jsonb,uuid,boolean)'::regprocedure) into definition;
  if position('errcode=''40001''' in definition)=0 then
    raise exception 'Expected service-event conflict guard not found';
  end if;
  execute replace(definition,'errcode=''40001''','errcode=''PT409''');
end $$;
notify pgrst,'reload schema';
