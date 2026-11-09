// @vitest-environment node
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'

const source = readFileSync('supabase/migrations/20261109_1800_login_attempt_guard.sql', 'utf8')
// Run mutation checks on isolated database instances; never edit the working source.
const mutation = process.env.LOGIN_GUARD_MUTATION
const migration = mutation === 'lock'
  ? source.replace('if v_guard.locked_until > v_now then', 'if false then')
  : mutation === 'count'
    ? source.replace('v_guard.failed_attempts + 1', '0')
    : mutation === 'read'
      ? source.replaceAll('using ((select private.request_session_user_id()) is not null)', 'using (true)')
      : source
let db: PGlite
type Login = { token: string | null; id: number; role: string; approval_status: string }
beforeAll(async () => {
  db = new PGlite({ extensions: { pgcrypto } })
  await db.exec(`
    create role anon; create role authenticated; create role outsider;
    create schema extensions; create extension pgcrypto with schema extensions;
    create schema private; grant usage on schema private to anon, authenticated;
    create table app_users(id serial primary key, login_id text unique, name text, pin text,
      role text, approval_status text default 'approved', is_active boolean default true, last_login_at timestamptz);
    create table auth_sessions(token uuid primary key default gen_random_uuid(), user_id int references app_users,
      device_label text, user_agent text, expires_at timestamptz default now() + interval '30 days');
    create table login_logs(user_id int, logged_in_at timestamptz);
    alter table app_users enable row level security;
    grant select(id,login_id,name,role) on app_users to anon, authenticated;
    create policy app_users_select_all on app_users for select to anon using(true);
    create policy other_permissive_read on app_users for select to anon using(true);
    create function private.request_session_user_id() returns int language sql stable security definer set search_path = '' as $$
      select s.user_id from public.auth_sessions s join public.app_users u on u.id=s.user_id
      where s.token::text = coalesce(nullif(current_setting('request.headers',true),''),'{}')::jsonb->>'x-session-token'
        and s.expires_at > now() and u.is_active and u.approval_status='approved'
    $$;
    revoke all on function private.request_session_user_id() from public;
    grant execute on function private.request_session_user_id() to anon, authenticated;
    create function auth_login(text,text) returns int language sql as $$ select 999 $$;
  `)
  await db.exec(migration)
}, 30_000)
afterAll(async () => { await db?.close() })
beforeEach(async () => {
  await db.exec(`reset role; set request.headers = '{}';
    truncate private.login_attempt_guard, login_logs, auth_sessions, app_users restart identity;
    insert into app_users(login_id,name,pin,role) values
    ('member','Member',extensions.crypt('Good-1234',extensions.gen_salt('bf',6)),'user'),
    ('admin','Admin',extensions.crypt('Good-1234',extensions.gen_salt('bf',6)),'admin'),
    (null,'legacy',extensions.crypt('Good-1234',extensions.gen_salt('bf',6)),'leader');
  `)
})
async function login(id = 'member', pin: string | null = 'Good-1234', legacy = false) {
  await db.exec('set role anon')
  try {
    return (await db.query<Login>(legacy ? 'select * from auth_login($1,$2)' : 'select * from auth_login($1,$2,$3,$4)',
      legacy ? [id, pin] : [id, pin, 'test-device', 'test-agent'])).rows
  } finally { await db.exec('reset role') }
}
async function failures(count = 5, id = 'member') {
  for (let i = 0; i < count; i++) expect(await login(id, 'wrong')).toEqual([])
}
async function guard() {
  return (await db.query<{ failed_attempts: number; locked_until: string | null }>(
    'select failed_attempts, locked_until::text from private.login_attempt_guard where user_id=1')).rows[0]
}
async function directory(token?: string) {
  await db.query("select set_config('request.headers',$1,false)", [JSON.stringify(token ? { 'x-session-token': token } : {})])
  await db.exec('set role anon')
  try { return (await db.query('select id,login_id,name,role from app_users')).rows }
  finally { await db.exec('reset role') }
}

test('normal login creates a session and log, preserves role, and legacy two-argument callers use the same RPC', async () => {
  for (const [id, role] of [['member', 'user'], ['admin', 'admin'], ['legacy', 'leader']]) {
    const rows = await login(id, 'Good-1234', true)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ role, approval_status: 'approved' })
    expect(rows[0].token).toBeTruthy()
  }
  expect((await db.query('select count(*)::int as n from login_logs')).rows).toEqual([{ n: 3 }])
  expect((await db.query("select to_regprocedure('auth_login(text,text)') as old")).rows).toEqual([{ old: null }])
})

test('four failures allow correct login; success resets the counter', async () => {
  await failures(4)
  expect(await guard()).toMatchObject({ failed_attempts: 4, locked_until: null })
  expect((await login())[0].token).toBeTruthy()
  expect(await guard()).toMatchObject({ failed_attempts: 0, locked_until: null })
  await failures(4)
  expect((await login())[0].token).toBeTruthy()
})

test('administrator and legacy-name logins cannot bypass account locks', async () => {
  for (const id of ['admin', 'legacy']) {
    await failures(5, id)
    expect(await login(id, 'Good-1234', true)).toEqual([])
  }
  expect((await login())[0].token).toBeTruthy()
})

test('authenticated SQL role also requires a live custom session', async () => {
  await db.exec('set role authenticated')
  expect((await db.query('select id from app_users')).rows).toEqual([])
  await db.exec('reset role')
  const token = (await login())[0].token!
  await db.query("select set_config('request.headers',$1,false)", [JSON.stringify({ 'x-session-token': token })])
  await db.exec('set role authenticated')
  expect((await db.query('select id from app_users')).rows).toHaveLength(3)
  await db.exec('reset role')
})

test('fifth failure persists a 15-minute lock, rejects correct PIN and never extends the lock', async () => {
  await failures()
  const locked = await guard()
  expect(locked.failed_attempts).toBe(5)
  expect(locked.locked_until).toBeTruthy()
  expect((await db.query('select locked_until between clock_timestamp()+interval \'14 minutes\' and clock_timestamp()+interval \'16 minutes\' as valid from private.login_attempt_guard')).rows).toEqual([{ valid: true }])
  expect(await login()).toEqual([])
  expect(await login(' member ', 'Good-1234', true)).toEqual([])
  await failures(2)
  expect(await guard()).toEqual(locked)
  expect((await db.query('select count(*)::int as n from auth_sessions')).rows).toEqual([{ n: 0 }])
})

test('expired lock allows login and an expired failure window starts again at one', async () => {
  await failures()
  await db.exec("update private.login_attempt_guard set locked_until=clock_timestamp()-interval '1 second'")
  expect((await login())[0].token).toBeTruthy()
  await failures(4)
  await db.exec("update private.login_attempt_guard set window_started_at=clock_timestamp()-interval '16 minutes'")
  await failures(1)
  expect(await guard()).toMatchObject({ failed_attempts: 1, locked_until: null })
})

test('unknown, wrong, null PIN and locked responses have the same empty shape; random IDs do not grow state', async () => {
  expect(await login('missing')).toEqual([])
  expect(await login('missing', null)).toEqual([])
  expect((await db.query('select count(*)::int as n from private.login_attempt_guard')).rows).toEqual([{ n: 0 }])
  expect(await login('member', null)).toEqual([])
  expect(await login('member', '')).toEqual([])
  await failures(3)
  expect(await login()).toEqual([])
})

test('pending and inactive accounts retain their correct-password UI but never receive tokens', async () => {
  await db.exec("update app_users set approval_status='pending' where id=1; update app_users set is_active=false where id=2")
  expect(await login('member', 'wrong')).toEqual([])
  expect(await login()).toEqual([expect.objectContaining({ token: null, approval_status: 'pending' })])
  expect(await login('admin')).toEqual([expect.objectContaining({ token: null, approval_status: 'blocked' })])
  await failures()
  expect(await login()).toEqual([])
})

test('anonymous directory is empty even with a permissive policy; live sessions still read it during login lock', async () => {
  expect(await directory()).toEqual([])
  expect(await directory('not-a-token')).toEqual([])
  const token = (await login())[0].token!
  expect(await directory(token)).toHaveLength(3)
  await failures()
  expect(await directory(token)).toHaveLength(3)
  await db.exec("update auth_sessions set expires_at=now()-interval '1 second'")
  expect(await directory(token)).toEqual([])
})

test('unapproved or inactive sessions cannot read the directory; state and hash cannot be read or changed', async () => {
  const token = (await login())[0].token!
  await db.exec("update app_users set is_active=false where id=1")
  expect(await directory(token)).toEqual([])
  await db.exec("update app_users set is_active=true,approval_status='pending' where id=1")
  expect(await directory(token)).toEqual([])
  await db.exec('set role anon')
  try {
    await expect(db.query('select * from private.login_attempt_guard')).rejects.toThrow(/permission denied/)
    await expect(db.query('update private.login_attempt_guard set failed_attempts=0')).rejects.toThrow(/permission denied/)
    await expect(db.query('select pin from app_users')).rejects.toThrow(/permission denied/)
  } finally { await db.exec('reset role') }
  expect((await db.query("select has_function_privilege('outsider','auth_login(text,text,text,text)','execute') as allowed")).rows).toEqual([{ allowed: false }])
})

test('reapplying migration does not unlock accounts or delete existing sessions', async () => {
  const token = (await login())[0].token!
  await failures()
  const previous = await guard()
  await db.exec(migration)
  expect(await guard()).toEqual(previous)
  expect(await login()).toEqual([])
  expect(await directory(token)).toHaveLength(3)
})
