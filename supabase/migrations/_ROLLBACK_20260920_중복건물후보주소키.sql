-- 선택형 후보 병합 RPC만 제거한다. 이미 병합된 자료와 감사 스냅샷은 보존한다.

drop function if exists public.merge_selected_duplicate_buildings_tx(uuid, integer, jsonb, integer[], jsonb);

notify pgrst, 'reload schema';
