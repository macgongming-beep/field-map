-- Preserve the existing cart recipients and repeated cart settings alongside group service.
do $$
declare definition text; needle text;
begin
  definition:=pg_get_functiondef('private.service_event_notify(jsonb,integer[],integer,integer[])'::regprocedure);
  needle:='union select unnest(public.user_ids_in_name_list(e.leader_name))';
  if position(needle in definition)=0 then raise exception 'Unexpected notify definition'; end if;
  execute replace(definition,needle,'union select ca.user_id from public.event_cart_applications ca where ca.event_id=any(v_changed) '||needle);

  definition:=pg_get_functiondef('public.update_calendar_event_series_tx(uuid,uuid,date,jsonb,boolean)'::regprocedure);
  needle:='v_result:=public.update_calendar_event_series_tx_impl_20260907(p_token,p_series_id,p_from_date,p_payload,false);';
  if position(needle in definition)=0 then raise exception 'Unexpected series definition'; end if;
  execute replace(definition,needle,needle||$patch$
  if p_payload ? 'allow_cart_applications' or p_payload ? 'cart_capacity' then
    update public.calendar_events e set
      allow_cart_applications=case when p_payload ? 'allow_cart_applications' then (p_payload->>'allow_cart_applications')::boolean else e.allow_cart_applications end,
      cart_capacity=case when p_payload ? 'cart_capacity' then nullif(p_payload->>'cart_capacity','')::integer else e.cart_capacity end
    where e.series_id=p_series_id and e.event_date>=p_from_date;
  end if;
$patch$);
end $$;
notify pgrst, 'reload schema';
