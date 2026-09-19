-- 같은 주소의 중복 건물을 합칠 때 같은 호수도 기록과 함께 통합한다.
--
-- 현재 상태 계약:
--   1. 가장 최근 유효 방문 기록이 연결된 세대를 남긴다.
--   2. 방문 기록은 한 건도 버리지 않고 남길 세대로 모두 옮긴다.
--   3. 중국어/식당/용도/메모는 최신 세대의 현재 값을 유지한다.
--   4. 서로 다른 정기방문 담당자, 복수의 진행 중 재방문, 일정 배정이 있는
--      중복 세대는 자동 판단하지 않고 그 주소 전체를 보류한다.
--   5. 변경 전 자료는 private.duplicate_building_merge_audits 에 보존한다.

create table if not exists private.duplicate_building_merge_audits (
  id bigint generated always as identity primary key,
  actor_id integer not null,
  primary_building_id integer not null,
  absorbed_building_ids integer[] not null,
  snapshot jsonb not null,
  created_at timestamptz not null default now()
);

revoke all on table private.duplicate_building_merge_audits from public, anon, authenticated;

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
  v_unit_group record;
  v_new_name text;
  v_keep_unit_id integer;
  v_loser_unit_ids integer[];
  v_keep_regular_id integer;
  v_distinct_regulars integer;
  v_active_returns integer;
  v_assignment_count integer;
  v_blocking_numbers text[];
  v_all_unit_ids integer[];
  v_audit_id bigint;
  v_audit_ids bigint[] := '{}';
  v_merged_buildings integer := 0;
  v_merged_units integer := 0;
  v_moved_units integer := 0;
  v_moved_histories integer := 0;
  v_row_count integer := 0;
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
    )
    select
      g.card_id,
      g.addr,
      g.ids,
      g.ids[1] as primary_id,
      g.ids[2:] as absorbed_ids
    from grouped g
    where p_selected_primary_ids is null or g.ids[1] = any(p_selected_primary_ids)
  loop
    v_blocking_numbers := '{}';

    -- 자동으로 하나를 고르면 현재 담당 업무가 사라질 수 있는 경우만 보류한다.
    for v_unit_group in
      select
        public.normalize_unit_number(u.number) as normalized_number,
        array_agg(u.id order by u.id) as unit_ids
      from public.units u
      where u.building_id = any(v_group.ids)
      group by public.normalize_unit_number(u.number)
      having count(*) > 1
    loop
      select count(distinct rv.visitor_name)
        into v_distinct_regulars
      from public.regular_visits rv
      where rv.unit_id = any(v_unit_group.unit_ids);

      select count(*)
        into v_active_returns
      from public.return_visits rv
      where rv.unit_id = any(v_unit_group.unit_ids)
        and rv.ended_at is null;

      select count(*)
        into v_assignment_count
      from public.event_restaurant_assignments era
      where era.unit_id = any(v_unit_group.unit_ids);

      if v_distinct_regulars > 1 or v_active_returns > 1 or v_assignment_count > 0 then
        v_blocking_numbers := array_append(v_blocking_numbers, v_unit_group.normalized_number);
      end if;
    end loop;

    if cardinality(v_blocking_numbers) > 0 then
      v_conflicts := v_conflicts || jsonb_build_object(
        'primaryId', v_group.primary_id,
        'conflictingNumbers', to_jsonb(v_blocking_numbers),
        'reason', '현재 담당 자료 확인 필요'
      );
      continue;
    end if;

    select coalesce(array_agg(u.id order by u.id), '{}')
      into v_all_unit_ids
    from public.units u
    where u.building_id = any(v_group.ids);

    insert into private.duplicate_building_merge_audits(
      actor_id, primary_building_id, absorbed_building_ids, snapshot
    )
    values (
      v_actor_id,
      v_group.primary_id,
      v_group.absorbed_ids,
      jsonb_build_object(
        'buildings', coalesce((select jsonb_agg(to_jsonb(x)) from public.buildings x where x.id = any(v_group.ids)), '[]'::jsonb),
        'units', coalesce((select jsonb_agg(to_jsonb(x)) from public.units x where x.id = any(v_all_unit_ids)), '[]'::jsonb),
        'visit_histories', coalesce((select jsonb_agg(to_jsonb(x)) from public.visit_histories x where x.unit_id = any(v_all_unit_ids)), '[]'::jsonb),
        'regular_visits', coalesce((select jsonb_agg(to_jsonb(x)) from public.regular_visits x where x.unit_id = any(v_all_unit_ids)), '[]'::jsonb),
        'return_visits', coalesce((select jsonb_agg(to_jsonb(x)) from public.return_visits x where x.unit_id = any(v_all_unit_ids) or x.building_id = any(v_group.ids)), '[]'::jsonb),
        'phone_surveys', coalesce((select jsonb_agg(to_jsonb(x)) from public.phone_surveys x where x.unit_id = any(v_all_unit_ids)), '[]'::jsonb),
        'event_restaurant_assignments', coalesce((select jsonb_agg(to_jsonb(x)) from public.event_restaurant_assignments x where x.unit_id = any(v_all_unit_ids) or x.building_id = any(v_group.ids)), '[]'::jsonb),
        'place_change_requests', coalesce((select jsonb_agg(to_jsonb(x)) from public.place_change_requests x where x.unit_id = any(v_all_unit_ids) or x.building_id = any(v_group.ids)), '[]'::jsonb)
      )
    )
    returning id into v_audit_id;
    v_audit_ids := array_append(v_audit_ids, v_audit_id);

    -- 같은 호수마다 최신 방문 기록의 세대를 남기고 연결 자료를 한곳으로 옮긴다.
    for v_unit_group in
      select
        public.normalize_unit_number(u.number) as normalized_number,
        array_agg(u.id order by u.id) as unit_ids
      from public.units u
      where u.building_id = any(v_group.ids)
      group by public.normalize_unit_number(u.number)
      having count(*) > 1
    loop
      select u.id
        into v_keep_unit_id
      from public.units u
      left join lateral (
        select vh.id, vh.visited_at, vh.created_at
        from public.visit_histories vh
        where vh.unit_id = u.id and vh.invalidated_at is null
        order by vh.visited_at desc, vh.created_at desc nulls last, vh.id desc
        limit 1
      ) latest on true
      where u.id = any(v_unit_group.unit_ids)
      order by
        (latest.id is not null) desc,
        latest.visited_at desc nulls last,
        latest.created_at desc nulls last,
        latest.id desc nulls last,
        (u.building_id = v_group.primary_id) desc,
        u.id desc
      limit 1;

      select coalesce(array_agg(id order by id), '{}')
        into v_loser_unit_ids
      from public.units
      where id = any(v_unit_group.unit_ids) and id <> v_keep_unit_id;

      -- 같은 담당자 행이 여러 개면 가장 최근 등록 한 건만 현재값으로 남긴다.
      select rv.id
        into v_keep_regular_id
      from public.regular_visits rv
      where rv.unit_id = any(v_unit_group.unit_ids)
      order by rv.registered_at desc nulls last, rv.id desc
      limit 1;

      if v_keep_regular_id is not null then
        delete from public.regular_visits
        where unit_id = any(v_unit_group.unit_ids) and id <> v_keep_regular_id;
        update public.regular_visits set unit_id = v_keep_unit_id where id = v_keep_regular_id;
      end if;

      update public.visit_histories
      set unit_id = v_keep_unit_id
      where unit_id = any(v_loser_unit_ids);
      get diagnostics v_row_count = row_count;
      v_moved_histories := v_moved_histories + v_row_count;

      update public.return_visits
      set unit_id = v_keep_unit_id,
          building_id = v_group.primary_id
      where unit_id = any(v_loser_unit_ids);

      update public.phone_surveys
      set unit_id = v_keep_unit_id
      where unit_id = any(v_loser_unit_ids);

      update public.place_change_requests
      set unit_id = v_keep_unit_id,
          building_id = v_group.primary_id
      where unit_id = any(v_loser_unit_ids);

      delete from public.unit_creation_signals where unit_id = any(v_loser_unit_ids);
      delete from public.units where id = any(v_loser_unit_ids);
      v_merged_units := v_merged_units + cardinality(v_loser_unit_ids);

      update public.units
      set building_id = v_group.primary_id
      where id = v_keep_unit_id;

      perform private.recompute_unit_status_from_visits(v_keep_unit_id);
    end loop;

    -- 겹치지 않는 나머지 세대는 기존처럼 기준 건물로 이동한다.
    update public.units
    set building_id = v_group.primary_id
    where building_id = any(v_group.absorbed_ids);
    get diagnostics v_row_count = row_count;
    v_moved_units := v_moved_units + v_row_count;

    -- 건물 단위 연결도 삭제 전에 기준 건물로 옮긴다.
    delete from public.event_restaurant_assignments old
    using public.event_restaurant_assignments keep
    where old.building_id = any(v_group.absorbed_ids)
      and old.unit_id is null
      and keep.building_id = v_group.primary_id
      and keep.unit_id is null
      and keep.event_id = old.event_id
      and keep.user_name = old.user_name;

    update public.event_restaurant_assignments
    set building_id = v_group.primary_id
    where building_id = any(v_group.absorbed_ids);

    update public.return_visits
    set building_id = v_group.primary_id
    where building_id = any(v_group.absorbed_ids);

    update public.place_change_requests
    set building_id = v_group.primary_id
    where building_id = any(v_group.absorbed_ids);

    update public.restaurant_requests
    set building_id = v_group.primary_id
    where building_id = any(v_group.absorbed_ids);

    update public.building_access_events
    set building_id = v_group.primary_id
    where building_id = any(v_group.absorbed_ids);

    update public.unit_creation_signals
    set building_id = v_group.primary_id
    where building_id = any(v_group.absorbed_ids);

    v_new_name := p_name_overrides ->> v_group.primary_id::text;
    if v_new_name is not null and length(btrim(v_new_name)) > 0 then
      update public.buildings
      set name = btrim(v_new_name)
      where id = v_group.primary_id and name is distinct from btrim(v_new_name);
    end if;

    if exists (select 1 from public.units where building_id = any(v_group.absorbed_ids)) then
      raise exception '세대가 남은 채로 건물을 지우려 했습니다 (건물 %) — 중단합니다', v_group.absorbed_ids;
    end if;

    delete from public.buildings where id = any(v_group.absorbed_ids);
    v_merged_buildings := v_merged_buildings + cardinality(v_group.absorbed_ids);
  end loop;

  return jsonb_build_object(
    'ok', true,
    'mergedBuildings', v_merged_buildings,
    'mergedUnits', v_merged_units,
    'movedUnits', v_moved_units,
    'movedVisitHistories', v_moved_histories,
    'conflicts', v_conflicts,
    'auditIds', to_jsonb(v_audit_ids)
  );
end;
$$;

comment on function public.merge_duplicate_buildings_tx is
  '중복 주소 건물과 같은 호수를 최신 방문 기준으로 통합한다. 기록은 이전하고 현재 담당 충돌은 보류하며 변경 전 스냅샷을 보존한다.';

revoke all on function public.merge_duplicate_buildings_tx(uuid, integer, jsonb, integer[]) from public;
grant execute on function public.merge_duplicate_buildings_tx(uuid, integer, jsonb, integer[]) to anon, authenticated;

notify pgrst, 'reload schema';
