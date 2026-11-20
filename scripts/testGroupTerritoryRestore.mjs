// Disposable local PostgreSQL only. Does not load .env or connect to any remote database.
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir, userInfo } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { GROUP_BACKUP_TABLES, runOwnerSql, snapshotSql, restoreGroupTableSql } from './groupTerritoryBackup.mjs'
import { groupTerritoryRestoreFixture } from './fixtures/groupTerritoryRestoreFixture.mjs'

const root = mkdtempSync(join(tmpdir(), 'territory-restore-'))
const data = join(root, 'data')
const env = { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('PG'))),
  PGHOST: root, PGPORT: '55440', PGDATABASE: 'postgres', PGUSER: userInfo().username }
function command(bin, args) {
  const result = spawnSync(bin, args, {env,encoding:'utf8'})
  assert.equal(result.status,0,result.stderr)
}
const sql = body => runOwnerSql(body,env)
const snapshot = () => JSON.parse(sql(snapshotSql(GROUP_BACKUP_TABLES)))
const restore = (table, rows, replace = false) => sql(restoreGroupTableSql(table,rows,replace))
let started = false
try {
  command('initdb',['-D',data,'-A','trust','--no-locale','--encoding=UTF8'])
  command('pg_ctl',['-D',data,'-l',join(root,'server.log'),'-o',`-k ${root} -p 55440 -h ''`,'-w','start'])
  started = true
  sql(groupTerritoryRestoreFixture())
  const original = snapshot()
  assert.equal(original.cards[0].group_assignment_revision,2)
  assert.throws(() => sql("insert into cards values(10,'Old restore',2) on conflict(id) do update set group_assignment_revision=excluded.group_assignment_revision"))

  sql('delete from cards;delete from app_users;delete from service_groups;')
  restore('service_groups',original.service_groups)
  sql("insert into app_users(id,name,role,group_name) values(1,'Admin','admin','A')")
  restore('cards',original.cards)
  restore('card_group_assignments',original.card_group_assignments)
  const restored = snapshot()
  assert.deepEqual(restored.card_group_assignments,original.card_group_assignments)
  assert.deepEqual(restored.service_groups,original.service_groups)
  assert.equal(restored.cards[0].group_assignment_revision,4)
  assert.throws(() => sql('update cards set group_assignment_revision=0'))

  restore('cards',original.cards,true)
  assert.equal(snapshot().cards[0].group_assignment_revision,5)
  restore('card_group_assignments',original.card_group_assignments.slice(0,1),true)
  assert.equal(snapshot().card_group_assignments.length,2)
  assert.throws(() => sql(`select set_territory_group_assignments_tx('00000000-0000-0000-0000-000000000001','a',array[10],'remove','{"10":"4"}')`))

  const beforeFailure = snapshot()
  assert.throws(() => restore('cards',[...original.cards,{...original.cards[0],id:null}],true))
  assert.deepEqual(snapshot(),beforeFailure)
  assert.equal(sql("select tgenabled from pg_trigger where tgname='guard_territory_group_revision'"),'O')
  assert.throws(() => sql(`set local role authenticated;${restoreGroupTableSql('cards',original.cards,true)}`))
  assert.throws(() => sql("set local role authenticated;set local app.territory_group_revision_write='on';update cards set group_assignment_revision=6"))

  const output = { localOnly:true, version:sql('show server_version'), legacyRestoreRejected:true,
    sharedLinksAndAttributionRestored:true, revisionMonotonic:true, staleSaveRejected:true,
    failedTransactionRolledBack:true, guardEnabled:true, ordinaryWriterBlocked:true,
    scope:'Group tables and actual directory/revision migrations; not a full application recovery rehearsal.' }
  writeFileSync('scratch/group-territory-restore.json',JSON.stringify(output,null,2))
  console.log(JSON.stringify(output))
} finally {
  if (started) command('pg_ctl',['-D',data,'-m','immediate','-w','stop'])
  rmSync(root,{recursive:true,force:true})
}
