-- 운영 스키마 baseline — supabase/tools/_EXPORT_schema.sql 로 뽑았다.
-- 만든 날: 2026-08-24
--
-- 빈 Supabase 프로젝트의 SQL Editor 에서 이 파일을 통째로 실행하면 구조가 선다.
-- 순서: 확장 → 시퀀스 → 테이블 → 제약 → 인덱스 → 뷰 → 함수 → 트리거
--       → RLS → 정책 → 권한 → realtime → replica identity
--
-- ⚠ 데이터는 없다. 구조뿐이다.
-- ⚠ 손으로 고치지 말 것 — 다시 뽑는다 (npm run db:baseline).
--
-- ⚠ 확장 여섯 개 중 pg_cron · pg_net 은 프로젝트에 따라 SQL 로 못 켤 수 있다.
--    그때는 Dashboard → Database → Extensions 에서 먼저 켜고 다시 실행한다.
--    pg_stat_statements · pgcrypto · supabase_vault · uuid-ossp 는 보통 이미 있다.
--
-- ⚠ 이 파일에 없는 것 (따로 챙긴다):
--    · pg_cron 예약 작업 · 스토리지 버킷  → supabase/tools/_EXPORT_extras.sql
--    · 첫 관리자 계정 · 지역 목록          → 새 회중 설치 시 손으로
--    · 푸시 VAPID 키                      → 회중마다 **새로 만든다** (돌려쓰면
--      다른 회중 앱이 우리 교인에게 알림을 보낼 수 있다)

create extension if not exists pg_cron with schema pg_catalog;

create extension if not exists pg_net with schema public;

create extension if not exists pg_stat_statements with schema extensions;

create extension if not exists pgcrypto with schema extensions;

create extension if not exists supabase_vault with schema vault;

create extension if not exists "uuid-ossp" with schema extensions;

create sequence if not exists public.app_users_id_seq;

create sequence if not exists public.buildings_id_seq;

create sequence if not exists public.calendar_events_id_seq;

create sequence if not exists public.card_assignments_id_seq;

create sequence if not exists public.card_leader_assignments_id_seq;

create sequence if not exists public.cards_id_seq;

create sequence if not exists public.chat_message_signals_id_seq;

create sequence if not exists public.chat_messages_id_seq;

create sequence if not exists public.comments_id_seq;

create sequence if not exists public.event_card_assignment_cards_id_seq;

create sequence if not exists public.event_card_assignments_id_seq;

create sequence if not exists public.event_informal_assignments_id_seq;

create sequence if not exists public.event_participants_id_seq;

create sequence if not exists public.event_restaurant_assignments_id_seq;

create sequence if not exists public.informal_assets_id_seq;

create sequence if not exists public.informal_groups_id_seq;

create sequence if not exists public.notifications_id_seq;

create sequence if not exists public.phone_surveys_id_seq;

create sequence if not exists public.push_subscriptions_id_seq;

create sequence if not exists public.regular_visits_id_seq;

create sequence if not exists public.restaurant_requests_id_seq;

create sequence if not exists public.return_visit_logs_id_seq;

create sequence if not exists public.return_visits_id_seq;

create sequence if not exists public.service_logs_id_seq;

create sequence if not exists public.service_sessions_id_seq;

create sequence if not exists public.special_periods_id_seq;

create sequence if not exists public.territory_regions_id_seq;

create sequence if not exists public.units_id_seq;

create sequence if not exists public.visit_histories_id_seq;

create table if not exists public.app_private_settings (
  key text not null,
  value text not null,
  updated_at timestamp with time zone default now() not null
);

create table if not exists public.app_settings (
  key text not null,
  value text default ''::text not null,
  updated_at timestamp with time zone default now() not null
);

create table if not exists public.app_users (
  id integer default nextval('app_users_id_seq'::regclass) not null,
  name text not null,
  role text default 'user'::text not null,
  pin text not null,
  created_at timestamp with time zone default now(),
  login_id text not null,
  last_login_at timestamp with time zone,
  phone text,
  approval_status text default 'approved'::text not null,
  is_active boolean default true not null,
  group_name text
);

create table if not exists public.auth_sessions (
  token uuid default gen_random_uuid() not null,
  user_id integer not null,
  device_label text,
  user_agent text,
  created_at timestamp with time zone default now() not null,
  last_used_at timestamp with time zone default now() not null,
  expires_at timestamp with time zone default (now() + '30 days'::interval) not null
);

create table if not exists public.buildings (
  id integer default nextval('buildings_id_seq'::regclass) not null,
  card_id integer not null,
  name text not null,
  address text not null,
  type text not null,
  lat double precision not null,
  lng double precision not null,
  warning boolean default false,
  memo text,
  created_at timestamp with time zone default now(),
  is_chinese_heavy boolean default false not null,
  is_restaurant boolean default false not null
);

create table if not exists public.calendar_events (
  id integer default nextval('calendar_events_id_seq'::regclass) not null,
  event_date date not null,
  "time" text default '10:00'::text not null,
  title text not null,
  type text default '주택'::text not null,
  place text default ''::text not null,
  leader_name text default ''::text not null,
  card_name text default ''::text not null,
  memo text default ''::text not null,
  created_at timestamp with time zone default now(),
  has_meeting boolean default false not null,
  series_id uuid,
  allow_applications boolean default true not null,
  meeting_map_url text,
  end_time text,
  assignment_status text default 'draft'::text not null,
  assignment_shared_at timestamp with time zone,
  assignment_shared_by text
);

create table if not exists public.card_assignments (
  id integer default nextval('card_assignments_id_seq'::regclass) not null,
  card_id integer not null,
  user_name text not null,
  created_at timestamp with time zone default now()
);

create table if not exists public.card_boundaries (
  card_id integer not null,
  points jsonb not null,
  updated_at timestamp with time zone default now()
);

create table if not exists public.card_leader_assignments (
  id integer default nextval('card_leader_assignments_id_seq'::regclass) not null,
  card_id integer not null,
  user_name text not null,
  created_at timestamp with time zone default now()
);

create table if not exists public.cards (
  id integer default nextval('cards_id_seq'::regclass) not null,
  name text not null,
  area text not null,
  region text not null,
  type text not null,
  status text default '미배정'::text not null,
  leader_name text,
  created_at timestamp with time zone default now()
);

create table if not exists public.chat_message_signals (
  id bigint default nextval('chat_message_signals_id_seq'::regclass) not null,
  event_id integer not null,
  message_id bigint not null,
  created_at timestamp with time zone default now() not null
);

create table if not exists public.chat_messages (
  id bigint default nextval('chat_messages_id_seq'::regclass) not null,
  event_id integer not null,
  author_id integer,
  author_name text not null,
  message_type text default 'text'::text not null,
  content text,
  image_url text,
  image_expires_at timestamp with time zone,
  image_expired boolean default false not null,
  mention_ids integer[] default '{}'::integer[] not null,
  mention_names text[] default '{}'::text[] not null,
  created_at timestamp with time zone default now() not null,
  deleted_at timestamp with time zone
);

create table if not exists public.chat_read_status (
  event_id integer not null,
  user_id integer not null,
  last_read_at timestamp with time zone default now() not null
);

create table if not exists public.chat_room_mutes (
  event_id integer not null,
  user_id integer not null,
  muted_at timestamp with time zone default now() not null
);

create table if not exists public.comments (
  id bigint default nextval('comments_id_seq'::regclass) not null,
  target_type text not null,
  target_id integer not null,
  author_id integer,
  author_name text not null,
  content text not null,
  mention_ids integer[] default '{}'::integer[] not null,
  mention_names text[] default '{}'::text[] not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  deleted_at timestamp with time zone
);

create table if not exists public.event_card_assignment_cards (
  id integer default nextval('event_card_assignment_cards_id_seq'::regclass) not null,
  event_id integer not null,
  user_name text not null,
  card_id integer not null,
  created_at timestamp with time zone default now()
);

create table if not exists public.event_card_assignments (
  id integer default nextval('event_card_assignments_id_seq'::regclass) not null,
  event_id integer not null,
  user_name text not null,
  assigned_card_id integer not null,
  assigned_by text default ''::text not null,
  assigned_at timestamp with time zone default now(),
  memo text default ''::text not null,
  team_key text
);

create table if not exists public.event_informal_assignments (
  id integer default nextval('event_informal_assignments_id_seq'::regclass) not null,
  event_id integer not null,
  user_name text not null,
  asset_id integer not null,
  assigned_by text default ''::text not null,
  assigned_at timestamp with time zone default now(),
  memo text default ''::text not null
);

create table if not exists public.event_participants (
  id integer default nextval('event_participants_id_seq'::regclass) not null,
  event_id integer not null,
  user_name text not null,
  role text not null,
  created_at timestamp with time zone default now()
);

create table if not exists public.event_restaurant_assignments (
  id integer default nextval('event_restaurant_assignments_id_seq'::regclass) not null,
  event_id integer not null,
  user_name text not null,
  building_id integer not null,
  assigned_by text default ''::text not null,
  assigned_at timestamp with time zone default now(),
  memo text default ''::text not null,
  unit_id integer
);

create table if not exists public.informal_assets (
  id integer default nextval('informal_assets_id_seq'::regclass) not null,
  name text not null,
  image_url text not null,
  image_path text not null,
  uploaded_by text default ''::text not null,
  created_at timestamp with time zone default now(),
  archived boolean default false not null,
  group_id integer,
  lat double precision,
  lng double precision,
  memo text,
  boundary jsonb,
  route jsonb,
  zoom smallint
);

create table if not exists public.informal_groups (
  id integer default nextval('informal_groups_id_seq'::regclass) not null,
  name text not null,
  "position" integer default 0 not null,
  created_by text default ''::text not null,
  created_at timestamp with time zone default now()
);

create table if not exists public.login_logs (
  id bigint generated always as identity not null,
  user_id integer,
  logged_in_at timestamp with time zone default now() not null
);

create table if not exists public.notices (
  id bigint generated always as identity not null,
  title text not null,
  content text default ''::text not null,
  priority text default 'normal'::text not null,
  author text default ''::text not null,
  created_at timestamp with time zone default now() not null
);

create table if not exists public.notification_preferences (
  user_id integer not null,
  push_new_notice boolean default true not null,
  push_event_change boolean default true not null,
  push_comment boolean default true not null,
  push_chat boolean default true not null,
  push_mention boolean default true not null,
  push_service_status boolean default true not null,
  quiet_hours_start time without time zone,
  quiet_hours_end time without time zone,
  updated_at timestamp with time zone default now() not null,
  push_daily_service boolean default true not null
);

create table if not exists public.notifications (
  id bigint default nextval('notifications_id_seq'::regclass) not null,
  user_id integer not null,
  type text not null,
  title text not null,
  body text,
  link text,
  related_id integer,
  is_read boolean default false not null,
  created_at timestamp with time zone default now() not null
);

create table if not exists public.phone_surveys (
  id integer default nextval('phone_surveys_id_seq'::regclass) not null,
  place_id text not null,
  name text not null,
  address text,
  category text,
  phone text,
  result text not null,
  checked_at date,
  checked_by text,
  memo text,
  unit_id integer,
  uploaded_by text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  restaurant text
);

create table if not exists public.push_subscriptions (
  id bigint default nextval('push_subscriptions_id_seq'::regclass) not null,
  user_id integer not null,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  device_label text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  last_seen_at timestamp with time zone
);

create table if not exists public.regular_visits (
  id integer default nextval('regular_visits_id_seq'::regclass) not null,
  unit_id integer not null,
  visitor_name text not null,
  registered_at timestamp with time zone default now()
);

create table if not exists public.restaurant_requests (
  id integer default nextval('restaurant_requests_id_seq'::regclass) not null,
  name text not null,
  address text not null,
  requested_by text not null,
  requested_at timestamp with time zone default now(),
  status text default 'pending'::text,
  memo text,
  visited_at timestamp with time zone default now(),
  reviewer text,
  reviewed_at timestamp with time zone,
  building_id integer
);

create table if not exists public.return_visit_logs (
  id bigint default nextval('return_visit_logs_id_seq'::regclass) not null,
  return_visit_id bigint,
  visited_at timestamp with time zone default now(),
  result text,
  memo text default ''::text,
  created_by text default ''::text,
  service_session_id bigint,
  created_at timestamp with time zone default now()
);

create table if not exists public.return_visits (
  id bigint default nextval('return_visits_id_seq'::regclass) not null,
  unit_id bigint,
  building_id bigint,
  display_name text not null,
  address text default ''::text,
  unit_number text default ''::text,
  assigned_user_name text default ''::text,
  created_by text default ''::text,
  last_visited_at timestamp with time zone,
  last_result text,
  created_at timestamp with time zone default now(),
  nickname text default ''::text
);

create table if not exists public.review_tasks (
  id bigint generated always as identity not null,
  title text not null,
  content text,
  status text default 'pending'::text not null,
  created_by text default ''::text not null,
  created_at timestamp with time zone default now() not null,
  completed_at timestamp with time zone,
  updated_at timestamp with time zone default now() not null
);

create table if not exists public.service_logs (
  id bigint default nextval('service_logs_id_seq'::regclass) not null,
  session_id integer,
  event_id integer,
  event_title text,
  event_date date,
  card_id integer,
  card_name text,
  actor_id integer,
  actor_name text not null,
  action text not null,
  target_type text,
  target_id integer,
  details jsonb default '{}'::jsonb not null,
  created_at timestamp with time zone default now() not null
);

create table if not exists public.service_sessions (
  id integer default nextval('service_sessions_id_seq'::regclass) not null,
  user_name text not null,
  role text default 'user'::text not null,
  calendar_event_id integer,
  started_at timestamp with time zone default now() not null,
  ended_at timestamp with time zone,
  service_date date default CURRENT_DATE not null,
  time_slot text not null,
  status text default 'active'::text not null,
  primary_card_id integer,
  assigned_card_id integer,
  assignment_id integer,
  source text default 'manual'::text not null,
  memo text default ''::text not null,
  created_at timestamp with time zone default now()
);

create table if not exists public.service_suggestions (
  id bigint generated by default as identity not null,
  title text not null,
  show_title_on_home boolean default false not null,
  tags jsonb default '[]'::jsonb not null,
  last_used_at timestamp with time zone,
  is_visible boolean default false not null,
  content jsonb default '[]'::jsonb not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

create table if not exists public.special_periods (
  id bigint default nextval('special_periods_id_seq'::regclass) not null,
  label text not null,
  start_date date not null,
  end_date date not null,
  color text default '#7c3aed'::text not null,
  created_at timestamp with time zone default now(),
  has_invitation boolean default false not null
);

create table if not exists public.territory_regions (
  id integer default nextval('territory_regions_id_seq'::regclass) not null,
  name text not null,
  city text,
  sort_order integer default 0 not null,
  name_zh text,
  name_en text,
  created_at timestamp with time zone default now() not null
);

create table if not exists public.units (
  id integer default nextval('units_id_seq'::regclass) not null,
  building_id integer not null,
  number text not null,
  status text default '미방문'::text not null,
  memo text,
  created_at timestamp with time zone default now(),
  is_chinese boolean default false not null,
  is_restaurant boolean default false not null,
  naver_place_id text
);

create table if not exists public.visit_histories (
  id integer default nextval('visit_histories_id_seq'::regclass) not null,
  unit_id integer not null,
  visitor_name text not null,
  result text not null,
  time_slot text default '저녁'::text not null,
  memo text,
  visited_at date default CURRENT_DATE not null,
  created_at timestamp with time zone default now(),
  service_session_id integer,
  special_period_id integer,
  invitation_left boolean default false,
  visit_type text default 'card'::text
);

alter table public.app_private_settings add constraint app_private_settings_pkey PRIMARY KEY (key);

alter table public.app_settings add constraint app_settings_pkey PRIMARY KEY (key);

alter table public.app_users add constraint app_users_approval_status_check CHECK ((approval_status = ANY (ARRAY['pending'::text, 'approved'::text, 'blocked'::text])));

alter table public.app_users add constraint app_users_name_key UNIQUE (name);

alter table public.app_users add constraint app_users_pkey PRIMARY KEY (id);

alter table public.app_users add constraint app_users_role_check CHECK ((role = ANY (ARRAY['user'::text, 'leader'::text, 'admin'::text, 'developer'::text])));

alter table public.auth_sessions add constraint auth_sessions_pkey PRIMARY KEY (token);

alter table public.buildings add constraint buildings_pkey PRIMARY KEY (id);

alter table public.buildings add constraint buildings_type_check CHECK ((type = ANY (ARRAY['주택'::text, '상가'::text])));

alter table public.calendar_events add constraint calendar_events_assignment_status_check CHECK ((assignment_status = ANY (ARRAY['draft'::text, 'confirmed'::text, 'shared'::text])));

alter table public.calendar_events add constraint calendar_events_pkey PRIMARY KEY (id);

alter table public.card_assignments add constraint card_assignments_card_id_user_name_key UNIQUE (card_id, user_name);

alter table public.card_assignments add constraint card_assignments_pkey PRIMARY KEY (id);

alter table public.card_boundaries add constraint card_boundaries_pkey PRIMARY KEY (card_id);

alter table public.card_leader_assignments add constraint card_leader_assignments_card_id_user_name_key UNIQUE (card_id, user_name);

alter table public.card_leader_assignments add constraint card_leader_assignments_pkey PRIMARY KEY (id);

alter table public.cards add constraint cards_pkey PRIMARY KEY (id);

alter table public.cards add constraint cards_status_check CHECK ((status = ANY (ARRAY['미배정'::text, '진행중'::text, '완료'::text, '보류'::text])));

alter table public.cards add constraint cards_type_check CHECK ((type = '전체'::text));

alter table public.chat_message_signals add constraint chat_message_signals_pkey PRIMARY KEY (id);

alter table public.chat_messages add constraint chat_messages_message_type_check CHECK ((message_type = ANY (ARRAY['text'::text, 'image'::text, 'system'::text])));

alter table public.chat_messages add constraint chat_messages_pkey PRIMARY KEY (id);

alter table public.chat_read_status add constraint chat_read_status_pkey PRIMARY KEY (event_id, user_id);

alter table public.chat_room_mutes add constraint chat_room_mutes_pkey PRIMARY KEY (event_id, user_id);

alter table public.comments add constraint comments_pkey PRIMARY KEY (id);

alter table public.comments add constraint comments_target_type_check CHECK ((target_type = ANY (ARRAY['notice'::text, 'calendar_event'::text])));

alter table public.event_card_assignment_cards add constraint event_card_assignment_cards_event_id_user_name_card_id_key UNIQUE (event_id, user_name, card_id);

alter table public.event_card_assignment_cards add constraint event_card_assignment_cards_pkey PRIMARY KEY (id);

alter table public.event_card_assignments add constraint event_card_assignments_event_id_user_name_key UNIQUE (event_id, user_name);

alter table public.event_card_assignments add constraint event_card_assignments_pkey PRIMARY KEY (id);

alter table public.event_informal_assignments add constraint event_informal_assignments_event_id_user_name_asset_id_key UNIQUE (event_id, user_name, asset_id);

alter table public.event_informal_assignments add constraint event_informal_assignments_pkey PRIMARY KEY (id);

alter table public.event_participants add constraint event_participants_event_id_user_name_key UNIQUE (event_id, user_name);

alter table public.event_participants add constraint event_participants_pkey PRIMARY KEY (id);

alter table public.event_participants add constraint event_participants_role_check CHECK ((role = ANY (ARRAY['신청'::text, '입명'::text])));

alter table public.event_restaurant_assignments add constraint event_restaurant_assignments_pkey PRIMARY KEY (id);

alter table public.informal_assets add constraint informal_assets_pkey PRIMARY KEY (id);

alter table public.informal_groups add constraint informal_groups_pkey PRIMARY KEY (id);

alter table public.login_logs add constraint login_logs_pkey PRIMARY KEY (id);

alter table public.notices add constraint notices_pkey PRIMARY KEY (id);

alter table public.notification_preferences add constraint notification_preferences_pkey PRIMARY KEY (user_id);

alter table public.notifications add constraint notifications_pkey PRIMARY KEY (id);

alter table public.notifications add constraint notifications_type_check CHECK ((type = ANY (ARRAY['notice'::text, 'event_change'::text, 'comment'::text, 'mention'::text, 'chat'::text, 'service_started'::text, 'service_ended'::text, 'assignment'::text, 'assignment_informal'::text, 'assignment_restaurant'::text, 'daily_service'::text])));

alter table public.phone_surveys add constraint phone_surveys_pkey PRIMARY KEY (id);

alter table public.phone_surveys add constraint phone_surveys_place_id_key UNIQUE (place_id);

alter table public.phone_surveys add constraint phone_surveys_result_check CHECK ((result = ANY (ARRAY['있음'::text, '없음'::text, '미확인'::text])));

alter table public.push_subscriptions add constraint push_subscriptions_endpoint_key UNIQUE (endpoint);

alter table public.push_subscriptions add constraint push_subscriptions_pkey PRIMARY KEY (id);

alter table public.regular_visits add constraint regular_visits_pkey PRIMARY KEY (id);

alter table public.regular_visits add constraint regular_visits_unit_id_key UNIQUE (unit_id);

alter table public.restaurant_requests add constraint restaurant_requests_pkey PRIMARY KEY (id);

alter table public.restaurant_requests add constraint restaurant_requests_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text])));

alter table public.return_visit_logs add constraint return_visit_logs_pkey PRIMARY KEY (id);

alter table public.return_visits add constraint return_visits_pkey PRIMARY KEY (id);

alter table public.review_tasks add constraint review_tasks_pkey PRIMARY KEY (id);

alter table public.review_tasks add constraint review_tasks_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'done'::text, 'deleted'::text])));

alter table public.service_logs add constraint service_logs_pkey PRIMARY KEY (id);

alter table public.service_sessions add constraint service_sessions_pkey PRIMARY KEY (id);

alter table public.service_sessions add constraint service_sessions_role_check CHECK ((role = ANY (ARRAY['user'::text, 'leader'::text, 'admin'::text])));

alter table public.service_sessions add constraint service_sessions_source_check CHECK ((source = ANY (ARRAY['assigned'::text, 'manual'::text, 'manual_override'::text])));

alter table public.service_sessions add constraint service_sessions_status_check CHECK ((status = ANY (ARRAY['active'::text, 'ended'::text, 'expired'::text])));

alter table public.service_sessions add constraint service_sessions_time_slot_check CHECK ((time_slot = ANY (ARRAY['오전'::text, '오후'::text, '저녁'::text])));

alter table public.service_sessions add constraint service_sessions_user_date_slot_card_unique UNIQUE NULLS NOT DISTINCT (user_name, service_date, time_slot, primary_card_id);

alter table public.service_suggestions add constraint service_suggestions_pkey PRIMARY KEY (id);

alter table public.special_periods add constraint special_periods_pkey PRIMARY KEY (id);
alter table public.special_periods add constraint special_periods_valid_date_range check (start_date <= end_date);

alter table public.territory_regions add constraint territory_regions_name_key UNIQUE (name);

alter table public.territory_regions add constraint territory_regions_pkey PRIMARY KEY (id);

alter table public.units add constraint units_pkey PRIMARY KEY (id);

alter table public.units add constraint units_status_check CHECK ((status = ANY (ARRAY['미방문'::text, '만남'::text, '부재'::text, '대상외'::text, '거절'::text, '확인필요'::text])));

alter table public.visit_histories add constraint visit_histories_pkey PRIMARY KEY (id);

alter table public.visit_histories add constraint visit_histories_result_check CHECK ((result = ANY (ARRAY['만남'::text, '부재'::text, '대상외'::text, '거절'::text, '확인필요'::text])));

alter table public.visit_histories add constraint visit_histories_time_slot_check CHECK ((time_slot = ANY (ARRAY['오전'::text, '오후'::text, '저녁'::text])));

alter table public.visit_histories add constraint visit_histories_visit_type_check CHECK ((visit_type = ANY (ARRAY['card'::text, 'restaurant'::text])));

alter table public.auth_sessions add constraint auth_sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES app_users(id) ON DELETE CASCADE;

alter table public.buildings add constraint buildings_card_id_fkey FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE CASCADE;

alter table public.card_assignments add constraint card_assignments_card_id_fkey FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE CASCADE;

alter table public.card_boundaries add constraint card_boundaries_card_id_fkey FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE CASCADE;

alter table public.card_leader_assignments add constraint card_leader_assignments_card_id_fkey FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE CASCADE;

alter table public.chat_message_signals add constraint chat_message_signals_event_id_fkey FOREIGN KEY (event_id) REFERENCES calendar_events(id) ON DELETE CASCADE;

alter table public.chat_messages add constraint chat_messages_author_id_fkey FOREIGN KEY (author_id) REFERENCES app_users(id) ON DELETE SET NULL;

alter table public.chat_messages add constraint chat_messages_event_id_fkey FOREIGN KEY (event_id) REFERENCES calendar_events(id) ON DELETE CASCADE;

alter table public.chat_read_status add constraint chat_read_status_event_id_fkey FOREIGN KEY (event_id) REFERENCES calendar_events(id) ON DELETE CASCADE;

alter table public.chat_read_status add constraint chat_read_status_user_id_fkey FOREIGN KEY (user_id) REFERENCES app_users(id) ON DELETE CASCADE;

alter table public.chat_room_mutes add constraint chat_room_mutes_event_id_fkey FOREIGN KEY (event_id) REFERENCES calendar_events(id) ON DELETE CASCADE;

alter table public.chat_room_mutes add constraint chat_room_mutes_user_id_fkey FOREIGN KEY (user_id) REFERENCES app_users(id) ON DELETE CASCADE;

alter table public.comments add constraint comments_author_id_fkey FOREIGN KEY (author_id) REFERENCES app_users(id) ON DELETE SET NULL;

alter table public.event_card_assignment_cards add constraint event_card_assignment_cards_card_id_fkey FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE CASCADE;

alter table public.event_card_assignment_cards add constraint event_card_assignment_cards_event_id_fkey FOREIGN KEY (event_id) REFERENCES calendar_events(id) ON DELETE CASCADE;

alter table public.event_card_assignments add constraint event_card_assignments_assigned_card_id_fkey FOREIGN KEY (assigned_card_id) REFERENCES cards(id) ON DELETE CASCADE;

alter table public.event_card_assignments add constraint event_card_assignments_event_id_fkey FOREIGN KEY (event_id) REFERENCES calendar_events(id) ON DELETE CASCADE;

alter table public.event_informal_assignments add constraint event_informal_assignments_asset_id_fkey FOREIGN KEY (asset_id) REFERENCES informal_assets(id) ON DELETE CASCADE;

alter table public.event_informal_assignments add constraint event_informal_assignments_event_id_fkey FOREIGN KEY (event_id) REFERENCES calendar_events(id) ON DELETE CASCADE;

alter table public.event_participants add constraint event_participants_event_id_fkey FOREIGN KEY (event_id) REFERENCES calendar_events(id) ON DELETE CASCADE;

alter table public.event_restaurant_assignments add constraint event_restaurant_assignments_building_id_fkey FOREIGN KEY (building_id) REFERENCES buildings(id) ON DELETE CASCADE;

alter table public.event_restaurant_assignments add constraint event_restaurant_assignments_event_id_fkey FOREIGN KEY (event_id) REFERENCES calendar_events(id) ON DELETE CASCADE;

alter table public.event_restaurant_assignments add constraint event_restaurant_assignments_unit_id_fkey FOREIGN KEY (unit_id) REFERENCES units(id) ON DELETE CASCADE;

alter table public.informal_assets add constraint informal_assets_group_id_fkey FOREIGN KEY (group_id) REFERENCES informal_groups(id) ON DELETE SET NULL;

alter table public.login_logs add constraint login_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES app_users(id) ON DELETE CASCADE;

alter table public.notification_preferences add constraint notification_preferences_user_id_fkey FOREIGN KEY (user_id) REFERENCES app_users(id) ON DELETE CASCADE;

alter table public.notifications add constraint notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES app_users(id) ON DELETE CASCADE;

alter table public.phone_surveys add constraint phone_surveys_unit_id_fkey FOREIGN KEY (unit_id) REFERENCES units(id) ON DELETE SET NULL;

alter table public.push_subscriptions add constraint push_subscriptions_user_id_fkey FOREIGN KEY (user_id) REFERENCES app_users(id) ON DELETE CASCADE;

alter table public.regular_visits add constraint regular_visits_unit_id_fkey FOREIGN KEY (unit_id) REFERENCES units(id) ON DELETE CASCADE;

alter table public.restaurant_requests add constraint restaurant_requests_building_id_fkey FOREIGN KEY (building_id) REFERENCES buildings(id) ON DELETE SET NULL;

alter table public.return_visit_logs add constraint return_visit_logs_return_visit_id_fkey FOREIGN KEY (return_visit_id) REFERENCES return_visits(id) ON DELETE CASCADE;

alter table public.return_visits add constraint return_visits_building_id_fkey FOREIGN KEY (building_id) REFERENCES buildings(id) ON DELETE CASCADE;

alter table public.return_visits add constraint return_visits_unit_id_fkey FOREIGN KEY (unit_id) REFERENCES units(id) ON DELETE CASCADE;

alter table public.service_logs add constraint service_logs_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES app_users(id) ON DELETE SET NULL;

alter table public.service_logs add constraint service_logs_card_id_fkey FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE SET NULL;

alter table public.service_logs add constraint service_logs_event_id_fkey FOREIGN KEY (event_id) REFERENCES calendar_events(id) ON DELETE SET NULL;

alter table public.service_logs add constraint service_logs_session_id_fkey FOREIGN KEY (session_id) REFERENCES service_sessions(id) ON DELETE SET NULL;

alter table public.service_sessions add constraint service_sessions_assigned_card_id_fkey FOREIGN KEY (assigned_card_id) REFERENCES cards(id) ON DELETE SET NULL;

alter table public.service_sessions add constraint service_sessions_calendar_event_id_fkey FOREIGN KEY (calendar_event_id) REFERENCES calendar_events(id) ON DELETE SET NULL;

alter table public.service_sessions add constraint service_sessions_primary_card_id_fkey FOREIGN KEY (primary_card_id) REFERENCES cards(id) ON DELETE SET NULL;

alter table public.units add constraint units_building_id_fkey FOREIGN KEY (building_id) REFERENCES buildings(id) ON DELETE CASCADE;

alter table public.visit_histories add constraint visit_histories_service_session_id_fkey FOREIGN KEY (service_session_id) REFERENCES service_sessions(id) ON DELETE SET NULL;

alter table public.visit_histories add constraint visit_histories_special_period_id_fkey FOREIGN KEY (special_period_id) REFERENCES special_periods(id) ON DELETE SET NULL;

alter table public.visit_histories add constraint visit_histories_unit_id_fkey FOREIGN KEY (unit_id) REFERENCES units(id) ON DELETE CASCADE;

alter sequence public.app_users_id_seq owned by public.app_users.id;

CREATE UNIQUE INDEX app_users_login_id_key ON public.app_users USING btree (login_id);

alter sequence public.buildings_id_seq owned by public.buildings.id;

alter sequence public.calendar_events_id_seq owned by public.calendar_events.id;

alter sequence public.card_assignments_id_seq owned by public.card_assignments.id;

alter sequence public.card_leader_assignments_id_seq owned by public.card_leader_assignments.id;

alter sequence public.cards_id_seq owned by public.cards.id;

alter sequence public.chat_message_signals_id_seq owned by public.chat_message_signals.id;

alter sequence public.chat_messages_id_seq owned by public.chat_messages.id;

alter sequence public.comments_id_seq owned by public.comments.id;

alter sequence public.event_card_assignment_cards_id_seq owned by public.event_card_assignment_cards.id;

alter sequence public.event_card_assignments_id_seq owned by public.event_card_assignments.id;

CREATE INDEX event_informal_assignments_event_idx ON public.event_informal_assignments USING btree (event_id);

alter sequence public.event_informal_assignments_id_seq owned by public.event_informal_assignments.id;

alter sequence public.event_participants_id_seq owned by public.event_participants.id;

CREATE INDEX event_restaurant_assignments_event_idx ON public.event_restaurant_assignments USING btree (event_id);

alter sequence public.event_restaurant_assignments_id_seq owned by public.event_restaurant_assignments.id;

CREATE UNIQUE INDEX event_restaurant_assignments_unique_idx ON public.event_restaurant_assignments USING btree (event_id, user_name, building_id, COALESCE(unit_id, 0));

CREATE INDEX idx_auth_sessions_expires ON public.auth_sessions USING btree (expires_at);

CREATE INDEX idx_auth_sessions_user ON public.auth_sessions USING btree (user_id);

CREATE INDEX idx_calendar_events_series_id ON public.calendar_events USING btree (series_id);

CREATE INDEX idx_chat_message_signals_event ON public.chat_message_signals USING btree (event_id, created_at DESC);

CREATE INDEX idx_chat_messages_author ON public.chat_messages USING btree (author_id, created_at);

CREATE INDEX idx_chat_messages_event ON public.chat_messages USING btree (event_id, created_at);

CREATE INDEX idx_comments_author ON public.comments USING btree (author_id, created_at);

CREATE INDEX idx_comments_target ON public.comments USING btree (target_type, target_id, created_at);

CREATE INDEX idx_notifications_user ON public.notifications USING btree (user_id, is_read, created_at DESC);

CREATE INDEX idx_push_subscriptions_user ON public.push_subscriptions USING btree (user_id);

CREATE INDEX idx_service_logs_actor ON public.service_logs USING btree (actor_id, created_at DESC);

CREATE INDEX idx_service_logs_card ON public.service_logs USING btree (card_id, created_at DESC);

CREATE INDEX idx_service_logs_event ON public.service_logs USING btree (event_id, created_at DESC);

CREATE INDEX idx_service_logs_session ON public.service_logs USING btree (session_id, created_at DESC);

CREATE INDEX idx_visit_histories_special_period ON public.visit_histories USING btree (special_period_id);

CREATE INDEX informal_assets_group_idx ON public.informal_assets USING btree (group_id);

alter sequence public.informal_assets_id_seq owned by public.informal_assets.id;

CREATE INDEX informal_assets_latlng_idx ON public.informal_assets USING btree (lat, lng) WHERE ((lat IS NOT NULL) AND (lng IS NOT NULL));

alter sequence public.informal_groups_id_seq owned by public.informal_groups.id;

CREATE INDEX login_logs_logged_in_at_idx ON public.login_logs USING btree (logged_in_at DESC);

CREATE INDEX login_logs_user_id_idx ON public.login_logs USING btree (user_id);

alter sequence public.notifications_id_seq owned by public.notifications.id;

CREATE INDEX phone_surveys_checked_at_idx ON public.phone_surveys USING btree (checked_at DESC);

alter sequence public.phone_surveys_id_seq owned by public.phone_surveys.id;

CREATE INDEX phone_surveys_result_idx ON public.phone_surveys USING btree (result);

alter sequence public.push_subscriptions_id_seq owned by public.push_subscriptions.id;

alter sequence public.regular_visits_id_seq owned by public.regular_visits.id;

alter sequence public.restaurant_requests_id_seq owned by public.restaurant_requests.id;

alter sequence public.return_visit_logs_id_seq owned by public.return_visit_logs.id;

alter sequence public.return_visits_id_seq owned by public.return_visits.id;

alter sequence public.service_logs_id_seq owned by public.service_logs.id;

alter sequence public.service_sessions_id_seq owned by public.service_sessions.id;

alter sequence public.special_periods_id_seq owned by public.special_periods.id;

alter sequence public.territory_regions_id_seq owned by public.territory_regions.id;

CREATE INDEX territory_regions_sort_idx ON public.territory_regions USING btree (sort_order, name);

alter sequence public.units_id_seq owned by public.units.id;

CREATE INDEX units_is_restaurant_idx ON public.units USING btree (is_restaurant) WHERE is_restaurant;

CREATE INDEX units_naver_place_id_idx ON public.units USING btree (naver_place_id) WHERE (naver_place_id IS NOT NULL);

alter sequence public.visit_histories_id_seq owned by public.visit_histories.id;

create or replace view public.user_notification_prefs as
 SELECT user_id,
    quiet_hours_start,
    quiet_hours_end
   FROM notification_preferences;

CREATE OR REPLACE FUNCTION public.assign_cards_bulk_tx(p_token uuid, p_event_id integer, p_assignments jsonb, p_status text DEFAULT NULL::text, p_expected_shared_at text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_actor_id integer;
  v_actor_name text;
  v_current_shared_at timestamptz;
  v_expected timestamptz;
  v_item jsonb;
  v_card_id bigint;
  v_count integer := 0;
  v_old jsonb;
  v_new jsonb;
  v_skip jsonb;
begin
  -- 1) 인증
  v_actor_id := public.verify_session(p_token);
  if v_actor_id is null then
    raise exception '세션이 유효하지 않습니다';
  end if;
  select name into v_actor_name from public.app_users where id = v_actor_id;

  -- 2) 낙관적 잠금
  if p_expected_shared_at is not null then
    select assignment_shared_at into v_current_shared_at
    from public.calendar_events where id = p_event_id;
    v_expected := p_expected_shared_at::timestamptz;
    if v_current_shared_at is not null
       and abs(extract(epoch from (v_current_shared_at - v_expected))) > 1 then
      return jsonb_build_object(
        'ok', false,
        'conflict', true,
        'server_shared_at', v_current_shared_at,
        'message', '편집하는 사이 다른 사람이 배정을 공유했습니다. 새로고침 후 다시 시도하세요.'
      );
    end if;
  end if;

  -- 3) 이전 배정 지문 (사람 → 카드목록|같은팀사람목록)
  with base as (
    select
      a.user_name,
      coalesce(
        (select array_agg(distinct c.card_id order by c.card_id)
         from public.event_card_assignment_cards c
         where c.event_id = a.event_id and c.user_name = a.user_name),
        case when a.assigned_card_id is null then array[]::bigint[]
             else array[a.assigned_card_id::bigint] end
      ) as cards,
      a.team_key
    from public.event_card_assignments a
    where a.event_id = p_event_id
  ),
  grp as (
    select user_name, cards,
           coalesce(nullif(team_key, ''), 'cards:' || array_to_string(cards, ',')) as gkey
    from base
  ),
  sig as (
    select g.user_name,
           array_to_string(g.cards, ',') || '|' ||
           (select string_agg(g2.user_name, ',' order by g2.user_name)
            from grp g2 where g2.gkey = g.gkey) as fingerprint
    from grp g
  )
  select coalesce(jsonb_object_agg(user_name, fingerprint), '{}'::jsonb)
  into v_old from sig;

  -- 4) 새 배정 지문 (같은 규칙)
  with items as (
    select
      v->>'userName' as user_name,
      coalesce(v->>'teamKey', '') as team_key,
      coalesce(
        (select array_agg(distinct e::bigint order by e::bigint)
         from jsonb_array_elements_text(coalesce(v->'cardIds', '[]'::jsonb)) e),
        array[]::bigint[]
      ) as cards
    from jsonb_array_elements(coalesce(p_assignments, '[]'::jsonb)) v
  ),
  valid as (
    select * from items
    where user_name is not null
      and length(trim(user_name)) > 0
      and coalesce(array_length(cards, 1), 0) > 0
  ),
  grp as (
    select user_name, cards,
           case when team_key = '' then 'cards:' || array_to_string(cards, ',') else team_key end as gkey
    from valid
  ),
  sig as (
    select g.user_name,
           array_to_string(g.cards, ',') || '|' ||
           (select string_agg(g2.user_name, ',' order by g2.user_name)
            from grp g2 where g2.gkey = g.gkey) as fingerprint
    from grp g
  )
  select coalesce(jsonb_object_agg(user_name, fingerprint), '{}'::jsonb)
  into v_new from sig;

  -- 5) 이전과 지문이 같은 사람 = 알림 생략 대상
  select coalesce(jsonb_agg(n.key), '[]'::jsonb)
  into v_skip
  from jsonb_each_text(v_new) n
  where v_old ? n.key and v_old->>n.key = n.value;

  -- 트랜잭션 로컬 설정 → 이 저장에서 실행되는 트리거만 읽는다
  perform set_config('app.skip_assignment_notify', v_skip::text, true);

  -- 6) 기존 배정 정리
  delete from public.event_card_assignment_cards where event_id = p_event_id;
  delete from public.event_card_assignments where event_id = p_event_id;

  -- 7) 새 배정 insert
  for v_item in select * from jsonb_array_elements(coalesce(p_assignments, '[]'::jsonb))
  loop
    declare
      v_user text := v_item->>'userName';
      v_cards jsonb := coalesce(v_item->'cardIds', '[]'::jsonb);
      v_team text := v_item->>'teamKey';
      v_first_card bigint;
    begin
      if v_user is null or length(trim(v_user)) = 0 then
        continue;
      end if;
      if jsonb_array_length(v_cards) > 0 then
        v_first_card := (v_cards->>0)::bigint;
        insert into public.event_card_assignments (event_id, user_name, assigned_card_id, assigned_by, team_key)
        values (p_event_id, v_user, v_first_card, v_actor_name, v_team);
        for v_card_id in select (value)::text::bigint from jsonb_array_elements(v_cards)
        loop
          insert into public.event_card_assignment_cards (event_id, user_name, card_id)
          values (p_event_id, v_user, v_card_id);
        end loop;
        v_count := v_count + 1;
      end if;
    end;
  end loop;

  -- 8) 공유 상태
  if p_status is not null then
    update public.calendar_events
    set assignment_status = p_status,
        assignment_shared_at = case when p_status = 'shared' then now() else null end,
        assignment_shared_by = case when p_status = 'shared' then v_actor_name else null end
    where id = p_event_id;
  end if;

  return jsonb_build_object(
    'ok', true,
    'count', v_count,
    'notified', v_count - jsonb_array_length(v_skip),
    'skipped_unchanged', jsonb_array_length(v_skip)
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.auth_login(p_login_id text, p_pin text, p_device_label text DEFAULT NULL::text, p_user_agent text DEFAULT NULL::text)
 RETURNS TABLE(token uuid, id integer, name text, login_id text, role text, approval_status text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  v_id integer;
  v_name text;
  v_login_id text;
  v_role text;
  v_pin text;
  v_approval_status text;
  v_is_active boolean;
  v_token uuid;
begin
  select
    u.id,
    u.name,
    coalesce(u.login_id, u.name),
    u.role,
    u.pin,
    coalesce(u.approval_status, 'approved'),
    coalesce(u.is_active, true)
  into
    v_id,
    v_name,
    v_login_id,
    v_role,
    v_pin,
    v_approval_status,
    v_is_active
  from public.app_users u
  where u.login_id = p_login_id
     or (u.login_id is null and u.name = p_login_id)
  limit 1;

  if v_id is null then
    return;
  end if;

  if v_pin is null or v_pin <> extensions.crypt(p_pin, v_pin) then
    return;
  end if;

  -- 기존 클라이언트가 approval_status를 보고 안내를 띄우므로,
  -- 승인대기/차단은 예외 대신 토큰 없이 상태만 반환한다.
  if v_approval_status <> 'approved' or v_is_active is false then
    return query
    select
      null::uuid,
      v_id,
      v_name,
      v_login_id,
      v_role,
      case when v_is_active is false then 'blocked' else v_approval_status end;
    return;
  end if;

  insert into public.auth_sessions (user_id, device_label, user_agent)
  values (v_id, nullif(trim(coalesce(p_device_label, '')), ''), nullif(trim(coalesce(p_user_agent, '')), ''))
  returning auth_sessions.token into v_token;

  update public.app_users
  set last_login_at = now()
  where app_users.id = v_id;

  if to_regclass('public.login_logs') is not null then
    insert into public.login_logs (user_id, logged_in_at)
    values (v_id, now());
  end if;

  return query
  select v_token, v_id, v_name, v_login_id, v_role, v_approval_status;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.auth_record_auto_login(p_user_id integer, p_device_label text DEFAULT NULL::text, p_user_agent text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE public.app_users 
  SET last_login_at = now() 
  WHERE id = p_user_id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.auto_close_stale_sessions()
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_4h_closed int := 0;
  v_next_closed int := 0;
begin
  -- 2-A. 시작 후 4시간 경과 자동 종료 (안전망)
  with closed as (
    update service_sessions
    set ended_at = started_at + interval '4 hours',
        status = 'ended'
    where status = 'active'
      and ended_at is null
      and started_at + interval '4 hours' < now()
    returning id
  )
  select count(*) into v_4h_closed from closed;

  -- 2-B. ★ 캘린더 전체에서 다음 봉사 일정이 시작되면 이전 세션 종료
  --     같은 service_date 안에서 더 늦은 calendar_event 가 이미 시작 시각을 지났으면
  --     active session 의 ended_at = 그 다음 일정의 started_at
  with next_starts as (
    select
      s.id as session_id,
      (
        select min(
          (ce.event_date::text || ' ' || coalesce(nullif(ce.time, ''), '09:00'))::timestamp
          at time zone 'Asia/Seoul'
        )
        from calendar_events ce
        where ce.event_date = s.service_date
          and (
            (ce.event_date::text || ' ' || coalesce(nullif(ce.time, ''), '09:00'))::timestamp
            at time zone 'Asia/Seoul'
          ) > s.started_at
          and (
            (ce.event_date::text || ' ' || coalesce(nullif(ce.time, ''), '09:00'))::timestamp
            at time zone 'Asia/Seoul'
          ) <= now()
      ) as next_start
    from service_sessions s
    where s.status = 'active'
      and s.ended_at is null
  ),
  closed as (
    update service_sessions
    set ended_at = next_starts.next_start,
        status = 'ended'
    from next_starts
    where service_sessions.id = next_starts.session_id
      and next_starts.next_start is not null
    returning service_sessions.id
  )
  select count(*) into v_next_closed from closed;

  return json_build_object(
    'closed_4h', v_4h_closed,
    'closed_by_next', v_next_closed
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.auto_reset_met_units()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  _enabled   BOOLEAN;
  _days      INT;
  _cutoff    TEXT;
BEGIN
  SELECT (value = 'true') INTO _enabled FROM app_settings WHERE key = 'visit_reset_enabled';
  SELECT value::INT        INTO _days   FROM app_settings WHERE key = 'visit_reset_days_met';

  IF NOT COALESCE(_enabled, false) OR COALESCE(_days, 0) <= 0 THEN
    RETURN;
  END IF;

  _cutoff := (CURRENT_DATE - (_days || ' days')::INTERVAL)::DATE::TEXT;

  -- status = '만남' 이면서, 가장 최근 만남 방문일이 cutoff 이전인 유닛만 초기화
  UPDATE units u
  SET    status = '미방문'
  WHERE  u.status = '만남'
  AND NOT EXISTS (
    SELECT 1
    FROM   visit_histories vh
    WHERE  vh.unit_id    = u.id
    AND    vh.result     = '만남'
    AND    vh.visited_at > _cutoff
  );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.can_access_chat_event(p_user_id integer, p_event_id integer)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_user_name text;
  v_role text;
begin
  select name, role
  into v_user_name, v_role
  from public.app_users
  where id = p_user_id;

  if v_user_name is null then
    return false;
  end if;

  if v_role in ('admin', 'developer') then
    return true;
  end if;

  if exists (
    select 1
    from public.event_participants ep
    where ep.event_id = p_event_id
      and ep.user_name = v_user_name
  ) then
    return true;
  end if;

  if exists (
    select 1
    from public.calendar_events ce
    where ce.id = p_event_id
      and ce.leader_name = v_user_name
  ) then
    return true;
  end if;

  return false;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.cleanup_expired_auth_sessions()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_deleted integer;
begin
  delete from public.auth_sessions
  where expires_at < now() - interval '7 days';

  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.cleanup_old_data()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  _enabled        BOOLEAN;
  _chat_days      INT;
  _notif_read     INT;
  _notif_max      INT;
  _svc_days       INT;
  _login_days     INT;
  _chat_del       INT := 0;
  _notif_del      INT := 0;
  _svc_del        INT := 0;
  _login_del      INT := 0;
BEGIN
  SELECT (value = 'true')        INTO _enabled    FROM app_settings WHERE key = 'retention_enabled';
  SELECT value::INT              INTO _chat_days  FROM app_settings WHERE key = 'retention_chat_days';
  SELECT value::INT              INTO _notif_read FROM app_settings WHERE key = 'retention_notif_read_days';
  SELECT value::INT              INTO _notif_max  FROM app_settings WHERE key = 'retention_notif_max_days';
  SELECT value::INT              INTO _svc_days   FROM app_settings WHERE key = 'retention_service_logs_days';
  SELECT value::INT              INTO _login_days FROM app_settings WHERE key = 'retention_login_logs_days';

  IF NOT COALESCE(_enabled, false) THEN
    RETURN jsonb_build_object('skipped', true, 'reason', 'retention_disabled');
  END IF;

  -- 1) 오래된 채팅 메시지
  IF COALESCE(_chat_days, 0) > 0 THEN
    DELETE FROM chat_messages
    WHERE created_at < now() - (_chat_days || ' days')::INTERVAL;
    GET DIAGNOSTICS _chat_del = ROW_COUNT;
  END IF;

  -- 2) 알림: 읽은 건 _notif_read일, 안 읽어도 _notif_max일 하드캡
  DELETE FROM notifications
  WHERE (is_read = true  AND COALESCE(_notif_read, 0) > 0 AND created_at < now() - (_notif_read || ' days')::INTERVAL)
     OR (                    COALESCE(_notif_max, 0)  > 0 AND created_at < now() - (_notif_max  || ' days')::INTERVAL);
  GET DIAGNOSTICS _notif_del = ROW_COUNT;

  -- 3) 운영 로그
  IF COALESCE(_svc_days, 0) > 0 THEN
    DELETE FROM service_logs
    WHERE created_at < now() - (_svc_days || ' days')::INTERVAL;
    GET DIAGNOSTICS _svc_del = ROW_COUNT;
  END IF;

  -- 4) 로그인 기록
  IF COALESCE(_login_days, 0) > 0 THEN
    DELETE FROM login_logs
    WHERE logged_in_at < now() - (_login_days || ' days')::INTERVAL;
    GET DIAGNOSTICS _login_del = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object(
    'skipped',           false,
    'ran_at',            now(),
    'chat_deleted',      _chat_del,
    'notifications_deleted', _notif_del,
    'service_logs_deleted',  _svc_del,
    'login_logs_deleted',    _login_del
  );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.cleanup_old_service_logs()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_deleted integer;
begin
  delete from public.service_logs
  where created_at < now() - interval '90 days';

  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.clear_read_notifications(p_token uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_user_id integer;
begin
  v_user_id := public.verify_session(p_token);

  delete from public.notifications
  where user_id = v_user_id
    and is_read = true;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.count_old_visit_histories(cutoff_date text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE _count INT;
BEGIN
  SELECT COUNT(*) INTO _count FROM visit_histories WHERE visited_at < cutoff_date;
  RETURN _count;
END; $function$
;

CREATE OR REPLACE FUNCTION public.create_sessions_on_assignment()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_event_date date;
  v_event_time text;
  v_leader text;
  v_leaders text[];
  v_one text;
  v_started_at timestamptz;
  v_time_slot text;
  v_hour int;
begin
  select event_date, time, leader_name
  into v_event_date, v_event_time, v_leader
  from calendar_events
  where id = new.event_id;

  if v_event_date is null then
    return new;
  end if;

  -- '엄민석, 장웅' → {엄민석, 장웅}. 빈 조각은 버린다.
  v_leaders := array(
    select btrim(x)
    from unnest(string_to_array(coalesce(v_leader, ''), ',')) as x
    where btrim(x) <> ''
  );

  v_started_at := (
    (v_event_date::text || ' ' || coalesce(nullif(v_event_time, ''), '09:00'))::timestamp
    at time zone 'Asia/Seoul'
  );
  v_hour := extract(hour from v_started_at at time zone 'Asia/Seoul');
  v_time_slot := case
    when v_hour < 12 then '오전'
    when v_hour < 17 then '오후'
    else '저녁'
  end;

  -- 봉사자 세션 — 배정받은 사람이 인도자 목록에 있으면 'leader'
  insert into service_sessions (
    user_name, role, calendar_event_id,
    primary_card_id, assigned_card_id, assignment_id,
    time_slot, started_at, service_date, status, source
  ) values (
    new.user_name,
    case when new.user_name = any(v_leaders) then 'leader' else 'user' end,
    new.event_id,
    new.assigned_card_id, new.assigned_card_id, new.id,
    v_time_slot, v_started_at, v_event_date, 'active', 'assigned'
  )
  on conflict on constraint service_sessions_user_date_slot_card_unique do nothing;

  -- 인도자 세션 — 이름마다 하나씩
  foreach v_one in array v_leaders loop
    continue when v_one = new.user_name;
    continue when exists (
      select 1 from service_sessions
      where user_name = v_one
        and calendar_event_id = new.event_id
        and status = 'active'
    );
    insert into service_sessions (
      user_name, role, calendar_event_id,
      primary_card_id, assigned_card_id,
      time_slot, started_at, service_date, status, source
    ) values (
      v_one, 'leader', new.event_id,
      new.assigned_card_id, new.assigned_card_id,
      v_time_slot, v_started_at, v_event_date, 'active', 'assigned'
    )
    on conflict on constraint service_sessions_user_date_slot_card_unique do nothing;
  end loop;

  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.create_system_chat_message(p_token uuid, p_event_id integer, p_content text)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_actor_id integer;
  v_actor_name text;
  v_actor_role text;
  v_message_id bigint;
begin
  v_actor_id := public.verify_session(p_token);

  select name, role
  into v_actor_name, v_actor_role
  from public.app_users
  where id = v_actor_id;

  if p_event_id is null then
    return null;
  end if;

  if nullif(trim(coalesce(p_content, '')), '') is null then
    raise exception '시스템 메시지가 비어있습니다';
  end if;

  if public.is_chat_locked(p_event_id) then
    raise exception '채팅방이 잠겼습니다 (모든 세션 종료 후 1주일 경과)';
  end if;

  if v_actor_role not in ('leader', 'admin', 'developer')
    and not exists (
      select 1
      from public.event_participants ep
      where ep.event_id = p_event_id
        and ep.user_name = v_actor_name
    )
  then
    raise exception '채팅방 참여자가 아닙니다';
  end if;

  insert into public.chat_messages (
    event_id,
    author_id,
    author_name,
    message_type,
    content,
    mention_ids,
    mention_names
  )
  values (
    p_event_id,
    null,
    '시스템',
    'system',
    trim(p_content),
    '{}',
    '{}'
  )
  returning id into v_message_id;

  return v_message_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.delete_chat_message(p_token uuid, p_message_id bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_actor_id integer;
  v_actor_role text;
  v_message public.chat_messages%rowtype;
  v_is_moderator boolean;
begin
  v_actor_id := public.verify_session(p_token);

  select role
  into v_actor_role
  from public.app_users
  where id = v_actor_id;

  select *
  into v_message
  from public.chat_messages
  where id = p_message_id
    and deleted_at is null;

  if not found then
    raise exception '메시지를 찾을 수 없습니다';
  end if;

  v_is_moderator := v_actor_role in ('leader', 'admin', 'developer');

  if not v_is_moderator then
    if v_message.author_id is distinct from v_actor_id then
      raise exception '본인 메시지만 삭제할 수 있습니다';
    end if;

    if v_message.created_at < now() - interval '5 minutes' then
      raise exception '메시지는 작성 후 5분 안에만 삭제할 수 있습니다';
    end if;

    if public.is_chat_locked(v_message.event_id) then
      raise exception '잠긴 채팅방에서는 메시지를 삭제할 수 없습니다';
    end if;
  end if;

  update public.chat_messages
  set deleted_at = now()
  where id = p_message_id;

  begin
    perform public.log_service_action(
      p_token,
      null,
      v_message.event_id,
      null,
      'message_deleted',
      'chat_message',
      p_message_id::integer,
      jsonb_build_object(
        'author_id', v_message.author_id,
        'author_name', v_message.author_name,
        'moderated', v_is_moderator
      )
    );
  exception
    when others then
      raise notice 'message deletion log skipped: %', sqlerrm;
  end;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.delete_informal_asset_secure(p_token uuid, p_asset_id integer)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_user_id integer;
  v_role text;
begin
  v_user_id := public.verify_session(p_token);

  select role
    into v_role
  from public.app_users
  where id = v_user_id;

  if v_role not in ('admin', 'developer') then
    raise exception 'permission denied';
  end if;

  delete from public.informal_assets
  where id = p_asset_id;

  -- Storage 파일은 환경별 삭제 함수 지원 여부가 달라 여기서는 DB row 삭제만 수행한다.
  -- 필요 시 service_role Edge Function 또는 정리 cron 으로 image_path orphan 을 청소한다.
  return true;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.delete_old_visit_histories(cutoff_date text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE _count INT; _affected_ids INT[];
BEGIN
  SELECT ARRAY_AGG(DISTINCT unit_id) INTO _affected_ids FROM visit_histories WHERE visited_at < cutoff_date;
  DELETE FROM visit_histories WHERE visited_at < cutoff_date;
  GET DIAGNOSTICS _count = ROW_COUNT;
  IF _affected_ids IS NOT NULL THEN
    UPDATE units u
    SET status = COALESCE(
      (SELECT result FROM visit_histories WHERE unit_id = u.id ORDER BY visited_at DESC, created_at DESC LIMIT 1),
      '미방문'
    ) WHERE u.id = ANY(_affected_ids);
  END IF;
  RETURN _count;
END; $function$
;

CREATE OR REPLACE FUNCTION public.delete_push_subscription(p_token uuid, p_endpoint text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_user_id integer;
begin
  v_user_id := public.verify_session(p_token);

  delete from public.push_subscriptions
  where endpoint = p_endpoint and user_id = v_user_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.dispatch_push_notification(p_user_ids integer[], p_type text, p_title text, p_body text DEFAULT NULL::text, p_link text DEFAULT NULL::text, p_related_id integer DEFAULT NULL::integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_url text;
  v_key text;
begin
  -- 운영 설정 위치: public.app_private_settings (anon/authenticated 접근 차단됨)
  select value into v_url from public.app_private_settings where key = 'push_edge_function_url';
  select value into v_key from public.app_private_settings where key = 'push_edge_function_key';

  -- 과거 GUC 방식으로 설정한 환경 호환 (테이블에 없을 때만)
  if v_url is null then
    v_url := nullif(current_setting('app.push_edge_function_url', true), '');
  end if;
  if v_key is null then
    v_key := nullif(current_setting('app.push_edge_function_key', true), '');
  end if;

  if v_url is null or v_key is null or p_user_ids is null or cardinality(p_user_ids) = 0 then
    return;
  end if;

  begin
    perform net.http_post(
      url := v_url,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || v_key
      ),
      body := jsonb_build_object(
        'recipient_ids', p_user_ids,
        'type', p_type,
        'title', p_title,
        'body', p_body,
        'link', p_link,
        'related_id', p_related_id
      )
    );
  exception
    when others then
      raise notice 'push dispatch skipped: %', sqlerrm;
  end;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.emit_chat_message_signal()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  insert into public.chat_message_signals (event_id, message_id)
  values (new.event_id, new.id);

  -- 신호 테이블은 실시간 트리거 용도라 너무 오래 쌓이지 않게 가볍게 정리한다.
  delete from public.chat_message_signals
  where created_at < now() - interval '7 days';

  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.get_chat_message_meta(p_token uuid, p_event_ids integer[])
 RETURNS TABLE(event_id integer, created_at timestamp with time zone, author_id integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_user_id integer;
begin
  v_user_id := public.verify_session(p_token);

  if coalesce(array_length(p_event_ids, 1), 0) = 0 then
    return;
  end if;

  return query
  select
    cm.event_id,
    cm.created_at,
    cm.author_id
  from public.chat_messages cm
  where cm.event_id = any(p_event_ids)
    and cm.deleted_at is null
    and cm.message_type != 'system'  -- ★ 시스템 메시지 안 읽음 카운트에서 제외
    and public.can_access_chat_event(v_user_id, cm.event_id)
  order by cm.created_at desc
  limit 1000;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.get_chat_message_previews(p_token uuid, p_event_ids integer[])
 RETURNS TABLE(id bigint, event_id integer, author_name text, message_type text, content text, created_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_user_id integer;
begin
  v_user_id := public.verify_session(p_token);

  if coalesce(array_length(p_event_ids, 1), 0) = 0 then
    return;
  end if;

  return query
  select
    cm.id,
    cm.event_id,
    cm.author_name,
    cm.message_type,
    cm.content,
    cm.created_at
  from public.chat_messages cm
  where cm.event_id = any(p_event_ids)
    and cm.deleted_at is null
    and public.can_access_chat_event(v_user_id, cm.event_id)
  order by cm.created_at desc
  limit 200;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.get_chat_messages(p_token uuid, p_event_id integer)
 RETURNS TABLE(id bigint, event_id integer, author_id integer, author_name text, message_type text, content text, image_url text, image_expired boolean, mention_ids integer[], mention_names text[], created_at timestamp with time zone, deleted_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_user_id integer;
begin
  v_user_id := public.verify_session(p_token);

  if not public.can_access_chat_event(v_user_id, p_event_id) then
    raise exception '채팅방 참여자가 아닙니다';
  end if;

  return query
  select
    cm.id,
    cm.event_id,
    cm.author_id,
    cm.author_name,
    cm.message_type,
    cm.content,
    cm.image_url,
    cm.image_expired,
    cm.mention_ids,
    cm.mention_names,
    cm.created_at,
    cm.deleted_at
  from public.chat_messages cm
  where cm.event_id = p_event_id
    and cm.deleted_at is null
  order by cm.created_at asc;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.get_comment_target_author_id(p_target_type text, p_target_id integer)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_author_name text;
  v_author_id integer;
begin
  if p_target_type = 'notice' and to_regclass('public.notices') is not null then
    begin
      execute 'select author from public.notices where id = $1'
      into v_author_name
      using p_target_id;
    exception
      when undefined_column then
        v_author_name := null;
    end;
  elsif p_target_type = 'calendar_event' then
    select leader_name
    into v_author_name
    from public.calendar_events
    where id = p_target_id;
  end if;

  if nullif(trim(coalesce(v_author_name, '')), '') is not null then
    select id
    into v_author_id
    from public.app_users
    where name = v_author_name
    limit 1;
  end if;

  return v_author_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.get_daily_service_settings(p_token text)
 RETURNS TABLE(enabled boolean, send_time text, last_sent text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_role text;
  v_token uuid;
begin
  begin
    v_token := p_token::uuid;
  exception when others then
    raise exception 'invalid session';
  end;

  select u.role into v_role
  from public.auth_sessions s
  join public.app_users u on u.id = s.user_id
  where s.token = v_token
    and (s.expires_at is null or s.expires_at > now())
    and coalesce(u.is_active, true) = true
  limit 1;

  if v_role not in ('admin', 'developer') then
    raise exception 'permission denied';
  end if;

  return query
  select
    coalesce((select aps.value = 'true' from public.app_private_settings aps where aps.key = 'daily_service_enabled'), true),
    coalesce((select aps.value from public.app_private_settings aps where aps.key = 'daily_service_time'), '09:00'),
    (select aps.value from public.app_private_settings aps where aps.key = 'daily_service_last_sent');
end;
$function$
;

CREATE OR REPLACE FUNCTION public.get_global_push_quiet_settings(p_token text)
 RETURNS TABLE(enabled boolean, quiet_start text, quiet_end text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_role text;
  v_token uuid;
begin
  begin
    v_token := p_token::uuid;
  exception when others then
    raise exception 'invalid session';
  end;

  select u.role
    into v_role
  from public.auth_sessions s
  join public.app_users u on u.id = s.user_id
  where s.token = v_token
    and (s.expires_at is null or s.expires_at > now())
    and coalesce(u.is_active, true) = true
  limit 1;

  if v_role not in ('admin', 'developer') then
    raise exception 'permission denied';
  end if;

  return query
  select
    coalesce((select aps.value = 'true' from public.app_private_settings aps where aps.key = 'global_push_quiet_enabled'), false) as enabled,
    coalesce((select aps.value from public.app_private_settings aps where aps.key = 'global_push_quiet_start'), '22:00') as quiet_start,
    coalesce((select aps.value from public.app_private_settings aps where aps.key = 'global_push_quiet_end'), '07:00') as quiet_end;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.get_login_logs(p_user_id integer, p_since timestamp with time zone DEFAULT NULL::timestamp with time zone, p_limit integer DEFAULT 50)
 RETURNS TABLE(id bigint, logged_in_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  SELECT l.id, l.logged_in_at
  FROM public.login_logs l
  WHERE l.user_id = p_user_id
    AND (p_since IS NULL OR l.logged_in_at >= p_since)
  ORDER BY l.logged_in_at DESC
  LIMIT p_limit;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_my_chat_reads(p_token uuid)
 RETURNS SETOF chat_read_status
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_user_id integer;
begin
  v_user_id := public.verify_session(p_token);

  return query
  select * from public.chat_read_status
  where user_id = v_user_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.get_my_notification_prefs(p_token uuid)
 RETURNS notification_preferences
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_user_id integer;
  v_row public.notification_preferences%rowtype;
begin
  v_user_id := public.verify_session(p_token);

  select * into v_row
  from public.notification_preferences
  where user_id = v_user_id;

  if not found then
    -- 없으면 기본값으로 생성 후 반환
    insert into public.notification_preferences (user_id) values (v_user_id)
    returning * into v_row;
  end if;

  return v_row;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.get_my_notifications(p_token uuid, p_limit integer DEFAULT 50)
 RETURNS SETOF notifications
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_user_id integer;
begin
  v_user_id := public.verify_session(p_token);

  return query
  select * from public.notifications
  where user_id = v_user_id
  order by created_at desc
  limit p_limit;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.get_service_logs(p_token uuid, p_filter_event_id integer DEFAULT NULL::integer, p_filter_card_id integer DEFAULT NULL::integer, p_limit integer DEFAULT 100)
 RETURNS SETOF service_logs
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_user_id integer;
  v_role text;
begin
  v_user_id := public.verify_session(p_token);

  select role
  into v_role
  from public.app_users
  where id = v_user_id;

  if v_role <> 'developer' then
    raise exception '권한 없음 (developer 전용)';
  end if;

  return query
  select sl.*
  from public.service_logs sl
  where (p_filter_event_id is null or sl.event_id = p_filter_event_id)
    and (p_filter_card_id is null or sl.card_id = p_filter_card_id)
  order by sl.created_at desc
  limit greatest(1, least(coalesce(p_limit, 100), 500));
end;
$function$
;

CREATE OR REPLACE FUNCTION public.hash_pin_if_plain()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  IF NEW.pin IS NOT NULL AND NEW.pin !~ '^\$2[aby]\$' THEN
    NEW.pin := extensions.crypt(NEW.pin, extensions.gen_salt('bf', 10));
  END IF;
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.insert_notifications(p_user_ids integer[], p_type text, p_title text, p_body text DEFAULT NULL::text, p_link text DEFAULT NULL::text, p_related_id integer DEFAULT NULL::integer)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_inserted integer;
begin
  if p_user_ids is null or cardinality(p_user_ids) = 0 then
    return 0;
  end if;

  with recipients as (
    select distinct unnest(p_user_ids) as user_id
  ),
  filtered as (
    select r.user_id
    from recipients r
    join public.app_users u on u.id = r.user_id
    left join public.notification_preferences pref on pref.user_id = r.user_id
    where coalesce(u.is_active, true) is true
      and coalesce(u.approval_status, 'approved') = 'approved'
      and case p_type
        when 'notice' then coalesce(pref.push_new_notice, true)
        when 'event_change' then coalesce(pref.push_event_change, true)
        when 'comment' then coalesce(pref.push_comment, true)
        when 'mention' then coalesce(pref.push_mention, true)
        when 'chat' then coalesce(pref.push_chat, true)
        when 'service_started' then coalesce(pref.push_service_status, true)
        when 'service_ended' then coalesce(pref.push_service_status, true)
        else true
      end
  ),
  inserted as (
    insert into public.notifications (user_id, type, title, body, link, related_id)
    select user_id, p_type, p_title, p_body, p_link, p_related_id
    from filtered
    returning 1
  )
  select count(*) into v_inserted from inserted;

  return coalesce(v_inserted, 0);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.is_chat_locked(p_event_id integer)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_session_count integer;
  v_has_active boolean;
  v_last_ended timestamptz;
begin
  select count(*)
  into v_session_count
  from public.service_sessions
  where calendar_event_id = p_event_id;

  -- 일정만 있고 봉사를 시작한 적이 없으면 채팅은 계속 활성.
  if coalesce(v_session_count, 0) = 0 then
    return false;
  end if;

  select exists (
    select 1
    from public.service_sessions
    where calendar_event_id = p_event_id
      and ended_at is null
  )
  into v_has_active;

  if v_has_active then
    return false;
  end if;

  select max(ended_at)
  into v_last_ended
  from public.service_sessions
  where calendar_event_id = p_event_id
    and ended_at is not null;

  return v_last_ended is not null and v_last_ended < now() - interval '7 days';
end;
$function$
;

CREATE OR REPLACE FUNCTION public.log_service_action(p_token uuid, p_session_id integer DEFAULT NULL::integer, p_event_id integer DEFAULT NULL::integer, p_card_id integer DEFAULT NULL::integer, p_action text DEFAULT NULL::text, p_target_type text DEFAULT NULL::text, p_target_id integer DEFAULT NULL::integer, p_details jsonb DEFAULT '{}'::jsonb)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_actor_id integer;
  v_actor_name text;
  v_event_title text;
  v_event_date date;
  v_card_name text;
  v_log_id bigint;
begin
  v_actor_id := public.verify_session(p_token);

  select name
  into v_actor_name
  from public.app_users
  where id = v_actor_id;

  if nullif(trim(coalesce(p_action, '')), '') is null then
    raise exception '로그 액션이 없습니다';
  end if;

  if p_event_id is not null then
    select title, event_date
    into v_event_title, v_event_date
    from public.calendar_events
    where id = p_event_id;
  end if;

  if p_card_id is not null then
    select name
    into v_card_name
    from public.cards
    where id = p_card_id;
  end if;

  insert into public.service_logs (
    session_id,
    event_id,
    event_title,
    event_date,
    card_id,
    card_name,
    actor_id,
    actor_name,
    action,
    target_type,
    target_id,
    details
  )
  values (
    p_session_id,
    p_event_id,
    v_event_title,
    v_event_date,
    p_card_id,
    v_card_name,
    v_actor_id,
    v_actor_name,
    trim(p_action),
    nullif(trim(coalesce(p_target_type, '')), ''),
    p_target_id,
    coalesce(p_details, '{}'::jsonb)
  )
  returning id into v_log_id;

  return v_log_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.manual_reset_met_units()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  _count INT;
BEGIN
  UPDATE units SET status = '미방문' WHERE status = '만남';
  GET DIAGNOSTICS _count = ROW_COUNT;
  RETURN _count;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.mark_all_chats_read(p_token uuid, p_event_ids integer[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_user_id integer;
begin
  v_user_id := public.verify_session(p_token);

  if coalesce(array_length(p_event_ids, 1), 0) = 0 then
    return;
  end if;

  insert into public.chat_read_status (event_id, user_id, last_read_at)
  select event_id, v_user_id, now()
  from unnest(p_event_ids) as t(event_id)
  on conflict (event_id, user_id) do update
    set last_read_at = now();
end;
$function$
;

CREATE OR REPLACE FUNCTION public.mark_all_notifications_read(p_token uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_user_id integer;
  v_count integer;
begin
  v_user_id := public.verify_session(p_token);

  update public.notifications
  set is_read = true
  where user_id = v_user_id and is_read = false;

  get diagnostics v_count = row_count;
  return v_count;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.mark_notification_read(p_token uuid, p_notification_id bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_user_id integer;
begin
  v_user_id := public.verify_session(p_token);

  update public.notifications
  set is_read = true
  where id = p_notification_id and user_id = v_user_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.notify_on_calendar_event_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_recipient_ids integer[];
  v_link text;
begin
  if old.event_date is not distinct from new.event_date
    and old.time is not distinct from new.time
    and old.place is not distinct from new.place
    and old.meeting_map_url is not distinct from new.meeting_map_url
    and old.leader_name is not distinct from new.leader_name
    and old.title is not distinct from new.title
  then
    return new;
  end if;

  select array_agg(distinct recipient_id)
  into v_recipient_ids
  from (
    select u.id as recipient_id
    from public.event_participants ep
    join public.app_users u on u.name = ep.user_name
    where ep.event_id = new.id

    union

    select u.id as recipient_id
    from public.app_users u
    where u.name = new.leader_name
  ) recipients
  where recipient_id is not null;

  if v_recipient_ids is null or cardinality(v_recipient_ids) = 0 then
    return new;
  end if;

  v_link := '/calendar?openChat=' || new.id;

  perform public.insert_notifications(
    v_recipient_ids,
    'event_change',
    '일정이 변경되었습니다',
    new.title || ' · ' || new.event_date || ' ' || new.time,
    v_link,
    new.id
  );

  perform public.dispatch_push_notification(
    v_recipient_ids,
    'event_change',
    '일정이 변경되었습니다',
    new.title || ' · ' || new.event_date || ' ' || new.time,
    v_link,
    new.id
  );

  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.notify_on_card_assignment()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_recipient_id integer;
  v_assigner_id integer;
  v_event_title text;
  v_event_date date;
  v_event_time text;
  v_card_name text;
  v_title text;
  v_body text;
  v_link text;
  v_skip text;
begin
  -- 배정 내용이 그대로인 사람은 알림 생략 (assign_cards_bulk_tx 가 목록을 넣어 준다)
  v_skip := current_setting('app.skip_assignment_notify', true);
  if coalesce(v_skip, '') <> '' then
    begin
      if (v_skip::jsonb) ? new.user_name then
        return new;
      end if;
    exception when others then
      null;  -- 설정값이 깨져 있으면 평소대로 알림
    end;
  end if;

  -- 배정 대상자(user_name) → user_id
  select id into v_recipient_id
  from public.app_users
  where name = new.user_name
    and coalesce(is_active, true) is true
  limit 1;

  if v_recipient_id is null then
    return new;
  end if;

  -- 배정한 사람(assigned_by) → user_id (자기 자신에게 보내지 않기 위해)
  if coalesce(new.assigned_by, '') <> '' then
    select id into v_assigner_id
    from public.app_users
    where name = new.assigned_by
    limit 1;
  end if;

  if v_assigner_id is not null and v_assigner_id = v_recipient_id then
    return new;
  end if;

  select title, event_date, time
  into v_event_title, v_event_date, v_event_time
  from public.calendar_events
  where id = new.event_id;

  select name into v_card_name
  from public.cards
  where id = new.assigned_card_id;

  v_title := '봉사 카드가 배정되었습니다';
  v_body := coalesce(v_event_title, '봉사 일정') ||
            case when v_event_date is not null
              then ' · ' || to_char(v_event_date, 'YYYY-MM-DD') ||
                   coalesce(' ' || v_event_time, '')
              else ''
            end ||
            case when v_card_name is not null
              then ' · ' || v_card_name
              else ''
            end;
  v_link := '/territory?assignmentEvent=' || new.event_id;

  perform public.insert_notifications(
    array[v_recipient_id], 'assignment', v_title, v_body, v_link, new.event_id
  );
  perform public.dispatch_push_notification(
    array[v_recipient_id], 'assignment', v_title, v_body, v_link, new.event_id
  );

  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.notify_on_chat_message()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_recipient_ids integer[];
  v_body text;
  v_link text;
begin
  -- ★ 시스템 메시지는 알림 + 푸시 생성 안 함
  if new.message_type = 'system' then
    return new;
  end if;

  select array_agg(distinct recipient_id)
  into v_recipient_ids
  from (
    select u.id as recipient_id
    from public.event_participants ep
    join public.app_users u on u.name = ep.user_name
    where ep.event_id = new.event_id

    union

    select u.id as recipient_id
    from public.calendar_events ce
    join public.app_users u on u.name = ce.leader_name
    where ce.id = new.event_id

    union

    select unnest(coalesce(new.mention_ids, '{}'::integer[])) as recipient_id
  ) recipients
  where recipient_id is not null
    and recipient_id is distinct from new.author_id
    and not exists (
      select 1
      from public.chat_room_mutes m
      where m.event_id = new.event_id
        and m.user_id = recipient_id
    );

  if v_recipient_ids is null or cardinality(v_recipient_ids) = 0 then
    return new;
  end if;

  v_body := new.author_name || ': ' || left(coalesce(new.content, '사진 메시지'), 50);
  v_link := '/calendar?openChat=' || new.event_id;

  perform public.insert_notifications(
    v_recipient_ids,
    case when cardinality(coalesce(new.mention_ids, '{}'::integer[])) > 0 then 'mention' else 'chat' end,
    case when cardinality(coalesce(new.mention_ids, '{}'::integer[])) > 0 then '채팅에서 언급됨' else '새 채팅 메시지' end,
    v_body,
    v_link,
    new.id::integer
  );

  perform public.dispatch_push_notification(
    v_recipient_ids,
    case when cardinality(coalesce(new.mention_ids, '{}'::integer[])) > 0 then 'mention' else 'chat' end,
    case when cardinality(coalesce(new.mention_ids, '{}'::integer[])) > 0 then '채팅에서 언급됨' else '새 채팅 메시지' end,
    v_body,
    v_link,
    new.id::integer
  );

  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.notify_on_comment()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_target_author_id integer;
  v_recipient_ids integer[];
  v_link text;
  v_type text;
begin
  v_target_author_id := public.get_comment_target_author_id(new.target_type, new.target_id);

  select array_agg(distinct recipient_id)
  into v_recipient_ids
  from (
    select unnest(coalesce(new.mention_ids, '{}'::integer[])) as recipient_id
    union all
    select v_target_author_id
  ) recipients
  where recipient_id is not null
    and recipient_id is distinct from new.author_id;

  if v_recipient_ids is null or cardinality(v_recipient_ids) = 0 then
    return new;
  end if;

  v_link := case new.target_type
    when 'notice' then '/notices?noticeId=' || new.target_id
    when 'calendar_event' then '/calendar?openEvent=' || new.target_id
    else null
  end;

  v_type := case
    when cardinality(coalesce(new.mention_ids, '{}'::integer[])) > 0 then 'mention'
    else 'comment'
  end;

  perform public.insert_notifications(
    v_recipient_ids,
    v_type,
    case when v_type = 'mention' then '댓글에서 언급됨' else '새 댓글' end,
    new.author_name || ': ' || left(new.content, 50),
    v_link,
    new.id::integer
  );

  perform public.dispatch_push_notification(
    v_recipient_ids,
    v_type,
    case when v_type = 'mention' then '댓글에서 언급됨' else '새 댓글' end,
    new.author_name || ': ' || left(new.content, 50),
    v_link,
    new.id::integer
  );

  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.notify_on_informal_assignment()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_recipient_id integer;
  v_assigner_id integer;
  v_event_title text;
  v_event_date date;
  v_event_time text;
  v_asset_name text;
  v_title text;
  v_body text;
  v_link text;
begin
  select id into v_recipient_id
  from public.app_users
  where name = new.user_name
    and coalesce(is_active, true) is true
  limit 1;

  if v_recipient_id is null then
    return new;
  end if;

  if coalesce(new.assigned_by, '') <> '' then
    select id into v_assigner_id from public.app_users
    where name = new.assigned_by limit 1;
  end if;

  if v_assigner_id is not null and v_assigner_id = v_recipient_id then
    return new;
  end if;

  select title, event_date, time into v_event_title, v_event_date, v_event_time
  from public.calendar_events where id = new.event_id;

  select name into v_asset_name from public.informal_assets where id = new.asset_id;

  v_title := '비공식 증거 카드가 배정되었습니다';
  v_body := coalesce(v_event_title, '봉사 일정')
    || case when v_event_date is not null
         then ' · ' || to_char(v_event_date, 'YYYY-MM-DD')
              || coalesce(' ' || v_event_time, '')
         else '' end
    || case when v_asset_name is not null
         then ' · ' || v_asset_name
         else '' end;
  v_link := '/territory?assignmentEvent=' || new.event_id;

  perform public.insert_notifications(
    array[v_recipient_id], 'assignment_informal', v_title, v_body, v_link, new.event_id
  );
  perform public.dispatch_push_notification(
    array[v_recipient_id], 'assignment_informal', v_title, v_body, v_link, new.event_id
  );
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.notify_on_notice_insert()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_author_id integer;
  v_recipient_ids integer[];
  v_title text;
begin
  begin
    select id
    into v_author_id
    from public.app_users
    where name = new.author
    limit 1;
  exception
    when undefined_column then
      v_author_id := null;
  end;

  select array_agg(id)
  into v_recipient_ids
  from public.app_users
  where coalesce(is_active, true) is true
    and coalesce(approval_status, 'approved') = 'approved'
    and id is distinct from v_author_id;

  if v_recipient_ids is null or cardinality(v_recipient_ids) = 0 then
    return new;
  end if;

  begin
    v_title := coalesce(new.title, '새 공지');
  exception
    when undefined_column then
      v_title := '새 공지';
  end;

  perform public.insert_notifications(
    v_recipient_ids,
    'notice',
    '새 공지',
    v_title,
    '/notices?noticeId=' || new.id,
    new.id::integer
  );

  perform public.dispatch_push_notification(
    v_recipient_ids,
    'notice',
    '새 공지',
    v_title,
    '/notices?noticeId=' || new.id,
    new.id::integer
  );

  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.notify_on_restaurant_assignment()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_recipient_id integer;
  v_assigner_id integer;
  v_event_title text;
  v_event_date date;
  v_event_time text;
  v_building_name text;
  v_title text;
  v_body text;
  v_link text;
begin
  select id into v_recipient_id
  from public.app_users
  where name = new.user_name
    and coalesce(is_active, true) is true
  limit 1;

  if v_recipient_id is null then
    return new;
  end if;

  if coalesce(new.assigned_by, '') <> '' then
    select id into v_assigner_id from public.app_users
    where name = new.assigned_by limit 1;
  end if;

  if v_assigner_id is not null and v_assigner_id = v_recipient_id then
    return new;
  end if;

  select title, event_date, time into v_event_title, v_event_date, v_event_time
  from public.calendar_events where id = new.event_id;

  select coalesce(nullif(name, ''), address)
    into v_building_name from public.buildings where id = new.building_id;

  v_title := '식당 봉사가 배정되었습니다';
  v_body := coalesce(v_event_title, '봉사 일정')
    || case when v_event_date is not null
         then ' · ' || to_char(v_event_date, 'YYYY-MM-DD')
              || coalesce(' ' || v_event_time, '')
         else '' end
    || case when v_building_name is not null
         then ' · ' || v_building_name
         else '' end;
  v_link := '/territory?assignmentEvent=' || new.event_id;

  perform public.insert_notifications(
    array[v_recipient_id], 'assignment_restaurant', v_title, v_body, v_link, new.event_id
  );
  perform public.dispatch_push_notification(
    array[v_recipient_id], 'assignment_restaurant', v_title, v_body, v_link, new.event_id
  );
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.preview_data_cleanup()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  _chat_days  INT;
  _notif_read INT;
  _notif_max  INT;
  _svc_days   INT;
  _login_days INT;
  _chat       INT := 0;
  _notif      INT := 0;
  _svc        INT := 0;
  _login      INT := 0;
BEGIN
  SELECT value::INT INTO _chat_days  FROM app_settings WHERE key = 'retention_chat_days';
  SELECT value::INT INTO _notif_read FROM app_settings WHERE key = 'retention_notif_read_days';
  SELECT value::INT INTO _notif_max  FROM app_settings WHERE key = 'retention_notif_max_days';
  SELECT value::INT INTO _svc_days   FROM app_settings WHERE key = 'retention_service_logs_days';
  SELECT value::INT INTO _login_days FROM app_settings WHERE key = 'retention_login_logs_days';

  IF COALESCE(_chat_days, 0) > 0 THEN
    SELECT COUNT(*) INTO _chat FROM chat_messages
    WHERE created_at < now() - (_chat_days || ' days')::INTERVAL;
  END IF;

  SELECT COUNT(*) INTO _notif FROM notifications
  WHERE (is_read = true  AND COALESCE(_notif_read, 0) > 0 AND created_at < now() - (_notif_read || ' days')::INTERVAL)
     OR (                    COALESCE(_notif_max, 0)  > 0 AND created_at < now() - (_notif_max  || ' days')::INTERVAL);

  IF COALESCE(_svc_days, 0) > 0 THEN
    SELECT COUNT(*) INTO _svc FROM service_logs
    WHERE created_at < now() - (_svc_days || ' days')::INTERVAL;
  END IF;

  IF COALESCE(_login_days, 0) > 0 THEN
    SELECT COUNT(*) INTO _login FROM login_logs
    WHERE logged_in_at < now() - (_login_days || ' days')::INTERVAL;
  END IF;

  RETURN jsonb_build_object(
    'chat_to_delete',          _chat,
    'notifications_to_delete', _notif,
    'service_logs_to_delete',  _svc,
    'login_logs_to_delete',    _login
  );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.push_config_status()
 RETURNS TABLE(url_set boolean, key_set boolean, source text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_tbl_url text;
  v_tbl_key text;
begin
  select value into v_tbl_url from public.app_private_settings where key = 'push_edge_function_url';
  select value into v_tbl_key from public.app_private_settings where key = 'push_edge_function_key';
  return query select
    v_tbl_url is not null,
    v_tbl_key is not null,
    'app_private_settings'::text;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.push_recent_responses(p_limit integer DEFAULT 10)
 RETURNS TABLE(id bigint, status_code integer, created timestamp with time zone, body text)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select r.id, r.status_code, r.created, left(coalesce(r.content, ''), 300)
  from net._http_response r order by r.created desc limit p_limit;
$function$
;

CREATE OR REPLACE FUNCTION public.send_chat_image(p_token uuid, p_event_id integer, p_image_url text, p_caption text DEFAULT NULL::text, p_mention_ids integer[] DEFAULT '{}'::integer[], p_mention_names text[] DEFAULT '{}'::text[])
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_author_id integer;
  v_author_name text;
  v_role text;
  v_message_id bigint;
  v_caption text;
begin
  v_author_id := public.verify_session(p_token);

  select name, role
  into v_author_name, v_role
  from public.app_users
  where id = v_author_id;

  if p_image_url is null or length(p_image_url) = 0 then
    raise exception '이미지 URL이 비어있습니다';
  end if;

  if public.is_chat_locked(p_event_id) then
    raise exception '채팅방이 잠겼습니다 (모든 세션 종료 후 1주일 경과)';
  end if;

  if v_role not in ('leader', 'admin', 'developer')
    and not exists (
      select 1
      from public.event_participants ep
      where ep.event_id = p_event_id
        and ep.user_name = v_author_name
    )
  then
    raise exception '채팅방 참여자가 아닙니다';
  end if;

  -- 관리자/인도자 자동 참여 및 합류 메시지 발생
  if not exists (
    select 1
    from public.event_participants ep
    where ep.event_id = p_event_id
      and ep.user_name = v_author_name
  ) then
    insert into public.event_participants (event_id, user_name, role)
    values (p_event_id, v_author_name, '참여')
    on conflict (event_id, user_name) do nothing;
    
    insert into public.chat_messages (
      event_id, author_id, author_name, message_type, content
    )
    values (
      p_event_id, null, '시스템', 'system', v_author_name || '님이 합류했습니다.'
    );
  end if;

  v_caption := nullif(trim(coalesce(p_caption, '')), '');

  insert into public.chat_messages (
    event_id,
    author_id,
    author_name,
    message_type,
    content,
    image_url,
    image_expires_at,
    mention_ids,
    mention_names
  )
  values (
    p_event_id,
    v_author_id,
    v_author_name,
    'image',
    v_caption,
    p_image_url,
    now() + interval '180 days',
    coalesce(p_mention_ids, '{}'),
    coalesce(p_mention_names, '{}')
  )
  returning id into v_message_id;

  return v_message_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.send_chat_message(p_token uuid, p_event_id integer, p_content text, p_mention_ids integer[] DEFAULT '{}'::integer[], p_mention_names text[] DEFAULT '{}'::text[])
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_author_id integer;
  v_author_name text;
  v_role text;
  v_message_id bigint;
begin
  v_author_id := public.verify_session(p_token);

  select name, role
  into v_author_name, v_role
  from public.app_users
  where id = v_author_id;

  if nullif(trim(coalesce(p_content, '')), '') is null then
    raise exception '메시지를 입력해주세요';
  end if;

  if public.is_chat_locked(p_event_id) then
    raise exception '채팅방이 잠겼습니다 (모든 세션 종료 후 1주일 경과)';
  end if;

  if v_role not in ('leader', 'admin', 'developer')
    and not exists (
      select 1
      from public.event_participants ep
      where ep.event_id = p_event_id
        and ep.user_name = v_author_name
    )
  then
    raise exception '채팅방 참여자가 아닙니다';
  end if;

  -- 관리자/인도자 자동 참여 및 합류 메시지 발생
  if not exists (
    select 1
    from public.event_participants ep
    where ep.event_id = p_event_id
      and ep.user_name = v_author_name
  ) then
    insert into public.event_participants (event_id, user_name, role)
    values (p_event_id, v_author_name, '참여')
    on conflict (event_id, user_name) do nothing;
    
    insert into public.chat_messages (
      event_id, author_id, author_name, message_type, content
    )
    values (
      p_event_id, null, '시스템', 'system', v_author_name || '님이 합류했습니다.'
    );
  end if;

  insert into public.chat_messages (
    event_id,
    author_id,
    author_name,
    message_type,
    content,
    mention_ids,
    mention_names
  )
  values (
    p_event_id,
    v_author_id,
    v_author_name,
    'text',
    trim(p_content),
    coalesce(p_mention_ids, '{}'),
    coalesce(p_mention_names, '{}')
  )
  returning id into v_message_id;

  return v_message_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.send_daily_service_digest(p_force boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_enabled boolean;
  v_send_time time;
  v_last_sent text;
  v_now timestamp;
  v_today date;
  v_count integer;
  v_title text;
  v_body text;
  v_link text;
  v_first_event integer;
  v_recipients integer[];
begin
  v_now := (now() at time zone 'Asia/Seoul');
  v_today := v_now::date;

  select coalesce((select value = 'true' from public.app_private_settings where key = 'daily_service_enabled'), true)
    into v_enabled;
  select coalesce((select value from public.app_private_settings where key = 'daily_service_time'), '09:00')::time
    into v_send_time;
  select value into v_last_sent from public.app_private_settings where key = 'daily_service_last_sent';

  if not p_force then
    if not v_enabled then
      return jsonb_build_object('ok', true, 'sent', 0, 'reason', 'disabled');
    end if;
    if v_now::time < v_send_time then
      return jsonb_build_object('ok', true, 'sent', 0, 'reason', 'too_early');
    end if;
    if v_last_sent = v_today::text then
      return jsonb_build_object('ok', true, 'sent', 0, 'reason', 'already_sent_today');
    end if;
  end if;

  -- 오늘 일정 모으기 (시간 순)
  select count(*), min(id)
    into v_count, v_first_event
  from public.calendar_events
  where event_date = v_today;

  -- 발송 시각이 지났다는 기록은 일정 유무와 관계없이 남긴다
  -- (하루 한 번만 판단 → 낮에 일정이 추가돼도 뒤늦게 알림이 튀지 않는다)
  if not p_force then
    insert into public.app_private_settings (key, value)
    values ('daily_service_last_sent', v_today::text)
    on conflict (key) do update set value = excluded.value, updated_at = now();
  end if;

  if coalesce(v_count, 0) = 0 then
    return jsonb_build_object('ok', true, 'sent', 0, 'reason', 'no_events');
  end if;

  select string_agg(line, E'\n' order by ord)
    into v_body
  from (
    select
      e.time as ord,
      coalesce(e.time, '') || ' ' || coalesce(e.title, '봉사') ||
      coalesce(' · ' || nullif(e.place, ''), '') ||
      coalesce(' (' || nullif(e.leader_name, '') || ')', '') as line
    from public.calendar_events e
    where e.event_date = v_today
  ) s;

  v_title := '오늘 봉사 마련 ' || v_count || '건';
  v_link := case when v_count = 1 then '/calendar?openEvent=' || v_first_event else '/calendar' end;

  -- 받을 사람: 활성 사용자 중 이 알림을 끄지 않은 사람
  select array_agg(u.id)
    into v_recipients
  from public.app_users u
  left join public.notification_preferences p on p.user_id = u.id
  where coalesce(u.is_active, true) is true
    and coalesce(u.approval_status, 'approved') = 'approved'
    and coalesce(p.push_daily_service, true) is true;

  if v_recipients is null or cardinality(v_recipients) = 0 then
    return jsonb_build_object('ok', true, 'sent', 0, 'reason', 'no_recipients');
  end if;

  -- 받을 사람은 위에서 이미 걸렀다 (insert_notifications 의 종류별 필터에는
  -- daily_service 항목이 없어 그대로 통과하므로, 여기서 거른 목록을 그대로 쓴다)
  perform public.insert_notifications(v_recipients, 'daily_service', v_title, v_body, v_link, null::integer);
  perform public.dispatch_push_notification(v_recipients, 'daily_service', v_title, v_body, v_link, null::integer);

  return jsonb_build_object(
    'ok', true,
    'sent', cardinality(v_recipients),
    'events', v_count,
    'title', v_title,
    'body', v_body
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.sync_building_is_restaurant()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_building_id integer := coalesce(new.building_id, old.building_id);
  v_has boolean;
begin
  if v_building_id is null then
    return coalesce(new, old);
  end if;

  -- ⚠ 식당 세대와 무관한 변경(호수 추가·수정 등)에는 손대지 않는다.
  --   그러지 않으면 "건물에만 식당 표시가 있고 식당 세대는 없는" 옛 데이터가
  --   엉뚱한 순간에 꺼져 목록에서 사라진다.
  if coalesce(new.is_restaurant, false) is not true
     and coalesce(old.is_restaurant, false) is not true then
    return coalesce(new, old);
  end if;
  select exists (
    select 1 from public.units
    where building_id = v_building_id and is_restaurant is true
  ) into v_has;

  update public.buildings
  set is_restaurant = v_has
  where id = v_building_id
    and is_restaurant is distinct from v_has;

  return coalesce(new, old);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.touch_phone_survey()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  new.updated_at := now();
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.update_chat_read(p_token uuid, p_event_id integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_user_id integer;
begin
  v_user_id := public.verify_session(p_token);

  insert into public.chat_read_status (event_id, user_id, last_read_at)
  values (p_event_id, v_user_id, now())
  on conflict (event_id, user_id) do update
  set last_read_at = now();
end;
$function$
;

CREATE OR REPLACE FUNCTION public.update_daily_service_settings(p_token text, p_enabled boolean, p_send_time text)
 RETURNS TABLE(enabled boolean, send_time text, last_sent text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_role text;
  v_token uuid;
  v_time time;
begin
  begin
    v_token := p_token::uuid;
  exception when others then
    raise exception 'invalid session';
  end;

  select u.role into v_role
  from public.auth_sessions s
  join public.app_users u on u.id = s.user_id
  where s.token = v_token
    and (s.expires_at is null or s.expires_at > now())
    and coalesce(u.is_active, true) = true
  limit 1;

  if v_role not in ('admin', 'developer') then
    raise exception 'permission denied';
  end if;

  begin
    v_time := p_send_time::time;
  exception when others then
    raise exception 'invalid time';
  end;

  insert into public.app_private_settings (key, value)
  values ('daily_service_enabled', case when p_enabled then 'true' else 'false' end)
  on conflict (key) do update set value = excluded.value, updated_at = now();

  insert into public.app_private_settings (key, value)
  values ('daily_service_time', to_char(v_time, 'HH24:MI'))
  on conflict (key) do update set value = excluded.value, updated_at = now();

  return query select * from public.get_daily_service_settings(p_token);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.update_global_push_quiet_settings(p_token text, p_enabled boolean, p_quiet_start text, p_quiet_end text)
 RETURNS TABLE(enabled boolean, quiet_start text, quiet_end text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_role text;
  v_token uuid;
  v_start time;
  v_end time;
begin
  begin
    v_token := p_token::uuid;
  exception when others then
    raise exception 'invalid session';
  end;

  select u.role
    into v_role
  from public.auth_sessions s
  join public.app_users u on u.id = s.user_id
  where s.token = v_token
    and (s.expires_at is null or s.expires_at > now())
    and coalesce(u.is_active, true) = true
  limit 1;

  if v_role not in ('admin', 'developer') then
    raise exception 'permission denied';
  end if;

  begin
    v_start := p_quiet_start::time;
    v_end := p_quiet_end::time;
  exception when others then
    raise exception 'invalid quiet hour time';
  end;

  insert into public.app_private_settings (key, value, updated_at)
  values
    ('global_push_quiet_enabled', case when p_enabled then 'true' else 'false' end, now()),
    ('global_push_quiet_start', to_char(v_start, 'HH24:MI'), now()),
    ('global_push_quiet_end', to_char(v_end, 'HH24:MI'), now())
  on conflict (key) do update
    set value = excluded.value,
        updated_at = now();

  return query
  select
    p_enabled as enabled,
    to_char(v_start, 'HH24:MI') as quiet_start,
    to_char(v_end, 'HH24:MI') as quiet_end;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.update_my_notification_prefs(p_token uuid, p_push_new_notice boolean, p_push_event_change boolean, p_push_comment boolean, p_push_chat boolean, p_push_mention boolean, p_push_service_status boolean, p_quiet_hours_start time without time zone DEFAULT NULL::time without time zone, p_quiet_hours_end time without time zone DEFAULT NULL::time without time zone, p_push_daily_service boolean DEFAULT true)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_user_id integer;
begin
  v_user_id := public.verify_session(p_token);

  insert into public.notification_preferences (
    user_id, push_new_notice, push_event_change, push_comment,
    push_chat, push_mention, push_service_status,
    quiet_hours_start, quiet_hours_end, push_daily_service, updated_at
  )
  values (
    v_user_id, p_push_new_notice, p_push_event_change, p_push_comment,
    p_push_chat, p_push_mention, p_push_service_status,
    p_quiet_hours_start, p_quiet_hours_end, coalesce(p_push_daily_service, true), now()
  )
  on conflict (user_id) do update
  set
    push_new_notice = excluded.push_new_notice,
    push_event_change = excluded.push_event_change,
    push_comment = excluded.push_comment,
    push_chat = excluded.push_chat,
    push_mention = excluded.push_mention,
    push_service_status = excluded.push_service_status,
    quiet_hours_start = excluded.quiet_hours_start,
    quiet_hours_end = excluded.quiet_hours_end,
    push_daily_service = excluded.push_daily_service,
    updated_at = now();
end;
$function$
;

CREATE OR REPLACE FUNCTION public.upsert_push_subscription(p_token uuid, p_endpoint text, p_p256dh text, p_auth text, p_device_label text DEFAULT NULL::text)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_user_id integer;
  v_id bigint;
begin
  v_user_id := public.verify_session(p_token);

  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, device_label, last_seen_at)
  values (v_user_id, p_endpoint, p_p256dh, p_auth, p_device_label, now())
  on conflict (endpoint) do update
  set
    user_id = excluded.user_id,
    p256dh = excluded.p256dh,
    auth = excluded.auth,
    device_label = excluded.device_label,
    updated_at = now(),
    last_seen_at = now()
  returning id into v_id;

  return v_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.verify_session(p_token uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_user_id integer;
  v_is_active boolean;
  v_approval_status text;
begin
  if p_token is null then
    raise exception '세션 토큰이 없습니다';
  end if;

  select s.user_id, coalesce(u.is_active, true), coalesce(u.approval_status, 'approved')
  into v_user_id, v_is_active, v_approval_status
  from public.auth_sessions s
  join public.app_users u on u.id = s.user_id
  where s.token = p_token
    and s.expires_at > now();

  if v_user_id is null then
    raise exception '세션 만료. 다시 로그인해주세요';
  end if;

  if v_is_active is false then
    delete from public.auth_sessions where token = p_token;
    raise exception '비활성화된 계정입니다';
  end if;

  if v_approval_status is distinct from 'approved' then
    delete from public.auth_sessions where token = p_token;
    raise exception '승인되지 않은 계정입니다';
  end if;

  update public.auth_sessions
  set last_used_at = now()
  where token = p_token;

  return v_user_id;
end;
$function$
;

CREATE TRIGGER app_users_hash_pin BEFORE INSERT OR UPDATE OF pin ON public.app_users FOR EACH ROW EXECUTE FUNCTION hash_pin_if_plain();

CREATE TRIGGER on_calendar_event_update AFTER UPDATE OF event_date, "time", place, meeting_map_url, leader_name, title ON public.calendar_events FOR EACH ROW EXECUTE FUNCTION notify_on_calendar_event_change();

CREATE TRIGGER on_chat_message_insert AFTER INSERT ON public.chat_messages FOR EACH ROW EXECUTE FUNCTION notify_on_chat_message();

CREATE TRIGGER on_chat_message_signal AFTER INSERT ON public.chat_messages FOR EACH ROW EXECUTE FUNCTION emit_chat_message_signal();

CREATE TRIGGER on_comment_insert AFTER INSERT ON public.comments FOR EACH ROW EXECUTE FUNCTION notify_on_comment();

CREATE TRIGGER on_event_card_assignment_insert AFTER INSERT ON public.event_card_assignments FOR EACH ROW EXECUTE FUNCTION notify_on_card_assignment();

CREATE TRIGGER on_event_card_assignment_session AFTER INSERT ON public.event_card_assignments FOR EACH ROW EXECUTE FUNCTION create_sessions_on_assignment();

CREATE TRIGGER on_informal_assignment_insert AFTER INSERT ON public.event_informal_assignments FOR EACH ROW EXECUTE FUNCTION notify_on_informal_assignment();

CREATE TRIGGER on_notice_insert AFTER INSERT ON public.notices FOR EACH ROW EXECUTE FUNCTION notify_on_notice_insert();

CREATE TRIGGER on_restaurant_assignment_insert AFTER INSERT ON public.event_restaurant_assignments FOR EACH ROW EXECUTE FUNCTION notify_on_restaurant_assignment();

CREATE TRIGGER phone_surveys_touch BEFORE UPDATE ON public.phone_surveys FOR EACH ROW EXECUTE FUNCTION touch_phone_survey();

CREATE TRIGGER units_sync_building_restaurant AFTER INSERT OR DELETE OR UPDATE OF is_restaurant, building_id ON public.units FOR EACH ROW EXECUTE FUNCTION sync_building_is_restaurant();

alter table public.app_private_settings enable row level security;

alter table public.app_settings enable row level security;

alter table public.app_users enable row level security;

alter table public.auth_sessions enable row level security;

alter table public.buildings enable row level security;

alter table public.calendar_events enable row level security;

alter table public.card_assignments enable row level security;

alter table public.card_boundaries enable row level security;

alter table public.card_leader_assignments enable row level security;

alter table public.cards enable row level security;

alter table public.chat_message_signals enable row level security;

alter table public.chat_messages enable row level security;

alter table public.chat_read_status enable row level security;

alter table public.chat_room_mutes enable row level security;

alter table public.comments enable row level security;

alter table public.event_card_assignment_cards enable row level security;

alter table public.event_card_assignments enable row level security;

alter table public.event_informal_assignments enable row level security;

alter table public.event_participants enable row level security;

alter table public.event_restaurant_assignments enable row level security;

alter table public.informal_assets enable row level security;

alter table public.informal_groups enable row level security;

alter table public.notices enable row level security;

alter table public.notification_preferences enable row level security;

alter table public.notifications enable row level security;

alter table public.phone_surveys enable row level security;

alter table public.push_subscriptions enable row level security;

alter table public.regular_visits enable row level security;

alter table public.restaurant_requests enable row level security;

alter table public.return_visit_logs enable row level security;

alter table public.return_visits enable row level security;

alter table public.review_tasks enable row level security;

alter table public.service_logs enable row level security;

alter table public.service_sessions enable row level security;

alter table public.service_suggestions enable row level security;

alter table public.territory_regions enable row level security;

alter table public.units enable row level security;

alter table public.visit_histories enable row level security;

create policy app_private_settings_deny_all on public.app_private_settings as PERMISSIVE for ALL to anon, authenticated using (false) with check (false);

create policy app_settings_read on public.app_settings as PERMISSIVE for SELECT to public using (true);

create policy app_settings_write on public.app_settings as PERMISSIVE for ALL to public using (true);

create policy open_access on public.app_users as PERMISSIVE for ALL to anon using (true) with check (true);

create policy open_access on public.buildings as PERMISSIVE for ALL to anon using (true) with check (true);

create policy open on public.calendar_events as PERMISSIVE for ALL to public using (true) with check (true);

create policy open_access on public.card_assignments as PERMISSIVE for ALL to anon using (true) with check (true);

create policy open_access on public.card_boundaries as PERMISSIVE for ALL to anon using (true) with check (true);

create policy open_access on public.card_leader_assignments as PERMISSIVE for ALL to anon using (true) with check (true);

create policy open_access on public.cards as PERMISSIVE for ALL to anon using (true) with check (true);

create policy chat_message_signals_read on public.chat_message_signals as PERMISSIVE for SELECT to anon, authenticated using (true);

create policy chat_read_status_realtime_select on public.chat_read_status as PERMISSIVE for SELECT to anon, authenticated using (true);

create policy open_access on public.chat_room_mutes as PERMISSIVE for ALL to anon, authenticated using (true) with check (true);

create policy open_access on public.comments as PERMISSIVE for ALL to anon, authenticated using (true) with check (true);

create policy open_access on public.event_card_assignment_cards as PERMISSIVE for ALL to anon using (true) with check (true);

create policy open_access on public.event_card_assignments as PERMISSIVE for ALL to anon using (true) with check (true);

create policy open_access on public.event_informal_assignments as PERMISSIVE for ALL to anon using (true) with check (true);

create policy open on public.event_participants as PERMISSIVE for ALL to public using (true) with check (true);

create policy open_access on public.event_restaurant_assignments as PERMISSIVE for ALL to anon using (true) with check (true);

create policy open_access on public.informal_assets as PERMISSIVE for ALL to anon using (true) with check (true);

create policy open_access on public.informal_groups as PERMISSIVE for ALL to anon, authenticated using (true) with check (true);

create policy "anyone can delete notices" on public.notices as PERMISSIVE for DELETE to public using (true);

create policy "anyone can insert notices" on public.notices as PERMISSIVE for INSERT to public with check (true);

create policy "anyone can read notices" on public.notices as PERMISSIVE for SELECT to public using (true);

create policy delete on public.notices as PERMISSIVE for DELETE to public using (true);

create policy insert on public.notices as PERMISSIVE for INSERT to public with check (true);

create policy read on public.notices as PERMISSIVE for SELECT to public using (true);

create policy notifications_realtime_select on public.notifications as PERMISSIVE for SELECT to anon, authenticated using (true);

create policy open_access on public.phone_surveys as PERMISSIVE for ALL to anon, authenticated using (true) with check (true);

create policy open_access on public.regular_visits as PERMISSIVE for ALL to anon using (true) with check (true);

create policy restaurant_requests_delete on public.restaurant_requests as PERMISSIVE for DELETE to public using (true);

create policy restaurant_requests_insert on public.restaurant_requests as PERMISSIVE for INSERT to public with check (true);

create policy restaurant_requests_select on public.restaurant_requests as PERMISSIVE for SELECT to public using (true);

create policy restaurant_requests_update on public.restaurant_requests as PERMISSIVE for UPDATE to public using (true);

create policy "allow all" on public.return_visit_logs as PERMISSIVE for ALL to public using (true);

create policy "allow all" on public.return_visits as PERMISSIVE for ALL to public using (true);

create policy "allow all" on public.review_tasks as PERMISSIVE for ALL to public using (true) with check (true);

create policy open_access on public.service_sessions as PERMISSIVE for ALL to anon using (true) with check (true);

create policy "Enable all operations for all" on public.service_suggestions as PERMISSIVE for ALL to public using (true) with check (true);

create policy open_access on public.territory_regions as PERMISSIVE for ALL to anon, authenticated using (true) with check (true);

create policy open_access on public.units as PERMISSIVE for ALL to anon using (true) with check (true);

create policy open_access on public.visit_histories as PERMISSIVE for ALL to anon using (true) with check (true);

grant DELETE on public.app_private_settings to service_role;

grant INSERT on public.app_private_settings to service_role;

grant REFERENCES on public.app_private_settings to service_role;

grant SELECT on public.app_private_settings to service_role;

grant TRIGGER on public.app_private_settings to service_role;

grant TRUNCATE on public.app_private_settings to service_role;

grant UPDATE on public.app_private_settings to service_role;

grant DELETE on public.app_settings to anon;

grant INSERT on public.app_settings to anon;

grant REFERENCES on public.app_settings to anon;

grant SELECT on public.app_settings to anon;

grant TRIGGER on public.app_settings to anon;

grant TRUNCATE on public.app_settings to anon;

grant UPDATE on public.app_settings to anon;

grant DELETE on public.app_settings to authenticated;

grant INSERT on public.app_settings to authenticated;

grant REFERENCES on public.app_settings to authenticated;

grant SELECT on public.app_settings to authenticated;

grant TRIGGER on public.app_settings to authenticated;

grant TRUNCATE on public.app_settings to authenticated;

grant UPDATE on public.app_settings to authenticated;

grant DELETE on public.app_settings to service_role;

grant INSERT on public.app_settings to service_role;

grant REFERENCES on public.app_settings to service_role;

grant SELECT on public.app_settings to service_role;

grant TRIGGER on public.app_settings to service_role;

grant TRUNCATE on public.app_settings to service_role;

grant UPDATE on public.app_settings to service_role;

grant DELETE on public.app_users to anon;

grant INSERT on public.app_users to anon;

grant UPDATE on public.app_users to anon;

grant DELETE on public.app_users to authenticated;

grant INSERT on public.app_users to authenticated;

grant UPDATE on public.app_users to authenticated;

grant DELETE on public.app_users to service_role;

grant INSERT on public.app_users to service_role;

grant REFERENCES on public.app_users to service_role;

grant SELECT on public.app_users to service_role;

grant TRIGGER on public.app_users to service_role;

grant TRUNCATE on public.app_users to service_role;

grant UPDATE on public.app_users to service_role;

grant DELETE on public.auth_sessions to service_role;

grant INSERT on public.auth_sessions to service_role;

grant REFERENCES on public.auth_sessions to service_role;

grant SELECT on public.auth_sessions to service_role;

grant TRIGGER on public.auth_sessions to service_role;

grant TRUNCATE on public.auth_sessions to service_role;

grant UPDATE on public.auth_sessions to service_role;

grant DELETE on public.buildings to anon;

grant INSERT on public.buildings to anon;

grant REFERENCES on public.buildings to anon;

grant SELECT on public.buildings to anon;

grant TRIGGER on public.buildings to anon;

grant TRUNCATE on public.buildings to anon;

grant UPDATE on public.buildings to anon;

grant DELETE on public.buildings to authenticated;

grant INSERT on public.buildings to authenticated;

grant REFERENCES on public.buildings to authenticated;

grant SELECT on public.buildings to authenticated;

grant TRIGGER on public.buildings to authenticated;

grant TRUNCATE on public.buildings to authenticated;

grant UPDATE on public.buildings to authenticated;

grant DELETE on public.buildings to service_role;

grant INSERT on public.buildings to service_role;

grant REFERENCES on public.buildings to service_role;

grant SELECT on public.buildings to service_role;

grant TRIGGER on public.buildings to service_role;

grant TRUNCATE on public.buildings to service_role;

grant UPDATE on public.buildings to service_role;

grant DELETE on public.calendar_events to anon;

grant INSERT on public.calendar_events to anon;

grant REFERENCES on public.calendar_events to anon;

grant SELECT on public.calendar_events to anon;

grant TRIGGER on public.calendar_events to anon;

grant TRUNCATE on public.calendar_events to anon;

grant UPDATE on public.calendar_events to anon;

grant DELETE on public.calendar_events to authenticated;

grant INSERT on public.calendar_events to authenticated;

grant REFERENCES on public.calendar_events to authenticated;

grant SELECT on public.calendar_events to authenticated;

grant TRIGGER on public.calendar_events to authenticated;

grant TRUNCATE on public.calendar_events to authenticated;

grant UPDATE on public.calendar_events to authenticated;

grant DELETE on public.calendar_events to service_role;

grant INSERT on public.calendar_events to service_role;

grant REFERENCES on public.calendar_events to service_role;

grant SELECT on public.calendar_events to service_role;

grant TRIGGER on public.calendar_events to service_role;

grant TRUNCATE on public.calendar_events to service_role;

grant UPDATE on public.calendar_events to service_role;

grant DELETE on public.card_assignments to anon;

grant INSERT on public.card_assignments to anon;

grant REFERENCES on public.card_assignments to anon;

grant SELECT on public.card_assignments to anon;

grant TRIGGER on public.card_assignments to anon;

grant TRUNCATE on public.card_assignments to anon;

grant UPDATE on public.card_assignments to anon;

grant DELETE on public.card_assignments to authenticated;

grant INSERT on public.card_assignments to authenticated;

grant REFERENCES on public.card_assignments to authenticated;

grant SELECT on public.card_assignments to authenticated;

grant TRIGGER on public.card_assignments to authenticated;

grant TRUNCATE on public.card_assignments to authenticated;

grant UPDATE on public.card_assignments to authenticated;

grant DELETE on public.card_assignments to service_role;

grant INSERT on public.card_assignments to service_role;

grant REFERENCES on public.card_assignments to service_role;

grant SELECT on public.card_assignments to service_role;

grant TRIGGER on public.card_assignments to service_role;

grant TRUNCATE on public.card_assignments to service_role;

grant UPDATE on public.card_assignments to service_role;

grant DELETE on public.card_boundaries to anon;

grant INSERT on public.card_boundaries to anon;

grant REFERENCES on public.card_boundaries to anon;

grant SELECT on public.card_boundaries to anon;

grant TRIGGER on public.card_boundaries to anon;

grant TRUNCATE on public.card_boundaries to anon;

grant UPDATE on public.card_boundaries to anon;

grant DELETE on public.card_boundaries to authenticated;

grant INSERT on public.card_boundaries to authenticated;

grant REFERENCES on public.card_boundaries to authenticated;

grant SELECT on public.card_boundaries to authenticated;

grant TRIGGER on public.card_boundaries to authenticated;

grant TRUNCATE on public.card_boundaries to authenticated;

grant UPDATE on public.card_boundaries to authenticated;

grant DELETE on public.card_boundaries to service_role;

grant INSERT on public.card_boundaries to service_role;

grant REFERENCES on public.card_boundaries to service_role;

grant SELECT on public.card_boundaries to service_role;

grant TRIGGER on public.card_boundaries to service_role;

grant TRUNCATE on public.card_boundaries to service_role;

grant UPDATE on public.card_boundaries to service_role;

grant DELETE on public.card_leader_assignments to anon;

grant INSERT on public.card_leader_assignments to anon;

grant REFERENCES on public.card_leader_assignments to anon;

grant SELECT on public.card_leader_assignments to anon;

grant TRIGGER on public.card_leader_assignments to anon;

grant TRUNCATE on public.card_leader_assignments to anon;

grant UPDATE on public.card_leader_assignments to anon;

grant DELETE on public.card_leader_assignments to authenticated;

grant INSERT on public.card_leader_assignments to authenticated;

grant REFERENCES on public.card_leader_assignments to authenticated;

grant SELECT on public.card_leader_assignments to authenticated;

grant TRIGGER on public.card_leader_assignments to authenticated;

grant TRUNCATE on public.card_leader_assignments to authenticated;

grant UPDATE on public.card_leader_assignments to authenticated;

grant DELETE on public.card_leader_assignments to service_role;

grant INSERT on public.card_leader_assignments to service_role;

grant REFERENCES on public.card_leader_assignments to service_role;

grant SELECT on public.card_leader_assignments to service_role;

grant TRIGGER on public.card_leader_assignments to service_role;

grant TRUNCATE on public.card_leader_assignments to service_role;

grant UPDATE on public.card_leader_assignments to service_role;

grant DELETE on public.cards to anon;

grant INSERT on public.cards to anon;

grant REFERENCES on public.cards to anon;

grant SELECT on public.cards to anon;

grant TRIGGER on public.cards to anon;

grant TRUNCATE on public.cards to anon;

grant UPDATE on public.cards to anon;

grant DELETE on public.cards to authenticated;

grant INSERT on public.cards to authenticated;

grant REFERENCES on public.cards to authenticated;

grant SELECT on public.cards to authenticated;

grant TRIGGER on public.cards to authenticated;

grant TRUNCATE on public.cards to authenticated;

grant UPDATE on public.cards to authenticated;

grant DELETE on public.cards to service_role;

grant INSERT on public.cards to service_role;

grant REFERENCES on public.cards to service_role;

grant SELECT on public.cards to service_role;

grant TRIGGER on public.cards to service_role;

grant TRUNCATE on public.cards to service_role;

grant UPDATE on public.cards to service_role;

grant REFERENCES on public.chat_message_signals to anon;

grant SELECT on public.chat_message_signals to anon;

grant TRIGGER on public.chat_message_signals to anon;

grant TRUNCATE on public.chat_message_signals to anon;

grant REFERENCES on public.chat_message_signals to authenticated;

grant SELECT on public.chat_message_signals to authenticated;

grant TRIGGER on public.chat_message_signals to authenticated;

grant TRUNCATE on public.chat_message_signals to authenticated;

grant DELETE on public.chat_message_signals to service_role;

grant INSERT on public.chat_message_signals to service_role;

grant REFERENCES on public.chat_message_signals to service_role;

grant SELECT on public.chat_message_signals to service_role;

grant TRIGGER on public.chat_message_signals to service_role;

grant TRUNCATE on public.chat_message_signals to service_role;

grant UPDATE on public.chat_message_signals to service_role;

grant DELETE on public.chat_messages to service_role;

grant INSERT on public.chat_messages to service_role;

grant REFERENCES on public.chat_messages to service_role;

grant SELECT on public.chat_messages to service_role;

grant TRIGGER on public.chat_messages to service_role;

grant TRUNCATE on public.chat_messages to service_role;

grant UPDATE on public.chat_messages to service_role;

grant DELETE on public.chat_read_status to service_role;

grant INSERT on public.chat_read_status to service_role;

grant REFERENCES on public.chat_read_status to service_role;

grant SELECT on public.chat_read_status to service_role;

grant TRIGGER on public.chat_read_status to service_role;

grant TRUNCATE on public.chat_read_status to service_role;

grant UPDATE on public.chat_read_status to service_role;

grant DELETE on public.chat_room_mutes to anon;

grant INSERT on public.chat_room_mutes to anon;

grant REFERENCES on public.chat_room_mutes to anon;

grant SELECT on public.chat_room_mutes to anon;

grant TRIGGER on public.chat_room_mutes to anon;

grant TRUNCATE on public.chat_room_mutes to anon;

grant UPDATE on public.chat_room_mutes to anon;

grant DELETE on public.chat_room_mutes to authenticated;

grant INSERT on public.chat_room_mutes to authenticated;

grant REFERENCES on public.chat_room_mutes to authenticated;

grant SELECT on public.chat_room_mutes to authenticated;

grant TRIGGER on public.chat_room_mutes to authenticated;

grant TRUNCATE on public.chat_room_mutes to authenticated;

grant UPDATE on public.chat_room_mutes to authenticated;

grant DELETE on public.chat_room_mutes to service_role;

grant INSERT on public.chat_room_mutes to service_role;

grant REFERENCES on public.chat_room_mutes to service_role;

grant SELECT on public.chat_room_mutes to service_role;

grant TRIGGER on public.chat_room_mutes to service_role;

grant TRUNCATE on public.chat_room_mutes to service_role;

grant UPDATE on public.chat_room_mutes to service_role;

grant DELETE on public.comments to anon;

grant INSERT on public.comments to anon;

grant REFERENCES on public.comments to anon;

grant SELECT on public.comments to anon;

grant TRIGGER on public.comments to anon;

grant TRUNCATE on public.comments to anon;

grant UPDATE on public.comments to anon;

grant DELETE on public.comments to authenticated;

grant INSERT on public.comments to authenticated;

grant REFERENCES on public.comments to authenticated;

grant SELECT on public.comments to authenticated;

grant TRIGGER on public.comments to authenticated;

grant TRUNCATE on public.comments to authenticated;

grant UPDATE on public.comments to authenticated;

grant DELETE on public.comments to service_role;

grant INSERT on public.comments to service_role;

grant REFERENCES on public.comments to service_role;

grant SELECT on public.comments to service_role;

grant TRIGGER on public.comments to service_role;

grant TRUNCATE on public.comments to service_role;

grant UPDATE on public.comments to service_role;

grant DELETE on public.event_card_assignment_cards to anon;

grant INSERT on public.event_card_assignment_cards to anon;

grant REFERENCES on public.event_card_assignment_cards to anon;

grant SELECT on public.event_card_assignment_cards to anon;

grant TRIGGER on public.event_card_assignment_cards to anon;

grant TRUNCATE on public.event_card_assignment_cards to anon;

grant UPDATE on public.event_card_assignment_cards to anon;

grant DELETE on public.event_card_assignment_cards to authenticated;

grant INSERT on public.event_card_assignment_cards to authenticated;

grant REFERENCES on public.event_card_assignment_cards to authenticated;

grant SELECT on public.event_card_assignment_cards to authenticated;

grant TRIGGER on public.event_card_assignment_cards to authenticated;

grant TRUNCATE on public.event_card_assignment_cards to authenticated;

grant UPDATE on public.event_card_assignment_cards to authenticated;

grant DELETE on public.event_card_assignment_cards to service_role;

grant INSERT on public.event_card_assignment_cards to service_role;

grant REFERENCES on public.event_card_assignment_cards to service_role;

grant SELECT on public.event_card_assignment_cards to service_role;

grant TRIGGER on public.event_card_assignment_cards to service_role;

grant TRUNCATE on public.event_card_assignment_cards to service_role;

grant UPDATE on public.event_card_assignment_cards to service_role;

grant DELETE on public.event_card_assignments to anon;

grant INSERT on public.event_card_assignments to anon;

grant REFERENCES on public.event_card_assignments to anon;

grant SELECT on public.event_card_assignments to anon;

grant TRIGGER on public.event_card_assignments to anon;

grant TRUNCATE on public.event_card_assignments to anon;

grant UPDATE on public.event_card_assignments to anon;

grant DELETE on public.event_card_assignments to authenticated;

grant INSERT on public.event_card_assignments to authenticated;

grant REFERENCES on public.event_card_assignments to authenticated;

grant SELECT on public.event_card_assignments to authenticated;

grant TRIGGER on public.event_card_assignments to authenticated;

grant TRUNCATE on public.event_card_assignments to authenticated;

grant UPDATE on public.event_card_assignments to authenticated;

grant DELETE on public.event_card_assignments to service_role;

grant INSERT on public.event_card_assignments to service_role;

grant REFERENCES on public.event_card_assignments to service_role;

grant SELECT on public.event_card_assignments to service_role;

grant TRIGGER on public.event_card_assignments to service_role;

grant TRUNCATE on public.event_card_assignments to service_role;

grant UPDATE on public.event_card_assignments to service_role;

grant DELETE on public.event_informal_assignments to anon;

grant INSERT on public.event_informal_assignments to anon;

grant REFERENCES on public.event_informal_assignments to anon;

grant SELECT on public.event_informal_assignments to anon;

grant TRIGGER on public.event_informal_assignments to anon;

grant TRUNCATE on public.event_informal_assignments to anon;

grant UPDATE on public.event_informal_assignments to anon;

grant DELETE on public.event_informal_assignments to authenticated;

grant INSERT on public.event_informal_assignments to authenticated;

grant REFERENCES on public.event_informal_assignments to authenticated;

grant SELECT on public.event_informal_assignments to authenticated;

grant TRIGGER on public.event_informal_assignments to authenticated;

grant TRUNCATE on public.event_informal_assignments to authenticated;

grant UPDATE on public.event_informal_assignments to authenticated;

grant DELETE on public.event_informal_assignments to service_role;

grant INSERT on public.event_informal_assignments to service_role;

grant REFERENCES on public.event_informal_assignments to service_role;

grant SELECT on public.event_informal_assignments to service_role;

grant TRIGGER on public.event_informal_assignments to service_role;

grant TRUNCATE on public.event_informal_assignments to service_role;

grant UPDATE on public.event_informal_assignments to service_role;

grant DELETE on public.event_participants to anon;

grant INSERT on public.event_participants to anon;

grant REFERENCES on public.event_participants to anon;

grant SELECT on public.event_participants to anon;

grant TRIGGER on public.event_participants to anon;

grant TRUNCATE on public.event_participants to anon;

grant UPDATE on public.event_participants to anon;

grant DELETE on public.event_participants to authenticated;

grant INSERT on public.event_participants to authenticated;

grant REFERENCES on public.event_participants to authenticated;

grant SELECT on public.event_participants to authenticated;

grant TRIGGER on public.event_participants to authenticated;

grant TRUNCATE on public.event_participants to authenticated;

grant UPDATE on public.event_participants to authenticated;

grant DELETE on public.event_participants to service_role;

grant INSERT on public.event_participants to service_role;

grant REFERENCES on public.event_participants to service_role;

grant SELECT on public.event_participants to service_role;

grant TRIGGER on public.event_participants to service_role;

grant TRUNCATE on public.event_participants to service_role;

grant UPDATE on public.event_participants to service_role;

grant DELETE on public.event_restaurant_assignments to anon;

grant INSERT on public.event_restaurant_assignments to anon;

grant REFERENCES on public.event_restaurant_assignments to anon;

grant SELECT on public.event_restaurant_assignments to anon;

grant TRIGGER on public.event_restaurant_assignments to anon;

grant TRUNCATE on public.event_restaurant_assignments to anon;

grant UPDATE on public.event_restaurant_assignments to anon;

grant DELETE on public.event_restaurant_assignments to authenticated;

grant INSERT on public.event_restaurant_assignments to authenticated;

grant REFERENCES on public.event_restaurant_assignments to authenticated;

grant SELECT on public.event_restaurant_assignments to authenticated;

grant TRIGGER on public.event_restaurant_assignments to authenticated;

grant TRUNCATE on public.event_restaurant_assignments to authenticated;

grant UPDATE on public.event_restaurant_assignments to authenticated;

grant DELETE on public.event_restaurant_assignments to service_role;

grant INSERT on public.event_restaurant_assignments to service_role;

grant REFERENCES on public.event_restaurant_assignments to service_role;

grant SELECT on public.event_restaurant_assignments to service_role;

grant TRIGGER on public.event_restaurant_assignments to service_role;

grant TRUNCATE on public.event_restaurant_assignments to service_role;

grant UPDATE on public.event_restaurant_assignments to service_role;

grant DELETE on public.informal_assets to anon;

grant INSERT on public.informal_assets to anon;

grant REFERENCES on public.informal_assets to anon;

grant SELECT on public.informal_assets to anon;

grant TRIGGER on public.informal_assets to anon;

grant TRUNCATE on public.informal_assets to anon;

grant UPDATE on public.informal_assets to anon;

grant DELETE on public.informal_assets to authenticated;

grant INSERT on public.informal_assets to authenticated;

grant REFERENCES on public.informal_assets to authenticated;

grant SELECT on public.informal_assets to authenticated;

grant TRIGGER on public.informal_assets to authenticated;

grant TRUNCATE on public.informal_assets to authenticated;

grant UPDATE on public.informal_assets to authenticated;

grant DELETE on public.informal_assets to service_role;

grant INSERT on public.informal_assets to service_role;

grant REFERENCES on public.informal_assets to service_role;

grant SELECT on public.informal_assets to service_role;

grant TRIGGER on public.informal_assets to service_role;

grant TRUNCATE on public.informal_assets to service_role;

grant UPDATE on public.informal_assets to service_role;

grant DELETE on public.informal_groups to anon;

grant INSERT on public.informal_groups to anon;

grant REFERENCES on public.informal_groups to anon;

grant SELECT on public.informal_groups to anon;

grant TRIGGER on public.informal_groups to anon;

grant TRUNCATE on public.informal_groups to anon;

grant UPDATE on public.informal_groups to anon;

grant DELETE on public.informal_groups to authenticated;

grant INSERT on public.informal_groups to authenticated;

grant REFERENCES on public.informal_groups to authenticated;

grant SELECT on public.informal_groups to authenticated;

grant TRIGGER on public.informal_groups to authenticated;

grant TRUNCATE on public.informal_groups to authenticated;

grant UPDATE on public.informal_groups to authenticated;

grant DELETE on public.informal_groups to service_role;

grant INSERT on public.informal_groups to service_role;

grant REFERENCES on public.informal_groups to service_role;

grant SELECT on public.informal_groups to service_role;

grant TRIGGER on public.informal_groups to service_role;

grant TRUNCATE on public.informal_groups to service_role;

grant UPDATE on public.informal_groups to service_role;

grant DELETE on public.login_logs to anon;

grant INSERT on public.login_logs to anon;

grant REFERENCES on public.login_logs to anon;

grant TRIGGER on public.login_logs to anon;

grant TRUNCATE on public.login_logs to anon;

grant UPDATE on public.login_logs to anon;

grant DELETE on public.login_logs to authenticated;

grant INSERT on public.login_logs to authenticated;

grant REFERENCES on public.login_logs to authenticated;

grant TRIGGER on public.login_logs to authenticated;

grant TRUNCATE on public.login_logs to authenticated;

grant UPDATE on public.login_logs to authenticated;

grant DELETE on public.login_logs to service_role;

grant INSERT on public.login_logs to service_role;

grant REFERENCES on public.login_logs to service_role;

grant SELECT on public.login_logs to service_role;

grant TRIGGER on public.login_logs to service_role;

grant TRUNCATE on public.login_logs to service_role;

grant UPDATE on public.login_logs to service_role;

grant DELETE on public.notices to anon;

grant INSERT on public.notices to anon;

grant REFERENCES on public.notices to anon;

grant SELECT on public.notices to anon;

grant TRIGGER on public.notices to anon;

grant TRUNCATE on public.notices to anon;

grant UPDATE on public.notices to anon;

grant DELETE on public.notices to authenticated;

grant INSERT on public.notices to authenticated;

grant REFERENCES on public.notices to authenticated;

grant SELECT on public.notices to authenticated;

grant TRIGGER on public.notices to authenticated;

grant TRUNCATE on public.notices to authenticated;

grant UPDATE on public.notices to authenticated;

grant DELETE on public.notices to service_role;

grant INSERT on public.notices to service_role;

grant REFERENCES on public.notices to service_role;

grant SELECT on public.notices to service_role;

grant TRIGGER on public.notices to service_role;

grant TRUNCATE on public.notices to service_role;

grant UPDATE on public.notices to service_role;

grant DELETE on public.notification_preferences to service_role;

grant INSERT on public.notification_preferences to service_role;

grant REFERENCES on public.notification_preferences to service_role;

grant SELECT on public.notification_preferences to service_role;

grant TRIGGER on public.notification_preferences to service_role;

grant TRUNCATE on public.notification_preferences to service_role;

grant UPDATE on public.notification_preferences to service_role;

grant DELETE on public.notifications to service_role;

grant INSERT on public.notifications to service_role;

grant REFERENCES on public.notifications to service_role;

grant SELECT on public.notifications to service_role;

grant TRIGGER on public.notifications to service_role;

grant TRUNCATE on public.notifications to service_role;

grant UPDATE on public.notifications to service_role;

grant DELETE on public.phone_surveys to anon;

grant INSERT on public.phone_surveys to anon;

grant REFERENCES on public.phone_surveys to anon;

grant SELECT on public.phone_surveys to anon;

grant TRIGGER on public.phone_surveys to anon;

grant TRUNCATE on public.phone_surveys to anon;

grant UPDATE on public.phone_surveys to anon;

grant DELETE on public.phone_surveys to authenticated;

grant INSERT on public.phone_surveys to authenticated;

grant REFERENCES on public.phone_surveys to authenticated;

grant SELECT on public.phone_surveys to authenticated;

grant TRIGGER on public.phone_surveys to authenticated;

grant TRUNCATE on public.phone_surveys to authenticated;

grant UPDATE on public.phone_surveys to authenticated;

grant DELETE on public.phone_surveys to service_role;

grant INSERT on public.phone_surveys to service_role;

grant REFERENCES on public.phone_surveys to service_role;

grant SELECT on public.phone_surveys to service_role;

grant TRIGGER on public.phone_surveys to service_role;

grant TRUNCATE on public.phone_surveys to service_role;

grant UPDATE on public.phone_surveys to service_role;

grant DELETE on public.push_subscriptions to service_role;

grant INSERT on public.push_subscriptions to service_role;

grant REFERENCES on public.push_subscriptions to service_role;

grant SELECT on public.push_subscriptions to service_role;

grant TRIGGER on public.push_subscriptions to service_role;

grant TRUNCATE on public.push_subscriptions to service_role;

grant UPDATE on public.push_subscriptions to service_role;

grant DELETE on public.regular_visits to anon;

grant INSERT on public.regular_visits to anon;

grant REFERENCES on public.regular_visits to anon;

grant SELECT on public.regular_visits to anon;

grant TRIGGER on public.regular_visits to anon;

grant TRUNCATE on public.regular_visits to anon;

grant UPDATE on public.regular_visits to anon;

grant DELETE on public.regular_visits to authenticated;

grant INSERT on public.regular_visits to authenticated;

grant REFERENCES on public.regular_visits to authenticated;

grant SELECT on public.regular_visits to authenticated;

grant TRIGGER on public.regular_visits to authenticated;

grant TRUNCATE on public.regular_visits to authenticated;

grant UPDATE on public.regular_visits to authenticated;

grant DELETE on public.regular_visits to service_role;

grant INSERT on public.regular_visits to service_role;

grant REFERENCES on public.regular_visits to service_role;

grant SELECT on public.regular_visits to service_role;

grant TRIGGER on public.regular_visits to service_role;

grant TRUNCATE on public.regular_visits to service_role;

grant UPDATE on public.regular_visits to service_role;

grant DELETE on public.restaurant_requests to anon;

grant INSERT on public.restaurant_requests to anon;

grant REFERENCES on public.restaurant_requests to anon;

grant SELECT on public.restaurant_requests to anon;

grant TRIGGER on public.restaurant_requests to anon;

grant TRUNCATE on public.restaurant_requests to anon;

grant UPDATE on public.restaurant_requests to anon;

grant DELETE on public.restaurant_requests to authenticated;

grant INSERT on public.restaurant_requests to authenticated;

grant REFERENCES on public.restaurant_requests to authenticated;

grant SELECT on public.restaurant_requests to authenticated;

grant TRIGGER on public.restaurant_requests to authenticated;

grant TRUNCATE on public.restaurant_requests to authenticated;

grant UPDATE on public.restaurant_requests to authenticated;

grant DELETE on public.restaurant_requests to service_role;

grant INSERT on public.restaurant_requests to service_role;

grant REFERENCES on public.restaurant_requests to service_role;

grant SELECT on public.restaurant_requests to service_role;

grant TRIGGER on public.restaurant_requests to service_role;

grant TRUNCATE on public.restaurant_requests to service_role;

grant UPDATE on public.restaurant_requests to service_role;

grant DELETE on public.return_visit_logs to anon;

grant INSERT on public.return_visit_logs to anon;

grant REFERENCES on public.return_visit_logs to anon;

grant SELECT on public.return_visit_logs to anon;

grant TRIGGER on public.return_visit_logs to anon;

grant TRUNCATE on public.return_visit_logs to anon;

grant UPDATE on public.return_visit_logs to anon;

grant DELETE on public.return_visit_logs to authenticated;

grant INSERT on public.return_visit_logs to authenticated;

grant REFERENCES on public.return_visit_logs to authenticated;

grant SELECT on public.return_visit_logs to authenticated;

grant TRIGGER on public.return_visit_logs to authenticated;

grant TRUNCATE on public.return_visit_logs to authenticated;

grant UPDATE on public.return_visit_logs to authenticated;

grant DELETE on public.return_visit_logs to service_role;

grant INSERT on public.return_visit_logs to service_role;

grant REFERENCES on public.return_visit_logs to service_role;

grant SELECT on public.return_visit_logs to service_role;

grant TRIGGER on public.return_visit_logs to service_role;

grant TRUNCATE on public.return_visit_logs to service_role;

grant UPDATE on public.return_visit_logs to service_role;

grant DELETE on public.return_visits to anon;

grant INSERT on public.return_visits to anon;

grant REFERENCES on public.return_visits to anon;

grant SELECT on public.return_visits to anon;

grant TRIGGER on public.return_visits to anon;

grant TRUNCATE on public.return_visits to anon;

grant UPDATE on public.return_visits to anon;

grant DELETE on public.return_visits to authenticated;

grant INSERT on public.return_visits to authenticated;

grant REFERENCES on public.return_visits to authenticated;

grant SELECT on public.return_visits to authenticated;

grant TRIGGER on public.return_visits to authenticated;

grant TRUNCATE on public.return_visits to authenticated;

grant UPDATE on public.return_visits to authenticated;

grant DELETE on public.return_visits to service_role;

grant INSERT on public.return_visits to service_role;

grant REFERENCES on public.return_visits to service_role;

grant SELECT on public.return_visits to service_role;

grant TRIGGER on public.return_visits to service_role;

grant TRUNCATE on public.return_visits to service_role;

grant UPDATE on public.return_visits to service_role;

grant DELETE on public.review_tasks to anon;

grant INSERT on public.review_tasks to anon;

grant REFERENCES on public.review_tasks to anon;

grant SELECT on public.review_tasks to anon;

grant TRIGGER on public.review_tasks to anon;

grant TRUNCATE on public.review_tasks to anon;

grant UPDATE on public.review_tasks to anon;

grant DELETE on public.review_tasks to authenticated;

grant INSERT on public.review_tasks to authenticated;

grant REFERENCES on public.review_tasks to authenticated;

grant SELECT on public.review_tasks to authenticated;

grant TRIGGER on public.review_tasks to authenticated;

grant TRUNCATE on public.review_tasks to authenticated;

grant UPDATE on public.review_tasks to authenticated;

grant DELETE on public.review_tasks to service_role;

grant INSERT on public.review_tasks to service_role;

grant REFERENCES on public.review_tasks to service_role;

grant SELECT on public.review_tasks to service_role;

grant TRIGGER on public.review_tasks to service_role;

grant TRUNCATE on public.review_tasks to service_role;

grant UPDATE on public.review_tasks to service_role;

grant DELETE on public.service_logs to service_role;

grant INSERT on public.service_logs to service_role;

grant REFERENCES on public.service_logs to service_role;

grant SELECT on public.service_logs to service_role;

grant TRIGGER on public.service_logs to service_role;

grant TRUNCATE on public.service_logs to service_role;

grant UPDATE on public.service_logs to service_role;

grant DELETE on public.service_sessions to anon;

grant INSERT on public.service_sessions to anon;

grant REFERENCES on public.service_sessions to anon;

grant SELECT on public.service_sessions to anon;

grant TRIGGER on public.service_sessions to anon;

grant TRUNCATE on public.service_sessions to anon;

grant UPDATE on public.service_sessions to anon;

grant DELETE on public.service_sessions to authenticated;

grant INSERT on public.service_sessions to authenticated;

grant REFERENCES on public.service_sessions to authenticated;

grant SELECT on public.service_sessions to authenticated;

grant TRIGGER on public.service_sessions to authenticated;

grant TRUNCATE on public.service_sessions to authenticated;

grant UPDATE on public.service_sessions to authenticated;

grant DELETE on public.service_sessions to service_role;

grant INSERT on public.service_sessions to service_role;

grant REFERENCES on public.service_sessions to service_role;

grant SELECT on public.service_sessions to service_role;

grant TRIGGER on public.service_sessions to service_role;

grant TRUNCATE on public.service_sessions to service_role;

grant UPDATE on public.service_sessions to service_role;

grant DELETE on public.service_suggestions to anon;

grant INSERT on public.service_suggestions to anon;

grant REFERENCES on public.service_suggestions to anon;

grant SELECT on public.service_suggestions to anon;

grant TRIGGER on public.service_suggestions to anon;

grant TRUNCATE on public.service_suggestions to anon;

grant UPDATE on public.service_suggestions to anon;

grant DELETE on public.service_suggestions to authenticated;

grant INSERT on public.service_suggestions to authenticated;

grant REFERENCES on public.service_suggestions to authenticated;

grant SELECT on public.service_suggestions to authenticated;

grant TRIGGER on public.service_suggestions to authenticated;

grant TRUNCATE on public.service_suggestions to authenticated;

grant UPDATE on public.service_suggestions to authenticated;

grant DELETE on public.service_suggestions to service_role;

grant INSERT on public.service_suggestions to service_role;

grant REFERENCES on public.service_suggestions to service_role;

grant SELECT on public.service_suggestions to service_role;

grant TRIGGER on public.service_suggestions to service_role;

grant TRUNCATE on public.service_suggestions to service_role;

grant UPDATE on public.service_suggestions to service_role;

grant DELETE on public.special_periods to anon;

grant INSERT on public.special_periods to anon;

grant REFERENCES on public.special_periods to anon;

grant SELECT on public.special_periods to anon;

grant TRIGGER on public.special_periods to anon;

grant TRUNCATE on public.special_periods to anon;

grant UPDATE on public.special_periods to anon;

grant DELETE on public.special_periods to authenticated;

grant INSERT on public.special_periods to authenticated;

grant REFERENCES on public.special_periods to authenticated;

grant SELECT on public.special_periods to authenticated;

grant TRIGGER on public.special_periods to authenticated;

grant TRUNCATE on public.special_periods to authenticated;

grant UPDATE on public.special_periods to authenticated;

grant DELETE on public.special_periods to service_role;

grant INSERT on public.special_periods to service_role;

grant REFERENCES on public.special_periods to service_role;

grant SELECT on public.special_periods to service_role;

grant TRIGGER on public.special_periods to service_role;

grant TRUNCATE on public.special_periods to service_role;

grant UPDATE on public.special_periods to service_role;

grant DELETE on public.territory_regions to anon;

grant INSERT on public.territory_regions to anon;

grant REFERENCES on public.territory_regions to anon;

grant SELECT on public.territory_regions to anon;

grant TRIGGER on public.territory_regions to anon;

grant TRUNCATE on public.territory_regions to anon;

grant UPDATE on public.territory_regions to anon;

grant DELETE on public.territory_regions to authenticated;

grant INSERT on public.territory_regions to authenticated;

grant REFERENCES on public.territory_regions to authenticated;

grant SELECT on public.territory_regions to authenticated;

grant TRIGGER on public.territory_regions to authenticated;

grant TRUNCATE on public.territory_regions to authenticated;

grant UPDATE on public.territory_regions to authenticated;

grant DELETE on public.territory_regions to service_role;

grant INSERT on public.territory_regions to service_role;

grant REFERENCES on public.territory_regions to service_role;

grant SELECT on public.territory_regions to service_role;

grant TRIGGER on public.territory_regions to service_role;

grant TRUNCATE on public.territory_regions to service_role;

grant UPDATE on public.territory_regions to service_role;

grant DELETE on public.units to anon;

grant INSERT on public.units to anon;

grant REFERENCES on public.units to anon;

grant SELECT on public.units to anon;

grant TRIGGER on public.units to anon;

grant TRUNCATE on public.units to anon;

grant UPDATE on public.units to anon;

grant DELETE on public.units to authenticated;

grant INSERT on public.units to authenticated;

grant REFERENCES on public.units to authenticated;

grant SELECT on public.units to authenticated;

grant TRIGGER on public.units to authenticated;

grant TRUNCATE on public.units to authenticated;

grant UPDATE on public.units to authenticated;

grant DELETE on public.units to service_role;

grant INSERT on public.units to service_role;

grant REFERENCES on public.units to service_role;

grant SELECT on public.units to service_role;

grant TRIGGER on public.units to service_role;

grant TRUNCATE on public.units to service_role;

grant UPDATE on public.units to service_role;

grant DELETE on public.user_notification_prefs to service_role;

grant INSERT on public.user_notification_prefs to service_role;

grant REFERENCES on public.user_notification_prefs to service_role;

grant SELECT on public.user_notification_prefs to service_role;

grant TRIGGER on public.user_notification_prefs to service_role;

grant TRUNCATE on public.user_notification_prefs to service_role;

grant UPDATE on public.user_notification_prefs to service_role;

grant DELETE on public.visit_histories to anon;

grant INSERT on public.visit_histories to anon;

grant REFERENCES on public.visit_histories to anon;

grant SELECT on public.visit_histories to anon;

grant TRIGGER on public.visit_histories to anon;

grant TRUNCATE on public.visit_histories to anon;

grant UPDATE on public.visit_histories to anon;

grant DELETE on public.visit_histories to authenticated;

grant INSERT on public.visit_histories to authenticated;

grant REFERENCES on public.visit_histories to authenticated;

grant SELECT on public.visit_histories to authenticated;

grant TRIGGER on public.visit_histories to authenticated;

grant TRUNCATE on public.visit_histories to authenticated;

grant UPDATE on public.visit_histories to authenticated;

grant DELETE on public.visit_histories to service_role;

grant INSERT on public.visit_histories to service_role;

grant REFERENCES on public.visit_histories to service_role;

grant SELECT on public.visit_histories to service_role;

grant TRIGGER on public.visit_histories to service_role;

grant TRUNCATE on public.visit_histories to service_role;

grant UPDATE on public.visit_histories to service_role;

grant SELECT (approval_status) on public.app_users to anon;

grant SELECT (approval_status) on public.app_users to authenticated;

grant SELECT (created_at) on public.app_users to anon;

grant SELECT (created_at) on public.app_users to authenticated;

grant SELECT (group_name) on public.app_users to anon;

grant SELECT (group_name) on public.app_users to authenticated;

grant SELECT (id) on public.app_users to anon;

grant SELECT (id) on public.app_users to authenticated;

grant SELECT (is_active) on public.app_users to anon;

grant SELECT (is_active) on public.app_users to authenticated;

grant SELECT (last_login_at) on public.app_users to anon;

grant SELECT (last_login_at) on public.app_users to authenticated;

grant SELECT (login_id) on public.app_users to anon;

grant SELECT (login_id) on public.app_users to authenticated;

grant SELECT (name) on public.app_users to anon;

grant SELECT (name) on public.app_users to authenticated;

grant SELECT (phone) on public.app_users to anon;

grant SELECT (phone) on public.app_users to authenticated;

grant SELECT (role) on public.app_users to anon;

grant SELECT (role) on public.app_users to authenticated;

alter publication supabase_realtime add table public.calendar_events;

alter publication supabase_realtime add table public.chat_message_signals;

alter publication supabase_realtime add table public.chat_messages;

alter publication supabase_realtime add table public.chat_read_status;

alter publication supabase_realtime add table public.event_card_assignment_cards;

alter publication supabase_realtime add table public.event_card_assignments;

alter publication supabase_realtime add table public.event_informal_assignments;

alter publication supabase_realtime add table public.event_participants;

alter publication supabase_realtime add table public.event_restaurant_assignments;

alter publication supabase_realtime add table public.informal_assets;

alter publication supabase_realtime add table public.informal_groups;

alter publication supabase_realtime add table public.notifications;

alter table public.calendar_events replica identity full;

alter table public.chat_message_signals replica identity full;

alter table public.chat_messages replica identity full;

alter table public.chat_read_status replica identity full;

alter table public.event_card_assignment_cards replica identity full;

alter table public.event_card_assignments replica identity full;

alter table public.event_informal_assignments replica identity full;

alter table public.event_participants replica identity full;

alter table public.event_restaurant_assignments replica identity full;

alter table public.informal_assets replica identity full;

alter table public.informal_groups replica identity full;

alter table public.notifications replica identity full;

-- ── 임시 보정 (v5 로 다시 뽑으면 이 칸은 없어진다) ──────────────
-- 새 Supabase 프로젝트가 테이블을 만들 때 RLS 를 켜 두는데, 운영에서는
-- 이 둘이 꺼져 있다. 정책이 없는 채로 켜져 있으면 **에러 없이 빈 결과**가 온다.
-- special_periods 는 화면이 직접 읽으므로 특별봉사 시즌이 조용히 사라진다.
alter table public.special_periods disable row level security;
alter table public.login_logs disable row level security;
