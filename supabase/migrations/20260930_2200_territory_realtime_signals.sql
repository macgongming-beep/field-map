-- Metadata only: custom app session headers do not reach Realtime.
-- Existing tables/RLS and the old unit creation channel remain unchanged.
create table public.territory_change_signals (
  building_id integer not null references public.buildings(id) on delete cascade,
  card_id integer not null references public.cards(id) on delete cascade,
  revision bigint not null,
  primary key (building_id, card_id)
);
create index territory_change_signals_card_idx on public.territory_change_signals(card_id);
alter table public.territory_change_signals enable row level security;
revoke all on public.territory_change_signals from public, anon, authenticated;
grant select on public.territory_change_signals to anon, authenticated;
create policy territory_change_signals_read on public.territory_change_signals
  for select to anon, authenticated using (true);

create function private.touch_territory_signal(p_building_id integer, p_card_id integer default null)
returns void language sql security definer set search_path = '' as $$
  insert into public.territory_change_signals (building_id, card_id, revision)
  select b.id, coalesce(p_card_id, b.card_id), pg_catalog.txid_current()
  from public.buildings b where b.id = p_building_id
  on conflict (building_id, card_id) do update set revision = excluded.revision
  where territory_change_signals.revision <> excluded.revision;
$$;
revoke all on function private.touch_territory_signal(integer, integer) from public, anon, authenticated;

create function private.signal_territory_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_building_id integer;
begin
  if tg_op = 'UPDATE' and to_jsonb(old) = to_jsonb(new) then return new; end if;
  if tg_table_name = 'buildings' then
    if tg_op = 'UPDATE' and old.card_id is distinct from new.card_id then
      perform private.touch_territory_signal(new.id, old.card_id);
    end if;
    perform private.touch_territory_signal(new.id);
  elsif tg_table_name in ('units', 'building_access_events') then
    if tg_op <> 'INSERT' then perform private.touch_territory_signal(old.building_id); end if;
    if tg_op <> 'DELETE' then perform private.touch_territory_signal(new.building_id); end if;
  else
    if tg_op <> 'INSERT' then
      select building_id into v_building_id from public.units where id = old.unit_id;
      perform private.touch_territory_signal(v_building_id);
    end if;
    if tg_op <> 'DELETE' then
      select building_id into v_building_id from public.units where id = new.unit_id;
      perform private.touch_territory_signal(v_building_id);
    end if;
  end if;
  return null;
end;
$$;
revoke all on function private.signal_territory_change() from public, anon, authenticated;

create trigger signal_territory_building after insert or update on public.buildings
  for each row execute function private.signal_territory_change();
create trigger signal_territory_unit after insert or update or delete on public.units
  for each row execute function private.signal_territory_change();
create trigger signal_territory_history after insert or update or delete on public.visit_histories
  for each row execute function private.signal_territory_change();
create trigger signal_territory_regular after insert or update or delete on public.regular_visits
  for each row execute function private.signal_territory_change();
create trigger signal_territory_access after insert or update or delete on public.building_access_events
  for each row execute function private.signal_territory_change();

alter publication supabase_realtime add table public.territory_change_signals;

do $$ begin
  if has_table_privilege('anon', 'public.territory_change_signals', 'INSERT,UPDATE,DELETE,TRUNCATE')
    or has_function_privilege('anon', 'private.touch_territory_signal(integer,integer)', 'EXECUTE')
    or has_function_privilege('anon', 'private.signal_territory_change()', 'EXECUTE') then
    raise exception 'Territory signal write access must remain private';
  end if;
end $$;
notify pgrst, 'reload schema';
