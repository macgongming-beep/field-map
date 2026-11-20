import assert from 'node:assert/strict'
import { mkdtempSync, cpSync, symlinkSync, readFileSync, writeFileSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const root=process.cwd(), directory=mkdtempSync(join(tmpdir(),'group-backup-mutations-')), results=[]
const helper='scripts/groupTerritoryBackup.mjs'
try {
  for(const path of ['src','scripts','supabase','package.json','vitest.config.ts']) cpSync(path,join(directory,path),{recursive:true})
  mkdirSync(join(directory,'scratch'))
  symlinkSync(join(root,'node_modules'),join(directory,'node_modules'),'dir')
  const run=()=>spawnSync(process.execPath,[join(root,'node_modules/vitest/vitest.mjs'),'run','src/features/groupTerritory/backup.sql.test.ts','--reporter=json'],{cwd:directory,encoding:'utf8',timeout:120000,maxBuffer:16*1024*1024})
  const baseline=run();assert.equal(baseline.status,0,baseline.stdout+baseline.stderr)
  for(const [name,file,before,after] of [
    ['backup omits links','scripts/backup.js',"  'card_group_assignments',",''],
    ['users restored before groups','scripts/restore.js',"  'service_groups', // Membership validation needs the directory before app_users.","  'app_users', 'service_groups',"],
    ['restore leaves guard enabled',helper,'alter table public.cards disable trigger guard_territory_group_revision;',''],
    ['restore forgets to reenable guard',helper,'alter table public.cards enable trigger guard_territory_group_revision;',''],
    ['revision rolls back',helper,'greatest(target.${quote(column)},excluded.${quote(column)})+1','excluded.${quote(column)}'],
    ['restoration overwrites missing-only rows',helper,'replace && updates.length','updates.length'],
    ['directory membership left stale',helper,'u.group_name is distinct from (case when g.is_active then g.display_name else null end)','false'],
    ['incomplete backup accepted',helper,'if (!featureInstalled) return','if (true) return'],
  ]) {
    const path=join(directory,file),original=readFileSync(path,'utf8')
    assert.equal(original.split(before).length,2,name)
    writeFileSync(path,original.replace(before,after))
    const result=run();writeFileSync(path,original)
    assert.equal(result.status,1,`${name}: ${result.stderr}`)
    const report=JSON.parse(result.stdout);assert.ok(report.numFailedTests>0,name)
    results.push({name,failedTests:report.numFailedTests})
  }
} finally {rmSync(directory,{recursive:true,force:true})}
writeFileSync('scratch/group-territory-backup-mutations.json',JSON.stringify(results,null,2))
console.log(JSON.stringify(results))
