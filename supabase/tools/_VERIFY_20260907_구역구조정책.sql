do $$
declare
  v_temp integer;
  v_final integer;
  v_select integer;
  v_direct_delete integer;
begin
  select count(*) into v_temp from pg_policies
  where schemaname='public'
    and tablename in ('cards','card_boundaries','buildings','units')
    and policyname like 'TEMP_session_gate_%';

  select count(*) into v_final from pg_policies
  where schemaname='public' and policyname in (
    'role_admin_cards_insert','role_admin_cards_update','role_admin_cards_delete',
    'role_admin_card_boundaries_insert','role_admin_card_boundaries_update','role_admin_card_boundaries_delete',
    'role_member_buildings_insert','role_member_buildings_update',
    'role_member_units_insert','role_member_units_update'
  );

  select count(distinct tablename) into v_select from pg_policies
  where schemaname='public' and tablename in ('cards','card_boundaries','buildings','units')
    and cmd='SELECT' and qual='true';

  select count(*) into v_direct_delete from pg_policies
  where schemaname='public' and tablename in ('buildings','units') and cmd in ('ALL','DELETE');

  if v_temp <> 0 or v_final <> 10 or v_select <> 4 or v_direct_delete <> 0 then
    raise exception '구역 구조 VERIFY 실패: TEMP %, final %, SELECT %/4, direct delete %',
      v_temp, v_final, v_select, v_direct_delete;
  end if;
  if not has_function_privilege('anon', 'public.session_can_manage_place_structure()', 'EXECUTE') then
    raise exception '세대 구조 보호 helper 실행권한이 없습니다';
  end if;
  if not has_function_privilege('anon', 'public.delete_place_or_request_tx(uuid,text,bigint,text,text)', 'EXECUTE') then
    raise exception '장소 삭제 RPC 실행권한이 없습니다';
  end if;
end $$;

select tablename, cmd, policyname, roles, qual, with_check
from pg_policies
where schemaname='public' and tablename in ('cards','card_boundaries','buildings','units')
order by tablename, cmd, policyname;
