drop policy if exists role_admin_cards_insert on public.cards;
drop policy if exists role_admin_cards_update on public.cards;
drop policy if exists role_admin_cards_delete on public.cards;
drop policy if exists role_admin_card_boundaries_insert on public.card_boundaries;
drop policy if exists role_admin_card_boundaries_update on public.card_boundaries;
drop policy if exists role_admin_card_boundaries_delete on public.card_boundaries;
drop policy if exists role_member_buildings_insert on public.buildings;
drop policy if exists role_manager_buildings_update on public.buildings;
drop policy if exists role_member_buildings_update on public.buildings;
drop policy if exists role_member_units_insert on public.units;
drop policy if exists role_member_units_update on public.units;

create policy "TEMP_session_gate_cards_ins" on public.cards for insert to anon, authenticated
  with check ((select private.request_session_user_id()) is not null);
create policy "TEMP_session_gate_cards_upd" on public.cards for update to anon, authenticated
  using ((select private.request_session_user_id()) is not null)
  with check ((select private.request_session_user_id()) is not null);
create policy "TEMP_session_gate_cards_del" on public.cards for delete to anon, authenticated
  using ((select private.request_session_user_id()) is not null);
create policy "TEMP_session_gate_card_boundaries_ins" on public.card_boundaries for insert to anon, authenticated
  with check ((select private.request_session_user_id()) is not null);
create policy "TEMP_session_gate_card_boundaries_upd" on public.card_boundaries for update to anon, authenticated
  using ((select private.request_session_user_id()) is not null)
  with check ((select private.request_session_user_id()) is not null);
create policy "TEMP_session_gate_card_boundaries_del" on public.card_boundaries for delete to anon, authenticated
  using ((select private.request_session_user_id()) is not null);
create policy "TEMP_session_gate_buildings_ins" on public.buildings for insert to anon, authenticated
  with check ((select private.request_session_user_id()) is not null);
create policy "TEMP_session_gate_buildings_upd" on public.buildings for update to anon, authenticated
  using ((select private.request_session_user_id()) is not null)
  with check ((select private.request_session_user_id()) is not null);
create policy buildings_delete_admin on public.buildings for delete to anon, authenticated
  using ((select private.request_is_admin()));
create policy "TEMP_session_gate_units_ins" on public.units for insert to anon, authenticated
  with check ((select private.request_session_user_id()) is not null);
create policy "TEMP_session_gate_units_upd" on public.units for update to anon, authenticated
  using ((select private.request_session_user_id()) is not null)
  with check ((select private.request_session_user_id()) is not null);
create policy units_delete_admin on public.units for delete to anon, authenticated
  using ((select private.request_is_admin()));

drop trigger if exists guard_unit_structure_change_trigger on public.units;
drop trigger if exists guard_building_structure_change_trigger on public.buildings;
drop function if exists public.guard_unit_structure_change();
drop function if exists public.guard_building_structure_change();
drop function if exists public.session_can_manage_place_structure();
-- 삭제 RPC와 감사 helper는 rollback에서 제거하지 않는다. 이전 호출 계약과 호환되며
-- 더 강한 감사·인도자 권한만 제공하므로 정책 복구 중에도 자료 손실을 만들지 않는다.

notify pgrst, 'reload schema';
