// @vitest-environment node
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from 'vitest'
import { recomputeCardStats, toBuilding, type RawBuilding } from '../hooks/storeTransforms'
import { buildingHasUsage, unitsForUsage } from '../utils/unitUsage'
import type { TerritoryCard } from '../types'
import type { CardSummary } from './cardSummaries'

const migration = readFileSync('supabase/migrations/20261005_1200_card_summaries.sql', 'utf8')
const rollback = readFileSync('supabase/tools/rollbacks/_ROLLBACK_20261005_1200_card_summaries.sql', 'utf8')
const token = '00000000-0000-0000-0000-000000000001'
let db: PGlite
const raw: RawBuilding[] = [
  { id: 1, card_id: 1, type: '주택', units: [
    { id: 1, number: '101', status: '미방문', is_chinese: false },
    { id: 2, number: '102', status: '부재', usage_type: '상가' },
    { id: 3, number: '103', status: '만남', is_restaurant: true, usage_type: '주택', regular_visits: [{ visitor_name: 'A' }, { visitor_name: 'B' }] },
    { id: 4, number: '104', status: '대상외' },
    { id: 5, number: '105', status: '거절' },
    { id: 6, number: '106', status: '확인필요' },
    { id: 7, number: '\u00a0출입불가\ufeff', status: '만남', regular_visits: [{ visitor_name: 'C' }] },
  ] },
  { id: 2, card_id: 1, type: '상가', units: [] },
  { id: 3, card_id: 2, type: '주택', units: [{ id: 8, number: '\t출입불가\n', status: '만남' }] },
  { id: 4, card_id: 2, type: '상가', units: [{ id: 9, number: '1', status: '부재', usage_type: '주택' }] },
] as RawBuilding[]

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`
    create role anon; create role authenticated; create role outsider;
    create table cards(id integer primary key, name text, area text, region text, status text);
    create table buildings(id integer primary key, card_id integer, type text);
    create table units(id integer primary key, building_id integer, number text, status text, is_restaurant boolean, usage_type text);
    create table regular_visits(unit_id integer);
    grant select on cards, buildings, units, regular_visits to anon, authenticated;
    -- Session helper stub; production verify_session is not replaced by this migration.
    create function public.verify_session(p_token uuid) returns integer language plpgsql as $$
    begin
      if p_token is distinct from '${token}'::uuid then raise exception 'Invalid session'; end if;
      return 1;
    end $$;
    alter table cards enable row level security;
    create policy visible_cards on cards for select using (id <> 99);
    alter table buildings enable row level security;
    create policy visible_buildings on buildings for select using (id <> 90);
    alter table units enable row level security;
    create policy visible_units on units for select using (id <> 90);
  `)
}, 30_000)

beforeEach(async () => {
  await db.exec(migration)
  await db.exec(`truncate cards, buildings, units, regular_visits;
    insert into cards values (1,'Mixed','Area','Region','진행중'),(2,'Legacy','Area','Region','미배정'),
    (3,'Empty','Area','Region','미배정'),(99,'Hidden','Area','Region','미배정');`)
  for (const b of raw) {
    await db.query('insert into buildings values ($1,$2,$3)', [b.id, b.card_id, b.type])
    for (const u of b.units) {
      await db.query('insert into units values ($1,$2,$3,$4,$5,$6)',
        [u.id, b.id, u.number, u.status, u.is_restaurant ?? false, u.usage_type ?? null])
      for (const _ of u.regular_visits ?? []) {
        void _
        await db.query('insert into regular_visits values ($1)', [u.id])
      }
    }
  }
  await db.exec('set role anon')
})
afterEach(async () => { await db.exec('reset role') })
afterAll(async () => { await db?.close() })

async function summaries(ids: number[] | null, session: string | null = token) {
  const { rows } = await db.query<{ result: CardSummary[] }>(
    'select public.get_card_summaries($1::uuid,$2::integer[]) as result', [session, ids])
  return rows[0].result
}

test('SQL aggregates match existing UI stats and usage rules, without duplicated regular visits', async () => {
  const buildings = raw.map(toBuilding)
  const rows = await summaries([1, 2, 3])
  for (const row of rows) {
    const stats = recomputeCardStats({ id: row.id } as TerritoryCard, buildings)
    const selected = buildings.filter((b) => b.cardId === row.id)
    const house = selected.flatMap((b) => unitsForUsage(b, '주택'))
    const shop = selected.flatMap((b) => unitsForUsage(b, '상가'))
    expect(row).toMatchObject({
      buildings: stats.buildings, units: stats.units, completed: stats.completed,
      progress: stats.progress, regularVisits: stats.regularVisits,
      houseUnits: house.length, shopUnits: shop.length,
      houseCompleted: house.filter((u) => u.status !== '미방문' && u.status !== '부재').length,
      shopCompleted: shop.filter((u) => u.status !== '미방문' && u.status !== '부재').length,
      houseBuildings: selected.filter((b) => buildingHasUsage(b, '주택')).length,
      shopBuildings: selected.filter((b) => buildingHasUsage(b, '상가')).length,
    })
  }
  expect(rows[0]).toMatchObject({ units: 6, completed: 4, regularVisits: 1, progress: 67 })
  expect(rows[2]).toMatchObject({ buildings: 0, units: 0, progress: 100 })
  expect(Object.keys(rows[0]).sort()).toEqual([
    'id', 'name', 'area', 'region', 'status', 'buildings', 'units', 'completed', 'progress',
    'regularVisits', 'houseUnits', 'shopUnits', 'houseCompleted', 'shopCompleted', 'houseBuildings', 'shopBuildings',
  ].sort())
})

test('empty, duplicate, missing IDs do not broaden scope; RLS still hides a requested card', async () => {
  expect(await summaries([])).toEqual([])
  expect((await summaries([1, 1, 99, 999])).map((r) => r.id)).toEqual([1])
})

test('null, oversized and invalid scopes fail instead of returning all cards', async () => {
  for (const ids of [null, [0], [-1], Array(201).fill(1)]) {
    await expect(summaries(ids)).rejects.toThrow('positive card IDs')
  }
})

test('hidden buildings and units cannot inflate summary counts through the RPC', async () => {
  await db.exec(`reset role; insert into buildings values (90,1,'상가');
    insert into units values (90,1,'Hidden unit','만남',false,null), (91,90,'Hidden building','만남',false,null);
    set role anon;`)
  expect((await summaries([1]))[0]).toMatchObject({ buildings: 2, units: 6, completed: 4 })
})

test('RPC grants are explicit, not inherited through PUBLIC', async () => {
  const { rows } = await db.query(`select
    has_function_privilege('anon','public.get_card_summaries(uuid,integer[])','execute') as anon,
    has_function_privilege('authenticated','public.get_card_summaries(uuid,integer[])','execute') as authenticated,
    has_function_privilege('outsider','public.get_card_summaries(uuid,integer[])','execute') as outsider`)
  expect(rows[0]).toEqual({ anon: true, authenticated: true, outsider: false })
})

test('missing or expired session cannot call the summary RPC even with an empty scope', async () => {
  await expect(summaries([], null)).rejects.toThrow('Invalid session')
  await expect(summaries([1], '00000000-0000-0000-0000-000000000002')).rejects.toThrow('Invalid session')
})

test('aggregate includes over 1000 units without a PostgREST parent-row limit', async () => {
  await db.exec(`reset role;
    insert into units select n, 2, n::text, '만남', false, null from generate_series(100,1200) n;
    set role anon;`)
  expect((await summaries([1]))[0]).toMatchObject({ units: 1107, completed: 1105 })
})

test('changes, deletion and movement are reflected without stored counters', async () => {
  await db.exec(`reset role; update buildings set card_id = 3 where id = 1;
    delete from units where id = 9; set role anon;`)
  const rows = await summaries([1, 2, 3])
  expect(rows[0]).toMatchObject({ units: 0, buildings: 1 })
  expect(rows[1]).toMatchObject({ units: 0, buildings: 2, progress: 100 })
  expect(rows[2]).toMatchObject({ units: 6, buildings: 1, progress: 67 })
})

test('rollback removes only the RPC and forward migration can recreate it', async () => {
  await db.exec('reset role')
  await db.exec(rollback)
  expect((await db.query("select to_regprocedure('public.get_card_summaries(uuid,integer[])') as f")).rows[0]).toEqual({ f: null })
  expect((await db.query('select count(*)::integer as n from units')).rows[0]).toEqual({ n: 9 })
  await db.exec(migration)
  await db.exec('set role anon')
  expect((await summaries([1]))[0].units).toBe(6)
})
