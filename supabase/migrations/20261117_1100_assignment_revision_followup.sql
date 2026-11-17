-- Demo follow-up. Keep maintenance separate from a version-checked editor save.
-- Copy the current implementations, including later account/history fixes.
do $$ declare signature text; name text; definition text; begin
  foreach name in array array['rename_user_name_references','purge_user_name_references'] loop
    signature:=case name when 'rename_user_name_references' then '(uuid,text,text)' else '(uuid,text)' end;
    definition:=pg_get_functiondef(('public.'||name||signature)::regprocedure);
    execute replace(definition,'FUNCTION public.'||name||'(', 'FUNCTION private.'||name||'_before_assignment_guard(');
    execute 'revoke all on function private.'||name||'_before_assignment_guard'||signature||' from public,anon,authenticated';
  end loop;
end $$;

create or replace function public.rename_user_name_references(p_token uuid,p_old text,p_new text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare prior text; result jsonb;
begin
  prior:=current_setting('app.assignment_maintenance',true);
  perform set_config('app.assignment_maintenance','on',true);
  result:=private.rename_user_name_references_before_assignment_guard(p_token,p_old,p_new);
  perform set_config('app.assignment_maintenance',coalesce(prior,''),true);
  return result;
end $$;
create or replace function public.purge_user_name_references(p_token uuid,p_name text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare prior text; result jsonb;
begin
  prior:=current_setting('app.assignment_maintenance',true);
  perform set_config('app.assignment_maintenance','on',true);
  result:=private.purge_user_name_references_before_assignment_guard(p_token,p_name);
  perform set_config('app.assignment_maintenance',coalesce(prior,''),true);
  return result;
end $$;

create or replace function private.track_assignment_revision() returns trigger
language plpgsql security definer set search_path='' as $$
declare eid integer; guarded boolean; maintenance boolean; cascading boolean:=false; who text; old_row jsonb;
begin
  eid:=case when tg_op='DELETE' then old.event_id else new.event_id end;
  if tg_op='UPDATE' and old.event_id<>new.event_id then raise exception 'Event ownership cannot change'; end if;
  perform 1 from public.calendar_events where id=eid for update;
  if not found then return coalesce(new,old); end if;
  guarded:=coalesce(current_setting('app.assignment_write_event',true),'')=eid::text;
  maintenance:=coalesce(current_setting('app.assignment_maintenance',true),'')='on';
  -- Accept real FK cleanup, not merely any nested trigger or any admin write.
  if tg_op='DELETE' and pg_trigger_depth()>1 then
    old_row:=to_jsonb(old);
    cascading:=case tg_table_name
      when 'event_card_assignments' then old_row->>'assigned_card_id' is not null and not exists(select 1 from public.cards where id=(old_row->>'assigned_card_id')::bigint)
      when 'event_card_assignment_cards' then not exists(select 1 from public.cards where id=(old_row->>'card_id')::bigint)
      when 'event_informal_assignments' then not exists(select 1 from public.informal_assets where id=(old_row->>'asset_id')::integer)
      when 'event_restaurant_assignments' then not exists(select 1 from public.buildings where id=(old_row->>'building_id')::bigint)
        or (old_row->>'unit_id' is not null and not exists(select 1 from public.units where id=(old_row->>'unit_id')::bigint))
      else false end;
  end if;
  if tg_when='BEFORE' and not(guarded or maintenance or cascading) then
    if tg_table_name<>'event_participants' then
      raise exception 'Versioned assignment save required' using errcode='42501';
    end if;
    select name into who from public.app_users where id=private.request_session_user_id();
    if tg_op='UPDATE' or (tg_op='DELETE' and (who is distinct from old.user_name or old.role<>'신청'))
      or (tg_op='INSERT' and (who is distinct from new.user_name or new.role<>'신청')) then
      raise exception 'Versioned participant management required' using errcode='42501';
    end if;
  elsif tg_when='AFTER' and not guarded then
    -- A new applicant does not change existing teams. Cancellation and edits do.
    if tg_table_name='event_participants' and tg_op='INSERT' then return new; end if;
    if tg_op='UPDATE' and to_jsonb(old)=to_jsonb(new) then return new; end if;
    insert into private.event_assignment_revisions(event_id,revision) values(eid,1)
      on conflict(event_id) do update set revision=private.event_assignment_revisions.revision+1;
  end if;
  return coalesce(new,old);
end $$;

create or replace function public.manage_event_participant_versioned_tx(
  p_token uuid,p_event_id integer,p_user_name text,p_action text,p_expected_revision bigint,p_role text default '신청'
) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor integer; who text; target text; e public.calendar_events; rev bigint; prior text; n integer; own_cancel boolean;
begin
  actor:=public.verify_session(p_token);
  select name into who from public.app_users where id=actor and is_active and approval_status='approved';
  select * into e from public.calendar_events where id=p_event_id for update;
  if not found or who is null then raise exception 'Approved session required' using errcode='42501'; end if;
  own_cancel:=p_action='remove' and p_user_name=who and not exists(
    select 1 from public.event_participants where event_id=p_event_id and user_name=who and role<>'신청');
  if not own_cancel and not private.user_can_manage_event(actor,p_event_id) then
    raise exception 'Participant permission denied' using errcode='42501';
  end if;
  rev:=public.assignment_revision(e);
  if not own_cancel and (p_expected_revision is null or p_expected_revision<>rev) then
    return jsonb_build_object('ok',false,'conflict',true,'revision',rev);
  end if;
  target:=p_user_name;
  if p_action in ('add','role') then
    if not private.event_participant_identity_allowed(p_user_name,p_role) then
      raise exception 'Invalid participant identity' using errcode='23514';
    end if;
    if p_role='게스트' then target:=private.normalize_person_name(p_user_name);
    else select name into target from public.app_users
      where lower(private.normalize_person_name(name))=lower(private.normalize_person_name(p_user_name)); end if;
  end if;
  prior:=current_setting('app.assignment_write_event',true);
  perform set_config('app.assignment_write_event',p_event_id::text,true);
  if p_action='add' and p_role in ('신청','게스트') then
    insert into public.event_participants(event_id,user_name,role) values(p_event_id,target,p_role)
      on conflict(event_id,user_name) do nothing;
    get diagnostics n=row_count;
  elsif p_action='remove' then
    delete from public.event_participants where event_id=p_event_id and user_name=target;
    get diagnostics n=row_count;
  elsif p_action='role' then
    update public.event_participants set role=p_role where event_id=p_event_id and user_name=target and role is distinct from p_role;
    get diagnostics n=row_count;
  else raise exception 'Invalid participant action'; end if;
  if n>0 and p_action<>'add' then
    rev:=rev+1;
    insert into private.event_assignment_revisions(event_id,revision) values(p_event_id,rev)
      on conflict(event_id) do update set revision=excluded.revision;
  end if;
  perform set_config('app.assignment_write_event',coalesce(prior,''),true);
  return jsonb_build_object('ok',true,'changed',n>0,'revision',rev);
end $$;

create function public.mutate_personal_assignment_versioned_tx(
  p_token uuid,p_event_id integer,p_expected_revision bigint,p_kind text,p_action text,
  p_user_name text default null,p_target_id bigint default null,p_unit_id bigint default null,p_assignment_id integer default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor integer; who text; e public.calendar_events; rev bigint; prior text; n integer;
begin
  actor:=public.verify_session(p_token);
  select * into e from public.calendar_events where id=p_event_id for update;
  if not found or not private.user_can_manage_event(actor,p_event_id) then raise exception 'Assignment permission denied' using errcode='42501'; end if;
  select name into who from public.app_users where id=actor;
  rev:=public.assignment_revision(e);
  if p_expected_revision is null or p_expected_revision<>rev then return jsonb_build_object('ok',false,'conflict',true,'revision',rev); end if;
  if p_kind not in ('informal','restaurant') or p_action not in ('add','remove') or p_kind is null or p_action is null then raise exception 'Invalid assignment action'; end if;
  if p_action='add' and not exists(select 1 from public.event_participants where event_id=p_event_id and user_name=p_user_name and service_activity='service') then
    raise exception 'Participant is no longer eligible' using errcode='23514';
  end if;
  if p_action='add' and p_kind='informal' and (e.assignment_team_informal is not null or not exists(
    select 1 from public.informal_assets where id=p_target_id and not archived and parent_id is null)) then raise exception 'Use team informal assignment'; end if;
  if p_action='add' and p_kind='restaurant' and (not exists(select 1 from public.buildings where id=p_target_id)
    or (p_unit_id is not null and not exists(select 1 from public.units where id=p_unit_id and building_id=p_target_id))) then raise exception 'Invalid restaurant target'; end if;
  prior:=current_setting('app.assignment_write_event',true);
  perform set_config('app.assignment_write_event',p_event_id::text,true);
  if p_kind='informal' and p_action='add' then
    insert into public.event_informal_assignments(event_id,user_name,asset_id,assigned_by) values(p_event_id,p_user_name,p_target_id,who);
  elsif p_kind='restaurant' and p_action='add' then
    insert into public.event_restaurant_assignments(event_id,user_name,building_id,unit_id,assigned_by) values(p_event_id,p_user_name,p_target_id,p_unit_id,who);
  elsif p_kind='informal' then
    delete from public.event_informal_assignments where id=p_assignment_id and event_id=p_event_id;
  else
    delete from public.event_restaurant_assignments where id=p_assignment_id and event_id=p_event_id;
  end if;
  get diagnostics n=row_count;
  if n<>1 then raise exception 'Assignment no longer exists' using errcode='40001'; end if;
  insert into private.event_assignment_revisions(event_id,revision) values(p_event_id,rev+1)
    on conflict(event_id) do update set revision=excluded.revision;
  perform set_config('app.assignment_write_event',coalesce(prior,''),true);
  return jsonb_build_object('ok',true,'revision',rev+1);
end $$;
revoke all on function public.mutate_personal_assignment_versioned_tx(uuid,integer,bigint,text,text,text,bigint,bigint,integer) from public;
grant execute on function public.mutate_personal_assignment_versioned_tx(uuid,integer,bigint,text,text,text,bigint,bigint,integer) to anon,authenticated;

-- Assignment management is not permission to rewrite other people's history.
create policy service_session_owner_update on public.service_sessions as restrictive for update
  using ((select private.request_is_admin()) or user_name=(select private.request_session_user_name()))
  with check ((select private.request_is_admin()) or user_name=(select private.request_session_user_name()));
create policy service_session_owner_delete on public.service_sessions as restrictive for delete
  using ((select private.request_is_admin()) or user_name=(select private.request_session_user_name()));
notify pgrst,'reload schema';
