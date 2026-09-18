-- 중국어 세대 관리 현황 보고서
-- 외부 공유에는 집계 스냅샷만 저장한다. 주소, 세대 번호, 이름, 전화, 메모,
-- 개별 좌표는 이 표와 공개 RPC에 절대 넣지 않는다.

create table if not exists public.territory_report_shares (
  id uuid primary key default extensions.gen_random_uuid(),
  token_hash text not null unique,
  pin_hash text,
  snapshot jsonb not null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  failed_attempts integer not null default 0 check (failed_attempts >= 0),
  locked_until timestamptz,
  view_count integer not null default 0 check (view_count >= 0),
  last_viewed_at timestamptz,
  created_by integer not null references public.app_users(id),
  created_at timestamptz not null default now(),
  constraint territory_report_shares_snapshot_object
    check (jsonb_typeof(snapshot) = 'object')
);

alter table public.territory_report_shares enable row level security;
revoke all on table public.territory_report_shares from public, anon, authenticated;

create index if not exists territory_report_shares_active_idx
  on public.territory_report_shares(expires_at)
  where revoked_at is null;

create or replace function private.require_report_admin(p_token uuid)
returns integer
language plpgsql security definer
set search_path = ''
as $$
declare
  v_actor_id integer;
  v_role text;
begin
  v_actor_id := public.verify_session(p_token);
  select role into v_role from public.app_users where id = v_actor_id and is_active = true;
  if not coalesce(v_role in ('admin', 'developer'), false) then
    raise exception '보고서를 관리할 권한이 없습니다' using errcode = '42501';
  end if;
  return v_actor_id;
end;
$$;
revoke all on function private.require_report_admin(uuid) from public, anon, authenticated;

create or replace function private.build_chinese_territory_report_snapshot(
  p_period_start date,
  p_period_end date,
  p_note text default ''
)
returns jsonb
language sql stable security definer
set search_path = ''
as $$
with target_units as (
  select
    u.id,
    u.status,
    -- 앱 effectiveUnitUsage와 같은 우선순위: 식당 > 세대 예외 용도 > 건물 기본 용도.
    (coalesce(u.is_restaurant, false) or coalesce(u.usage_type, b.type) = '상가') as is_business,
    b.id as building_id,
    b.card_id,
    b.lat,
    b.lng,
    coalesce(c.region, '미분류') as region,
    coalesce(c.area, '미분류') as area,
    lv.visited_at as last_visited_at,
    exists (
      select 1 from public.regular_visits rv where rv.unit_id = u.id
    ) as is_regular_visit
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
target_buildings as (
  -- 중심점은 세대가 아니라 건물에 한 표씩 준다. 세대가 많은 한 건물이
  -- 외부 지도 중심을 끌어당겨 실제 위치를 드러내지 않게 하기 위함이다.
  select
    building_id,
    region,
    area,
    max(lat) as lat,
    max(lng) as lng,
    count(*)::integer as target_count
  from target_units
  group by building_id, region, area
),
region_coordinates as (
  select
    region,
    case
      when count(*) filter (where lat is not null and lng is not null) < 3 then null
      when max(target_count)::numeric / nullif(sum(target_count), 0) > 0.5 then null
      else round((avg(lat) filter (where lat is not null and lng is not null))::numeric, 3)
    end as center_lat,
    case
      when count(*) filter (where lat is not null and lng is not null) < 3 then null
      when max(target_count)::numeric / nullif(sum(target_count), 0) > 0.5 then null
      else round((avg(lng) filter (where lat is not null and lng is not null))::numeric, 3)
    end as center_lng
  from target_buildings
  group by region
),
area_coordinates as (
  select
    region,
    area,
    case
      when count(*) filter (where lat is not null and lng is not null) < 3 then null
      when max(target_count)::numeric / nullif(sum(target_count), 0) > 0.5 then null
      else round((avg(lat) filter (where lat is not null and lng is not null))::numeric, 3)
    end as center_lat,
    case
      when count(*) filter (where lat is not null and lng is not null) < 3 then null
      when max(target_count)::numeric / nullif(sum(target_count), 0) > 0.5 then null
      else round((avg(lng) filter (where lat is not null and lng is not null))::numeric, 3)
    end as center_lng
  from target_buildings
  group by region, area
),
target_cards as (
  select distinct card_id from target_units where card_id is not null
),
card_totals as (
  select count(*)::integer as total_cards from public.cards
),
card_region_rows as (
  select coalesce(region, '미분류') as region, count(*)::integer as count
  from public.cards
  group by coalesce(region, '미분류')
),
leader_coverage as (
  select
    count(*)::integer as total_cards,
    count(*) filter (where exists (
      select 1 from public.card_leader_assignments cla where cla.card_id = tc.card_id
    ))::integer as assigned_cards
  from target_cards tc
),
region_rows as (
  select
    tu.region,
    count(*)::integer as total,
    count(*) filter (where not is_business)::integer as residential,
    count(*) filter (where is_business)::integer as business,
    count(*) filter (where last_visited_at >= p_period_end - 30)::integer as managed_30d,
    count(*) filter (where is_regular_visit)::integer as regular_visits,
    rc.center_lat,
    rc.center_lng
  from target_units tu
  left join region_coordinates rc on rc.region = tu.region
  group by tu.region, rc.center_lat, rc.center_lng
),
area_rows as (
  select
    tu.region,
    tu.area,
    count(*)::integer as total,
    count(*) filter (where not is_business)::integer as residential,
    count(*) filter (where is_business)::integer as business,
    count(*) filter (where last_visited_at >= p_period_end - 30)::integer as managed_30d,
    count(*) filter (where last_visited_at is null)::integer as no_history,
    ac.center_lat,
    ac.center_lng
  from target_units tu
  left join area_coordinates ac on ac.region = tu.region and ac.area = tu.area
  group by tu.region, tu.area, ac.center_lat, ac.center_lng
),
summary as (
  select
    count(*)::integer as total,
    count(*) filter (where not is_business)::integer as residential,
    count(*) filter (where is_business)::integer as business,
    count(*) filter (where is_regular_visit)::integer as regular_visits,
    count(*) filter (where status = '대상외')::integer as consistency_warnings,
    count(*) filter (where last_visited_at >= p_period_end - 30)::integer as managed_30d,
    count(*) filter (where last_visited_at between p_period_end - 90 and p_period_end - 31)::integer as managed_31_90d,
    count(*) filter (where last_visited_at between p_period_end - 180 and p_period_end - 91)::integer as managed_91_180d,
    count(*) filter (where last_visited_at < p_period_end - 180)::integer as managed_over_180d,
    count(*) filter (where last_visited_at is null)::integer as no_history
  from target_units
),
status_rows as (
  select status, count(*)::integer as count
  from target_units
  group by status
),
monthly_visit_rows as (
  select
    to_char(months.month_start, 'YYYY-MM') as month,
    count(distinct vh.unit_id)::integer as households,
    count(vh.id)::integer as visits
  from generate_series(
    date_trunc('month', p_period_start::timestamp),
    date_trunc('month', p_period_end::timestamp),
    interval '1 month'
  ) months(month_start)
  left join public.visit_histories vh
    on vh.visited_at >= months.month_start::date
   and vh.visited_at < (months.month_start + interval '1 month')::date
   and vh.visited_at between p_period_start and p_period_end
   and vh.invalidated_at is null
   and exists (select 1 from target_units tu where tu.id = vh.unit_id)
  group by months.month_start
)
select jsonb_build_object(
  'schemaVersion', 2,
  'congregationName', coalesce((
    select value::jsonb ->> 'name'
    from public.app_settings where key = 'congregation_profile'
  ), case when exists (
    select 1 from public.app_private_settings where key = 'environment' and value = 'test'
  ) then 'DEMO' else '경기용인중국어' end),
  'generatedAt', now(),
  'periodStart', p_period_start,
  'periodEnd', p_period_end,
  'note', left(btrim(coalesce(p_note, '')), 1000),
  'summary', jsonb_build_object(
    'total', s.total,
    'residential', s.residential,
    'business', s.business,
    'regularVisits', s.regular_visits,
    'totalCards', ct.total_cards,
    'targetCards', lc.total_cards,
    'assignedCards', lc.assigned_cards,
    'unassignedCards', lc.total_cards - lc.assigned_cards,
    'consistencyWarnings', s.consistency_warnings
  ),
  'management', jsonb_build_object(
    'within30Days', s.managed_30d,
    'days31To90', s.managed_31_90d,
    'days91To180', s.managed_91_180d,
    'over180Days', s.managed_over_180d,
    'noHistory', s.no_history
  ),
  'statuses', coalesce((
    select jsonb_agg(jsonb_build_object('status', status, 'count', count) order by count desc, status)
    from status_rows
  ), '[]'::jsonb),
  'monthlyVisits', coalesce((
    select jsonb_agg(jsonb_build_object(
      'month', month, 'households', households, 'visits', visits
    ) order by month)
    from monthly_visit_rows
  ), '[]'::jsonb),
  'cardRegions', coalesce((
    select jsonb_agg(jsonb_build_object('region', region, 'count', count) order by count desc, region)
    from card_region_rows
  ), '[]'::jsonb),
  'regions', coalesce((
    select jsonb_agg(jsonb_build_object(
      'region', region, 'total', total, 'residential', residential, 'business', business,
      'managed30d', managed_30d, 'regularVisits', regular_visits,
      'centerLat', center_lat, 'centerLng', center_lng
    ) order by total desc, region)
    from region_rows
  ), '[]'::jsonb),
  'areas', coalesce((
    select jsonb_agg(jsonb_build_object(
      'region', region, 'area', area, 'total', total, 'residential', residential,
      'business', business, 'managed30d', managed_30d, 'noHistory', no_history,
      'centerLat', center_lat, 'centerLng', center_lng
    ) order by region, total desc, area)
    from area_rows
  ), '[]'::jsonb)
)
from summary s cross join leader_coverage lc cross join card_totals ct;
$$;
revoke all on function private.build_chinese_territory_report_snapshot(date,date,text)
  from public, anon, authenticated;

create or replace function public.preview_chinese_territory_report_tx(
  p_token uuid,
  p_period_start date,
  p_period_end date,
  p_note text default ''
)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
begin
  perform private.require_report_admin(p_token);
  if p_period_start is null or p_period_end is null or p_period_start > p_period_end then
    raise exception '보고 기간이 올바르지 않습니다' using errcode = '22023';
  end if;
  if p_period_end - p_period_start > 730 then
    raise exception '보고 기간은 최대 2년입니다' using errcode = '22023';
  end if;
  return private.build_chinese_territory_report_snapshot(p_period_start, p_period_end, p_note);
end;
$$;

create or replace function public.create_chinese_territory_report_share_tx(
  p_token uuid,
  p_period_start date,
  p_period_end date,
  p_expires_at timestamptz,
  p_pin text default null,
  p_note text default ''
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

  v_raw_token := encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.territory_report_shares(
    token_hash, pin_hash, snapshot, expires_at, created_by
  ) values (
    encode(extensions.digest(v_raw_token, 'sha256'), 'hex'),
    case when v_pin is null then null else extensions.crypt(v_pin, extensions.gen_salt('bf')) end,
    private.build_chinese_territory_report_snapshot(p_period_start, p_period_end, p_note),
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

create or replace function public.get_chinese_territory_report_share(
  p_share_token text,
  p_pin text default null
)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_row public.territory_report_shares%rowtype;
begin
  select * into v_row
  from public.territory_report_shares
  where token_hash = encode(extensions.digest(coalesce(p_share_token, ''), 'sha256'), 'hex')
  for update;

  if not found or v_row.revoked_at is not null or v_row.expires_at <= now() then
    return jsonb_build_object('ok', false, 'code', 'unavailable');
  end if;
  if v_row.locked_until is not null and v_row.locked_until > now() then
    return jsonb_build_object('ok', false, 'code', 'locked', 'lockedUntil', v_row.locked_until);
  end if;
  if v_row.pin_hash is not null then
    if nullif(btrim(coalesce(p_pin, '')), '') is null then
      return jsonb_build_object('ok', false, 'code', 'pin_required');
    end if;
    if extensions.crypt(p_pin, v_row.pin_hash) <> v_row.pin_hash then
      update public.territory_report_shares
      set failed_attempts = failed_attempts + 1,
          locked_until = case when failed_attempts + 1 >= 5 then now() + interval '15 minutes' else null end
      where id = v_row.id;
      return jsonb_build_object('ok', false, 'code',
        case when v_row.failed_attempts + 1 >= 5 then 'locked' else 'invalid_pin' end);
    end if;
  end if;

  update public.territory_report_shares
  set failed_attempts = 0, locked_until = null,
      view_count = view_count + 1, last_viewed_at = now()
  where id = v_row.id;
  return jsonb_build_object('ok', true, 'snapshot', v_row.snapshot, 'expiresAt', v_row.expires_at);
end;
$$;

create or replace function public.list_chinese_territory_report_shares_tx(p_token uuid)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
begin
  perform private.require_report_admin(p_token);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', id, 'expiresAt', expires_at, 'revokedAt', revoked_at,
      'pinRequired', pin_hash is not null, 'viewCount', view_count,
      'lastViewedAt', last_viewed_at, 'createdAt', created_at,
      'periodStart', snapshot ->> 'periodStart', 'periodEnd', snapshot ->> 'periodEnd'
    ) order by created_at desc)
    from public.territory_report_shares
  ), '[]'::jsonb);
end;
$$;

create or replace function public.revoke_chinese_territory_report_share_tx(
  p_token uuid,
  p_share_id uuid
)
returns boolean
language plpgsql security definer
set search_path = ''
as $$
begin
  perform private.require_report_admin(p_token);
  update public.territory_report_shares
  set revoked_at = coalesce(revoked_at, now())
  where id = p_share_id;
  return found;
end;
$$;

revoke all on function public.preview_chinese_territory_report_tx(uuid,date,date,text) from public;
revoke all on function public.create_chinese_territory_report_share_tx(uuid,date,date,timestamptz,text,text) from public;
revoke all on function public.get_chinese_territory_report_share(text,text) from public;
revoke all on function public.list_chinese_territory_report_shares_tx(uuid) from public;
revoke all on function public.revoke_chinese_territory_report_share_tx(uuid,uuid) from public;

grant execute on function public.preview_chinese_territory_report_tx(uuid,date,date,text) to anon, authenticated;
grant execute on function public.create_chinese_territory_report_share_tx(uuid,date,date,timestamptz,text,text) to anon, authenticated;
grant execute on function public.get_chinese_territory_report_share(text,text) to anon, authenticated;
grant execute on function public.list_chinese_territory_report_shares_tx(uuid) to anon, authenticated;
grant execute on function public.revoke_chinese_territory_report_share_tx(uuid,uuid) to anon, authenticated;

comment on table public.territory_report_shares is
  '중국어 세대 관리 현황의 비식별 집계 스냅샷. 원자료나 개인정보를 저장하지 않는다.';
comment on function public.get_chinese_territory_report_share(text,text) is
  '임의 토큰과 선택적 6자리 암호로 만료 전 집계 보고서만 반환한다.';

do $$
declare
  v_def text;
begin
  if not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'territory_report_shares' and c.relrowsecurity
  ) then raise exception 'VERIFY: territory_report_shares RLS가 꺼져 있습니다'; end if;

  if exists (
    select 1 from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'territory_report_shares'
      and grantee in ('anon', 'authenticated')
  ) then raise exception 'VERIFY: 공유 표 직접 권한이 남아 있습니다'; end if;

  select pg_get_functiondef('public.get_chinese_territory_report_share(text,text)'::regprocedure) into v_def;
  if v_def not like '%SECURITY DEFINER%' or v_def not like '%failed_attempts%' then
    raise exception 'VERIFY: 공개 보고서 암호 방어 계약이 빠졌습니다';
  end if;

  if has_function_privilege('anon', 'public.create_chinese_territory_report_share_tx(uuid,date,date,timestamptz,text,text)', 'EXECUTE') is not true
     or has_function_privilege('anon', 'public.get_chinese_territory_report_share(text,text)', 'EXECUTE') is not true then
    raise exception 'VERIFY: 보고서 RPC 권한이 올바르지 않습니다';
  end if;
end
$$;
