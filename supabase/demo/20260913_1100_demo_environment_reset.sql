-- 외부 시연용 테스트 DB를 고정된 데모 상태로 되돌린다.
--
-- 화면에서 버튼을 숨기는 것만으로는 부족하다. 이 함수는 다음 세 조건을
-- 서버에서 모두 확인한다.
--   1. app_private_settings.environment = test
--   2. 유효한 세션의 역할이 developer
--   3. 그 계정의 login_id가 test-admin
-- 운영 DB에는 test 표식을 넣지 않으므로 같은 마이그레이션이 있어도 실행되지 않는다.

create or replace function public.reset_demo_environment_tx(p_token uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id integer;
  v_actor_name text;
  v_actor_role text;
  v_actor_login_id text;
  v_environment text;
  v_admin_id integer;
  v_leader_id integer;
  v_user_id integer;
  v_region_id integer;
  v_home_card_id integer;
  v_shop_card_id integer;
  v_home_building_id integer;
  v_shop_building_id integer;
  v_home_unit_id integer;
  v_shop_unit_id integer;
  v_event_id integer;
begin
  select u.id, u.name, u.role, u.login_id
    into v_actor_id, v_actor_name, v_actor_role, v_actor_login_id
  from public.app_users u
  where u.id = public.verify_session(p_token);

  if v_actor_id is null
     or v_actor_role <> 'developer'
     or v_actor_login_id <> 'test-admin' then
    raise exception '테스트 개발자만 데모 데이터를 초기화할 수 있습니다'
      using errcode = '42501';
  end if;

  select s.value into v_environment
  from public.app_private_settings s
  where s.key = 'environment';

  if coalesce(v_environment, '') <> 'test' then
    raise exception '테스트 환경이 아니므로 초기화를 중단했습니다'
      using errcode = '42501';
  end if;

  -- 초기화 두 번이 겹치면 중간 상태가 노출되지 않도록 DB 하나당 직렬화한다.
  perform pg_advisory_xact_lock(hashtextextended('field-map-demo-reset', 0));
  perform set_config('app.suppress_notifications', 'true', true);

  -- app_private_settings, app_settings, app_users, auth_sessions는 아래에서 별도로 다룬다.
  truncate table
    public.building_access_events,
    public.buildings,
    public.calendar_events,
    public.card_assignments,
    public.card_boundaries,
    public.card_leader_assignments,
    public.cards,
    public.cart_service_approval_logs,
    public.chat_message_signals,
    public.chat_messages,
    public.chat_read_status,
    public.chat_room_mutes,
    public.comments,
    public.event_card_assignment_cards,
    public.event_card_assignments,
    public.event_cart_applications,
    public.event_informal_assignments,
    public.event_participants,
    public.event_restaurant_assignments,
    public.informal_assets,
    public.informal_groups,
    public.login_logs,
    public.notices,
    public.notification_preferences,
    public.notifications,
    public.phone_surveys,
    public.place_change_requests,
    public.place_change_signals,
    public.push_subscriptions,
    public.regular_visits,
    public.restaurant_requests,
    public.return_visit_logs,
    public.return_visits,
    public.review_tasks,
    public.service_logs,
    public.service_sessions,
    public.service_suggestions,
    public.special_periods,
    public.territory_regions,
    public.unit_creation_signals,
    public.units,
    public.visit_histories
  restart identity cascade;

  -- 버튼을 누른 개발자의 현재 세션은 살려 둔다. 다른 시연 계정과 세션은 지운다.
  delete from public.auth_sessions where user_id <> v_actor_id;
  delete from public.app_users where id <> v_actor_id;
  update public.app_users
  set role = 'developer', approval_status = 'approved', is_active = true
  where id = v_actor_id;

  insert into public.app_users
    (login_id, name, pin, role, approval_status, is_active,
     cart_service_approved, cart_service_approved_at, cart_service_approved_by_user_id)
  values
    ('관리자', '데모 관리자', '0000', 'admin', 'approved', true,
     true, now(), v_actor_id)
  returning id into v_admin_id;

  insert into public.app_users
    (login_id, name, pin, role, approval_status, is_active)
  values
    ('인도자', '데모 인도자', '0000', 'leader', 'approved', true)
  returning id into v_leader_id;

  insert into public.app_users
    (login_id, name, pin, role, approval_status, is_active)
  values
    ('봉사자', '데모 봉사자', '0000', 'user', 'approved', true)
  returning id into v_user_id;

  insert into public.territory_regions (name, city, sort_order)
  values ('테스트구', '테스트시', 1)
  returning id into v_region_id;

  insert into public.cards (name, area, region, type, status)
  values ('테스트구 한동 1', '한동', '테스트구', '전체', '미배정')
  returning id into v_home_card_id;

  insert into public.cards (name, area, region, type, status)
  values ('테스트구 두동 1', '두동', '테스트구', '전체', '미배정')
  returning id into v_shop_card_id;

  insert into public.buildings (card_id, name, address, type, lat, lng)
  values (v_home_card_id, '한동빌라', '테스트시 테스트구 한동로 1', '주택', 37.5, 127.1)
  returning id into v_home_building_id;

  insert into public.buildings (card_id, name, address, type, lat, lng)
  values (v_shop_card_id, '두동상가', '테스트시 테스트구 두동로 2', '상가', 37.5008, 127.101)
  returning id into v_shop_building_id;

  insert into public.units (building_id, number, status, is_chinese)
  values (v_home_building_id, '101', '미방문', true)
  returning id into v_home_unit_id;
  insert into public.units (building_id, number, status, is_chinese)
  values (v_home_building_id, '102', '부재', true);
  insert into public.units (building_id, number, status, is_chinese)
  values (v_shop_building_id, '카페', '만남', true)
  returning id into v_shop_unit_id;
  insert into public.units (building_id, number, status, is_chinese, usage_type)
  values (v_home_building_id, '1층 상가', '미방문', true, '상가');

  insert into public.visit_histories
    (unit_id, visitor_name, result, time_slot, memo, visited_at, created_by_user_id)
  values
    (v_home_unit_id, v_actor_name, '부재', '오후', '데모 방문 기록', current_date - 3, v_actor_id),
    (v_shop_unit_id, v_actor_name, '만남', '저녁', '데모 방문 기록', current_date - 1, v_actor_id);

  insert into public.regular_visits (unit_id, visitor_name)
  values (v_shop_unit_id, v_actor_name);

  -- 현재 사용자 명단에는 없는 과거 담당자를 남겨 관리 화면의 재배정 흐름을 시연한다.
  insert into public.return_visits (
    unit_id, building_id, display_name, nickname, address, unit_number,
    assigned_user_name, created_by, last_visited_at, last_result, created_at
  ) values (
    v_home_unit_id, v_home_building_id, '한동빌라 101', '관심을 보인 세대',
    '테스트시 테스트구 한동로 1', '101', '전출한 봉사자', '전출한 봉사자',
    current_date - 120, '만남', now() - interval '120 days'
  );

  insert into public.place_change_requests (
    request_type, building_id, unit_id, building_name, address, unit_number,
    note, requested_by_id, requested_by_name, status, created_at
  ) values (
    'details_wrong', v_shop_building_id, v_shop_unit_id, '두동상가',
    '테스트시 테스트구 두동로 2', '카페',
    '건물 이름과 영업 여부를 확인해 주세요.', v_user_id, '데모 봉사자',
    'pending', now() - interval '1 day'
  );

  insert into public.special_periods (label, start_date, end_date, color)
  values ('테스트 특별봉사', current_date - 7, current_date + 7, '#c94735');

  insert into public.calendar_events
    (event_date, "time", end_time, title, type, place, leader_name,
     allow_applications, allow_cart_applications, cart_capacity)
  values
    (current_date + 1, '10:00', '12:00', '데모 봉사', '주택', '테스트구 한동',
     '데모 인도자', true, true, 4)
  returning id into v_event_id;

  insert into public.event_participants (event_id, user_name, role)
  values (v_event_id, '데모 봉사자', '신청');

  insert into public.event_cart_applications
    (event_id, user_id, is_team_lead, added_by_user_id)
  values (v_event_id, v_admin_id, true, v_actor_id);

  return jsonb_build_object(
    'ok', true,
    'users', 4,
    'cards', 2,
    'buildings', 2,
    'units', 4,
    'events', 1,
    'orphaned_return_visits', 1,
    'pending_place_requests', 1
  );
end;
$$;

revoke all on function public.reset_demo_environment_tx(uuid)
  from public, anon, authenticated;
grant execute on function public.reset_demo_environment_tx(uuid)
  to anon, authenticated;

do $$
begin
  if has_function_privilege('public', 'public.reset_demo_environment_tx(uuid)', 'execute') then
    raise exception 'PUBLIC이 데모 초기화 함수를 실행할 수 있습니다';
  end if;
end $$;
