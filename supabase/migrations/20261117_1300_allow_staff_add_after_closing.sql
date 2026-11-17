-- Closing stops self applications, not authorized staff adding late arrivals/guests.
-- Preserve the parent lock, management permission, identity, revision and cart checks.
do $$
declare definition text; gate text:=$gate$    if not coalesce(e.allow_applications,true) then
      return jsonb_build_object('ok',false,'reason','applications_closed');
    end if;
$gate$;
begin
  definition:=pg_get_functiondef('public.manage_event_participant_versioned_tx(uuid,integer,text,text,bigint,text)'::regprocedure);
  if position(gate in definition)=0
    or position('private.user_can_manage_event(actor,p_event_id)' in definition)=0
    or position('cart_application_exists' in definition)=0 then
    raise exception 'Unexpected participant function; review before changing closing policy';
  end if;
  execute replace(definition,gate,'');
end $$;
notify pgrst,'reload schema';
