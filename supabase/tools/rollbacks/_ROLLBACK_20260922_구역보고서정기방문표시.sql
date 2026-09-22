-- 20260922_1100_territory_report_regular_visit_visibility.sql 롤백.
-- 이미 생성된 공유 스냅샷은 보존한다.

drop function if exists public.create_chinese_territory_report_share_v3_tx(
  uuid,date,date,timestamptz,text,text,boolean,boolean,jsonb
);
drop function if exists public.preview_chinese_territory_report_v3_tx(
  uuid,date,date,text,boolean,boolean,jsonb
);
drop function if exists private.apply_chinese_territory_report_visibility(jsonb,boolean);

notify pgrst, 'reload schema';
