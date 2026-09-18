-- 20260918_1100_territory_report_presentation.sql 롤백.
-- 기존 v1 보고서 함수와 이미 생성된 공유 스냅샷은 그대로 보존한다.

drop function if exists public.create_chinese_territory_report_share_v2_tx(uuid,date,date,timestamptz,text,text,boolean,jsonb);
drop function if exists public.preview_chinese_territory_report_v2_tx(uuid,date,date,text,boolean,jsonb);
drop function if exists private.validate_territory_report_boundaries(jsonb);
drop function if exists private.decorate_chinese_territory_report_snapshot(jsonb,date,boolean,jsonb);
