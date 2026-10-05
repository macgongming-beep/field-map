-- Explicit card IDs only. Invoker rights preserve the caller's SELECT/RLS scope.
-- No addresses, coordinates, unit numbers, visitor names or notes leave this RPC.
create or replace function public.get_card_summaries(p_token uuid, p_card_ids integer[])
returns jsonb
language plpgsql security invoker
set search_path = ''
as $$
begin
  if public.verify_session(p_token) is null then
    raise exception 'Login required' using errcode = '42501';
  end if;
  if p_card_ids is null or cardinality(p_card_ids) > 200
     or exists (select 1 from unnest(p_card_ids) id where id is null or id <= 0) then
    raise exception 'Expected at most 200 positive card IDs' using errcode = '22023';
  end if;

  return (
    with selected_cards as (
      select c.id, c.name, c.area, c.region, c.status
      from public.cards c where c.id = any(p_card_ids)
    ), real_units as (
      select u.id, u.building_id,
        u.status is distinct from '미방문' and u.status is distinct from '부재' as completed,
        case when coalesce(u.is_restaurant, false) then '상가'
             else coalesce(u.usage_type, b.type) end as usage,
        exists(select 1 from public.regular_visits rv where rv.unit_id = u.id) as regular
      from public.units u
      join public.buildings b on b.id = u.building_id
      join selected_cards c on c.id = b.card_id
      -- Match JavaScript String.trim(), including NBSP and BOM in legacy labels.
      where btrim(u.number, U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF') <> '출입불가'
    ), building_stats as (
      select b.id, b.card_id,
        count(u.id)::integer as units,
        count(u.id) filter (where u.completed)::integer as completed,
        count(u.id) filter (where u.regular)::integer as regular_visits,
        count(u.id) filter (where u.usage = '주택')::integer as house_units,
        count(u.id) filter (where u.usage = '상가')::integer as shop_units,
        count(u.id) filter (where u.usage = '주택' and u.completed)::integer as house_completed,
        count(u.id) filter (where u.usage = '상가' and u.completed)::integer as shop_completed,
        case when count(u.id) = 0 then b.type = '주택' else bool_or(u.usage = '주택') end as has_house,
        case when count(u.id) = 0 then b.type = '상가' else bool_or(u.usage = '상가') end as has_shop
      from public.buildings b
      join selected_cards c on c.id = b.card_id
      left join real_units u on u.building_id = b.id
      group by b.id, b.card_id, b.type
    ), totals as (
      select c.id, c.name, c.area, c.region, c.status,
        count(b.id)::integer as buildings,
        coalesce(sum(b.units), 0)::integer as units,
        coalesce(sum(b.completed), 0)::integer as completed,
        coalesce(sum(b.regular_visits), 0)::integer as "regularVisits",
        coalesce(sum(b.house_units), 0)::integer as "houseUnits",
        coalesce(sum(b.shop_units), 0)::integer as "shopUnits",
        coalesce(sum(b.house_completed), 0)::integer as "houseCompleted",
        coalesce(sum(b.shop_completed), 0)::integer as "shopCompleted",
        count(b.id) filter (where b.has_house)::integer as "houseBuildings",
        count(b.id) filter (where b.has_shop)::integer as "shopBuildings"
      from selected_cards c left join building_stats b on b.card_id = c.id
      group by c.id, c.name, c.area, c.region, c.status
    )
    select coalesce(jsonb_agg(to_jsonb(t) || jsonb_build_object(
      'progress', case when t.units = 0 then 100 else round(100.0 * t.completed / t.units)::integer end
    ) order by t.id), '[]'::jsonb) from totals t
  );
end;
$$;

revoke all on function public.get_card_summaries(uuid,integer[]) from public, anon, authenticated;
grant execute on function public.get_card_summaries(uuid,integer[]) to anon, authenticated;
notify pgrst, 'reload schema';
