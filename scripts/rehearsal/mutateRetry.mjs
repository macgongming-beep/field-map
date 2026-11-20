import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, cpSync, readFileSync, writeFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { spawnSync } from 'node:child_process'

process.umask(0o077)
const copy=mkdtempSync(join(tmpdir(),'recovery-retry-mutation-'))
try{
  for(const file of ['package.json','scripts/restore.js','scripts/groupTerritoryBackup.mjs','scripts/rehearseProductionBackup.mjs',
    'scripts/rehearsal/localRestoreAdapter.mjs','scripts/rehearsal/offlineRestoreHooks.mjs',
    'supabase/migrations/20261119_0010_service_series_edit_targets.sql',
    'backups/2026-11-20','backups/service-series-production/before.dump']){
    mkdirSync(dirname(join(copy,file)),{recursive:true});cpSync(file,join(copy,file),{recursive:true})
  }
  const path=join(copy,'scripts/rehearsal/localRestoreAdapter.mjs')
  const original=readFileSync(path,'utf8'),needle='on conflict (${keys.map(identifier).join(\',\')}) ${action};'
  assert.equal(original.split(needle).length,2)
  writeFileSync(path,original.replace(needle,';'))
  const result=spawnSync(process.execPath,['scripts/rehearseProductionBackup.mjs'],{
    cwd:copy,env:{PATH:process.env.PATH,HOME:process.env.HOME,REHEARSAL_PG_BIN:process.env.REHEARSAL_PG_BIN},
    encoding:'utf8',timeout:180000,maxBuffer:8*1024*1024,
  })
  assert.equal(result.status,1)
  const output=join(copy,'backups',readdirSync(join(copy,'backups')).find(name=>name.startsWith('recovery-rehearsal-')))
  const report=JSON.parse(readFileSync(join(output,'report.json'),'utf8'))
  assert.equal(report.completed,false);assert.equal(report.localClusterRemoved,true)
  const calls=readFileSync(join(output,'partial_retry-attempts.jsonl'),'utf8').trim().split('\n').map(line=>JSON.parse(line))
  assert.ok(calls.some(call=>call.table==='units'&&call.sqlstate==='23505'))
  console.log(JSON.stringify({mutation:'remove conflict handling',caught:true,stage:'partial retry',sqlstate:'23505',productionAccess:false}))
}finally{rmSync(copy,{recursive:true,force:true})}
