-- Existing demo installs remain strict. Only the reviewed prepare bundle opts
-- into compatibility, inside the same transaction as initial installation.
create table private.assignment_rollout (
  singleton boolean primary key default true check(singleton),
  phase text not null check(phase in ('compatibility','strict')),
  evidence text,
  changed_at timestamptz not null default clock_timestamp()
);
insert into private.assignment_rollout(phase) values('strict');
revoke all on private.assignment_rollout from public,anon,authenticated;
create function private.assignment_writes_strict() returns boolean
language sql stable security definer set search_path='' as $$
  select coalesce((select phase='strict' from private.assignment_rollout where singleton),true);
$$;
revoke all on function private.assignment_writes_strict() from public,anon,authenticated;

do $$ declare definition text; needle text:='if tg_when=''BEFORE'' and not(guarded or maintenance or cascading) then'; begin
  definition:=pg_get_functiondef('private.track_assignment_revision()'::regprocedure);
  if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then
    raise exception 'Unexpected assignment guard';
  end if;
  execute replace(definition,needle,'if tg_when=''BEFORE'' and private.assignment_writes_strict() and not(guarded or maintenance or cascading) then');
end $$;

-- The old client first deletes assigned sessions when removing a participant.
-- Permit ONLY that existing named-leader cleanup during compatibility. Never
-- widen manual session editing/deletion to all newly authorized leaders.
create function private.assignment_compat_session_cleanup(p_event_id integer,p_source text) returns boolean
language sql stable security definer set search_path='' as $$
  select not private.assignment_writes_strict() and p_source='assigned' and exists(
    select 1 from public.calendar_events e join public.app_users u
      on u.id=private.request_session_user_id()
    where e.id=p_event_id and u.is_active and u.approval_status='approved'
      and u.role in ('leader','admin','developer')
      and u.id=any(public.user_ids_in_name_list(e.leader_name)));
$$;
revoke all on function private.assignment_compat_session_cleanup(integer,text) from public;
grant execute on function private.assignment_compat_session_cleanup(integer,text) to anon,authenticated;
drop policy service_session_owner_delete on public.service_sessions;
create policy service_session_owner_delete on public.service_sessions as restrictive for delete
  using ((select private.request_is_admin()) or user_name=(select private.request_session_user_name())
    or private.assignment_compat_session_cleanup(calendar_event_id,source));

-- Operator-only, never callable through PostgREST. Acknowledgement is an audit
-- record, not automated proof that every physical device has updated.
create function private.set_assignment_rollout_phase(p_phase text,p_evidence text) returns void
language plpgsql set search_path='' as $$
declare signature text;
begin
  if p_phase is null or p_phase not in ('compatibility','strict') or length(btrim(coalesce(p_evidence,'')))<20 then
    raise exception 'Reviewed rollout evidence is required';
  end if;
  lock table public.calendar_events,public.event_participants,public.event_card_assignments,
    public.event_card_assignment_cards,public.event_informal_assignments,public.event_restaurant_assignments
    in share row exclusive mode;
  update private.assignment_rollout set phase=p_phase,evidence=p_evidence,changed_at=clock_timestamp() where singleton;
  if not found then raise exception 'Rollout state missing'; end if;
  foreach signature in array array[
    'public.assign_team_service_bulk_tx(uuid,integer,jsonb,text,text)',
    'public.assign_scoped_cards_bulk_tx(uuid,integer,jsonb,text,text)',
    'public.assign_cards_bulk_tx(uuid,integer,jsonb,text,text)',
    'public.remove_team_event_participant_tx(uuid,integer,text,boolean,text)',
    'public.remove_service_participant_compat_tx(uuid,integer,text,boolean,text)'
  ] loop
    execute format('revoke all on function %s from public,anon,authenticated',signature);
    if p_phase='compatibility' then
      execute format('grant execute on function %s to anon,authenticated',signature);
    end if;
  end loop;
  notify pgrst,'reload schema';
end $$;
revoke all on function private.set_assignment_rollout_phase(text,text) from public,anon,authenticated;
notify pgrst,'reload schema';
