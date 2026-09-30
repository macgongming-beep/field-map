-- Run on DEMO only with psql --single-transaction. The inner block always rolls back fixtures.
do $$
declare
  v_card integer;
  v_other integer;
  v_building integer;
  v_unit integer;
  v_revision bigint;
  v_started timestamptz := public.territory_sync_clock();
begin
  if has_table_privilege('anon','public.territory_change_signals','INSERT,UPDATE,DELETE,TRUNCATE')
    or has_function_privilege('anon','private.signal_territory_change()','EXECUTE')
    or has_function_privilege('anon','private.touch_territory_signal(integer,integer)','EXECUTE') then
    raise exception 'Signal write permissions are open';
  end if;
  begin
    select min(id), max(id) into v_card, v_other from public.cards;
    insert into public.buildings(card_id,name,address,type,lat,lng)
      values(v_card,'synthetic signal contract','synthetic signal contract','주택',37,127) returning id into v_building;
    if not exists(select 1 from public.territory_change_signals where building_id=v_building and changed_at >= v_started) then
      raise exception 'Empty building did not signal';
    end if;
    select revision into v_revision from public.territory_change_signals where building_id=v_building;
    insert into public.units(building_id,number,status) values(v_building,'203','미방문') returning id into v_unit;
    update public.units set status='부재' where id=v_unit;
    if (select count(*) from public.territory_change_signals where building_id=v_building) <> 1
      or (select revision from public.territory_change_signals where building_id=v_building) <> v_revision then
      raise exception 'Same-transaction changes were not coalesced';
    end if;
    update public.buildings set card_id=v_other where id=v_building;
    if not exists(select 1 from public.territory_change_signals where building_id=v_building and card_id=v_card)
      or not exists(select 1 from public.territory_change_signals where building_id=v_building and card_id=v_other) then
      raise exception 'Move must invalidate both cards';
    end if;
    delete from public.buildings where id=v_building;
    if exists(select 1 from public.territory_change_signals where building_id=v_building) then
      raise exception 'Signals must not survive building deletion';
    end if;
    raise exception using errcode='ZX001', message='fixture rollback';
  exception when sqlstate 'ZX001' then null;
  end;
end $$;
