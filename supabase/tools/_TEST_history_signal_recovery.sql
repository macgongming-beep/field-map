-- Use scripts/checkDemoHistorySignals.mjs. Fixtures and their signals roll back.
-- Sequence values can advance; no real histories or schema are changed.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
select set_config('app.suppress_notifications', 'true', true);
do $$
declare
  c integer;
  b integer;
  other_b integer;
  u integer;
  h integer;
  step integer;
  since_at timestamptz;
  active_count integer;
  expected integer[] := array[1, 1, 0, 1, 0];
begin
  select min(id) into c from public.cards;
  if c is null then raise exception 'Demo requires a card'; end if;
  insert into public.buildings(card_id,name,address,type,lat,lng)
    values(c,'synthetic history recovery','synthetic history recovery','주택',37,127)
    returning id into b;
  insert into public.buildings(card_id,name,address,type,lat,lng)
    values(c,'synthetic history destination','synthetic history destination','주택',37,127)
    returning id into other_b;
  insert into public.units(building_id,number,status)
    values(b,'signal-test','미방문') returning id into u;

  for step in 1..5 loop
    -- Reset only this synthetic signal, so same-transaction coalescing cannot
    -- make a previous operation falsely satisfy the next assertion.
    delete from public.territory_change_signals where building_id in (b, other_b);
    since_at := public.territory_sync_clock();
    case step
      when 1 then
        insert into public.visit_histories(unit_id,visitor_name,result,created_at,updated_at)
          values(u,'synthetic history check','부재',now()-interval '30 days',null)
          returning id into h;
      when 2 then update public.visit_histories set memo='changed old record' where id=h;
      when 3 then update public.visit_histories set invalidated_at=clock_timestamp() where id=h;
      when 4 then update public.visit_histories set invalidated_at=null where id=h;
      when 5 then delete from public.visit_histories where id=h;
    end case;
    if not exists(select 1 from public.territory_change_signals
      where building_id=b and changed_at>=since_at) then
      raise exception 'Missing signal at history step %', step;
    end if;
    select count(*) into active_count from public.visit_histories vh
      join public.units un on un.id=vh.unit_id
      where un.building_id=b and vh.invalidated_at is null
        and vh.created_at>=now()-interval '1 year';
    if active_count<>expected[step] then
      raise exception 'Wrong replacement snapshot at step %: %',step,active_count;
    end if;
    if step<5 and not exists(select 1 from public.visit_histories
      where id=h and updated_at is null and created_at<now()-interval '7 days') then
      raise exception 'Fixture no longer tests old history with NULL updated_at';
    end if;
    raise notice 'PASS history step % (insert/edit/invalidate/restore/delete), active=%',step,active_count;
  end loop;

  insert into public.visit_histories(unit_id,visitor_name,result)
    values(u,'synthetic history check','부재') returning id into h;
  delete from public.territory_change_signals where building_id in (b,other_b);
  update public.units set building_id=other_b where id=u;
  if (select count(*) from public.territory_change_signals where building_id in (b,other_b))<>2 then
    raise exception 'Unit move must signal both old and new building';
  end if;
  raise notice 'PASS unit move signals both buildings';
  delete from public.territory_change_signals where building_id in (b,other_b);
  delete from public.units where id=u;
  if not exists(select 1 from public.territory_change_signals where building_id=other_b)
    or exists(select 1 from public.visit_histories where id=h) then
    raise exception 'Unit deletion must signal parent and cascade history';
  end if;
  raise notice 'PASS unit deletion signals surviving parent';
  delete from public.buildings where id=other_b;
  if exists(select 1 from public.territory_change_signals where building_id=other_b)
    or exists(select 1 from public.buildings where id=other_b) then
    raise exception 'Building deletion must disappear from recovery index';
  end if;
  raise notice 'PASS building deletion detectable via building ID index';
end $$;
rollback;
