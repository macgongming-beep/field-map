-- 보고서 지도에는 임의의 볼록 외곽선 대신 저장된 카드 경계선을 그대로 표시한다.
-- 같은 구의 카드들을 개별 항목으로 전달하므로 허용 항목 수를 카드 규모에 맞춘다.

create or replace function private.validate_territory_report_boundaries(p_boundaries jsonb)
returns jsonb
language plpgsql immutable security definer
set search_path = ''
as $$
declare
  v_boundaries jsonb := coalesce(p_boundaries, '[]'::jsonb);
  v_point_count integer;
begin
  if jsonb_typeof(v_boundaries) <> 'array'
     or jsonb_array_length(v_boundaries) > 1000
     or pg_column_size(v_boundaries) > 2000000 then
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

  select coalesce(sum(jsonb_array_length(item -> 'points')), 0)
    into v_point_count
  from jsonb_array_elements(v_boundaries) item;
  if v_point_count > 30000 or exists (
    select 1
    from jsonb_array_elements(v_boundaries) item
    cross join lateral jsonb_array_elements(item -> 'points') point
    where case
      when jsonb_typeof(point -> 'lat') = 'number'
       and jsonb_typeof(point -> 'lng') = 'number'
      then (point ->> 'lat')::numeric not between -90 and 90
        or (point ->> 'lng')::numeric not between -180 and 180
      else true
    end
  ) then
    raise exception '구역 경계 자료가 올바르지 않습니다' using errcode = '22023';
  end if;

  return v_boundaries;
end;
$$;

revoke all on function private.validate_territory_report_boundaries(jsonb)
  from public, anon, authenticated;
