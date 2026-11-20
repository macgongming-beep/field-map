-- Additive demo-first ownership. Event/team assignments and legacy owners are untouched.
alter table public.cards add column group_assignment_revision bigint not null default 0;

create table public.card_group_assignments (
  card_id integer not null references public.cards(id) on delete cascade,
  group_code text not null references public.service_groups(code),
  assigned_by integer references public.app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (card_id, group_code)
);
create index card_group_assignments_group on public.card_group_assignments(group_code, card_id);
alter table public.card_group_assignments enable row level security;
revoke all on public.card_group_assignments from public, anon, authenticated;
grant select on public.card_group_assignments to anon, authenticated;
create function public.can_read_group_territories() returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.app_users u where u.id=private.request_session_user_id()
    and u.is_active and u.approval_status='approved' and u.role in ('admin','developer','leader'))
$$;
revoke all on function public.can_read_group_territories() from public,anon,authenticated;
grant execute on function public.can_read_group_territories() to anon,authenticated;
create policy card_group_assignments_read on public.card_group_assignments for select to anon, authenticated
using ((select public.can_read_group_territories()));

create function private.track_territory_group_revision() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  -- Actor deletion only clears attribution, not ownership.
  if tg_op='UPDATE' and new.card_id=old.card_id and new.group_code=old.group_code then return new; end if;
  if tg_op in ('DELETE','UPDATE') then
    update public.cards set group_assignment_revision=group_assignment_revision+1 where id=old.card_id;
  end if;
  if tg_op in ('INSERT','UPDATE') then
    update public.cards set group_assignment_revision=group_assignment_revision+1 where id=new.card_id;
  end if;
  return null;
end $$;
revoke all on function private.track_territory_group_revision() from public,anon,authenticated;
create trigger territory_group_revision after insert or update or delete on public.card_group_assignments
for each row execute function private.track_territory_group_revision();

create function public.set_territory_group_assignments_tx(
  p_token uuid, p_group_code text, p_card_ids integer[], p_action text, p_expected jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor integer; c record; n integer;
begin
  actor:=public.verify_session(p_token);
  if not exists(select 1 from public.app_users where id=actor and is_active
    and approval_status='approved' and role in ('admin','developer')) then
    raise exception 'Admin required' using errcode='42501';
  end if;
  if p_action is null or p_action not in ('add','remove') or p_card_ids is null
    or cardinality(p_card_ids) not between 1 and 500 or array_position(p_card_ids,null) is not null
    or cardinality(p_card_ids)<>(select count(distinct id) from unnest(p_card_ids) id)
    or p_expected is null or jsonb_typeof(p_expected)<>'object' then
    raise exception 'Invalid territory assignment input' using errcode='22023';
  end if;
  -- Same lock order as the group directory, including concurrent archive/rename.
  perform pg_advisory_xact_lock(20261118,2300);
  if not exists(select 1 from public.service_groups where code=p_group_code and (is_active or p_action='remove')) then
    raise exception 'Unknown or retired group' using errcode='22023';
  end if;
  n:=0;
  for c in select id,group_assignment_revision from public.cards where id=any(p_card_ids) order by id for update loop
    n:=n+1;
    if p_expected->>c.id::text is distinct from c.group_assignment_revision::text then
      raise exception 'Territory assignments changed' using errcode='PT409';
    end if;
  end loop;
  if n<>cardinality(p_card_ids) then raise exception 'Territory not found' using errcode='PT409'; end if;
  if p_action='add' then
    insert into public.card_group_assignments(card_id,group_code,assigned_by)
      select id,p_group_code,actor from unnest(p_card_ids) id on conflict do nothing;
  else
    delete from public.card_group_assignments where card_id=any(p_card_ids) and group_code=p_group_code;
  end if;
  return jsonb_build_object('ok',true,'count',n);
end $$;
revoke all on function public.set_territory_group_assignments_tx(uuid,text,integer[],text,jsonb) from public,anon,authenticated;
grant execute on function public.set_territory_group_assignments_tx(uuid,text,integer[],text,jsonb) to anon,authenticated;

notify pgrst,'reload schema';
