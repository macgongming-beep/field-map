-- Realtime has no custom session header. Publish IDs only; names stay behind RLS.
create table public.group_participant_signals (
  event_id integer primary key references public.calendar_events(id) on delete cascade,
  revision bigint not null default 1
);
alter table public.group_participant_signals enable row level security;
revoke all on public.group_participant_signals from public, anon, authenticated;
grant select on public.group_participant_signals to anon, authenticated;
create policy group_participant_signal_read on public.group_participant_signals
  for select using (true);

create function private.signal_group_participants() returns trigger
language plpgsql security definer set search_path = pg_catalog, public, private as $$
declare v_id integer;
begin
  for v_id in select distinct id from unnest(array[
    case when TG_OP <> 'INSERT' then OLD.event_id end,
    case when TG_OP <> 'DELETE' then NEW.event_id end
  ]) id where id is not null loop
    insert into public.group_participant_signals(event_id)
    select id from public.calendar_events where id=v_id and group_service_scope
    on conflict(event_id) do update
      set revision=public.group_participant_signals.revision+1;
  end loop;
  return null;
end $$;
revoke all on function private.signal_group_participants() from public, anon, authenticated;
create trigger signal_group_participants after insert or update or delete
  on public.event_participants for each row execute function private.signal_group_participants();

do $$ begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime') then
    alter publication supabase_realtime add table public.group_participant_signals;
  end if;
end $$;
notify pgrst, 'reload schema';
