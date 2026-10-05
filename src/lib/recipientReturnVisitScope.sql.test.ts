// @vitest-environment node
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { buildingAddressKey } from '../utils/shortAddress'

const migration = readFileSync('supabase/migrations/20261005_1500_recipient_return_visit_scope.sql', 'utf8')
const rollback = readFileSync('supabase/tools/rollbacks/_ROLLBACK_20261005_1500_recipient_return_visit_scope.sql', 'utf8')
const token = '00000000-0000-0000-0000-000000000001'
let db: PGlite
beforeAll(async () => {
  db = new PGlite()
  await db.exec(`
    create role anon; create role authenticated; create role outsider;
    create table app_users(id int primary key, name text);
    create table buildings(id int primary key, card_id int, address text);
    create table units(id int primary key, building_id int);
    create table regular_visits(unit_id int, visitor_name text);
    create table return_visits(id int primary key, building_id int, unit_id int, address text, assigned_user_name text, created_by text, ended_at timestamptz);
    grant select on app_users, buildings, units, regular_visits, return_visits to anon, authenticated;
    create function public.verify_session(p_token uuid) returns int language sql as $$
      select case when p_token = '${token}'::uuid then 1 else null end
    $$;
    insert into app_users values (1,'My Name'), (2,'Other');
    alter table buildings enable row level security;
    create policy visible on buildings for select using (id <> 99);
  `)
  await db.exec(migration)
}, 30_000)
afterAll(async () => { await db?.close() })
async function scope(session: string | null = token) {
  await db.exec('set role anon')
  try { return (await db.query<{ ids: number[] }>('select get_recipient_return_visit_card_ids($1::uuid) as ids', [session])).rows[0].ids }
  finally { await db.exec('reset role') }
}
async function reset() { await db.exec('truncate buildings, units, regular_visits, return_visits') }

test('linked building wins, moved units resolve, legacy names normalize, and other owners/ended rows stay out', async () => {
  await reset()
  await db.exec(`
    insert into buildings values (1,10,'A'),(2,20,'B'),(3,30,'C'),(99,99,'hidden');
    insert into units values (1,1),(2,2),(3,3),(99,99);
    insert into regular_visits values (1,' My Name '),(99,'MyName');
    insert into return_visits values
      (1,1,2,'B','MyName','Other',null),
      (2,404,2,'A',' ',' My Name ',null),
      (3,3,null,'C','Other','MyName',null),
      (4,3,null,'C','MyName','Other',now());
  `)
  expect(await scope()).toEqual([10, 20])
})

test('all ambiguous address matches are retained so the partial client cannot choose a false unique match', async () => {
  await reset()
  await db.exec(`insert into buildings values (1,10,'서울 가락로5길 11'),(2,20,'경기 가락로5길 11'),(3,30,'다른로 1');
    insert into return_visits values (1,null,null,'가락로5길11','MyName',null,null);`)
  expect(await scope()).toEqual([10, 20])
  await db.exec('delete from buildings where id = 2')
  expect(await scope()).toEqual([10])
})

test('SQL address keys match client normalization including Unicode whitespace and non-road fallbacks', async () => {
  const addresses = ['경기 용인시 유림로147번길 55-2 엠제이오사옥', '가락로5길\u00a011', '가락로5길\ufeff11', '  BUILDING\u3000A  ', '삼성로 12-3', '']
  for (const address of addresses) {
    await reset()
    await db.query('insert into buildings values (1,10,$1)', [address])
    await db.query("insert into return_visits values (1,null,null,$1,'MyName',null,null)", [buildingAddressKey(address)])
    expect(await scope(), address).toEqual(address ? [10] : [])
  }
})

test('no assignments, absent targets, invalid session and explicit grants do not expose global cards', async () => {
  await reset()
  await db.exec("insert into buildings values (1,10,'A'); insert into return_visits values (1,null,null,'missing','MyName',null,null)")
  expect(await scope()).toEqual([])
  await expect(scope(null)).rejects.toThrow('Login required')
  const result = await db.query("select has_function_privilege('outsider','get_recipient_return_visit_card_ids(uuid)','execute') as allowed")
  expect(result.rows[0]).toEqual({ allowed: false })
})

test('over 1000 legacy rows and a moved unit do not lose targets; rollback changes no data', async () => {
  await reset()
  await db.exec("insert into buildings values (1,10,'A'),(2,20,'B'); insert into units values (1,1); insert into regular_visits select 1,'MyName' from generate_series(1,1001)")
  expect(await scope()).toEqual([10])
  await db.exec('update units set building_id=2 where id=1')
  expect(await scope()).toEqual([20])
  await db.exec(rollback)
  expect((await db.query('select count(*)::int as n from regular_visits')).rows[0]).toEqual({ n: 1001 })
  await db.exec(migration)
  expect(await scope()).toEqual([20])
})
