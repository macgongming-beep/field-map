// @vitest-environment node
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'

const rpc = readFileSync('supabase/migrations/20261110_1400_private_user_directory.sql', 'utf8')
const policy = readFileSync('supabase/migrations/20261110_1500_private_user_rows.sql', 'utf8')
const mutation = process.env.PRIVATE_USER_READ_MUTATION
const testedRpc = mutation === 'session' ? rpc.replaceAll('IF private.request_session_user_id() IS NULL THEN', 'IF false THEN')
  : mutation === 'leaders' ? rpc.replace('WHERE e.id = p_event_id', 'WHERE true') : rpc
const testedPolicy = mutation === 'rows' ? policy.replace('AS RESTRICTIVE', 'AS PERMISSIVE') : policy
const helperSource = readFileSync('supabase/migrations/20260828_1000_session_helper_and_signup.sql', 'utf8')
const helper = (name: string) => helperSource.match(new RegExp(`create or replace function private\\.${name}\\(\\)[\\s\\S]+?\\$\\$;`))![0]
const token = (id: number) => `00000000-0000-0000-0000-${String(id).padStart(12, '0')}`
let db: PGlite
beforeAll(async () => {
  db = new PGlite()
  await db.exec(`create role anon; create role authenticated; create schema private;
    create table app_users(id int primary key,name text,role text,is_active boolean,approval_status text,
      phone text,login_id text,group_name text,cart_service_approved boolean,cart_service_approved_at timestamptz,
      created_at timestamptz default now());
    create table auth_sessions(token uuid primary key,user_id int,expires_at timestamptz);
    create table calendar_events(id int primary key,leader_name text);
    ${helper('request_session_token')} ${helper('request_session_user_id')}
    ${helper('request_session_role')} ${helper('request_is_admin')}
    revoke all on schema private from public,anon,authenticated;
    grant select,insert,update,delete on app_users to anon,authenticated;
    alter table app_users enable row level security;
    create policy legacy_read on app_users for select using(true);
    create policy self_admin_update on app_users for update
      using(id=(select private.request_session_user_id()) or (select private.request_is_admin()))
      with check(id=(select private.request_session_user_id()) or (select private.request_is_admin()));
    create policy admin_insert on app_users for insert with check((select private.request_is_admin()));
    create policy admin_delete on app_users for delete using((select private.request_is_admin()));
    ${testedRpc} ${testedPolicy}`)
}, 30_000)
afterAll(async () => { await db?.close() })
beforeEach(async () => {
  await db.exec(`reset role; set request.headers='{}'; truncate app_users,auth_sessions,calendar_events;
    insert into app_users(id,name,role,is_active,approval_status,phone,login_id) values
    (1,'Member','user',true,'approved','01011111111','private-member'),
    (2,'Leader','leader',true,'approved','01022222222','private-leader'),
    (3,'Admin','admin',true,'approved','01033333333','private-admin'),
    (4,'Developer','developer',true,'approved','01044444444','private-dev'),
    (5,'Other','user',true,'approved','01055555555','private-other'),
    (6,'Blocked','leader',false,'approved','01066666666','private-blocked');
    insert into calendar_events values(10,'  Leader , Admin, Blocked '),(11,'Other');`)
  for (let id = 1; id <= 6; id++) await db.query("insert into auth_sessions values($1,$2,now()+interval '1 day')", [token(id), id])
})
async function asClient<T>(t: string | undefined, action: () => Promise<T>, role = 'anon') {
  await db.query("select set_config('request.headers',$1,false)", [JSON.stringify(t ? { 'x-session-token': t } : {})])
  await db.exec(`set role ${role}`)
  try { return await action() } finally { await db.exec('reset role') }
}
test.each(['anon', 'authenticated'])('%s: private rows are self-only for members/leaders; admin/developer keep full management', async role => {
  for (let id = 1; id <= 4; id++) await asClient(token(id), async () => {
    const rows = (await db.query<{ id: number }>('select id,phone,login_id from app_users order by id')).rows
    expect(rows.map(r => r.id)).toEqual(id <= 2 ? [id] : [1, 2, 3, 4, 5, 6])
    expect((await db.query('update app_users set phone=$1 where id=$2 returning id,phone', ['01099999999', id])).rows)
      .toEqual([{ id, phone: '01099999999' }])
    expect((await db.query("update app_users set name='Changed' where id=5 returning id")).rows)
      .toEqual(id <= 2 ? [] : [{ id: 5 }])
  }, role)
})
test('safe directory preserves participant data but never includes phone, login ID, or login timestamps', async () => {
  await asClient(token(1), async () => {
    const rows = (await db.query<Record<string, unknown>>('select * from get_user_directory()')).rows
    expect(rows.map(r => r.id).sort()).toEqual([1, 2, 3, 5, 6])
    for (const r of rows) {
      expect(Object.keys(r).sort()).toEqual(['id','name','role','approval_status','is_active','group_name','cart_service_approved','cart_service_approved_at','created_at'].sort())
    }
    expect(JSON.stringify(rows)).not.toMatch(/010|private-/)
  })
})
test('event contacts only return active current leaders; unknown/other events cannot disclose arbitrary contacts', async () => {
  await asClient(token(1), async () => {
    expect((await db.query('select * from get_event_leader_contacts(10)')).rows).toEqual([
      { id: 2, name: 'Leader', phone: '01022222222' }, { id: 3, name: 'Admin', phone: '01033333333' },
    ])
    expect((await db.query('select * from get_event_leader_contacts(999)')).rows).toEqual([])
    expect((await db.query('select id from get_event_leader_contacts(11)')).rows).toEqual([{ id: 5 }])
  })
  await db.exec("update calendar_events set leader_name='Member' where id=10")
  expect((await asClient(token(1), () => db.query('select id from get_event_leader_contacts(10)'))).rows).toEqual([{ id: 1 }])
})
test.each([undefined, 'malformed', token(99), token(6)])('invalid session %s cannot use direct reads', async t => {
  await asClient(t, async () => {
    expect((await db.query('select phone,login_id from app_users')).rows).toEqual([])
  })
})
test.each(['get_user_directory()', 'get_event_leader_contacts(10)'])('%s checks sessions independently of table policy', async fn => {
  for (const t of [undefined, 'malformed', token(99), token(6)]) {
    await asClient(t, async () => {
      await expect(db.query(`select * from ${fn}`)).rejects.toThrow('Authentication required')
    })
  }
  await db.exec('delete from auth_sessions where user_id=1')
  await asClient(token(1), async () => {
    await expect(db.query(`select * from ${fn}`)).rejects.toThrow('Authentication required')
  })
})
test('expired or revoked sessions fail closed and an administrator can still create/edit/delete a user', async () => {
  await db.exec("update auth_sessions set expires_at=now()-interval '1 second' where user_id=1")
  await asClient(token(1), async () => {
    expect((await db.query('select * from app_users')).rows).toEqual([])
    await expect(db.query('select * from get_user_directory()')).rejects.toThrow('Authentication required')
  })
  await asClient(token(3), async () => {
    expect((await db.query("insert into app_users(id,name,role,login_id) values(7,'New','user','new-login') returning id")).rows).toEqual([{ id: 7 }])
    expect((await db.query("update app_users set login_id='edited' where id=7 returning login_id")).rows).toEqual([{ login_id: 'edited' }])
    expect((await db.query('delete from app_users where id=7 returning id')).rows).toEqual([{ id: 7 }])
  })
})
