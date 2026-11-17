-- Cart is optional. Do not create a cart feature as a side effect of group rollout.
create function private.service_cart_user_ids(p_event_ids integer[]) returns setof integer
language plpgsql stable security definer set search_path='' as $$
begin
  if to_regclass('public.event_cart_applications') is null then return; end if;
  return query execute 'select distinct user_id from public.event_cart_applications where event_id=any($1)'
    using p_event_ids;
end $$;
revoke all on function private.service_cart_user_ids(integer[]) from public,anon,authenticated;

-- Exact replacements fail closed on an unexpected installed definition.
do $$ declare signature text; definition text; needle text; replacement text; pair text[]; begin
  foreach pair slice 1 in array array[
    array['public.apply_service_activity_tx(uuid,integer,text)',
      'exists(select 1 from public.event_cart_applications where event_id=p_event_id and user_id=actor)',
      'exists(select 1 from private.service_cart_user_ids(array[p_event_id]) c(user_id) where c.user_id=actor)'],
    array['public.manage_event_participant_versioned_tx(uuid,integer,text,text,bigint,text)',
      E'exists(select 1 from public.event_cart_applications ca join public.app_users u on u.id=ca.user_id\n      where ca.event_id=p_event_id and lower(private.normalize_person_name(u.name))=lower(private.normalize_person_name(p_user_name)))',
      E'exists(select 1 from private.service_cart_user_ids(array[p_event_id]) ca(user_id) join public.app_users u on u.id=ca.user_id\n      where lower(private.normalize_person_name(u.name))=lower(private.normalize_person_name(p_user_name)))'],
    array['private.service_event_notify(jsonb,integer[],integer,integer[])',
      'select ca.user_id from public.event_cart_applications ca where ca.event_id=any(v_changed)',
      'select ca.user_id from private.service_cart_user_ids(v_changed) ca(user_id)']
  ] loop
    signature:=pair[1]; needle:=pair[2]; replacement:=pair[3];
    definition:=pg_get_functiondef(signature::regprocedure);
    if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then
      raise exception 'Unexpected cart dependency: %',signature;
    end if;
    execute replace(definition,needle,replacement);
  end loop;
end $$;

-- Generic atomic removal for the short compatibility period. Strict rollout
-- revokes this entry point together with the old team removal entry point.
create function public.remove_service_participant_compat_tx(
  p_token uuid,p_event_id integer,p_user_name text,p_self boolean,p_expected_shared_at text default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor integer; who text; e public.calendar_events; participant_role text;
begin
  actor:=public.verify_session(p_token);
  select name into who from public.app_users where id=actor and is_active and approval_status='approved';
  select * into e from public.calendar_events where id=p_event_id for update;
  if not found or who is null then raise exception 'Approved session required' using errcode='42501'; end if;
  if p_self is null or (p_self and who is distinct from p_user_name)
    or (not p_self and not private.user_can_manage_event(actor,p_event_id)) then
    raise exception 'Participant permission denied' using errcode='42501';
  end if;
  if not p_self and e.assignment_shared_at is distinct from p_expected_shared_at::timestamptz then
    return jsonb_build_object('ok',false,'conflict',true);
  end if;
  select role into participant_role from public.event_participants where event_id=p_event_id and user_name=p_user_name;
  if not found then return jsonb_build_object('ok',true,'changed',false); end if;
  if p_self and participant_role<>'신청' then raise exception 'Participant permission denied' using errcode='42501'; end if;
  -- The existing deletion trigger locks, cleans assignments and ends sessions
  -- in this same transaction. Any failure rolls back all affected rows.
  delete from public.event_participants where event_id=p_event_id and user_name=p_user_name;
  return jsonb_build_object('ok',true,'changed',true);
end $$;
revoke all on function public.remove_service_participant_compat_tx(uuid,integer,text,boolean,text) from public,anon,authenticated;
notify pgrst,'reload schema';
