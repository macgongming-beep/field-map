-- 1400 후속 핫픽스.
-- SQL NULL 전파로 작성자 미연결 기록의 소유권 검사가 건너뛰어지는 문제를 막고,
-- 기록 결과 제약과 자동 초기화가 무효 기록 계약을 따르게 한다.

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
  v_owner boolean := false;
  v_next_visitor text;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  v_actor_id := public.verify_session(p_token);
  select name, role into v_actor_name, v_actor_role from public.app_users where id = v_actor_id;
  select * into v_row from public.visit_histories where id = p_history_id for update;
  if not found or v_row.invalidated_at is not null then raise exception '유효한 방문기록을 찾을 수 없습니다'; end if;

  v_owner := coalesce(v_row.created_by_user_id = v_actor_id, false)
    or coalesce(
      v_row.created_by_user_id is null
      and nullif(btrim(v_row.visitor_name), '') is not null
      and v_row.visitor_name = v_actor_name,
      false
    );
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
  if p_result not in ('만남','부재','대상외','거절','확인필요') then
    raise exception '방문 결과는 만남·부재·대상외·거절·확인필요 중 하나여야 합니다' using errcode = '22023';
  end if;
  if p_time_slot not in ('오전','오후','저녁') then raise exception '방문 시간대가 올바르지 않습니다' using errcode = '22023'; end if;

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
  v_owner boolean := false;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  v_actor_id := public.verify_session(p_token);
  select name, role into v_actor_name, v_actor_role from public.app_users where id = v_actor_id;
  select * into v_row from public.visit_histories where id = p_history_id for update;
  if not found then raise exception '방문기록을 찾을 수 없습니다'; end if;
  if v_row.invalidated_at is not null then
    return jsonb_build_object('ok',true,'already_invalidated',true,'id',p_history_id,'unit_id',v_row.unit_id);
  end if;
  v_owner := coalesce(v_row.created_by_user_id = v_actor_id, false)
    or coalesce(
      v_row.created_by_user_id is null
      and nullif(btrim(v_row.visitor_name), '') is not null
      and v_row.visitor_name = v_actor_name,
      false
    );
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

create or replace function public.auto_reset_met_units()
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_enabled boolean;
  v_days integer;
  v_cutoff date;
begin
  select value = 'true' into v_enabled from public.app_settings where key = 'visit_reset_enabled';
  select value::integer into v_days from public.app_settings where key = 'visit_reset_days_met';
  if not coalesce(v_enabled, false) or coalesce(v_days, 0) <= 0 then return; end if;

  v_cutoff := current_date - v_days;
  update public.units u
  set status = '미방문'
  where u.status = '만남'
    and not exists (
      select 1 from public.visit_histories vh
      where vh.unit_id = u.id
        and vh.result = '만남'
        and vh.invalidated_at is null
        and vh.visited_at > v_cutoff
    );
end;
$$;
revoke all on function public.auto_reset_met_units() from public, anon, authenticated;

do $$
declare v_update text; v_invalidate text; v_reset text;
begin
  select pg_get_functiondef('public.update_visit_history_tx(uuid,bigint,text,text,text,date,text,text)'::regprocedure) into v_update;
  select pg_get_functiondef('public.invalidate_visit_history_tx(uuid,bigint,text)'::regprocedure) into v_invalidate;
  select pg_get_functiondef('public.auto_reset_met_units()'::regprocedure) into v_reset;
  if v_update not like '%coalesce(v_row.created_by_user_id = v_actor_id, false)%'
     or v_update like '%p_result not in (''미방문''%'
     or v_invalidate not like '%coalesce(v_row.created_by_user_id = v_actor_id, false)%'
     or v_reset not like '%vh.invalidated_at is null%' then
    raise exception '방문기록 NULL 소유권 핫픽스 검증 실패';
  end if;
end $$;

notify pgrst, 'reload schema';
