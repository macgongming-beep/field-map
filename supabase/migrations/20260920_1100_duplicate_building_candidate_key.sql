-- 식당 등록과 같은 주소 후보 열쇠로 사람이 선택한 건물만 병합한다.
--
-- 기존 normalize_building_address와 merge_duplicate_buildings_tx는 유지한다.
-- 그래야 이전 앱이 이 마이그레이션 뒤에도 전체 주소가 같은 건물만 자동 병합한다.
-- 전체 주소 표기가 다른 후보는 새 화면에서 관리자가 직접 선택해야 한다.

create or replace function public.merge_selected_duplicate_buildings_tx(
  p_token uuid,
  p_scope_card_id integer default null,
  p_name_overrides jsonb default '{}'::jsonb,
  p_selected_primary_ids integer[] default null,
  p_address_overrides jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id integer;
  v_role text;
  v_primary record;
  v_candidate_ids integer[];
  v_candidate_primary_id integer;
  v_original_buildings jsonb;
  v_selected_address text;
  v_address_audit_ids bigint[] := '{}';
  v_address_audit_id bigint;
  v_result jsonb;
  v_merged_buildings integer := 0;
  v_merged_units integer := 0;
  v_moved_units integer := 0;
  v_moved_histories integer := 0;
  v_conflicts jsonb := '[]'::jsonb;
begin
  v_actor_id := public.verify_session(p_token);
  if v_actor_id is null then
    raise exception '세션이 유효하지 않습니다';
  end if;

  select u.role
    into v_role
  from public.app_users u
  where u.id = v_actor_id;

  if v_role not in ('admin', 'developer') then
    raise exception '권한이 없습니다 (관리자 전용)';
  end if;

  if p_selected_primary_ids is null or cardinality(p_selected_primary_ids) = 0 then
    raise exception '병합할 주소 후보를 먼저 선택하세요';
  end if;

  for v_primary in
    select b.id, b.card_id, b.address
    from public.buildings b
    where b.id = any(p_selected_primary_ids)
      and (p_scope_card_id is null or b.card_id = p_scope_card_id)
    order by b.id
  loop
    select coalesce(array_agg(b.id order by b.id), '{}'::integer[])
      into v_candidate_ids
    from public.buildings b
    where b.card_id = v_primary.card_id
      and private.restaurant_address_key(b.address)
        = private.restaurant_address_key(v_primary.address);

    if cardinality(v_candidate_ids) < 2 then
      continue;
    end if;

    v_candidate_primary_id := v_candidate_ids[1];
    if v_primary.id <> v_candidate_primary_id then
      raise exception '병합 후보의 기준 건물이 올바르지 않습니다 (선택 %, 기준 %)',
        v_primary.id, v_candidate_primary_id;
    end if;

    select coalesce(jsonb_agg(to_jsonb(b) order by b.id), '[]'::jsonb)
      into v_original_buildings
    from public.buildings b
    where b.id = any(v_candidate_ids);

    v_selected_address := btrim(coalesce(p_address_overrides ->> v_primary.id::text, v_primary.address));
    if not exists (
      select 1
      from public.buildings b
      where b.id = any(v_candidate_ids)
        and b.address = v_selected_address
    ) then
      raise exception '남길 주소가 병합 후보에 없습니다 (건물 %)', v_primary.id;
    end if;

    insert into private.duplicate_building_merge_audits (
      actor_id,
      primary_building_id,
      absorbed_building_ids,
      snapshot
    )
    select
      v_actor_id,
      v_primary.id,
      array_remove(v_candidate_ids, v_primary.id),
      jsonb_build_object(
        'kind', 'candidate_address_normalization',
        'cardId', v_primary.card_id,
        'addressKey', private.restaurant_address_key(v_primary.address),
        'buildings', v_original_buildings
      )
    returning id into v_address_audit_id;

    update public.buildings b
    set address = v_selected_address
    where b.id = any(v_candidate_ids)
      and b.address is distinct from v_selected_address;

    -- 카드 하나와 선택한 묶음 하나만 잠가 처리한다. 담당 충돌로 보류되면
    -- 후보 주소를 원래 값으로 복구해 부분 변경을 남기지 않는다.
    v_result := public.merge_duplicate_buildings_tx(
      p_token,
      v_primary.card_id,
      p_name_overrides,
      array[v_primary.id]
    );

    if jsonb_array_length(coalesce(v_result -> 'conflicts', '[]'::jsonb)) > 0 then
      update public.buildings b
      set address = original.address
      from jsonb_to_recordset(v_original_buildings) as original(id integer, address text)
      where b.id = original.id;

      delete from private.duplicate_building_merge_audits
      where id = v_address_audit_id;
    else
      v_address_audit_ids := array_append(v_address_audit_ids, v_address_audit_id);
      v_address_audit_ids := v_address_audit_ids || coalesce(
        array(select jsonb_array_elements_text(coalesce(v_result -> 'auditIds', '[]'::jsonb))::bigint),
        '{}'::bigint[]
      );
    end if;

    v_merged_buildings := v_merged_buildings + coalesce((v_result ->> 'mergedBuildings')::integer, 0);
    v_merged_units := v_merged_units + coalesce((v_result ->> 'mergedUnits')::integer, 0);
    v_moved_units := v_moved_units + coalesce((v_result ->> 'movedUnits')::integer, 0);
    v_moved_histories := v_moved_histories + coalesce((v_result ->> 'movedVisitHistories')::integer, 0);
    v_conflicts := v_conflicts || coalesce(v_result -> 'conflicts', '[]'::jsonb);
  end loop;

  return jsonb_build_object(
    'ok', true,
    'mergedBuildings', v_merged_buildings,
    'mergedUnits', v_merged_units,
    'movedUnits', v_moved_units,
    'movedVisitHistories', v_moved_histories,
    'conflicts', v_conflicts,
    'auditIds', to_jsonb(v_address_audit_ids)
  );
end;
$$;

revoke all on function public.merge_selected_duplicate_buildings_tx(uuid, integer, jsonb, integer[], jsonb) from public;
grant execute on function public.merge_selected_duplicate_buildings_tx(uuid, integer, jsonb, integer[], jsonb) to anon, authenticated;

notify pgrst, 'reload schema';
