-- 특별봉사 시즌은 시작일과 종료일을 직접 선택하며, 역전된 기간은 DB에서도 막는다.

do $$
begin
  if exists (
    select 1 from public.special_periods where start_date > end_date
  ) then
    raise exception '종료일이 시작일보다 빠른 특별봉사 시즌이 있습니다';
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.special_periods'::regclass
      and conname = 'special_periods_valid_date_range'
  ) then
    alter table public.special_periods
      add constraint special_periods_valid_date_range check (start_date <= end_date);
  end if;
end $$;

notify pgrst, 'reload schema';
