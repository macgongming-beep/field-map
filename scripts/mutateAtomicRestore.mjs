import assert from 'node:assert/strict'
import { mkdtempSync, cpSync, symlinkSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const root=process.cwd(), copy=mkdtempSync(join(tmpdir(),'atomic-restore-mutations-')), results=[]
try {
  for(const path of ['src','scripts','supabase','package.json','vitest.config.ts']) cpSync(path,join(copy,path),{recursive:true})
  symlinkSync(join(root,'node_modules'),join(copy,'node_modules'),'dir')
  const run=()=>spawnSync(process.execPath,[join(root,'node_modules/vitest/vitest.mjs'),'run',
    'src/features/groupTerritory/atomicRestore.sql.test.ts','src/features/groupTerritory/backupCommands.test.ts','--reporter=json'],
  {cwd:copy,encoding:'utf8',timeout:120000,maxBuffer:16*1024*1024})
  const baseline=run();assert.equal(baseline.status,0,baseline.stdout+baseline.stderr)
  const helper='scripts/atomicRestore.mjs'
  for(const [name,file,before,after] of [
    ['identity override removed',helper,'overriding system value',''],
    ['restore replays side effects',helper,"execute format('alter table %s disable trigger %I',r.tgrelid::regclass,r.tgname);",'null;'],
    ['trigger state not restored',helper,"case r.tgenabled when 'D' then 'disable' when 'A' then 'enable always' when 'R' then 'enable replica' else 'enable' end","'disable'"],
    ['sequence restart omitted',helper,"execute format('alter sequence %s restart with %s',r.seq,greatest(high,previous)+1);",'null;'],
    ['sequence update is not transactional',helper,"execute format('alter sequence %s restart with %s',r.seq,greatest(high,previous)+1);","perform setval(r.seq,greatest(high,previous)+1,false);"],
    ['sequence goes backwards',helper,'greatest(high,previous)+1','high+1'],
    ['foreign key checks bypassed',helper,'select pg_advisory_xact_lock(20261118,2300);',"set local session_replication_role=replica;select pg_advisory_xact_lock(20261118,2300);"],
    ['missing business backup accepted',helper,'${full ? requiredTables.map','${false ? requiredTables.map'],
    ['card revision rewound',helper,'greatest(target.group_assignment_revision,excluded.group_assignment_revision)+1','excluded.group_assignment_revision'],
    ['assignment revision not advanced',helper,'revision=private.event_assignment_revisions.revision+1','revision=private.event_assignment_revisions.revision'],
    ['plaintext PIN accepted',helper,"table === 'app_users' && rows.some",'false && rows.some'],
    ['maintenance acknowledgement removed','scripts/restore.js',"if (!args.includes('--maintenance'))",'if (false)'],
    ['new business snapshot bypassed','scripts/backup.js','const result = OWNER_BACKUP_TABLES.includes(t)','const result = false'],
  ]) {
    const path=join(copy,file),original=readFileSync(path,'utf8')
    assert.equal(original.split(before).length,2,name)
    writeFileSync(path,original.replace(before,after))
    const result=run();writeFileSync(path,original)
    assert.equal(result.status,1,`${name}: mutation survived`)
    const report=JSON.parse(result.stdout);assert.ok(report.numFailedTests>0,name)
    results.push({name,failedTests:report.numFailedTests})
  }
} finally {rmSync(copy,{recursive:true,force:true})}
writeFileSync('scratch/atomic-restore-mutations.json',JSON.stringify(results,null,2))
console.log(JSON.stringify(results))
