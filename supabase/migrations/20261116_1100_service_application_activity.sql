alter table public.event_participants add column service_activity text not null default 'service'
  check (service_activity in ('service','return_visit'));

create or replace function private.guard_service_application_activity()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  perform 1 from public.calendar_events where id=new.event_id for update;
  if tg_op='UPDATE' and old.service_activity is distinct from new.service_activity then
    raise exception 'Cancel the existing application before changing its activity' using errcode='PT409';
  end if;
  if new.service_activity='return_visit' then
    if new.role<>'신청' or exists(select 1 from public.event_card_assignments where event_id=new.event_id and user_name=new.user_name)
      or exists(select 1 from public.event_informal_assignments where event_id=new.event_id and user_name=new.user_name)
      or exists(select 1 from public.event_restaurant_assignments where event_id=new.event_id and user_name=new.user_name) then
      raise exception 'Return visit applicants cannot receive territory assignments' using errcode='PT409';
    end if;
  end if;
  return new;
end $$;
revoke all on function private.guard_service_application_activity() from public,anon,authenticated;
create trigger guard_service_application_activity before insert or update on public.event_participants
  for each row execute function private.guard_service_application_activity();

create or replace function private.guard_return_visit_assignment()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  perform 1 from public.calendar_events where id=new.event_id for update;
  if exists(select 1 from public.event_participants where event_id=new.event_id and user_name=new.user_name and service_activity='return_visit') then
    raise exception 'Return visit applicants cannot receive territory assignments' using errcode='PT409';
  end if;
  return new;
end $$;
revoke all on function private.guard_return_visit_assignment() from public,anon,authenticated;
do $$ declare tab text; begin
  foreach tab in array array['event_card_assignments','event_card_assignment_cards','event_informal_assignments','event_restaurant_assignments'] loop
    execute format('create trigger guard_return_visit_assignment before insert or update on public.%I for each row execute function private.guard_return_visit_assignment()',tab);
  end loop;
end $$;

create or replace function public.apply_service_activity_tx(p_token uuid,p_event_id integer,p_activity text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor integer; who text; existing text; allowed boolean; inserted integer;
begin
  actor:=public.verify_session(p_token);
  if actor is null then raise exception 'Approved session required' using errcode='42501'; end if;
  select name into who from public.app_users where id=actor and is_active and approval_status='approved';
  if who is null then raise exception 'Approved session required' using errcode='42501'; end if;
  if p_activity is null or p_activity not in ('service','return_visit') then raise exception 'Invalid service activity'; end if;
  select coalesce(allow_applications,true) into allowed from public.calendar_events where id=p_event_id for update;
  if not found then raise exception 'Event not found'; end if;
  select service_activity into existing from public.event_participants where event_id=p_event_id and user_name=who;
  if found then
    if existing<>p_activity then raise exception 'Cancel existing application first' using errcode='PT409'; end if;
    return jsonb_build_object('ok',true,'created',false);
  end if;
  if not allowed then raise exception 'Applications are closed' using errcode='42501'; end if;
  if exists(select 1 from public.event_cart_applications where event_id=p_event_id and user_id=actor) then
    raise exception 'Cancel existing cart application first' using errcode='PT409';
  end if;
  insert into public.event_participants(event_id,user_name,role,service_activity)
    values(p_event_id,who,'신청',p_activity) on conflict(event_id,user_name) do nothing;
  get diagnostics inserted=row_count;
  select service_activity into existing from public.event_participants where event_id=p_event_id and user_name=who;
  if existing is distinct from p_activity then raise exception 'Application changed' using errcode='PT409'; end if;
  return jsonb_build_object('ok',true,'created',inserted=1);
end $$;
revoke all on function public.apply_service_activity_tx(uuid,integer,text) from public,anon,authenticated;
grant execute on function public.apply_service_activity_tx(uuid,integer,text) to anon,authenticated;
notify pgrst,'reload schema';
