-- 일정·참가자·배정 쓰기 권한을 역할 계약으로 전환한다.
-- SELECT 정책은 Realtime 계약 때문에 건드리지 않는다.

create or replace function private.user_can_manage_event(
  p_user_id integer,
  p_event_id integer
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(exists (
    select 1
    from public.app_users u
    where u.id = p_user_id
      and coalesce(u.is_active, true)
      and coalesce(u.approval_status, 'approved') = 'approved'
      and (
        u.role in ('admin', 'developer')
        or (
          u.role = 'leader'
          and exists (
            select 1
            from public.calendar_events e
            where e.id = p_event_id
              and u.name = any (
                select btrim(v)
                from unnest(string_to_array(coalesce(e.leader_name, ''), ',')) v
              )
          )
        )
      )
  ), false)
$$;
revoke all on function private.user_can_manage_event(integer, integer) from public, anon, authenticated;

create or replace function public.session_can_manage_event(p_event_id integer)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.user_can_manage_event(private.request_session_user_id(), p_event_id)
$$;
revoke all on function public.session_can_manage_event(integer) from public;
grant execute on function public.session_can_manage_event(integer) to anon, authenticated;

-- 기존 definer 함수 세 개는 본문을 복제하지 않고 숨긴 구현으로 옮긴다.
-- 공개 래퍼가 p_token의 실제 사용자로 권한을 검사한 뒤에만 구현을 부른다.
do $$
begin
  if to_regprocedure('public.assign_cards_bulk_tx_impl_20260907(uuid,integer,jsonb,text,text)') is null then
    alter function public.assign_cards_bulk_tx(uuid, integer, jsonb, text, text)
      rename to assign_cards_bulk_tx_impl_20260907;
  end if;
  if to_regprocedure('public.update_calendar_event_tx_impl_20260907(uuid,integer,jsonb,boolean)') is null then
    alter function public.update_calendar_event_tx(uuid, integer, jsonb, boolean)
      rename to update_calendar_event_tx_impl_20260907;
  end if;
  if to_regprocedure('public.update_calendar_event_series_tx_impl_20260907(uuid,uuid,date,jsonb,boolean)') is null then
    alter function public.update_calendar_event_series_tx(uuid, uuid, date, jsonb, boolean)
      rename to update_calendar_event_series_tx_impl_20260907;
  end if;
end $$;

revoke all on function public.assign_cards_bulk_tx_impl_20260907(uuid, integer, jsonb, text, text)
  from public, anon, authenticated;
revoke all on function public.update_calendar_event_tx_impl_20260907(uuid, integer, jsonb, boolean)
  from public, anon, authenticated;
revoke all on function public.update_calendar_event_series_tx_impl_20260907(uuid, uuid, date, jsonb, boolean)
  from public, anon, authenticated;

create or replace function public.assign_cards_bulk_tx(
  p_token uuid,
  p_event_id integer,
  p_assignments jsonb,
  p_status text default null,
  p_expected_shared_at text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_id integer;
begin
  v_actor_id := public.verify_session(p_token);
  if v_actor_id is null then raise exception '세션이 유효하지 않습니다'; end if;

  perform 1 from public.calendar_events where id = p_event_id for update;
  if not private.user_can_manage_event(v_actor_id, p_event_id) then
    raise exception '이 일정의 배정을 관리할 권한이 없습니다';
  end if;

  return public.assign_cards_bulk_tx_impl_20260907(
    p_token, p_event_id, p_assignments, p_status, p_expected_shared_at);
end;
$$;

create or replace function public.update_calendar_event_tx(
  p_token uuid,
  p_event_id integer,
  p_payload jsonb,
  p_notify boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_id integer;
begin
  v_actor_id := public.verify_session(p_token);
  if v_actor_id is null then raise exception '세션이 유효하지 않습니다'; end if;

  perform 1 from public.calendar_events where id = p_event_id for update;
  if not private.user_can_manage_event(v_actor_id, p_event_id) then
    raise exception '이 일정을 고칠 권한이 없습니다';
  end if;

  return public.update_calendar_event_tx_impl_20260907(
    p_token, p_event_id, p_payload, p_notify);
end;
$$;

create or replace function public.update_calendar_event_series_tx(
  p_token uuid,
  p_series_id uuid,
  p_from_date date,
  p_payload jsonb,
  p_notify boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_id integer;
  v_actor_role text;
begin
  v_actor_id := public.verify_session(p_token);
  if v_actor_id is null then raise exception '세션이 유효하지 않습니다'; end if;
  select role into v_actor_role from public.app_users where id = v_actor_id;
  if v_actor_role not in ('leader', 'admin', 'developer') then
    raise exception '반복 일정을 고칠 권한이 없습니다';
  end if;

  -- 구현 함수가 대상 전부를 잠근 뒤 각 일정의 인도자인지 다시 검사한다.
  return public.update_calendar_event_series_tx_impl_20260907(
    p_token, p_series_id, p_from_date, p_payload, p_notify);
end;
$$;

revoke all on function public.assign_cards_bulk_tx(uuid, integer, jsonb, text, text) from public;
revoke all on function public.update_calendar_event_tx(uuid, integer, jsonb, boolean) from public;
revoke all on function public.update_calendar_event_series_tx(uuid, uuid, date, jsonb, boolean) from public;
grant execute on function public.assign_cards_bulk_tx(uuid, integer, jsonb, text, text) to anon, authenticated;
grant execute on function public.update_calendar_event_tx(uuid, integer, jsonb, boolean) to anon, authenticated;
grant execute on function public.update_calendar_event_series_tx(uuid, uuid, date, jsonb, boolean) to anon, authenticated;

-- 일정 자체: 생성·삭제와 직접 수정은 관리자만. 인도자의 수정은 위 RPC만 사용한다.
drop policy if exists "TEMP_session_gate_calendar_events_ins" on public.calendar_events;
drop policy if exists "TEMP_session_gate_calendar_events_upd" on public.calendar_events;
drop policy if exists "TEMP_session_gate_calendar_events_del" on public.calendar_events;
drop policy if exists role_admin_calendar_events_insert on public.calendar_events;
drop policy if exists role_admin_calendar_events_update on public.calendar_events;
drop policy if exists role_admin_calendar_events_delete on public.calendar_events;
create policy role_admin_calendar_events_insert on public.calendar_events
  for insert to public with check ((select private.request_is_admin()));
create policy role_admin_calendar_events_update on public.calendar_events
  for update to public using ((select private.request_is_admin()))
  with check ((select private.request_is_admin()));
create policy role_admin_calendar_events_delete on public.calendar_events
  for delete to public using ((select private.request_is_admin()));

-- 참가자: 본인은 '신청'으로만 들어오고 자기 줄만 취소한다.
-- 해당 일정 인도자와 관리자는 손님·배정 참가자를 포함해 관리한다.
drop policy if exists "TEMP_session_gate_event_participants_ins" on public.event_participants;
drop policy if exists "TEMP_session_gate_event_participants_upd" on public.event_participants;
drop policy if exists "TEMP_session_gate_event_participants_del" on public.event_participants;
drop policy if exists role_event_participants_insert on public.event_participants;
drop policy if exists role_event_participants_update on public.event_participants;
drop policy if exists role_event_participants_delete on public.event_participants;
create policy role_event_participants_insert on public.event_participants
  for insert to public with check (
    (select public.session_can_manage_event(event_id))
    or (
      role = '신청'
      and user_name = (
        select u.name from public.app_users u
        where u.id = (select private.request_session_user_id())
      )
      and exists (
        select 1 from public.calendar_events e
        where e.id = event_id and e.allow_applications
      )
    )
  );
create policy role_event_participants_update on public.event_participants
  for update to public using ((select public.session_can_manage_event(event_id)))
  with check ((select public.session_can_manage_event(event_id)));
create policy role_event_participants_delete on public.event_participants
  for delete to public using (
    (select public.session_can_manage_event(event_id))
    or user_name = (
      select u.name from public.app_users u
      where u.id = (select private.request_session_user_id())
    )
  );

-- 일정별 구역 배정은 해당 일정 인도자와 관리자만.
do $$
declare
  v_table text;
begin
  foreach v_table in array array['event_card_assignments', 'event_card_assignment_cards'] loop
    execute format('drop policy if exists %I on public.%I', 'TEMP_session_gate_' || v_table || '_ins', v_table);
    execute format('drop policy if exists %I on public.%I', 'TEMP_session_gate_' || v_table || '_upd', v_table);
    execute format('drop policy if exists %I on public.%I', 'TEMP_session_gate_' || v_table || '_del', v_table);
    execute format('drop policy if exists %I on public.%I', 'role_' || v_table || '_insert', v_table);
    execute format('drop policy if exists %I on public.%I', 'role_' || v_table || '_update', v_table);
    execute format('drop policy if exists %I on public.%I', 'role_' || v_table || '_delete', v_table);
    execute format('create policy %I on public.%I for insert to anon with check ((select public.session_can_manage_event(event_id)))', 'role_' || v_table || '_insert', v_table);
    execute format('create policy %I on public.%I for update to anon using ((select public.session_can_manage_event(event_id))) with check ((select public.session_can_manage_event(event_id)))', 'role_' || v_table || '_update', v_table);
    execute format('create policy %I on public.%I for delete to anon using ((select public.session_can_manage_event(event_id)))', 'role_' || v_table || '_delete', v_table);
  end loop;
end $$;

-- 비공식·식당 배정도 '아무 인도자'가 아니라 해당 일정 인도자로 좁힌다.
do $$
declare
  v_table text;
begin
  foreach v_table in array array['event_informal_assignments', 'event_restaurant_assignments'] loop
    execute format('drop policy if exists %I on public.%I', 'role_' || v_table || '_insert', v_table);
    execute format('drop policy if exists %I on public.%I', 'role_' || v_table || '_update', v_table);
    execute format('drop policy if exists %I on public.%I', 'role_' || v_table || '_delete', v_table);
    execute format('create policy %I on public.%I for insert to anon, authenticated with check ((select public.session_can_manage_event(event_id)))', 'role_' || v_table || '_insert', v_table);
    execute format('create policy %I on public.%I for update to anon, authenticated using ((select public.session_can_manage_event(event_id))) with check ((select public.session_can_manage_event(event_id)))', 'role_' || v_table || '_update', v_table);
    execute format('create policy %I on public.%I for delete to anon, authenticated using ((select public.session_can_manage_event(event_id)))', 'role_' || v_table || '_delete', v_table);
  end loop;
end $$;

-- 상시 카드 담당·인도자 지정은 관리자 업무다.
do $$
declare
  v_table text;
begin
  foreach v_table in array array['card_assignments', 'card_leader_assignments'] loop
    execute format('drop policy if exists %I on public.%I', 'TEMP_session_gate_' || v_table || '_ins', v_table);
    execute format('drop policy if exists %I on public.%I', 'TEMP_session_gate_' || v_table || '_upd', v_table);
    execute format('drop policy if exists %I on public.%I', 'TEMP_session_gate_' || v_table || '_del', v_table);
    execute format('drop policy if exists %I on public.%I', 'role_admin_' || v_table || '_insert', v_table);
    execute format('drop policy if exists %I on public.%I', 'role_admin_' || v_table || '_update', v_table);
    execute format('drop policy if exists %I on public.%I', 'role_admin_' || v_table || '_delete', v_table);
    execute format('create policy %I on public.%I for insert to anon with check ((select private.request_is_admin()))', 'role_admin_' || v_table || '_insert', v_table);
    execute format('create policy %I on public.%I for update to anon using ((select private.request_is_admin())) with check ((select private.request_is_admin()))', 'role_admin_' || v_table || '_update', v_table);
    execute format('create policy %I on public.%I for delete to anon using ((select private.request_is_admin()))', 'role_admin_' || v_table || '_delete', v_table);
  end loop;
end $$;

notify pgrst, 'reload schema';
