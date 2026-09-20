-- PC·모바일의 건물 직접 등록을 한 RPC로 모은다.
--
-- 같은 주소 판정은 식당 등록과 반드시 같아야 한다. 새 정규화 규칙을 만들지 않고
-- private.restaurant_address_key + private.same_building_location 을 그대로 쓴다.
-- 기존 CSV import와 백업 restore는 이번 단계에서 바꾸지 않는다.

create or replace function public.create_building_tx(
  p_token uuid,
  p_card_id integer,
  p_name text,
  p_address text,
  p_type text,
  p_lat double precision,
  p_lng double precision
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id integer;
  v_actor_name text;
  v_address text := btrim(coalesce(p_address, ''));
  v_name text := btrim(coalesce(p_name, ''));
  v_address_key text;
  v_candidate_ids integer[] := '{}';
  v_building_id integer;
begin
  v_actor_id := public.verify_session(p_token);
  if v_actor_id is null then
    raise exception '세션이 유효하지 않습니다';
  end if;

  select name into v_actor_name
  from public.app_users
  where id = v_actor_id
    and approval_status = 'approved'
    and is_active = true;
  if v_actor_name is null then
    raise exception '승인된 사용자만 건물을 등록할 수 있습니다';
  end if;

  if v_address = '' then raise exception '주소를 입력해 주세요'; end if;
  if length(v_address) > 500 then raise exception '주소가 너무 깁니다'; end if;
  if length(v_name) > 200 then raise exception '건물 이름이 너무 깁니다'; end if;
  if p_type not in ('주택', '상가') then raise exception '건물 종류가 올바르지 않습니다'; end if;
  if not coalesce(p_lat between -90 and 90 and p_lng between -180 and 180, false) then
    raise exception '좌표가 올바르지 않습니다';
  end if;
  if not exists (select 1 from public.cards where id = p_card_id) then
    raise exception '건물을 추가할 카드를 찾지 못했습니다. 카드를 직접 선택해 주세요';
  end if;

  v_address_key := private.restaurant_address_key(v_address);
  perform pg_advisory_xact_lock(hashtextextended(v_address_key, 9051700));

  select coalesce(array_agg(b.id order by b.id), '{}')
  into v_candidate_ids
  from public.buildings b
  where private.same_building_location(b.address, b.lat, b.lng, v_address, p_lat, p_lng)
    and (
      coalesce(p_lat, 0) <> 0 or coalesce(p_lng, 0) <> 0
      or lower(regexp_replace(btrim(coalesce(b.address, '')), '[[:space:]]', '', 'g'))
        = lower(regexp_replace(v_address, '[[:space:]]', '', 'g'))
    );

  if cardinality(v_candidate_ids) = 1 then
    return jsonb_build_object(
      'ok', true,
      'action', 'existing',
      'building_id', v_candidate_ids[1],
      'candidate_ids', to_jsonb(v_candidate_ids)
    );
  end if;

  if cardinality(v_candidate_ids) > 1 then
    return jsonb_build_object(
      'ok', false,
      'action', 'ambiguous',
      'candidate_ids', to_jsonb(v_candidate_ids)
    );
  end if;

  if v_name = '' then
    v_name := coalesce(
      nullif(substring(v_address from '([가-힣A-Za-z0-9]+(로|길)[0-9]*(번길)?[[:space:]]*[0-9]+(-[0-9]+)?)'), ''),
      v_address
    );
  end if;

  insert into public.buildings (card_id, name, address, type, lat, lng)
  values (p_card_id, v_name, v_address, p_type, p_lat, p_lng)
  returning id into v_building_id;

  insert into public.service_logs(actor_id, actor_name, action, target_type, target_id, details)
  values (
    v_actor_id,
    v_actor_name,
    'building_added',
    'building',
    v_building_id,
    jsonb_build_object(
      'building_name', v_name,
      'address', v_address,
      'card_id', p_card_id,
      'source', 'create_building_tx'
    )
  );

  return jsonb_build_object(
    'ok', true,
    'action', 'created',
    'building_id', v_building_id,
    'candidate_ids', '[]'::jsonb
  );
end;
$$;

revoke all on function public.create_building_tx(uuid,integer,text,text,text,double precision,double precision)
  from public;
grant execute on function public.create_building_tx(uuid,integer,text,text,text,double precision,double precision)
  to anon, authenticated;

notify pgrst, 'reload schema';
