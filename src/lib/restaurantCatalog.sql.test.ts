// @vitest-environment node
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { beforeAll, afterAll, expect, test } from 'vitest'
import type { RestaurantCatalogItem } from './restaurantCatalog'
let db: PGlite
const token = '00000000-0000-0000-0000-000000000001'
beforeAll(async () => {
  db = new PGlite()
  await db.exec(`
    create role anon; create role authenticated; create role outsider;
    create table cards(id int primary key, region text, area text);
    create table buildings(id int primary key, card_id int, name text, address text, is_restaurant boolean);
    create table units(id int primary key, building_id int, number text, is_restaurant boolean);
    grant select on cards, buildings, units to anon, authenticated;
    alter table buildings enable row level security;
    create policy visible on buildings for select using (id <> 99);
    create function public.verify_session(p_token uuid) returns int language sql as $$ select case when p_token = '${token}'::uuid then 1 else null end $$;
    insert into cards values (1,'A','A1'),(2,'B','B1');
    insert into buildings select n,1,'Legacy '||n,'Address '||n,true from generate_series(1,45) n;
    insert into buildings values (98,2,'Other','B address',false),(99,1,'Hidden','hidden',true);
    insert into units values (1,1,'Unit Cafe',true),(2,1,'Not restaurant',false),(98,98,'100%_Cafe',true);
  `)
  await db.exec(readFileSync('supabase/migrations/20261019_1200_restaurant_catalog.sql', 'utf8'))
}, 30_000)
afterAll(async () => { await db?.close() })
async function page(search = '', region: string | null = null, area: string | null = null, after = [0, 0], all = false, session: string | null = token) {
  await db.exec('set role anon')
  try {
    return (await db.query<{ rows: RestaurantCatalogItem[] }>('select browse_restaurants($1,$2,$3,$4,$5,$6,$7) as rows', [session, search, region, area, ...after, all])).rows[0].rows
  } finally { await db.exec('reset role') }
}
test('idle is empty; explicit all is bounded, ordered, and respects RLS and unit/legacy semantics', async () => {
  expect(await page()).toEqual([])
  const first = await page('', null, null, [0, 0], true)
  expect(first).toHaveLength(21)
  expect(first[0]).toMatchObject({ building_id: 1, unit_id: 1, name: 'Unit Cafe' })
  expect(first[1]).toMatchObject({ building_id: 2, unit_id: null })
  const next = await page('', null, null, [first[19].building_id, first[19].unit_id ?? 0], true)
  expect(next[0]).toEqual(first[20])
  const last = await page('', null, null, [next[19].building_id, next[19].unit_id ?? 0], true)
  expect(last.map(row => row.building_id)).toEqual([41, 42, 43, 44, 45, 98])
})
test('district/neighborhood filters and literal normalized search run server-side', async () => {
  expect(await page('', 'B', 'B1')).toHaveLength(1)
  expect(await page('', 'B', 'A1')).toEqual([])
  expect((await page('unit cafe')).map(row => row.building_id)).toEqual([1])
  expect((await page('%_')).map(row => row.building_id)).toEqual([98])
  expect(await page('missing')).toEqual([])
})
test('invalid sessions and public execute are rejected', async () => {
  await expect(page('', null, null, [0, 0], true, null)).rejects.toThrow('Login required')
  expect((await db.query("select has_function_privilege('outsider','browse_restaurants(uuid,text,text,text,integer,integer,boolean)','execute') as allowed")).rows[0]).toEqual({ allowed: false })
})
