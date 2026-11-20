import { readFileSync } from 'node:fs'

export function groupTerritoryRestoreFixture() {
  const migration = name => readFileSync(`supabase/migrations/${name}`, 'utf8')
  return `create role anon;create role authenticated;create schema private;
    create table app_settings(key text primary key,value text);
    create table service_groups(code text primary key,label_ko text not null,label_zh text not null,legacy_name text unique not null);
    insert into service_groups values('a','A','A','A'),('b','B','B','B');
    create table app_users(id int primary key,name text,role text,group_name text,is_active boolean default true,approval_status text default 'approved');
    insert into app_users(id,name,role,group_name) values(1,'Admin','admin','A');
    create function verify_session(t uuid) returns integer language sql as $$select 1$$;
    create function private.request_session_user_id() returns integer language sql as $$select 1$$;
    create table calendar_events(id int primary key,target_groups text[]);
    create table cards(id int primary key,title text);
    ${migration('20261118_2300_service_group_directory.sql')}
    ${migration('20261120_1600_territory_group_assignments.sql')}
    ${migration('20261120_1700_territory_group_review.sql')}
    insert into cards(id,title) values(10,'Original');
    insert into card_group_assignments(card_id,group_code,assigned_by) values(10,'a',1),(10,'b',1);
    grant select,insert,update on public.cards to authenticated;
    grant usage on schema public to authenticated;`
}
