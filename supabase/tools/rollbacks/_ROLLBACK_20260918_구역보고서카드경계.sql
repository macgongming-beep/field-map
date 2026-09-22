-- 20260918_1200_territory_report_card_boundaries.sql 롤백.

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
