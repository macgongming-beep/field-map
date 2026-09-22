-- 구역 관리 보고서에서 정기방문 집계 표시를 선택한다.
-- 기존 v2 RPC와 이미 만든 공유 스냅샷은 그대로 유지한다.

create or replace function private.apply_chinese_territory_report_visibility(
  p_snapshot jsonb,
  p_show_regular_visits boolean
)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_snapshot jsonb := coalesce(p_snapshot, '{}'::jsonb);
  v_regions jsonb;
begin
  if not coalesce(p_show_regular_visits, true) then
    v_snapshot := jsonb_set(
      v_snapshot,
      '{summary}',
      coalesce(v_snapshot -> 'summary', '{}'::jsonb) - 'regularVisits'
    );

    select coalesce(jsonb_agg(region_row.value - 'regularVisits' order by region_row.ordinality), '[]'::jsonb)
      into v_regions
    from jsonb_array_elements(coalesce(v_snapshot -> 'regions', '[]'::jsonb))
      with ordinality as region_row(value, ordinality);

    v_snapshot := jsonb_set(v_snapshot, '{regions}', v_regions);
  end if;

  return v_snapshot || jsonb_build_object(
    'schemaVersion', 4,
    'showRegularVisits', coalesce(p_show_regular_visits, true)
  );
end;
$$;

revoke all on function private.apply_chinese_territory_report_visibility(jsonb,boolean)
  from public, anon, authenticated;

create or replace function public.preview_chinese_territory_report_v3_tx(
  p_token uuid,
  p_period_start date,
  p_period_end date,
  p_note text default '',
  p_include_area_details boolean default false,
  p_show_regular_visits boolean default true,
  p_region_boundaries jsonb default '[]'::jsonb
)
returns jsonb
language sql volatile security definer
set search_path = ''
as $$
  select private.apply_chinese_territory_report_visibility(
    public.preview_chinese_territory_report_v2_tx(
      p_token,
      p_period_start,
      p_period_end,
      p_note,
      p_include_area_details,
      p_region_boundaries
    ),
    p_show_regular_visits
  );
$$;

create or replace function public.create_chinese_territory_report_share_v3_tx(
  p_token uuid,
  p_period_start date,
  p_period_end date,
  p_expires_at timestamptz,
  p_pin text default null,
  p_note text default '',
  p_include_area_details boolean default false,
  p_show_regular_visits boolean default true,
  p_region_boundaries jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_result jsonb;
  v_share_id uuid;
begin
  v_result := public.create_chinese_territory_report_share_v2_tx(
    p_token,
    p_period_start,
    p_period_end,
    p_expires_at,
    p_pin,
    p_note,
    p_include_area_details,
    p_region_boundaries
  );
  v_share_id := (v_result ->> 'id')::uuid;

  update public.territory_report_shares
  set snapshot = private.apply_chinese_territory_report_visibility(snapshot, p_show_regular_visits)
  where id = v_share_id;

  if not found then
    raise exception '공유 보고서를 저장하지 못했습니다';
  end if;

  return v_result;
end;
$$;

revoke all on function public.preview_chinese_territory_report_v3_tx(uuid,date,date,text,boolean,boolean,jsonb) from public;
revoke all on function public.create_chinese_territory_report_share_v3_tx(uuid,date,date,timestamptz,text,text,boolean,boolean,jsonb) from public;
grant execute on function public.preview_chinese_territory_report_v3_tx(uuid,date,date,text,boolean,boolean,jsonb) to anon, authenticated;
grant execute on function public.create_chinese_territory_report_share_v3_tx(uuid,date,date,timestamptz,text,text,boolean,boolean,jsonb) to anon, authenticated;

comment on function public.preview_chinese_territory_report_v3_tx(uuid,date,date,text,boolean,boolean,jsonb) is
  '정기방문 집계 표시 선택을 포함한 구역 관리 보고서 미리보기.';
comment on function public.create_chinese_territory_report_share_v3_tx(uuid,date,date,timestamptz,text,text,boolean,boolean,jsonb) is
  '정기방문 집계 표시 선택을 스냅샷에 고정해 외부 공유 링크를 만든다.';

do $$
begin
  if has_function_privilege(
    'anon',
    'public.create_chinese_territory_report_share_v3_tx(uuid,date,date,timestamptz,text,text,boolean,boolean,jsonb)',
    'EXECUTE'
  ) is not true then
    raise exception 'VERIFY: anon 이 v3 공유 RPC를 호출할 수 없습니다';
  end if;
end $$;
