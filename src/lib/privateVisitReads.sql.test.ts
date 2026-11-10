// @vitest-environment node
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'

const tables = ['visit_histories', 'return_visits', 'return_visit_logs'] as const
const source = readFileSync('supabase/migrations/20261110_1000_private_visit_reads.sql', 'utf8')
const mutation = process.env.PRIVATE_VISIT_READ_MUTATION
const migration = mutation === 'permissive' ? source.replaceAll('AS RESTRICTIVE', 'AS PERMISSIVE')
  : tables.includes(mutation as typeof tables[number])
    ? source.replace(new RegExp(`CREATE POLICY ${mutation}_require_session_read[\\s\\S]+?;`), '') : source
const helperSource = readFileSync('supabase/migrations/20260828_1000_session_helper_and_signup.sql', 'utf8')
const helper = (name: string) => helperSource.match(new RegExp(`create or replace function private\\.${name}\\(\\)[\\s\\S]+?\\$\\$;`))![0]
const token = (id: number) => `00000000-0000-0000-0000-${String(id).padStart(12, '0')}`
let db: PGlite
beforeAll(async () => {
  db = new PGlite()
  await db.exec(`create role anon; create role authenticated; create schema private;
    create table app_users(id int primary key,role text,is_active boolean,approval_status text);
    create table auth_sessions(token uuid primary key,user_id int,expires_at timestamptz);
    ${helper('request_session_token')} ${helper('request_session_user_id')}
    revoke all on schema private from public,anon,authenticated;
    revoke all on function private.request_session_token() from public,anon,authenticated;
    revoke all on function private.request_session_user_id() from public;
    grant execute on function private.request_session_user_id() to anon,authenticated;
    create function public.fixture_actor() returns int language sql stable security definer set search_path='' as $$
      select private.request_session_user_id() $$;
    create table units(id int primary key);
    insert into units values(1);
    grant select on units to anon,authenticated;`)
  for (const table of tables) {
    await db.exec(`create table ${table}(id int primary key,unit_id int references units,owner_id int,memo text,address text);
      grant select,insert,update on ${table} to anon,authenticated;
      alter table ${table} enable row level security;
      create policy legacy_open on ${table} for select to public using(true);
      create policy other_open on ${table} for select to anon,authenticated using(true);
      create policy member_insert on ${table} for insert to anon,authenticated with check(owner_id=fixture_actor());
      create policy owner_update on ${table} for update to anon,authenticated using(owner_id=fixture_actor()) with check(owner_id=fixture_actor());`)
  }
  await db.exec(migration)
}, 30_000)
afterAll(async () => { await db?.close() })
beforeEach(async () => {
  await db.exec(`reset role; set request.headers='{}'; truncate app_users,auth_sessions;
    insert into app_users values(1,'user',true,'approved'),(2,'leader',true,'approved'),(3,'admin',true,'approved'),(4,'developer',true,'approved');`)
  for (let id = 1; id <= 4; id++) await db.query("insert into auth_sessions values($1,$2,now()+interval '1 day')", [token(id), id])
  for (const table of tables) await db.exec(`truncate ${table}; insert into ${table} values(1,1,1,'private memo','private address'),(2,1,2,'other memo','other address');`)
})
async function asClient<T>(headers: object, role: 'anon' | 'authenticated', action: () => Promise<T>) {
  await db.query("select set_config('request.headers',$1,false)", [JSON.stringify(headers)])
  await db.exec(`set role ${role}`)
  try { return await action() } finally { await db.exec('reset role') }
}
test.each(tables)('%s refuses missing, malformed, unknown, expired, revoked, inactive and pending sessions', async table => {
  const read = () => db.query(`select memo,address from ${table}`)
  for (const role of ['anon', 'authenticated'] as const) {
    for (const headers of [{}, { 'x-session-token': 'invalid' }, { 'x-session-token': token(99) }]) {
      expect((await asClient(headers, role, read)).rows).toEqual([])
    }
  }
  for (const change of ["update auth_sessions set expires_at=now()-interval '1 second'", 'delete from auth_sessions',
    'update app_users set is_active=false', "update app_users set approval_status='pending'"]) {
    await db.exec('begin')
    try {
      await db.exec(change)
      expect((await asClient({ 'x-session-token': token(1) }, 'anon', read)).rows).toEqual([])
    } finally { await db.exec('rollback') }
  }
})
test.each(tables)('%s keeps all four logged-in roles and complete aggregate results', async table => {
  const before = (await db.query(`select * from ${table} order by id`)).rows
  for (const dbRole of ['anon', 'authenticated'] as const) {
    for (let id = 1; id <= 4; id++) {
      await asClient({ 'x-session-token': token(id) }, dbRole, async () => {
        expect((await db.query(`select * from ${table} order by id`)).rows).toEqual(before)
        expect((await db.query(`select count(*)::int n from ${table}`)).rows).toEqual([{ n: 2 }])
      })
    }
  }
})
test.each(tables)('%s still allows owner writes with representation, not anonymous or other-owner writes', async table => {
  await asClient({ 'x-session-token': token(1) }, 'anon', async () => {
    expect((await db.query(`insert into ${table} values(3,1,1,'saved','address') returning id`)).rows).toEqual([{ id: 3 }])
    expect((await db.query(`update ${table} set memo='edited' where id=3 returning memo`)).rows).toEqual([{ memo: 'edited' }])
    expect((await db.query(`update ${table} set memo='not allowed' where id=2 returning id`)).rows).toEqual([])
  })
  await asClient({}, 'anon', async () => {
    await expect(db.query(`insert into ${table} values(4,1,1,'blocked','blocked')`)).rejects.toThrow(/row-level security/)
    expect((await db.query(`update ${table} set memo='blocked' where id=1 returning id`)).rows).toEqual([])
  })
})
test('joined reads do not disclose details without a session; reapplication preserves rows and policies', async () => {
  const query = 'select v.memo,r.address,l.memo from units u join visit_histories v on v.unit_id=u.id join return_visits r on r.unit_id=u.id join return_visit_logs l on l.unit_id=u.id'
  expect((await asClient({}, 'anon', () => db.query(query))).rows).toEqual([])
  expect((await asClient({ 'x-session-token': token(1) }, 'anon', () => db.query(query))).rows).toHaveLength(8)
  const before = (await db.query("select tablename,policyname,cmd,qual,with_check from pg_policies order by tablename,policyname")).rows
  await db.exec(migration)
  expect((await db.query("select tablename,policyname,cmd,qual,with_check from pg_policies order by tablename,policyname")).rows).toEqual(before)
  for (const table of tables) expect((await db.query(`select count(*)::int n from ${table}`)).rows).toEqual([{ n: 2 }])
})
