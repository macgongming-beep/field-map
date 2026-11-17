import { readFileSync } from 'node:fs'

const read = name => readFileSync(`supabase/migrations/${name}`,'utf8')
function fn(file,name) {
  const sql=read(file)
  const start=sql.indexOf(`create or replace function ${name}(`)
  if(start<0)throw new Error(name)
  const end=sql.indexOf('$$;',sql.indexOf('as $$',start))+3
  if(end<start)throw new Error(name)
  return sql.slice(start,end)
}

// Synthetic schema only. Core bulk/scope/team/removal and schedule wrappers are
// loaded from real migrations; external notification delivery is a local sink.
export function rolloutFixture(cart) {
  return `create role anon;create role authenticated;create schema private;create publication supabase_realtime;
  create table app_users(id int primary key,name text unique,role text,group_name text,is_active boolean default true,approval_status text default 'approved');
  create table auth_sessions(token uuid primary key,user_id int,expires_at timestamptz);
  create table calendar_events(id serial primary key,event_date date default '2099-11-18',time text default '14:30',end_time text default '16:30',title text default 'Test',place text default '',leader_name text,memo text,has_meeting boolean,allow_applications boolean default true,meeting_map_url text,series_id uuid,assignment_status text,assignment_shared_at timestamptz,assignment_shared_by text);
  ${cart?'alter table calendar_events add allow_cart_applications boolean default false,add cart_capacity int;create table event_cart_applications(event_id int references calendar_events on delete cascade,user_id int);':''}
  create table cards(id bigint primary key);create table buildings(id bigint primary key,card_id bigint,type text);create table units(id bigint primary key,building_id bigint references buildings on delete cascade,number text,is_restaurant boolean,usage_type text);
  create table informal_assets(id int primary key,archived boolean default false,parent_id int);
  create table event_participants(id serial primary key,event_id int references calendar_events on delete cascade,user_name text,role text default '신청',unique(event_id,user_name));
  ${['event_card_assignments','event_card_assignment_cards','event_informal_assignments','event_restaurant_assignments'].map(t=>`create table ${t}(id serial primary key,event_id int references calendar_events on delete cascade,user_name text,team_key text,assigned_by text);alter table ${t} enable row level security;`).join('')}
  alter table event_card_assignments add assigned_card_id bigint references cards on delete cascade;
  alter table event_card_assignment_cards add card_id bigint references cards on delete cascade;
  alter table event_informal_assignments add asset_id int references informal_assets on delete cascade;
  alter table event_restaurant_assignments add building_id bigint references buildings on delete cascade,add unit_id bigint references units on delete cascade;
  create table service_sessions(id serial primary key,calendar_event_id int,user_name text,source text,status text,ended_at timestamptz);
  create table comments(id bigserial primary key,target_type text,target_id int,author_id int,author_name text,content text,mention_ids int[],mention_names text[],created_at timestamptz default now(),deleted_at timestamptz);
  create table test_notices(recipient int,kind text,link text);
  create table notifications(id bigserial primary key,user_id int,type text not null,title text,body text,link text,related_id int,is_read boolean default false,created_at timestamptz default now());
  create function public.verify_session(t uuid) returns int language sql stable as $$select u.id from public.app_users u join public.auth_sessions s on s.user_id=u.id where s.token=t and s.expires_at>now() and u.is_active and u.approval_status='approved'$$;
  create function private.request_session_user_id() returns int language sql stable security definer as $$select public.verify_session(nullif(current_setting('test.token',true),'')::uuid)$$;
  create function private.request_is_admin() returns boolean language sql stable security definer as $$select role in ('admin','developer') from public.app_users where id=private.request_session_user_id()$$;
  create function private.request_session_user_name() returns text language sql stable security definer as $$select name from public.app_users where id=private.request_session_user_id()$$;
  ${fn('20260907_1100_finalize_calendar_assignment_policies.sql','private.user_can_manage_event')}
  create function public.session_can_manage_event(eid integer) returns boolean language sql stable security definer as $$select private.user_can_manage_event(private.request_session_user_id(),eid)$$;
  ${['event_card_assignments','event_card_assignment_cards','event_informal_assignments','event_restaurant_assignments'].map(t=>`create policy read_rows on ${t} for select using(true);create policy write_rows on ${t} for all using(public.session_can_manage_event(event_id)) with check(public.session_can_manage_event(event_id));grant all on ${t} to anon,authenticated;`).join('')}
  alter table event_participants enable row level security;
  create policy read_rows on event_participants for select using(true);
  create policy write_rows on event_participants for all using(public.session_can_manage_event(event_id) or user_name=private.request_session_user_name()) with check(public.session_can_manage_event(event_id) or user_name=private.request_session_user_name());
  alter table service_sessions enable row level security;
  create policy read_rows on service_sessions for select using(true);
  create policy write_rows on service_sessions for all using(public.session_can_manage_event(calendar_event_id) or user_name=private.request_session_user_name()) with check(public.session_can_manage_event(calendar_event_id) or user_name=private.request_session_user_name());
  grant select on calendar_events,app_users to anon,authenticated;grant all on event_participants,service_sessions to anon,authenticated;grant usage,select on all sequences in schema public to anon,authenticated;grant usage on schema private to anon,authenticated;
  ${read('20260909_1000_guard_event_participant_identity.sql').split('-- 가입할')[0]}
  ${fn('20260826_1400_team_without_card.sql','public.assign_cards_bulk_tx').replace('public.assign_cards_bulk_tx(', 'public.assign_cards_bulk_tx_impl_20260907(')}
  revoke all on function public.assign_cards_bulk_tx_impl_20260907(uuid,integer,jsonb,text,text) from public,anon,authenticated;
  ${fn('20260907_1100_finalize_calendar_assignment_policies.sql','public.assign_cards_bulk_tx')}
  ${read('20260930_1000_team_card_scope.sql')}
  ${read('20260930_1200_team_informal_assignments.sql')}
  ${read('20260930_1600_atomic_team_participant_removal.sql')}
  create function public.update_calendar_event_tx_impl_20260907(uuid,integer,jsonb,boolean) returns jsonb language sql as $$select '{"ok":true}'::jsonb$$;
  ${fn('20260907_1100_finalize_calendar_assignment_policies.sql','public.update_calendar_event_tx')}
  ${fn('20260827_1000_series_update_tx.sql','public.update_calendar_event_series_tx').replace('public.update_calendar_event_series_tx(', 'public.update_calendar_event_series_tx_impl_20260907(')}
  create function public.notify_on_calendar_event_change() returns trigger language plpgsql as $$begin return new;end$$;
  create trigger on_calendar_event_update after update on calendar_events for each row execute function notify_on_calendar_event_change();
  create function public.filter_notification_recipients(ids int[],kind text) returns int[] language sql as $$select ids$$;
  create function public.insert_notifications(ids int[],kind text,t text,b text,l text,e int) returns void language sql as $$insert into public.test_notices select unnest(ids),kind,l$$;
  create function public.dispatch_push_notification(int[],text,text,text,text,int) returns void language sql as $$select$$;
  create function public.get_comment_target_author_id(text,int) returns int language sql as $$select null::int$$;
  ${read('20260826_2500_comment_notify_participants.sql')}
  create trigger on_comment_insert after insert on comments for each row execute function notify_on_comment();
  create function public.rename_user_name_references(p_token uuid,p_old text,p_new text) returns jsonb language plpgsql security definer as $$begin
    if public.verify_session(p_token) is distinct from 1 then raise exception 'permission';end if;
    update public.event_participants set user_name=p_new where user_name=p_old;
    update public.event_card_assignments set user_name=p_new where user_name=p_old;return '{"ok":true}';end$$;
  create function public.purge_user_name_references(p_token uuid,p_name text) returns jsonb language plpgsql security definer as $$begin
    if public.verify_session(p_token) is distinct from 1 then raise exception 'permission';end if;
    delete from public.event_participants where user_name=p_name;return '{"ok":true}';end$$;
  create function public.merge_duplicate_buildings_tx(p_token uuid,p_scope_card_id integer default null,p_name_overrides jsonb default '{}',p_selected_primary_ids integer[] default null) returns jsonb language plpgsql security definer as $$begin
    if public.verify_session(p_token) is distinct from 1 then raise exception 'permission';end if;
    update public.event_restaurant_assignments set building_id=20 where building_id=21;delete from public.buildings where id=21;return '{"ok":true}';end$$;
  `
}
