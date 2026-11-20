-- Forward-only follow-up to the demo-installed 1600 migration.
do $$
declare body text; needle text := 'cardinality(p_card_ids) not between 1 and 500';
begin
  body := pg_get_functiondef('public.set_territory_group_assignments_tx(uuid,text,integer[],text,jsonb)'::regprocedure);
  if (length(body)-length(replace(body,needle,'')))/length(needle) <> 1 then
    raise exception 'Unexpected territory batch limit definition';
  end if;
  execute replace(body,needle,'cardinality(p_card_ids) not between 1 and 1000');
end $$;

create function private.guard_territory_group_revision() returns trigger
language plpgsql set search_path='' as $$
begin
  if tg_op='INSERT' then
    if new.group_assignment_revision<>0 then
      raise exception 'Group revision is server managed' using errcode='42501';
    end if;
  elsif new.group_assignment_revision is distinct from old.group_assignment_revision then
    if current_setting('app.territory_group_revision_write',true) is distinct from 'on'
      or pg_trigger_depth()<2 or new.group_assignment_revision<>old.group_assignment_revision+1 then
      raise exception 'Group revision is server managed' using errcode='42501';
    end if;
  end if;
  return new;
end $$;
revoke all on function private.guard_territory_group_revision() from public,anon,authenticated;
create trigger guard_territory_group_revision before insert or update on public.cards
for each row execute function private.guard_territory_group_revision();

create or replace function private.track_territory_group_revision() returns trigger
language plpgsql security definer set search_path='' as $$
declare previous text := current_setting('app.territory_group_revision_write',true);
begin
  -- Attribution cleanup does not change ownership or its revision.
  if tg_op='UPDATE' and new.card_id=old.card_id and new.group_code=old.group_code then return new; end if;
  perform set_config('app.territory_group_revision_write','on',true);
  if tg_op in ('DELETE','UPDATE') then
    update public.cards set group_assignment_revision=group_assignment_revision+1 where id=old.card_id;
  end if;
  if tg_op in ('INSERT','UPDATE') then
    update public.cards set group_assignment_revision=group_assignment_revision+1 where id=new.card_id;
  end if;
  perform set_config('app.territory_group_revision_write',coalesce(previous,''),true);
  return null;
end $$;
revoke all on function private.track_territory_group_revision() from public,anon,authenticated;
notify pgrst,'reload schema';
