-- 테스트 DB 전용. 역할별 장소 삭제·요청 계약을 검증하고 전부 롤백한다.
begin;

do $$
declare
  v_marker text := '_smoke_place_' || floor(extract(epoch from clock_timestamp()) * 1000)::bigint;
  v_user_id integer;
  v_leader_id integer;
  v_admin_id integer;
  v_user_token uuid := gen_random_uuid();
  v_leader_token uuid := gen_random_uuid();
  v_admin_token uuid := gen_random_uuid();
  v_card_id integer;
  v_building_id integer;
  v_unit_id bigint;
  v_result jsonb;
  v_request_id bigint;
  v_count integer;
begin
  select id into v_admin_id from public.app_users
  where role in ('admin','developer') and approval_status='approved' and is_active
  order by id limit 1;
  insert into public.app_users(login_id,name,pin,role,approval_status,is_active)
  values(v_marker||'_user',v_marker||'_사용자','4321','user','approved',true)
  returning id into v_user_id;
  insert into public.app_users(login_id,name,pin,role,approval_status,is_active)
  values(v_marker||'_leader',v_marker||'_인도자','4321','leader','approved',true)
  returning id into v_leader_id;
  insert into public.auth_sessions(token,user_id) values
    (v_user_token,v_user_id),(v_leader_token,v_leader_id),(v_admin_token,v_admin_id);
  select id into v_card_id from public.cards order by id limit 1;

  -- 일반 사용자는 빈 장소도 직접 삭제하지 않고 요청한다.
  insert into public.buildings(card_id,name,address,type,lat,lng)
  values(v_card_id,v_marker||'_사용자건물',v_marker||' 사용자주소','주택',37.2,127.2)
  returning id into v_building_id;
  v_result := public.delete_place_or_request_tx(v_user_token,'building',v_building_id,'remove_place','잘못 등록했습니다.');
  if v_result->>'action' <> 'requested' then raise exception '일반 사용자 삭제가 요청으로 바뀌지 않았습니다'; end if;
  if not exists(select 1 from public.buildings where id=v_building_id) then raise exception '일반 사용자 요청이 실제 건물을 삭제했습니다'; end if;
  if not exists(select 1 from public.place_change_requests where building_id=v_building_id and note='잘못 등록했습니다.') then
    raise exception '일반 사용자 장소 요청이 남지 않았습니다';
  end if;

  -- 인도자는 연결 자료가 없는 건물과 세대를 즉시 정리할 수 있다.
  insert into public.buildings(card_id,name,address,type,lat,lng)
  values(v_card_id,v_marker||'_빈건물',v_marker||' 빈주소','주택',37.2,127.2)
  returning id into v_building_id;
  insert into public.units(building_id,number,status) values(v_building_id,'101','미방문');
  v_result := public.delete_place_or_request_tx(v_leader_token,'building',v_building_id,null,'');
  if v_result->>'action' <> 'deleted' or exists(select 1 from public.buildings where id=v_building_id) then
    raise exception '인도자가 빈 건물을 정리하지 못했습니다: %',v_result;
  end if;
  if not exists (
    select 1 from public.place_change_signals
    where action='deleted' and target_type='building' and building_id=v_building_id
      and cardinality(unit_ids)=1
  ) then
    raise exception '빈 건물 삭제 신호에 건물과 하위 세대가 함께 담기지 않았습니다';
  end if;

  -- 인도자는 연결 자료가 있어도 영향과 스냅샷을 기록하고 즉시 삭제한다.
  insert into public.buildings(card_id,name,address,type,lat,lng)
  values(v_card_id,v_marker||'_기록건물',v_marker||' 기록주소','주택',37.2,127.2)
  returning id into v_building_id;
  insert into public.units(building_id,number,status,created_at)
  values(v_building_id,'201','만남',now()-interval '1 day') returning id into v_unit_id;
  insert into public.visit_histories(unit_id,visitor_name,result,time_slot,visited_at)
  values(v_unit_id,v_marker||'_인도자','만남','오후',current_date);
  v_result := public.delete_place_or_request_tx(v_leader_token,'unit',v_unit_id,'unit_missing','현장 확인 필요');
  if v_result->>'action' <> 'deleted' or exists(select 1 from public.units where id=v_unit_id) then
    raise exception '인도자가 연결 자료를 감사 삭제하지 못했습니다: %',v_result;
  end if;
  if (v_result->'impact'->>'visit_history_count')::integer <> 1 then
    raise exception '인도자 삭제 결과에 방문기록 영향이 없습니다';
  end if;
  if not exists (
    select 1 from public.service_logs
    where action='unit_deleted' and target_id=v_unit_id
      and details->>'actor_role'='leader'
      and (details->'impact'->>'visit_history_count')::integer=1
  ) then
    raise exception '인도자 삭제 감사 로그가 남지 않았습니다';
  end if;

  -- 일반 사용자는 연결 자료가 있는 세대도 요청만 남긴다.
  insert into public.units(building_id,number,status,created_at)
  values(v_building_id,'202','만남',now()-interval '1 day') returning id into v_unit_id;
  insert into public.visit_histories(unit_id,visitor_name,result,time_slot,visited_at)
  values(v_unit_id,v_marker||'_사용자','만남','오후',current_date);
  v_result := public.delete_place_or_request_tx(v_user_token,'unit',v_unit_id,'remove_place','잘못된 세대');
  if v_result->>'action' <> 'requested' or not exists(select 1 from public.units where id=v_unit_id) then
    raise exception '일반 사용자의 연결 자료 삭제가 요청으로 바뀌지 않았습니다: %',v_result;
  end if;
  v_request_id := (v_result->>'request_id')::bigint;
  if (select (impact_snapshot->>'visit_history_count')::integer from public.place_change_requests where id=v_request_id) <> 1 then
    raise exception '삭제 요청에 방문 기록 영향이 저장되지 않았습니다';
  end if;

  begin
    perform public.review_place_change_request_tx(v_admin_token,v_request_id,'completed','');
    raise exception '삭제하지 않은 요청이 처리 완료로 바뀌었습니다';
  exception
    when check_violation then null;
  end;

  -- 반려는 요청만 닫고 장소와 기록을 그대로 둔다.
  perform public.review_place_change_request_tx(v_admin_token,v_request_id,'rejected','보존');
  if not exists(select 1 from public.units where id=v_unit_id)
     or not exists(select 1 from public.visit_histories where unit_id=v_unit_id) then
    raise exception '삭제 요청 반려가 장소나 기록을 삭제했습니다';
  end if;

  -- 새 요청은 관리자 확정 RPC가 장소와 연결 자료를 한 트랜잭션으로 정리한다.
  v_result := public.delete_place_or_request_tx(v_user_token,'unit',v_unit_id,null,'다시 요청');
  v_request_id := (v_result->>'request_id')::bigint;
  begin
    perform public.execute_place_deletion_request_tx(v_user_token,v_request_id);
    raise exception '일반 사용자가 관리자 삭제 확정 RPC를 통과했습니다';
  exception
    when sqlstate '42501' then null;
  end;
  if not exists(select 1 from public.units where id=v_unit_id) then
    raise exception '일반 사용자의 삭제 확정 시도가 장소를 삭제했습니다';
  end if;
  v_result := public.execute_place_deletion_request_tx(v_admin_token,v_request_id);
  if v_result->>'action' <> 'deleted' or exists(select 1 from public.units where id=v_unit_id) then
    raise exception '요청함의 관리자 영구 삭제가 실행되지 않았습니다: %',v_result;
  end if;
  if exists(select 1 from public.visit_histories where unit_id=v_unit_id) then
    raise exception '관리자 삭제 뒤 FK 연결 자료가 남았습니다';
  end if;
  if not exists(select 1 from public.place_change_requests where id=v_request_id and status='completed') then
    raise exception '영구 삭제와 요청 완료가 함께 저장되지 않았습니다';
  end if;
  if not exists (
    select 1 from public.place_change_signals
    where action='deleted' and target_type='unit' and unit_id=v_unit_id
      and unit_ids=array[v_unit_id]::bigint[]
  ) then
    raise exception '요청함의 세대 삭제 신호가 남지 않았습니다';
  end if;

  select count(*) into v_count from pg_policies
  where schemaname='public' and tablename in ('buildings','units')
    and cmd='DELETE' and policyname like 'TEMP_session_gate_%';
  if v_count <> 0 then raise exception '건물·세대의 임시 DELETE 정책이 남았습니다'; end if;
  select count(*) into v_count from pg_policies
  where schemaname='public' and tablename in ('buildings','units')
    and cmd in ('ALL','DELETE');
  if v_count <> 0 then raise exception '건물·세대 직접 DELETE 정책이 남았습니다'; end if;
  if not has_function_privilege('anon','public.delete_place_or_request_tx(uuid,text,bigint,text,text)','execute') then
    raise exception 'anon이 안전 삭제 RPC를 호출할 수 없습니다';
  end if;
  if not has_function_privilege('anon','public.execute_place_deletion_request_tx(uuid,bigint)','execute') then
    raise exception 'anon이 관리자 삭제 확정 RPC를 호출할 수 없습니다';
  end if;
  if has_table_privilege('anon','public.place_change_signals','INSERT,UPDATE,DELETE,TRUNCATE') then
    raise exception 'anon이 장소 변경 신호를 직접 쓸 수 있습니다';
  end if;
  if exists (
    select 1 from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='public'
      and tablename in ('buildings','units')
  ) or not exists (
    select 1 from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='public'
      and tablename='place_change_signals'
  ) then
    raise exception '장소 Realtime publication 구성이 신호 표 전용이 아닙니다';
  end if;
end;
$$;

rollback;
