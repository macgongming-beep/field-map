-- 역할 정책 역리뷰 후속: 기록 보존, 장소 삭제 감사, 출입불가 해제, 참가 취소 계약.
-- SELECT 정책은 Realtime 계약 때문에 변경하지 않는다.

-- ── 재방문 기록: 이름이 아니라 사용자 ID가 소유권의 근거다. ──────────────
alter table public.return_visit_logs
  add column if not exists created_by_user_id integer references public.app_users(id) on delete set null,
  add column if not exists updated_by_user_id integer references public.app_users(id) on delete set null,
  add column if not exists updated_at timestamptz,
  add column if not exists invalidated_at timestamptz,
  add column if not exists invalidated_by_user_id integer references public.app_users(id) on delete set null,
  add column if not exists invalidation_reason text;

create index if not exists return_visit_logs_created_by_user_id_idx
  on public.return_visit_logs(created_by_user_id);
create index if not exists return_visit_logs_valid_visit_order_idx
  on public.return_visit_logs(return_visit_id, visited_at desc, id desc)
  where invalidated_at is null;

with unique_names as (
  select name, min(id) as user_id
  from public.app_users
  where nullif(btrim(name), '') is not null
  group by name
  having count(*) = 1
)
update public.return_visit_logs l
set created_by_user_id = u.user_id
from unique_names u
where l.created_by_user_id is null and l.created_by = u.name;

create or replace function public.guard_return_visit_log_write()
returns trigger
language plpgsql security invoker
set search_path = ''
as $$
declare v_actor_id integer;
begin
  v_actor_id := public.visit_history_request_user_id();
  if tg_op = 'INSERT' then
    if v_actor_id is not null then
      new.created_by_user_id := v_actor_id;
    elsif current_user not in ('postgres', 'supabase_admin', 'service_role') then
      raise exception '로그인이 필요합니다' using errcode = '42501';
    end if;
    new.updated_by_user_id := null;
    new.updated_at := null;
    new.invalidated_at := null;
    new.invalidated_by_user_id := null;
    new.invalidation_reason := null;
    return new;
  end if;
  if current_user in ('postgres', 'supabase_admin', 'service_role') then return new; end if;
  raise exception '정기방문 기록은 전용 기능으로만 수정할 수 있습니다' using errcode = '42501';
end;
$$;
revoke all on function public.guard_return_visit_log_write() from public, anon, authenticated;
drop trigger if exists guard_return_visit_log_write_trigger on public.return_visit_logs;
create trigger guard_return_visit_log_write_trigger
before insert or update on public.return_visit_logs
for each row execute function public.guard_return_visit_log_write();

create or replace function private.recompute_return_visit_summary(p_return_visit_id bigint)
returns void
language sql security definer
set search_path = ''
as $$
  update public.return_visits rv
  set last_visited_at = x.visited_at,
      last_result = x.result
  from lateral (
    select l.visited_at, l.result
    from public.return_visit_logs l
    where l.return_visit_id = p_return_visit_id
      and l.invalidated_at is null
      and l.result is not null
    order by l.visited_at desc, l.id desc
    limit 1
  ) x
  where rv.id = p_return_visit_id;

  update public.return_visits rv
  set last_visited_at = null, last_result = null
  where rv.id = p_return_visit_id
    and not exists (
      select 1 from public.return_visit_logs l
      where l.return_visit_id = p_return_visit_id
        and l.invalidated_at is null and l.result is not null
    )
$$;
revoke all on function private.recompute_return_visit_summary(bigint)
  from public, anon, authenticated;

create or replace function public.update_return_visit_log_tx(
  p_token uuid,
  p_log_id bigint,
  p_result text,
  p_memo text,
  p_reason text default ''
)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_actor_id integer;
  v_actor_name text;
  v_actor_role text;
  v_row public.return_visit_logs%rowtype;
  v_owner boolean := false;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  v_actor_id := public.verify_session(p_token);
  select name, role into v_actor_name, v_actor_role from public.app_users where id = v_actor_id;
  select * into v_row from public.return_visit_logs where id = p_log_id for update;
  if not found or v_row.invalidated_at is not null then
    raise exception '유효한 정기방문 기록을 찾을 수 없습니다';
  end if;
  v_owner := coalesce(v_row.created_by_user_id = v_actor_id, false)
    or coalesce(v_row.created_by_user_id is null
      and nullif(btrim(v_row.created_by), '') is not null
      and v_row.created_by = v_actor_name, false);
  if not v_owner and not coalesce(v_actor_role in ('leader','admin','developer'), false) then
    raise exception '다른 사람의 기록을 수정할 권한이 없습니다' using errcode = '42501';
  end if;
  if not v_owner and v_reason is null then
    raise exception '다른 사람의 기록을 수정하려면 사유가 필요합니다' using errcode = '22023';
  end if;
  if p_result is not null and p_result not in ('만남','부재') then
    raise exception '정기방문 결과가 올바르지 않습니다' using errcode = '22023';
  end if;

  update public.return_visit_logs
  set result = p_result, memo = coalesce(p_memo, ''),
      updated_by_user_id = v_actor_id, updated_at = now()
  where id = p_log_id;
  perform private.recompute_return_visit_summary(v_row.return_visit_id);
  insert into public.service_logs(actor_id, actor_name, action, target_type, target_id, details)
  values (v_actor_id, v_actor_name, 'return_visit_log_updated', 'return_visit_log', p_log_id::integer,
    jsonb_build_object('actor_role',v_actor_role,'reason',v_reason,'return_visit_id',v_row.return_visit_id,
      'before',jsonb_build_object('result',v_row.result,'memo',v_row.memo),
      'after',jsonb_build_object('result',p_result,'memo',coalesce(p_memo,''))));
  return jsonb_build_object('ok',true,'id',p_log_id,'return_visit_id',v_row.return_visit_id);
end;
$$;
revoke all on function public.update_return_visit_log_tx(uuid,bigint,text,text,text)
  from public, anon, authenticated;
grant execute on function public.update_return_visit_log_tx(uuid,bigint,text,text,text)
  to anon, authenticated;

create or replace function public.invalidate_return_visit_log_tx(
  p_token uuid,
  p_log_id bigint,
  p_reason text default ''
)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_actor_id integer;
  v_actor_name text;
  v_actor_role text;
  v_row public.return_visit_logs%rowtype;
  v_owner boolean := false;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  v_actor_id := public.verify_session(p_token);
  select name, role into v_actor_name, v_actor_role from public.app_users where id = v_actor_id;
  select * into v_row from public.return_visit_logs where id = p_log_id for update;
  if not found then raise exception '정기방문 기록을 찾을 수 없습니다'; end if;
  if v_row.invalidated_at is not null then
    return jsonb_build_object('ok',true,'already_invalidated',true,'id',p_log_id);
  end if;
  v_owner := coalesce(v_row.created_by_user_id = v_actor_id, false)
    or coalesce(v_row.created_by_user_id is null
      and nullif(btrim(v_row.created_by), '') is not null
      and v_row.created_by = v_actor_name, false);
  if not v_owner and not coalesce(v_actor_role in ('leader','admin','developer'), false) then
    raise exception '다른 사람의 기록을 무효 처리할 권한이 없습니다' using errcode = '42501';
  end if;
  if not v_owner and v_reason is null then
    raise exception '다른 사람의 기록을 무효 처리하려면 사유가 필요합니다' using errcode = '22023';
  end if;
  v_reason := coalesce(v_reason, '잘못 기록함');

  update public.return_visit_logs
  set invalidated_at = now(), invalidated_by_user_id = v_actor_id,
      invalidation_reason = v_reason, updated_by_user_id = v_actor_id, updated_at = now()
  where id = p_log_id;
  perform private.recompute_return_visit_summary(v_row.return_visit_id);
  insert into public.service_logs(actor_id, actor_name, action, target_type, target_id, details)
  values (v_actor_id, v_actor_name, 'return_visit_log_invalidated', 'return_visit_log', p_log_id::integer,
    jsonb_build_object('actor_role',v_actor_role,'reason',v_reason,'return_visit_id',v_row.return_visit_id,
      'record',jsonb_build_object('created_by',v_row.created_by,'result',v_row.result,
        'memo',v_row.memo,'visited_at',v_row.visited_at)));
  return jsonb_build_object('ok',true,'id',p_log_id,'return_visit_id',v_row.return_visit_id);
end;
$$;
revoke all on function public.invalidate_return_visit_log_tx(uuid,bigint,text)
  from public, anon, authenticated;
grant execute on function public.invalidate_return_visit_log_tx(uuid,bigint,text)
  to anon, authenticated;

drop policy if exists role_owner_return_visit_logs_insert on public.return_visit_logs;
drop policy if exists role_owner_return_visit_logs_update on public.return_visit_logs;
drop policy if exists role_owner_return_visit_logs_delete on public.return_visit_logs;
create policy role_owner_return_visit_logs_insert on public.return_visit_logs
  for insert to anon, authenticated
  with check (
    created_by_user_id = (select private.request_session_user_id())
    and created_by = (select private.request_session_user_name())
    and exists (
      select 1 from public.return_visits rv
      where rv.id = return_visit_id and rv.ended_at is null
        and (rv.assigned_user_name = (select private.request_session_user_name())
          or (select private.request_is_service_manager()))
    )
  );

-- 작성자 계정이 사라져 소유권이 이름 비교로 되돌아가지 않게 한다.
alter table public.return_visit_logs drop constraint if exists return_visit_logs_created_by_user_id_fkey;
alter table public.return_visit_logs add constraint return_visit_logs_created_by_user_id_fkey
  foreign key (created_by_user_id) references public.app_users(id) on delete restrict;
alter table public.visit_histories drop constraint if exists visit_histories_created_by_user_id_fkey;
alter table public.visit_histories add constraint visit_histories_created_by_user_id_fkey
  foreign key (created_by_user_id) references public.app_users(id) on delete restrict;

-- ── 장소 삭제: 연결 자료는 요청으로 보내고, 실제 삭제는 복구 자료와 사유를 남긴다. ──
create or replace function private.place_impact_snapshot(p_target_type text, p_target_id bigint)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare v_unit_ids bigint[]; v_return_ids bigint[]; v_result jsonb;
begin
  if p_target_type = 'unit' then
    v_unit_ids := array[p_target_id];
  elsif p_target_type = 'building' then
    select coalesce(array_agg(id::bigint), '{}') into v_unit_ids
    from public.units where building_id = p_target_id;
  else
    raise exception '삭제 대상 종류가 올바르지 않습니다';
  end if;
  select coalesce(array_agg(id::bigint), '{}') into v_return_ids
  from public.return_visits
  where unit_id = any(v_unit_ids)
     or (p_target_type = 'building' and building_id = p_target_id);

  select jsonb_build_object(
    'unit_count', cardinality(v_unit_ids),
    'visit_history_count', (select count(*) from public.visit_histories where unit_id = any(v_unit_ids)),
    'regular_visit_count', (select count(*) from public.regular_visits where unit_id = any(v_unit_ids)),
    'return_visit_count', cardinality(v_return_ids),
    'phone_survey_count', (select count(*) from public.phone_surveys where unit_id = any(v_unit_ids)),
    'assignment_count', (select count(*) from public.event_restaurant_assignments
      where unit_id = any(v_unit_ids) or (p_target_type='building' and building_id=p_target_id)),
    'rows', jsonb_build_object(
      'units', coalesce((select jsonb_agg(to_jsonb(x)) from public.units x where x.id = any(v_unit_ids)), '[]'::jsonb),
      'visit_histories', coalesce((select jsonb_agg(to_jsonb(x)) from public.visit_histories x where x.unit_id = any(v_unit_ids)), '[]'::jsonb),
      'regular_visits', coalesce((select jsonb_agg(to_jsonb(x)) from public.regular_visits x where x.unit_id = any(v_unit_ids)), '[]'::jsonb),
      'return_visits', coalesce((select jsonb_agg(to_jsonb(x)) from public.return_visits x where x.id = any(v_return_ids)), '[]'::jsonb),
      'return_visit_logs', coalesce((select jsonb_agg(to_jsonb(x)) from public.return_visit_logs x where x.return_visit_id = any(v_return_ids)), '[]'::jsonb),
      'phone_surveys', coalesce((select jsonb_agg(to_jsonb(x)) from public.phone_surveys x where x.unit_id = any(v_unit_ids)), '[]'::jsonb),
      'event_restaurant_assignments', coalesce((select jsonb_agg(to_jsonb(x)) from public.event_restaurant_assignments x
        where x.unit_id = any(v_unit_ids) or (p_target_type='building' and x.building_id=p_target_id)), '[]'::jsonb),
      'building_access_events', coalesce((select jsonb_agg(to_jsonb(x)) from public.building_access_events x
        where p_target_type='building' and x.building_id=p_target_id), '[]'::jsonb)
    )
  ) into v_result;
  return v_result;
end;
$$;
revoke all on function private.place_impact_snapshot(text,bigint) from public, anon, authenticated;

create or replace function public.delete_place_or_request_tx(
  p_token uuid, p_target_type text, p_target_id bigint,
  p_request_type text default null, p_note text default ''
)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_actor_id integer; v_actor_name text; v_actor_role text;
  v_has_links boolean; v_request jsonb; v_existing_request_id bigint;
  v_impact jsonb; v_reason text := nullif(btrim(coalesce(p_note,'')), '');
begin
  v_actor_id := public.verify_session(p_token);
  select name, role into v_actor_name, v_actor_role from public.app_users where id=v_actor_id;
  if p_target_type not in ('building','unit') then raise exception '삭제 대상 종류가 올바르지 않습니다'; end if;
  if v_reason is null then raise exception '삭제 사유를 입력해 주세요' using errcode='22023'; end if;
  if p_target_type='building' then
    perform 1 from public.buildings where id=p_target_id for update;
  else
    perform 1 from public.units where id=p_target_id for update;
  end if;
  if not found then raise exception '장소를 찾을 수 없습니다'; end if;

  v_has_links := private.place_has_linked_data(p_target_type,p_target_id);
  if v_actor_role='user' or v_has_links then
    select id into v_existing_request_id from public.place_change_requests
    where status='pending' and request_type='remove_place'
      and ((p_target_type='unit' and unit_id=p_target_id)
        or (p_target_type='building' and building_id=p_target_id and unit_id is null))
    order by id desc limit 1;
    if v_existing_request_id is not null then
      update public.place_change_requests
      set impact_snapshot=private.place_impact_snapshot(p_target_type,p_target_id), note=v_reason
      where id=v_existing_request_id;
      return jsonb_build_object('ok',true,'action','requested','request_id',v_existing_request_id,
        'has_linked_data',v_has_links,'already_requested',true);
    end if;
    v_request := public.submit_place_change_request_tx(
      p_token,coalesce(p_request_type,'remove_place'),
      case when p_target_type='building' then p_target_id else null end,
      case when p_target_type='unit' then p_target_id else null end,
      null,v_reason);
    return jsonb_build_object('ok',true,'action','requested','request_id',v_request->'id','has_linked_data',v_has_links);
  end if;
  if not coalesce(v_actor_role in ('leader','admin','developer'),false) then
    raise exception '장소를 삭제할 권한이 없습니다' using errcode='42501';
  end if;
  v_impact := private.place_impact_snapshot(p_target_type,p_target_id);
  perform private.queue_place_deletion_signal(p_target_type,p_target_id);
  perform private.log_place_deletion(v_actor_id,v_actor_name,v_actor_role,p_target_type,p_target_id,v_impact,v_reason);
  if p_target_type='unit' then delete from public.units where id=p_target_id;
  else delete from public.buildings where id=p_target_id; end if;
  return jsonb_build_object('ok',true,'action','deleted','has_linked_data',false,'impact',v_impact);
end;
$$;
revoke all on function public.delete_place_or_request_tx(uuid,text,bigint,text,text)
  from public, anon, authenticated;
grant execute on function public.delete_place_or_request_tx(uuid,text,bigint,text,text)
  to anon, authenticated;

create or replace function public.set_building_access_tx(
  p_token uuid, p_building_id integer, p_blocked boolean, p_note text default ''
)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare v_actor_id integer; v_actor_name text; v_actor_role text;
  v_status text := case when p_blocked then 'blocked' else 'normal' end;
  v_action text := case when p_blocked then 'blocked' else 'reopened' end;
begin
  v_actor_id := public.verify_session(p_token);
  select name,role into v_actor_name,v_actor_role from public.app_users where id=v_actor_id;
  if v_actor_name is null then raise exception '사용자를 확인할 수 없습니다'; end if;
  if not p_blocked and not coalesce(v_actor_role in ('leader','admin','developer'),false) then
    raise exception '건물 출입불가 해제는 인도자·관리자만 할 수 있습니다' using errcode='42501';
  end if;
  update public.buildings set access_status=v_status, warning=p_blocked
  where id=p_building_id and access_status is distinct from v_status;
  if not found then
    if not exists(select 1 from public.buildings where id=p_building_id) then raise exception '건물을 찾을 수 없습니다'; end if;
    return jsonb_build_object('ok',true,'changed',false,'status',v_status);
  end if;
  insert into public.building_access_events(building_id,action,visitor_name,visited_at,memo)
  values(p_building_id,v_action,v_actor_name,current_date,nullif(btrim(p_note),''));
  return jsonb_build_object('ok',true,'changed',true,'status',v_status);
end;
$$;
revoke all on function public.set_building_access_tx(uuid,integer,boolean,text)
  from public, anon, authenticated;
grant execute on function public.set_building_access_tx(uuid,integer,boolean,text)
  to anon, authenticated;

-- 본인은 본인이 신청한 줄만 취소한다. 배정·손님 줄은 일정 인도자가 관리한다.
drop policy if exists role_event_participants_delete on public.event_participants;
create policy role_event_participants_delete on public.event_participants
  for delete to public using (
    (select public.session_can_manage_event(event_id))
    or (
      role='신청' and user_name=(
        select u.name from public.app_users u
        where u.id=(select private.request_session_user_id())
      )
    )
  );

notify pgrst, 'reload schema';

do $$
declare
  v_direct_log_writes integer;
  v_participant_delete integer;
begin
  select count(*) into v_direct_log_writes
  from pg_policies
  where schemaname='public' and tablename='return_visit_logs' and cmd in ('UPDATE','DELETE','ALL');
  if v_direct_log_writes <> 0 then
    raise exception 'return_visit_logs 직접 수정·삭제 정책이 남아 있습니다: %', v_direct_log_writes;
  end if;
  if not has_function_privilege('anon','public.update_return_visit_log_tx(uuid,bigint,text,text,text)','EXECUTE')
     or not has_function_privilege('anon','public.invalidate_return_visit_log_tx(uuid,bigint,text)','EXECUTE')
     or not has_function_privilege('anon','public.delete_place_or_request_tx(uuid,text,bigint,text,text)','EXECUTE')
     or not has_function_privilege('anon','public.set_building_access_tx(uuid,integer,boolean,text)','EXECUTE') then
    raise exception '후속 보안 RPC 실행권한이 빠졌습니다';
  end if;
  select count(*) into v_participant_delete
  from pg_policies
  where schemaname='public' and tablename='event_participants'
    and policyname='role_event_participants_delete'
    and qual like '%role%신청%';
  if v_participant_delete <> 1 then
    raise exception '신청 취소 정책이 role=신청으로 제한되지 않았습니다';
  end if;
  if not exists (
    select 1 from information_schema.table_constraints
    where constraint_schema='public' and table_name='visit_histories'
      and constraint_name='visit_histories_created_by_user_id_fkey'
  ) then
    raise exception '방문기록 작성자 보존 FK가 없습니다';
  end if;
end $$;
