-- 먼저 모든 공유 링크를 즉시 무효화한다. 스냅샷 표는 자료 보존을 위해 남긴다.
-- 적용 전 DB에서도 롤백 계약 자체를 점검할 수 있어야 한다.
do $$
begin
  if to_regclass('public.territory_report_shares') is not null then
    update public.territory_report_shares set revoked_at = coalesce(revoked_at, now());
  end if;
end
$$;

drop function if exists public.revoke_chinese_territory_report_share_tx(uuid,uuid);
drop function if exists public.list_chinese_territory_report_shares_tx(uuid);
drop function if exists public.get_chinese_territory_report_share(text,text);
drop function if exists public.create_chinese_territory_report_share_tx(uuid,date,date,timestamptz,text,text);
drop function if exists public.preview_chinese_territory_report_tx(uuid,date,date,text);
drop function if exists private.build_chinese_territory_report_snapshot(date,date,text);
drop function if exists private.require_report_admin(uuid);

do $$
begin
  if to_regclass('public.territory_report_shares') is not null then
    revoke all on table public.territory_report_shares from public, anon, authenticated;
  end if;
end
$$;
