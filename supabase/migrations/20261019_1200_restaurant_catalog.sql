-- Read-only catalog. The caller must deliberately search or choose a region/all.
create function public.browse_restaurants(
  p_token uuid, p_search text default '', p_region text default null,
  p_area text default null, p_after_building integer default 0,
  p_after_unit integer default 0, p_all boolean default false
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_search text := regexp_replace(lower(coalesce(p_search, '')), '[[:space:]]+', '', 'g');
begin
  if public.verify_session(p_token) is null then
    raise exception 'Login required' using errcode = '42501';
  end if;
  if length(coalesce(p_search, '')) > 200 or p_after_building < 0 or p_after_unit < 0 then
    raise exception 'Invalid catalog query' using errcode = '22023';
  end if;
  if v_search = '' and p_region is null and not coalesce(p_all, false) then
    return '[]'::jsonb;
  end if;
  return (
    with restaurants as (
      select b.id as building_id, u.id as unit_id, b.card_id,
        coalesce(nullif(u.number, ''), nullif(b.name, ''), b.address, '') as name,
        coalesce(b.address, '') as address, coalesce(nullif(c.region, ''), '기타') as region,
        coalesce(c.area, '') as area
      from public.buildings b join public.cards c on c.id = b.card_id
      join public.units u on u.building_id = b.id and u.is_restaurant = true
      union all
      select b.id, null::integer, b.card_id, coalesce(nullif(b.name, ''), b.address, ''),
        coalesce(b.address, ''), coalesce(nullif(c.region, ''), '기타'), coalesce(c.area, '')
      from public.buildings b join public.cards c on c.id = b.card_id
      where b.is_restaurant = true and not exists (
        select 1 from public.units u where u.building_id = b.id and u.is_restaurant = true
      )
    ), page as (
      select * from restaurants r
      where (r.building_id, coalesce(r.unit_id, 0)) > (p_after_building, p_after_unit)
        and (p_region is null or r.region = p_region)
        and (p_area is null or r.area = p_area)
        and (v_search = '' or strpos(regexp_replace(lower(r.name || r.address), '[[:space:]]+', '', 'g'), v_search) > 0)
      order by r.building_id, coalesce(r.unit_id, 0) limit 21
    ) select coalesce(jsonb_agg(page order by building_id, coalesce(unit_id, 0)), '[]'::jsonb) from page
  );
end $$;
revoke all on function public.browse_restaurants(uuid,text,text,text,integer,integer,boolean) from public, anon, authenticated;
grant execute on function public.browse_restaurants(uuid,text,text,text,integer,integer,boolean) to anon, authenticated;
notify pgrst, 'reload schema';
