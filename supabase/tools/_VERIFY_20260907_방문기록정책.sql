do $$
declare v_temp integer; v_final integer; v_select integer; v_delete integer; v_columns integer;
begin
  select count(*) into v_temp from pg_policies where schemaname='public' and tablename='visit_histories' and policyname like 'TEMP_session_gate_%';
  select count(*) into v_final from pg_policies where schemaname='public' and tablename='visit_histories' and policyname in ('role_member_visit_histories_insert','role_owner_visit_histories_update');
  select count(*) into v_select from pg_policies where schemaname='public' and tablename='visit_histories' and cmd='SELECT' and qual='true';
  select count(*) into v_delete from pg_policies where schemaname='public' and tablename='visit_histories' and cmd in ('ALL','DELETE');
  select count(*) into v_columns from information_schema.columns where table_schema='public' and table_name='visit_histories' and column_name in ('created_by_user_id','updated_by_user_id','updated_at','invalidated_at','invalidated_by_user_id','invalidation_reason');
  if v_temp<>0 or v_final<>2 or v_select<1 or v_delete<>0 or v_columns<>6 then
    raise exception '방문기록 VERIFY 실패: TEMP %, final %, SELECT %, DELETE %, columns %/6',v_temp,v_final,v_select,v_delete,v_columns;
  end if;
  if not has_function_privilege('anon','public.update_visit_history_tx(uuid,bigint,text,text,text,date,text,text)','EXECUTE')
     or not has_function_privilege('anon','public.invalidate_visit_history_tx(uuid,bigint,text)','EXECUTE')
     or not has_function_privilege('anon','public.visit_history_request_user_id()','EXECUTE') then
    raise exception '방문기록 RPC 실행권한이 없습니다';
  end if;
end $$;

select policyname, cmd, roles, qual, with_check from pg_policies
where schemaname='public' and tablename='visit_histories' order by cmd, policyname;
