// @vitest-environment node
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'

let db: PGlite
const token = (id: number) => `00000000-0000-0000-0000-${String(id).padStart(12, '0')}`
async function assign(code: string, ids: number[], action = 'add', actor = 1, expected?: Record<string, string>) {
  const rows = (await db.query<{ id: number; group_assignment_revision: number }>('select id,group_assignment_revision from cards where id=any($1)', [ids])).rows
  return db.query('select set_territory_group_assignments_tx($1,$2,$3,$4,$5)', [token(actor), code, ids, action,
    JSON.stringify(expected ?? Object.fromEntries(rows.map(row => [row.id, String(row.group_assignment_revision)])))])
}
async function rejects(action: () => Promise<unknown>, message: string) {
  await db.exec('savepoint denied')
  await expect(action()).rejects.toThrow(message)
  await db.exec('rollback to denied;release denied')
}
beforeAll(async () => {
  db = new PGlite()
  await db.exec(`create role anon;create role authenticated;create schema private;
    create table app_users(id integer primary key,role text,is_active boolean default true,approval_status text default 'approved');
    insert into app_users(id,role) values(1,'admin'),(2,'developer'),(3,'leader'),(4,'user'),(5,'admin'),(6,'admin');
    update app_users set is_active=false where id=5;update app_users set approval_status='pending' where id=6;
    create function verify_session(t uuid) returns int language sql as $$select id from public.app_users where id=right(t::text,12)::int and is_active and approval_status='approved'$$;
    create function private.request_session_user_id() returns int language sql stable as $$select id from public.app_users where id=nullif(current_setting('test.actor',true),'')::int and is_active and approval_status='approved'$$;
    create table cards(id integer primary key,leader_name text,status text);
    insert into cards values(10,'Old leader','진행중'),(11,null,'완료'),(12,null,'미배정');
    create table service_groups(code text primary key,display_name text,is_active boolean default true);
    insert into service_groups values('a','第一组',true),('b','第二组',true),('retired','旧组',false);
    create table event_card_assignments(id integer primary key,card_id integer);
    insert into event_card_assignments values(1,10);
    create table visit_histories(id integer primary key,card_id integer);
    insert into visit_histories values(1,10);
    ${readFileSync('supabase/migrations/20261120_1600_territory_group_assignments.sql', 'utf8')}
    ${readFileSync('supabase/migrations/20261120_1700_territory_group_review.sql', 'utf8')}
  `)
}, 30000)
beforeEach(async () => { await db.exec('rollback;begin') })
afterAll(async () => { await db.close() })

test('shared ownership is a union; removing one group preserves the other, legacy owner, status and event/visits', async () => {
  await assign('a', [10, 11]); await assign('b', [10], 'add', 2); await assign('a', [10], 'remove')
  expect((await db.query('select card_id,group_code from card_group_assignments order by card_id')).rows).toEqual([{ card_id: 10, group_code: 'b' }, { card_id: 11, group_code: 'a' }])
  expect((await db.query('select leader_name,status from cards where id=10')).rows[0]).toEqual({ leader_name: 'Old leader', status: '진행중' })
  expect((await db.query('select * from event_card_assignments')).rows).toEqual([{ id: 1, card_id: 10 }])
  expect((await db.query('select * from visit_histories')).rows).toEqual([{ id: 1, card_id: 10 }])
})
test('stale bulk saves fail completely, including when another group changed the same territory', async () => {
  await assign('a', [11])
  await rejects(() => assign('b', [10, 11], 'add', 1, { 10: '0', 11: '0' }), 'Territory assignments changed')
  expect((await db.query('select card_id,group_code from card_group_assignments')).rows).toEqual([{ card_id: 11, group_code: 'a' }])
  await rejects(() => assign('b', [10, 999]), 'Territory not found')
  expect((await db.query('select * from card_group_assignments where card_id=10')).rows).toEqual([])
})
test('leaders, ordinary users, inactive/pending/missing sessions cannot manage standing ownership', async () => {
  for (const actor of [3, 4, 5, 6, 99]) await rejects(() => assign('a', [10], 'add', actor), 'Admin required')
})
test('names change without unlinking; retired groups can only release ownership', async () => {
  await assign('a', [10]); await db.exec("update service_groups set display_name='新名称',is_active=false where code='a'")
  expect((await db.query('select group_code from card_group_assignments')).rows).toEqual([{ group_code: 'a' }])
  await rejects(() => assign('a', [11]), 'Unknown or retired group')
  await assign('a', [10], 'remove')
  expect((await db.query('select * from card_group_assignments')).rows).toEqual([])
})
test('unknown groups, duplicate cards, empty batches, null actions and missing versions fail', async () => {
  await rejects(() => assign('missing', [10]), 'Unknown or retired group')
  for (const ids of [[], [10, 10]]) await rejects(() => assign('a', ids), 'Invalid territory assignment input')
  await rejects(() => db.query('select set_territory_group_assignments_tx($1,$2,$3,$4,$5)', [token(1), 'a', [10], null, '{}']), 'Invalid territory assignment input')
  await rejects(() => assign('a', [10], 'add', 1, {}), 'Territory assignments changed')
})
test('authenticated role reads only; anonymous or member reads reveal no group links and direct writes are forbidden', async () => {
  await assign('a', [10]); await assign('b', [11])
  for (const actor of [1, 2, 3, 4, 5, 6, 99]) {
    await db.exec(`set test.actor='${actor}';set local role anon`)
    expect((await db.query('select * from card_group_assignments')).rows).toHaveLength(actor <= 3 ? 2 : 0)
    await db.exec('reset role')
  }
  await db.exec("set test.actor='1';set local role anon")
  await rejects(() => db.exec("delete from card_group_assignments where card_id=10"), 'permission denied')
  await db.exec('reset role')
  expect((await db.query("select has_function_privilege('anon','private.track_territory_group_revision()','execute') allowed")).rows[0]).toEqual({ allowed: false })
})
test('actor cleanup and card deletion keep existing maintenance paths working', async () => {
  await assign('a', [10]); await db.exec('delete from app_users where id=1')
  expect((await db.query('select group_code,assigned_by from card_group_assignments')).rows).toEqual([{ group_code: 'a', assigned_by: null }])
  await db.exec('delete from cards where id=10')
  expect((await db.query('select * from card_group_assignments')).rows).toEqual([])
})

test('removing ownership invalidates an old add, and idempotent changes do not advance the revision', async () => {
  await assign('a', [10])
  await assign('a', [10])
  expect((await db.query('select group_assignment_revision::text as rev from cards where id=10')).rows).toEqual([{ rev: '1' }])
  await assign('a', [10], 'remove')
  await rejects(() => assign('b', [10], 'add', 1, { 10: '1' }), 'Territory assignments changed')
  expect((await db.query('select * from card_group_assignments')).rows).toEqual([])
})

test('609 and 1000 territories save atomically; 1001 are refused without partial changes', async () => {
  await db.exec('insert into cards(id) select generate_series(100,1100)')
  const ids = Array.from({ length: 1001 }, (_, index) => index + 100)
  await assign('a', ids.slice(0, 609))
  expect((await db.query('select * from card_group_assignments')).rows).toHaveLength(609)
  await assign('b', ids.slice(0, 1000))
  await rejects(() => assign('a', ids), 'Invalid territory assignment input')
  expect((await db.query("select * from card_group_assignments where group_code='a'")).rows).toHaveLength(609)
})

test('direct revision tampering is denied even with table UPDATE rights; ordinary edits and RPC still work', async () => {
  await db.exec('grant select,insert,update on cards to anon;set local role anon')
  await rejects(() => db.exec('update cards set group_assignment_revision=100 where id=10'), 'Group revision is server managed')
  await rejects(() => db.exec('insert into cards(id,group_assignment_revision) values(99,4)'), 'Group revision is server managed')
  await db.exec("update cards set status='완료' where id=10")
  await assign('a', [10])
  await assign('a', [10], 'remove')
  await rejects(() => db.exec('update cards set group_assignment_revision=3 where id=10'), 'Group revision is server managed')
  // The private flag alone is insufficient, including after legitimate writes.
  await db.exec("set local app.territory_group_revision_write='on'")
  await rejects(() => db.exec('update cards set group_assignment_revision=3 where id=10'), 'Group revision is server managed')
  await db.exec('reset role')
})
