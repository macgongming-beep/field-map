-- Export assignment_team_informal first. Personal assignments cleared before the
-- 20260930_1400 guard are not recreated by this rollback; the guard no longer clears them.
-- Run this before _ROLLBACK_20260930_team_card_scope.sql, in a single transaction.
do $$ begin
  if to_regprocedure('private.assign_scoped_cards_bulk_tx(uuid,integer,jsonb,text,text)') is null
    or to_regprocedure('private.assign_cards_bulk_tx(uuid,integer,jsonb,text,text)') is null
    or not exists(select 1 from information_schema.columns where table_schema='public'
      and table_name='calendar_events' and column_name='assignment_team_scopes') then
    raise exception '비공식 롤백 선행 조건이 맞지 않습니다. 변경 없이 중단합니다';
  end if;
end $$;
do $$ declare t text; begin
  foreach t in array array['event_informal_assignments','event_card_assignments','event_card_assignment_cards'] loop
    execute format('drop policy team_service_rpc_insert on public.%I',t);
    execute format('drop policy team_service_rpc_update on public.%I',t);
    execute format('drop policy team_service_rpc_delete on public.%I',t);
  end loop;
end $$;
drop function public.assign_team_service_bulk_tx(uuid,integer,jsonb,text,text);
drop function public.assign_scoped_cards_bulk_tx(uuid,integer,jsonb,text,text);
drop function public.assign_cards_bulk_tx(uuid,integer,jsonb,text,text);
alter function private.assign_scoped_cards_bulk_tx(uuid,integer,jsonb,text,text) set schema public;
alter function private.assign_cards_bulk_tx(uuid,integer,jsonb,text,text) set schema public;
grant execute on function public.assign_scoped_cards_bulk_tx(uuid,integer,jsonb,text,text) to anon,authenticated;
grant execute on function public.assign_cards_bulk_tx(uuid,integer,jsonb,text,text) to anon,authenticated;
alter table public.calendar_events drop column assignment_team_informal;
notify pgrst, 'reload schema';
