-- 방문기록의 작성자 소유권, 정정 사유, 무효 처리를 최종 계약으로 만든다.
-- SELECT 정책은 Realtime 계약 때문에 건드리지 않는다.

alter table public.visit_histories
  add column if not exists created_by_user_id integer references public.app_users(id) on delete set null,
  add column if not exists updated_by_user_id integer references public.app_users(id) on delete set null,
  add column if not exists updated_at timestamptz,
  add column if not exists invalidated_at timestamptz,
  add column if not exists invalidated_by_user_id integer references public.app_users(id) on delete set null,
  add column if not exists invalidation_reason text;

create index if not exists visit_histories_created_by_user_id_idx
  on public.visit_histories(created_by_user_id);
create index if not exists visit_histories_valid_unit_order_idx
  on public.visit_histories(unit_id, visited_at desc, created_at desc, id desc)
  where invalidated_at is null;

-- private 스키마 자체는 anon 에 열지 않는다. 트리거가 필요한 값만 좁게 노출한다.
create or replace function public.visit_history_request_user_id()
returns integer
language sql stable security definer
set search_path = ''
as $$ select private.request_session_user_id() $$;
revoke all on function public.visit_history_request_user_id() from public;
grant execute on function public.visit_history_request_user_id() to anon, authenticated;

-- 이름이 정확히 하나의 계정과 일치할 때만 기존 작성자를 연결한다.
with unique_names as (
  select name, min(id) as user_id
  from public.app_users
  where nullif(btrim(name), '') is not null
  group by name
  having count(*) = 1
)
update public.visit_histories vh
set created_by_user_id = un.user_id
from unique_names un
where vh.created_by_user_id is null
  and vh.visitor_name = un.name;

create or replace function private.visit_history_is_owned_by_requester(p_history_id bigint)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select coalesce(exists (
    select 1
    from public.visit_histories vh
    where vh.id = p_history_id
      and (
        vh.created_by_user_id = private.request_session_user_id()
        or (
          vh.created_by_user_id is null
          and vh.visitor_name = private.request_session_user_name()
        )
      )
  ), false)
$$;
revoke all on function private.visit_history_is_owned_by_requester(bigint) from public;
grant execute on function private.visit_history_is_owned_by_requester(bigint) to anon, authenticated;

create or replace function private.recompute_unit_status_from_visits(p_unit_id integer)
returns void
language sql security definer
set search_path = ''
as $$
  update public.units u
  set status = coalesce((
    select vh.result
    from public.visit_histories vh
    where vh.unit_id = p_unit_id and vh.invalidated_at is null
    order by vh.visited_at desc, vh.created_at desc, vh.id desc
    limit 1
  ), '미방문')
  where u.id = p_unit_id
$$;
revoke all on function private.recompute_unit_status_from_visits(integer)
  from public, anon, authenticated;

create or replace function public.guard_visit_history_write()
returns trigger
language plpgsql security invoker
set search_path = ''
as $$
declare
  v_actor_id integer;
begin
  if current_user in ('postgres', 'supabase_admin', 'service_role') then return new; end if;
  v_actor_id := public.visit_history_request_user_id();
  if v_actor_id is null then
    raise exception '로그인이 필요합니다' using errcode = '42501';
  end if;

  if tg_op = 'INSERT' then
    new.created_by_user_id := v_actor_id;
    new.updated_by_user_id := null;
    new.updated_at := null;
    new.invalidated_at := null;
    new.invalidated_by_user_id := null;
    new.invalidation_reason := null;
    return new;
  end if;

  if new.id is distinct from old.id
     or new.unit_id is distinct from old.unit_id
     or new.created_at is distinct from old.created_at
     or new.created_by_user_id is distinct from old.created_by_user_id
     or new.invalidated_at is distinct from old.invalidated_at
     or new.invalidated_by_user_id is distinct from old.invalidated_by_user_id
     or new.invalidation_reason is distinct from old.invalidation_reason then
    raise exception '방문기록의 소유권·무효 상태는 전용 기능으로만 바꿀 수 있습니다' using errcode = '42501';
  end if;
  if new.visitor_name is distinct from old.visitor_name then
    raise exception '방문자 변경은 사유를 남기는 정정 기능으로만 할 수 있습니다' using errcode = '42501';
  end if;

  new.updated_by_user_id := v_actor_id;
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function public.guard_visit_history_write() from public, anon, authenticated;
drop trigger if exists visit_histories_guard_visitor on public.visit_histories;
drop trigger if exists visit_histories_guard_write on public.visit_histories;
create trigger visit_histories_guard_write
before insert or update on public.visit_histories
for each row execute function public.guard_visit_history_write();

create or replace function private.after_visit_history_change()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  perform private.recompute_unit_status_from_visits(coalesce(new.unit_id, old.unit_id));
  return coalesce(new, old);
end;
$$;
revoke all on function private.after_visit_history_change() from public, anon, authenticated;
drop trigger if exists visit_histories_recompute_unit_status on public.visit_histories;
create trigger visit_histories_recompute_unit_status
after insert or update or delete on public.visit_histories
for each row execute function private.after_visit_history_change();

create or replace function public.update_visit_history_tx(
  p_token uuid,
  p_history_id bigint,
  p_result text,
  p_time_slot text,
  p_memo text,
  p_visited_at date,
  p_visitor_name text default null,
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
  v_row public.visit_histories%rowtype;
  v_owner boolean;
  v_next_visitor text;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  v_actor_id := public.verify_session(p_token);
  select name, role into v_actor_name, v_actor_role from public.app_users where id = v_actor_id;
  select * into v_row from public.visit_histories where id = p_history_id for update;
  if not found or v_row.invalidated_at is not null then raise exception '유효한 방문기록을 찾을 수 없습니다'; end if;

  v_owner := v_row.created_by_user_id = v_actor_id
    or (v_row.created_by_user_id is null and v_row.visitor_name = v_actor_name);
  if not v_owner and not coalesce(v_actor_role in ('leader','admin','developer'), false) then
    raise exception '다른 사람의 방문기록을 수정할 권한이 없습니다' using errcode = '42501';
  end if;
  v_next_visitor := coalesce(nullif(btrim(p_visitor_name), ''), v_row.visitor_name);
  if v_actor_role not in ('leader','admin','developer') and v_next_visitor is distinct from v_row.visitor_name then
    raise exception '방문자는 인도자·관리자만 바꿀 수 있습니다' using errcode = '42501';
  end if;
  if (not v_owner or v_next_visitor is distinct from v_row.visitor_name) and v_reason is null then
    raise exception '다른 사람의 기록 정정이나 방문자 변경에는 사유가 필요합니다' using errcode = '22023';
  end if;
  if p_result not in ('미방문','만남','부재','대상외','거절','확인필요') then raise exception '방문 결과가 올바르지 않습니다'; end if;
  if p_time_slot not in ('오전','오후','저녁') then raise exception '방문 시간대가 올바르지 않습니다'; end if;

  update public.visit_histories
  set result = p_result, time_slot = p_time_slot, memo = nullif(btrim(coalesce(p_memo,'')), ''),
      visited_at = p_visited_at, visitor_name = v_next_visitor,
      updated_by_user_id = v_actor_id, updated_at = now()
  where id = p_history_id;

  insert into public.service_logs(actor_id, actor_name, action, target_type, target_id, details)
  values (v_actor_id, v_actor_name, 'visit_updated', 'visit_history', p_history_id::integer,
    jsonb_build_object('actor_role',v_actor_role,'reason',v_reason,'unit_id',v_row.unit_id,
      'before',jsonb_build_object('visitor',v_row.visitor_name,'result',v_row.result,'time_slot',v_row.time_slot,'memo',v_row.memo,'visited_at',v_row.visited_at),
      'after',jsonb_build_object('visitor',v_next_visitor,'result',p_result,'time_slot',p_time_slot,'memo',nullif(btrim(coalesce(p_memo,'')),''),'visited_at',p_visited_at)));
  return jsonb_build_object('ok',true,'id',p_history_id,'unit_id',v_row.unit_id);
end;
$$;
revoke all on function public.update_visit_history_tx(uuid,bigint,text,text,text,date,text,text) from public, anon, authenticated;
grant execute on function public.update_visit_history_tx(uuid,bigint,text,text,text,date,text,text) to anon, authenticated;

create or replace function public.invalidate_visit_history_tx(
  p_token uuid,
  p_history_id bigint,
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
  v_row public.visit_histories%rowtype;
  v_owner boolean;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  v_actor_id := public.verify_session(p_token);
  select name, role into v_actor_name, v_actor_role from public.app_users where id = v_actor_id;
  select * into v_row from public.visit_histories where id = p_history_id for update;
  if not found then raise exception '방문기록을 찾을 수 없습니다'; end if;
  if v_row.invalidated_at is not null then
    return jsonb_build_object('ok',true,'already_invalidated',true,'id',p_history_id,'unit_id',v_row.unit_id);
  end if;
  v_owner := v_row.created_by_user_id = v_actor_id
    or (v_row.created_by_user_id is null and v_row.visitor_name = v_actor_name);
  if not v_owner and not coalesce(v_actor_role in ('leader','admin','developer'), false) then
    raise exception '다른 사람의 방문기록을 무효 처리할 권한이 없습니다' using errcode = '42501';
  end if;
  if not v_owner and v_reason is null then
    raise exception '다른 사람의 기록을 무효 처리하려면 사유가 필요합니다' using errcode = '22023';
  end if;
  v_reason := coalesce(v_reason, '잘못 기록함');

  update public.visit_histories
  set invalidated_at = now(), invalidated_by_user_id = v_actor_id,
      invalidation_reason = v_reason, updated_by_user_id = v_actor_id, updated_at = now()
  where id = p_history_id;

  insert into public.service_logs(actor_id, actor_name, action, target_type, target_id, details)
  values (v_actor_id, v_actor_name, 'visit_invalidated', 'visit_history', p_history_id::integer,
    jsonb_build_object('actor_role',v_actor_role,'reason',v_reason,'unit_id',v_row.unit_id,
      'record',jsonb_build_object('visitor',v_row.visitor_name,'result',v_row.result,'time_slot',v_row.time_slot,'memo',v_row.memo,'visited_at',v_row.visited_at)));
  return jsonb_build_object('ok',true,'id',p_history_id,'unit_id',v_row.unit_id);
end;
$$;
revoke all on function public.invalidate_visit_history_tx(uuid,bigint,text) from public, anon, authenticated;
grant execute on function public.invalidate_visit_history_tx(uuid,bigint,text) to anon, authenticated;

-- 보존기간 정리는 유일한 실제 DELETE 경로다. 삭제 뒤 상태도 유효 기록만 본다.
create or replace function public.delete_old_visit_histories(cutoff_date text)
returns integer
language plpgsql security definer
set search_path = ''
as $$
declare
  v_count integer;
  v_affected_ids integer[];
  v_cutoff date;
  v_actor_id integer;
  v_actor_name text;
begin
  if not coalesce(private.request_is_admin(), false) then
    raise exception '관리자만 할 수 있습니다' using errcode = '42501';
  end if;
  begin v_cutoff := cutoff_date::date;
  exception when invalid_datetime_format or datetime_field_overflow then
    raise exception '올바른 기준 날짜가 아닙니다' using errcode = '22007';
  end;

  select array_agg(distinct unit_id) into v_affected_ids
  from public.visit_histories where visited_at < v_cutoff;
  delete from public.visit_histories where visited_at < v_cutoff;
  get diagnostics v_count = row_count;

  if v_affected_ids is not null then
    perform private.recompute_unit_status_from_visits(affected.id)
    from unnest(v_affected_ids) as affected(id);
  end if;
  v_actor_id := private.request_session_user_id();
  select name into v_actor_name from public.app_users where id = v_actor_id;
  insert into public.service_logs(actor_id, actor_name, action, target_type, details)
  values (v_actor_id, coalesce(v_actor_name,'관리자'), 'visit_history_maintenance_deleted', 'visit_history',
    jsonb_build_object('cutoff_date',v_cutoff,'deleted_count',v_count,'affected_unit_count',coalesce(cardinality(v_affected_ids),0)));
  return v_count;
end;
$$;
revoke all on function public.delete_old_visit_histories(text) from public, anon, authenticated;
grant execute on function public.delete_old_visit_histories(text) to anon, authenticated;

drop policy if exists "TEMP_session_gate_visit_histories_ins" on public.visit_histories;
drop policy if exists "TEMP_session_gate_visit_histories_upd" on public.visit_histories;
drop policy if exists "TEMP_session_gate_visit_histories_del" on public.visit_histories;
drop policy if exists role_member_visit_histories_insert on public.visit_histories;
drop policy if exists role_owner_visit_histories_update on public.visit_histories;
create policy role_member_visit_histories_insert on public.visit_histories for insert to anon, authenticated
  with check ((select private.request_session_user_id()) is not null);
create policy role_owner_visit_histories_update on public.visit_histories for update to anon, authenticated
  using ((select private.visit_history_is_owned_by_requester(id)))
  with check ((select private.visit_history_is_owned_by_requester(id)));
-- 실제 행 삭제는 관리자 유지보수 RPC에서만 한다.
revoke truncate, references, trigger on public.visit_histories from public, anon, authenticated;

notify pgrst, 'reload schema';

do $$
declare v_temp integer; v_final integer; v_select integer; v_delete integer;
begin
  select count(*) into v_temp from pg_policies where schemaname='public' and tablename='visit_histories' and policyname like 'TEMP_session_gate_%';
  select count(*) into v_final from pg_policies where schemaname='public' and tablename='visit_histories' and policyname in ('role_member_visit_histories_insert','role_owner_visit_histories_update');
  select count(*) into v_select from pg_policies where schemaname='public' and tablename='visit_histories' and cmd='SELECT' and qual='true';
  select count(*) into v_delete from pg_policies where schemaname='public' and tablename='visit_histories' and cmd in ('ALL','DELETE');
  if v_temp<>0 or v_final<>2 or v_select<1 or v_delete<>0 then
    raise exception '방문기록 정책 검증 실패: TEMP %, final %, SELECT %, DELETE %',v_temp,v_final,v_select,v_delete;
  end if;
end $$;
