-- Resolve the caller's return-visit cards without downloading all buildings.
-- Invoker rights retain existing SELECT/RLS rules; no caller-supplied user name.
create or replace function public.get_recipient_return_visit_card_ids(p_token uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_actor integer;
  v_name text;
  -- JavaScript \s, used by normalizeVisitorName/buildingAddressKey.
  v_ws text := U&'[\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF]+';
  v_address_pattern text;
begin
  v_actor := public.verify_session(p_token);
  select regexp_replace(u.name, v_ws, '', 'g') into v_name
    from public.app_users u where u.id = v_actor;
  if v_actor is null or coalesce(v_name, '') = '' then
    raise exception 'Login required' using errcode = '42501';
  end if;
  v_address_pattern := '([가-힣A-Za-z0-9]+(?:로|길)[0-9]*(?:번길)?' || replace(v_ws, '+', '*') || '[0-9]+(?:-[0-9]+)?)';
  return (
    with own_visits as (
      select rv.* from public.return_visits rv
      where rv.ended_at is null and coalesce(
        nullif(regexp_replace(coalesce(rv.assigned_user_name, ''), v_ws, '', 'g'), ''),
        regexp_replace(coalesce(rv.created_by, ''), v_ws, '', 'g')) = v_name
    ), linked as (
      select rv.id, rv.address, coalesce(direct.card_id, moved.card_id) as card_id
      from own_visits rv
      left join public.buildings direct on direct.id = rv.building_id
      left join public.units u on direct.id is null and u.id = rv.unit_id
      left join public.buildings moved on moved.id = u.building_id
    ), unresolved as (
      select regexp_replace(lower(coalesce((regexp_match(address, v_address_pattern))[1], address, '')), v_ws, '', 'g') as address_key
      from linked where card_id is null
    ), address_matches as (
      -- Include ALL matching cards. A partial cache must not turn an ambiguous address
      -- into a unique match in findReturnVisitBuilding on the client.
      select b.card_id from public.buildings b where exists (
        select 1 from unresolved rv where rv.address_key <> '' and rv.address_key =
          regexp_replace(lower(coalesce((regexp_match(b.address, v_address_pattern))[1], b.address, '')), v_ws, '', 'g')
      )
    ), candidates as (
      select b.card_id from public.regular_visits rv
        join public.units u on u.id = rv.unit_id
        join public.buildings b on b.id = u.building_id
        where regexp_replace(coalesce(rv.visitor_name, ''), v_ws, '', 'g') = v_name
      union select card_id from linked where card_id is not null
      union select card_id from address_matches
    )
    select coalesce(jsonb_agg(card_id order by card_id), '[]'::jsonb)
      from candidates where card_id is not null
  );
end $$;
revoke all on function public.get_recipient_return_visit_card_ids(uuid) from public, anon, authenticated;
grant execute on function public.get_recipient_return_visit_card_ids(uuid) to anon, authenticated;
notify pgrst, 'reload schema';
