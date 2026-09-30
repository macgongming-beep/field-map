-- Existing signal rows are already represented by the initial full snapshot.
alter table public.territory_change_signals
  add column changed_at timestamptz not null default '-infinity';
alter table public.territory_change_signals
  alter column changed_at set default clock_timestamp();
create index territory_change_signals_recovery_idx
  on public.territory_change_signals(card_id, changed_at);

create or replace function private.touch_territory_signal(p_building_id integer, p_card_id integer default null)
returns void language sql security definer set search_path = '' as $$
  insert into public.territory_change_signals (building_id, card_id, revision, changed_at)
  select b.id, coalesce(p_card_id, b.card_id), pg_catalog.txid_current(), pg_catalog.clock_timestamp()
  from public.buildings b where b.id = p_building_id
  on conflict (building_id, card_id) do update
    set revision = excluded.revision, changed_at = excluded.changed_at
  where territory_change_signals.revision <> excluded.revision;
$$;
revoke all on function private.touch_territory_signal(integer, integer) from public, anon, authenticated;

-- No data access or definer privilege; avoid relying on a phone's clock.
create function public.territory_sync_clock()
returns timestamptz language sql volatile security invoker set search_path = '' as $$
  select pg_catalog.clock_timestamp();
$$;
revoke all on function public.territory_sync_clock() from public;
grant execute on function public.territory_sync_clock() to anon, authenticated;
notify pgrst, 'reload schema';
