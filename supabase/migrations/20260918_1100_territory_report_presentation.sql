-- 구역 관리 보고서 표시 옵션과 구 단위 경계선.
-- 기존 공유 링크와 v1 RPC는 그대로 둔다. 새 화면만 v2 RPC를 사용한다.

create or replace function private.decorate_chinese_territory_report_snapshot(
  p_snapshot jsonb,
  p_period_end date,
  p_include_area_details boolean,
  p_region_boundaries jsonb
)
returns jsonb
language sql stable security definer
set search_path = ''
as $$
with target_units as (
  select
    u.id,
    coalesce(c.region, '미분류') as region,
    lv.visited_at as last_visited_at
  from public.units u
  join public.buildings b on b.id = u.building_id
  left join public.cards c on c.id = b.card_id
  left join lateral (
    select vh.visited_at
    from public.visit_histories vh
    where vh.unit_id = u.id
      and vh.invalidated_at is null
      and vh.visited_at <= p_period_end
    order by vh.visited_at desc, vh.id desc
    limit 1
  ) lv on true
  where u.is_chinese = true
),
region_management as (
  select
    region,
    count(*) filter (where last_visited_at >= p_period_end - 180)::integer as managed_180d
  from target_units
  group by region
),
decorated_regions as (
  select coalesce(jsonb_agg(
    region_row.value || jsonb_build_object(
      'managed180d', coalesce(rm.managed_180d, 0)
    ) order by region_row.ordinality
  ), '[]'::jsonb) as value
  from jsonb_array_elements(coalesce(p_snapshot -> 'regions', '[]'::jsonb))
    with ordinality as region_row(value, ordinality)
  left join region_management rm on rm.region = region_row.value ->> 'region'
)
select p_snapshot || jsonb_build_object(
  'schemaVersion', 3,
  'includeAreaDetails', coalesce(p_include_area_details, false),
  'regionBoundaries', coalesce(p_region_boundaries, '[]'::jsonb),
  'regions', decorated_regions.value,
  'areas', case when coalesce(p_include_area_details, false)
    then coalesce(p_snapshot -> 'areas', '[]'::jsonb)
    else '[]'::jsonb
  end
)
from decorated_regions;
$$;
revoke all on function private.decorate_chinese_territory_report_snapshot(jsonb,date,boolean,jsonb)
  from public, anon, authenticated;

create or replace function private.validate_territory_report_boundaries(p_boundaries jsonb)
returns jsonb
language plpgsql immutable security definer
set search_path = ''
as $$
declare
  v_boundaries jsonb := coalesce(p_boundaries, '[]'::jsonb);
begin
  if jsonb_typeof(v_boundaries) <> 'array'
     or jsonb_array_length(v_boundaries) > 20
     or pg_column_size(v_boundaries) > 500000 then
    raise exception '구역 경계 자료가 올바르지 않습니다' using errcode = '22023';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(v_boundaries) item
    where jsonb_typeof(item -> 'region') is distinct from 'string'
       or jsonb_typeof(item -> 'points') is distinct from 'array'
       or jsonb_array_length(item -> 'points') < 3
       or jsonb_array_length(item -> 'points') > 3000
  ) then
    raise exception '구역 경계 자료가 올바르지 않습니다' using errcode = '22023';
  end if;
  return v_boundaries;
end;
$$;
revoke all on function private.validate_territory_report_boundaries(jsonb)
  from public, anon, authenticated;

create or replace function public.preview_chinese_territory_report_v2_tx(
  p_token uuid,
  p_period_start date,
  p_period_end date,
  p_note text default '',
  p_include_area_details boolean default false,
  p_region_boundaries jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_boundaries jsonb;
begin
  perform private.require_report_admin(p_token);
  if p_period_start is null or p_period_end is null or p_period_start > p_period_end then
    raise exception '보고 기간이 올바르지 않습니다' using errcode = '22023';
  end if;
  if p_period_end - p_period_start > 730 then
    raise exception '보고 기간은 최대 2년입니다' using errcode = '22023';
  end if;
  v_boundaries := private.validate_territory_report_boundaries(p_region_boundaries);
  return private.decorate_chinese_territory_report_snapshot(
    private.build_chinese_territory_report_snapshot(p_period_start, p_period_end, p_note),
    p_period_end,
    p_include_area_details,
    v_boundaries
  );
end;
$$;

create or replace function public.create_chinese_territory_report_share_v2_tx(
  p_token uuid,
  p_period_start date,
  p_period_end date,
  p_expires_at timestamptz,
  p_pin text default null,
  p_note text default '',
  p_include_area_details boolean default false,
  p_region_boundaries jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_actor_id integer;
  v_raw_token text;
  v_row public.territory_report_shares%rowtype;
  v_pin text := nullif(btrim(coalesce(p_pin, '')), '');
  v_boundaries jsonb;
begin
  v_actor_id := private.require_report_admin(p_token);
  if p_period_start is null or p_period_end is null or p_period_start > p_period_end then
    raise exception '보고 기간이 올바르지 않습니다' using errcode = '22023';
  end if;
  if p_period_end - p_period_start > 730 then
    raise exception '보고 기간은 최대 2년입니다' using errcode = '22023';
  end if;
  if p_expires_at is null or p_expires_at <= now() or p_expires_at > now() + interval '90 days' then
    raise exception '공유 만료일은 지금부터 90일 이내여야 합니다' using errcode = '22023';
  end if;
  if v_pin is not null and v_pin !~ '^[0-9]{6}$' then
    raise exception '암호는 숫자 6자리여야 합니다' using errcode = '22023';
  end if;
  v_boundaries := private.validate_territory_report_boundaries(p_region_boundaries);

  v_raw_token := encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.territory_report_shares(
    token_hash, pin_hash, snapshot, expires_at, created_by
  ) values (
    encode(extensions.digest(v_raw_token, 'sha256'), 'hex'),
    case when v_pin is null then null else extensions.crypt(v_pin, extensions.gen_salt('bf')) end,
    private.decorate_chinese_territory_report_snapshot(
      private.build_chinese_territory_report_snapshot(p_period_start, p_period_end, p_note),
      p_period_end,
      p_include_area_details,
      v_boundaries
    ),
    p_expires_at,
    v_actor_id
  ) returning * into v_row;

  return jsonb_build_object(
    'ok', true,
    'id', v_row.id,
    'shareToken', v_raw_token,
    'expiresAt', v_row.expires_at,
    'pinRequired', v_row.pin_hash is not null
  );
end;
$$;

revoke all on function public.preview_chinese_territory_report_v2_tx(uuid,date,date,text,boolean,jsonb) from public;
revoke all on function public.create_chinese_territory_report_share_v2_tx(uuid,date,date,timestamptz,text,text,boolean,jsonb) from public;
grant execute on function public.preview_chinese_territory_report_v2_tx(uuid,date,date,text,boolean,jsonb) to anon, authenticated;
grant execute on function public.create_chinese_territory_report_share_v2_tx(uuid,date,date,timestamptz,text,text,boolean,jsonb) to anon, authenticated;

comment on function public.preview_chinese_territory_report_v2_tx(uuid,date,date,text,boolean,jsonb) is
  '구별 180일 집계, 선택적 동별 상세, 구 단위 합성 경계를 포함한 보고서 미리보기.';
comment on function public.create_chinese_territory_report_share_v2_tx(uuid,date,date,timestamptz,text,text,boolean,jsonb) is
  '표시 옵션과 구 단위 합성 경계를 스냅샷에 고정해 외부 공유 링크를 만든다.';

do $$
declare
  v_def text;
begin
  select pg_get_functiondef(
    'public.create_chinese_territory_report_share_v2_tx(uuid,date,date,timestamptz,text,text,boolean,jsonb)'::regprocedure
  ) into v_def;
  if position('private.require_report_admin' in v_def) = 0
     or position('private.validate_territory_report_boundaries' in v_def) = 0 then
    raise exception 'VERIFY: v2 공유 함수의 권한 또는 경계 검증이 빠졌습니다';
  end if;
  if has_function_privilege(
    'anon',
    'public.create_chinese_territory_report_share_v2_tx(uuid,date,date,timestamptz,text,text,boolean,jsonb)',
    'EXECUTE'
  ) is not true then
    raise exception 'VERIFY: anon 이 v2 공유 RPC를 호출할 수 없습니다';
  end if;
end $$;
