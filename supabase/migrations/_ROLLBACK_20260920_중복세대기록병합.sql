-- 20260920_1000_merge_duplicate_unit_history.sql 롤백
--
-- 새 병합을 중단하고 이전의 보수적인 정책(호수가 겹치면 주소 전체 보류)으로
-- 함수만 되돌린다. 이미 통합된 자료와 감사 스냅샷은 자료 보존을 위해 삭제하지 않는다.

create or replace function public.merge_duplicate_buildings_tx(
  p_token uuid,
  p_scope_card_id integer default null,
  p_name_overrides jsonb default '{}'::jsonb,
  p_selected_primary_ids integer[] default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_id integer;
  v_role text;
  v_group record;
  v_new_name text;
  v_merged integer := 0;
  v_moved integer := 0;
  v_conflicts jsonb := '[]'::jsonb;
begin
  v_actor_id := public.verify_session(p_token);
  if v_actor_id is null then
    raise exception '세션이 유효하지 않습니다';
  end if;

  select role into v_role from public.app_users where id = v_actor_id;
  if v_role not in ('admin', 'developer') then
    raise exception '권한이 없습니다 (관리자 전용)';
  end if;

  perform 1
  from public.buildings b
  where p_scope_card_id is null or b.card_id = p_scope_card_id
  order by b.id
  for update;

  perform 1
  from public.units u
  join public.buildings b on b.id = u.building_id
  where p_scope_card_id is null or b.card_id = p_scope_card_id
  order by u.id
  for update of u;

  for v_group in
    with grouped as (
      select
        b.card_id,
        public.normalize_building_address(b.address) as addr,
        array_agg(b.id order by b.id) as ids
      from public.buildings b
      where p_scope_card_id is null or b.card_id = p_scope_card_id
      group by 1, 2
      having count(*) > 1
    ), picked as (
      select g.*, g.ids[1] as primary_id, g.ids[2:] as absorbed_ids
      from grouped g
      where p_selected_primary_ids is null or g.ids[1] = any(p_selected_primary_ids)
    )
    select
      p.primary_id,
      p.absorbed_ids,
      (
        select coalesce(array_agg(distinct x.number order by x.number), '{}')
        from (
          select u.number, public.normalize_unit_number(u.number) as norm
          from public.units u
          where u.building_id = p.primary_id or u.building_id = any(p.absorbed_ids)
        ) x
        where x.norm in (
          select public.normalize_unit_number(u2.number)
          from public.units u2
          where u2.building_id = p.primary_id or u2.building_id = any(p.absorbed_ids)
          group by public.normalize_unit_number(u2.number)
          having count(distinct u2.building_id) > 1
        )
      ) as conflicting
    from picked p
  loop
    if coalesce(array_length(v_group.conflicting, 1), 0) > 0 then
      v_conflicts := v_conflicts || jsonb_build_object(
        'primaryId', v_group.primary_id,
        'conflictingNumbers', to_jsonb(v_group.conflicting)
      );
      continue;
    end if;

    v_new_name := p_name_overrides ->> v_group.primary_id::text;
    if v_new_name is not null and length(btrim(v_new_name)) > 0 then
      update public.buildings
      set name = btrim(v_new_name)
      where id = v_group.primary_id and name is distinct from btrim(v_new_name);
    end if;

    with moved as (
      update public.units
      set building_id = v_group.primary_id
      where building_id = any(v_group.absorbed_ids)
      returning 1
    )
    select v_moved + count(*) into v_moved from moved;

    if exists (select 1 from public.units where building_id = any(v_group.absorbed_ids)) then
      raise exception '호수가 남은 채로 건물을 지우려 했습니다 (건물 %) — 중단합니다',
        v_group.absorbed_ids;
    end if;

    delete from public.buildings where id = any(v_group.absorbed_ids);
    v_merged := v_merged + coalesce(array_length(v_group.absorbed_ids, 1), 0);
  end loop;

  return jsonb_build_object(
    'ok', true,
    'mergedBuildings', v_merged,
    'movedUnits', v_moved,
    'conflicts', v_conflicts
  );
end;
$$;

comment on function public.merge_duplicate_buildings_tx is
  '중복 주소 건물 병합. 호수가 겹치는 묶음은 건드리지 않는 이전 정책.';

revoke all on function public.merge_duplicate_buildings_tx(uuid, integer, jsonb, integer[]) from public;
grant execute on function public.merge_duplicate_buildings_tx(uuid, integer, jsonb, integer[]) to anon, authenticated;

notify pgrst, 'reload schema';
