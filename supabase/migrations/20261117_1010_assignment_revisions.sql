-- Keep revisions off calendar_events: an application must not broadcast a full
-- calendar update to every client. PostgREST exposes the revision as a computed field.
create table private.event_assignment_revisions (
  event_id integer primary key references public.calendar_events(id) on delete cascade,
  revision bigint not null default 0
);
revoke all on private.event_assignment_revisions from public,anon,authenticated;
create function public.assignment_revision(e public.calendar_events) returns bigint
language sql stable security definer set search_path='' as $$
  select coalesce((select revision from private.event_assignment_revisions where event_id=e.id),0);
$$;
revoke all on function public.assignment_revision(public.calendar_events) from public;
grant execute on function public.assignment_revision(public.calendar_events) to anon,authenticated;

create function private.track_assignment_revision() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_event_id integer; guarded boolean; who text;
begin
  v_event_id:=case when tg_op='DELETE' then old.event_id else new.event_id end;
  if tg_op='UPDATE' and old.event_id<>new.event_id then raise exception 'Event ownership cannot change'; end if;
  perform 1 from public.calendar_events where id=v_event_id for update;
  if not found then return coalesce(new,old); end if;
  guarded:=coalesce(current_setting('app.assignment_write_event',true),'')=v_event_id::text;
  if tg_when='BEFORE' then
    if tg_table_name in ('event_card_assignments','event_card_assignment_cards') and not guarded then
      raise exception 'Versioned assignment save required' using errcode='42501';
    end if;
    if tg_table_name='event_participants' and tg_op='DELETE' and not guarded then
      select name into who from public.app_users where id=private.request_session_user_id();
      if who is distinct from old.user_name and exists(select 1 from public.event_card_assignments where event_id=v_event_id and user_name=old.user_name) then
        raise exception 'Versioned participant removal required' using errcode='42501';
      end if;
    end if;
  elsif not guarded then
    insert into private.event_assignment_revisions(event_id,revision) values(v_event_id,1)
      on conflict(event_id) do update set revision=private.event_assignment_revisions.revision+1;
  end if;
  return coalesce(new,old);
end $$;
revoke all on function private.track_assignment_revision() from public,anon,authenticated;
do $$ declare tab text; begin
  foreach tab in array array['event_participants','event_card_assignments','event_card_assignment_cards','event_informal_assignments','event_restaurant_assignments'] loop
    execute format('create trigger aa_assignment_revision_guard before insert or update or delete on public.%I for each row execute function private.track_assignment_revision()',tab);
    execute format('create trigger zz_assignment_revision_changed after insert or update or delete on public.%I for each row execute function private.track_assignment_revision()',tab);
  end loop;
end $$;

-- An authorized self-cancellation can clean its own assignment atomically.
do $$ declare def text; begin
  def:=pg_get_functiondef('private.cleanup_team_participant_removal()'::regprocedure);
  if position('k text;' in def)=0 or position('select team_key into k' in def)=0 then raise exception 'Unexpected cleanup function'; end if;
  def:=replace(def,'k text;','k text; previous_guard text;');
  def:=replace(def,'if not found or (e.assignment_team_informal is null and e.assignment_team_scopes=''{}''::jsonb) then',
    'if not found or not (exists(select 1 from public.event_card_assignments where event_id=old.event_id and user_name=old.user_name)
      or exists(select 1 from public.event_informal_assignments where event_id=old.event_id and user_name=old.user_name)
      or exists(select 1 from public.event_restaurant_assignments where event_id=old.event_id and user_name=old.user_name)) then');
  def:=replace(def,'select team_key into k',E'previous_guard:=current_setting(''app.assignment_write_event'',true);\n  perform set_config(''app.assignment_write_event'',old.event_id::text,true);\n  select team_key into k');
  def:=replace(def,E'  return old;\nend',E'  perform set_config(''app.assignment_write_event'',coalesce(previous_guard,''''),true);\n  return old;\nend');
  execute def;
end $$;

create function public.save_event_assignments_versioned_tx(
  p_token uuid,p_event_id integer,p_assignments jsonb,p_expected_revision bigint,
  p_status text default null,p_expected_shared_at text default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor integer; e public.calendar_events; result jsonb; previous_guard text; rev bigint;
begin
  actor:=public.verify_session(p_token);
  select * into e from public.calendar_events where id=p_event_id for update;
  if not found or not private.user_can_manage_event(actor,p_event_id) then raise exception 'Assignment permission denied' using errcode='42501'; end if;
  rev:=public.assignment_revision(e);
  if p_expected_revision is null or p_expected_revision<>rev then
    return jsonb_build_object('ok',false,'conflict',true,'revision',rev,'server_shared_at',e.assignment_shared_at);
  end if;
  previous_guard:=current_setting('app.assignment_write_event',true);
  perform set_config('app.assignment_write_event',p_event_id::text,true);
  result:=public.assign_team_service_bulk_tx(p_token,p_event_id,p_assignments,p_status,p_expected_shared_at);
  if coalesce((result->>'ok')::boolean,false) then
    insert into private.event_assignment_revisions(event_id,revision) values(p_event_id,rev+1)
      on conflict(event_id) do update set revision=excluded.revision;
    result:=result||jsonb_build_object('revision',rev+1);
  end if;
  perform set_config('app.assignment_write_event',coalesce(previous_guard,''),true);
  return result;
end $$;
revoke all on function public.save_event_assignments_versioned_tx(uuid,integer,jsonb,bigint,text,text) from public;
grant execute on function public.save_event_assignments_versioned_tx(uuid,integer,jsonb,bigint,text,text) to anon,authenticated;

create function public.manage_event_participant_versioned_tx(
  p_token uuid,p_event_id integer,p_user_name text,p_action text,p_expected_revision bigint,p_role text default '신청'
) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor integer; who text; e public.calendar_events; rev bigint; previous_guard text; n integer;
begin
  actor:=public.verify_session(p_token);
  select name into who from public.app_users where id=actor and is_active and approval_status='approved';
  select * into e from public.calendar_events where id=p_event_id for update;
  if not found or who is null then raise exception 'Approved session required' using errcode='42501'; end if;
  if not private.user_can_manage_event(actor,p_event_id) and not(p_action='remove' and p_user_name=who
    and exists(select 1 from public.event_participants where event_id=p_event_id and user_name=who and role='신청')) then
    raise exception 'Participant permission denied' using errcode='42501';
  end if;
  rev:=public.assignment_revision(e);
  if p_expected_revision is null or p_expected_revision<>rev then return jsonb_build_object('ok',false,'conflict',true,'revision',rev); end if;
  previous_guard:=current_setting('app.assignment_write_event',true);
  perform set_config('app.assignment_write_event',p_event_id::text,true);
  if p_action='add' and p_role in ('신청','게스트') then
    insert into public.event_participants(event_id,user_name,role) values(p_event_id,p_user_name,p_role)
      on conflict(event_id,user_name) do nothing;
    get diagnostics n=row_count;
  elsif p_action='remove' then
    delete from public.event_participants where event_id=p_event_id and user_name=p_user_name;
    get diagnostics n=row_count;
  else raise exception 'Invalid participant action'; end if;
  if n>0 then
    insert into private.event_assignment_revisions(event_id,revision) values(p_event_id,rev+1)
      on conflict(event_id) do update set revision=excluded.revision;
  end if;
  perform set_config('app.assignment_write_event',coalesce(previous_guard,''),true);
  return jsonb_build_object('ok',true,'changed',n>0,'revision',rev+case when n>0 then 1 else 0 end);
end $$;
revoke all on function public.manage_event_participant_versioned_tx(uuid,integer,text,text,bigint,text) from public;
grant execute on function public.manage_event_participant_versioned_tx(uuid,integer,text,text,bigint,text) to anon,authenticated;

-- Old clients fail closed instead of silently overwriting a newer draft.
revoke all on function public.assign_team_service_bulk_tx(uuid,integer,jsonb,text,text) from public,anon,authenticated;
revoke all on function public.assign_scoped_cards_bulk_tx(uuid,integer,jsonb,text,text) from public,anon,authenticated;
revoke all on function public.assign_cards_bulk_tx(uuid,integer,jsonb,text,text) from public,anon,authenticated;
revoke all on function public.remove_team_event_participant_tx(uuid,integer,text,boolean,text) from public,anon,authenticated;
notify pgrst,'reload schema';
