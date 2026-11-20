// @vitest-environment node
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import { GROUP_BACKUP_TABLES, GROUP_CONFLICT_KEYS, DIRECTORY_KEYS, snapshotSql, assertGroupBackup,
  ownerConnection, restoreGroupTableSql } from '../../../scripts/groupTerritoryBackup.mjs'
import { groupTerritoryRestoreFixture } from '../../../scripts/fixtures/groupTerritoryRestoreFixture.mjs'

let db: PGlite
type BackupRow = Record<string, unknown>
let backup: Record<string, BackupRow[]>
const query = async (sql: string) => (await db.query(sql)).rows
const revision = async () => Number((await query('select group_assignment_revision n from cards where id=10'))[0].n)
async function rejected(sql: string, message: string) {
  await db.exec('savepoint rejected')
  await expect(db.exec(sql)).rejects.toThrow(message)
  await db.exec('rollback to rejected;release rejected')
}
const restore = (table: string, rows = backup[table], replace = false) => db.exec(restoreGroupTableSql(table, rows, replace))
beforeAll(async () => {
  db = new PGlite()
  await db.exec(groupTerritoryRestoreFixture())
  backup = (await query(snapshotSql(GROUP_BACKUP_TABLES).replace('set transaction read only;', '')))[0].jsonb_build_object as typeof backup
}, 30000)
beforeEach(async () => { await db.exec('rollback;begin') })
afterAll(async () => { await db.close() })

test('backup and restore scripts include parent-first tables and composite keys', () => {
  const source = readFileSync('scripts/backup.js', 'utf8')
  const tables = source.split('const TABLES = [')[1].split(']')[0]
  expect(tables).toContain("'service_groups'")
  expect(tables).toContain("'card_group_assignments'")
  expect(source).toContain('snapshotSql(present)')
  const order = readFileSync('scripts/restore.js', 'utf8').split('const RESTORE_ORDER = [')[1].split(']')[0]
  expect(order.indexOf("'service_groups'")).toBeLessThan(order.indexOf("'app_users'"))
  expect(order.indexOf("'app_users'")).toBeLessThan(order.indexOf("'cards'"))
  expect(order.indexOf("'cards'")).toBeLessThan(order.indexOf("'card_group_assignments'"))
  expect(GROUP_CONFLICT_KEYS).toEqual({service_groups:'code',card_group_assignments:'card_id,group_code'})
  expect([...DIRECTORY_KEYS].sort()).toEqual(['service_group_directory','user_groups'])
})

test('legacy REST-style revision upsert is rejected even for an existing row', async () => {
  await rejected("insert into cards values(10,'Backup',2) on conflict(id) do update set group_assignment_revision=excluded.group_assignment_revision", 'server managed')
})

test('fresh restore preserves shared links, attribution, timestamps, labels and nonzero revisions', async () => {
  await db.exec('delete from cards;delete from app_users;delete from service_groups;')
  await restore('service_groups')
  await db.exec("insert into app_users(id,name,role,group_name) values(1,'Admin','admin','A')")
  await restore('cards')
  await restore('card_group_assignments')
  expect((await query('select jsonb_agg(to_jsonb(a) order by group_code) rows from card_group_assignments a'))[0].rows).toEqual(backup.card_group_assignments)
  expect(await query('select * from service_groups order by code')).toEqual(backup.service_groups)
  expect(await revision()).toBe(4)
  const directory = JSON.parse(String((await query("select value from app_settings where key='service_group_directory'"))[0].value))
  expect(directory.groups.map((g: {code:string}) => g.code)).toEqual(['a','b'])
  await rejected('update cards set group_assignment_revision=0', 'server managed')
})

test('missing-only restore keeps current fields and does not duplicate shared links', async () => {
  await db.exec("update cards set title='Current'")
  await restore('cards')
  await restore('card_group_assignments')
  expect(await query('select title from cards')).toEqual([{title:'Current'}])
  expect(await revision()).toBe(2)
  expect(await query('select * from card_group_assignments')).toHaveLength(2)
})

test('replace never rolls revisions back or removes another shared group', async () => {
  await db.exec("delete from card_group_assignments where group_code='a';insert into card_group_assignments(card_id,group_code) values(10,'a')")
  expect(await revision()).toBe(4)
  await restore('cards', backup.cards, true)
  await restore('card_group_assignments', backup.card_group_assignments.filter(row => row.group_code === 'a'), true)
  expect(await revision()).toBe(5)
  expect(await query('select group_code from card_group_assignments order by group_code')).toEqual([{group_code:'a'},{group_code:'b'}])
  await rejected(`select set_territory_group_assignments_tx('00000000-0000-0000-0000-000000000001','a',array[10],'remove','{"10":"4"}')`, 'Territory assignments changed')
})

test('restore failure rolls back writes and trigger disabling together', async () => {
  const bad = [...backup.cards, {...backup.cards[0],id:null}]
  await rejected(restoreGroupTableSql('cards', bad, true), 'null')
  expect(await revision()).toBe(2)
  expect(await query("select tgenabled from pg_trigger where tgname='guard_territory_group_revision'")).toEqual([{tgenabled:'O'}])
  await rejected('update cards set group_assignment_revision=99', 'server managed')
})

test('ordinary table writer cannot invoke owner restoration or bypass the guard', async () => {
  await rejected(`set local role authenticated;${restoreGroupTableSql('cards',backup.cards,true)}`, 'owner')
  await rejected('set local role authenticated;update cards set group_assignment_revision=99', 'server managed')
  await rejected("set local role authenticated;set local app.territory_group_revision_write='on';update cards set group_assignment_revision=3", 'server managed')
})

test('directory replacement updates memberships and regenerates guarded settings', async () => {
  const rows = backup.service_groups.map(row => row.code === 'a' ? {...row,display_name:'New A'} : row)
  await restore('service_groups',rows,true)
  expect(await query('select group_name from app_users')).toEqual([{group_name:'New A'}])
  const setting = JSON.parse(String((await query("select value from app_settings where key='service_group_directory'"))[0].value))
  expect(setting.revision).toBe('2')
  expect(setting.groups[0].name).toBe('New A')
  await rejected("update app_settings set value='[]' where key='user_groups'", 'directory management')
})

test('SQL payloads are data and unknown tables cannot be restored by this tool', async () => {
  const title = "a'\\; drop table cards; --"
  await restore('cards',[{...backup.cards[0],title}],true)
  expect(await query('select title from cards')).toEqual([{title}])
  expect(() => restoreGroupTableSql('app_users',backup.app_users,true)).toThrow('Unexpected')
})

test('incomplete backups and cross-project database credentials fail before writes', () => {
  expect(() => assertGroupBackup(backup,true)).not.toThrow()
  expect(() => assertGroupBackup({...backup,card_group_assignments:null},true)).toThrow('required')
  expect(() => assertGroupBackup({...backup,service_groups:[]},true)).toThrow('parent')
  expect(() => ownerConnection('postgresql://postgres.other:secret@aws-0.pooler.supabase.com:5432/postgres','https://demo.supabase.co')).toThrow('match')
  const env = ownerConnection('postgresql://postgres.demo:s%40fe@aws-0.pooler.supabase.com:5432/postgres','https://demo.supabase.co')
  expect(env.PGPASSWORD).toBe('s@fe')
  expect(env.PGUSER).toBe('postgres.demo')
})
