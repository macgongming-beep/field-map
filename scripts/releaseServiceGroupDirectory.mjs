import assert from 'node:assert/strict'
import {readFileSync,writeFileSync,mkdirSync,chmodSync,statSync,cpSync} from 'node:fs'
import {parseEnv} from 'node:util'
import {spawnSync} from 'node:child_process'
import {createHash} from 'node:crypto'
import {resolve} from 'node:path'
import {assignmentInventorySql,assertAssignmentInventory} from './assignmentDefinerInventory.mjs'

const project='prj_cdo2L78J2YEEaBgxMMnNDfA5BDZs',team='team_x5DMFAR7DAqaqjoochn7Af5q'
const ref='qdxemvdorasoryfysuoq',dir=resolve('backups/nov18-service-directory-release')
const migration='supabase/migrations/20261118_2300_service_group_directory.sql'
const hash=()=>createHash('sha256').update(readFileSync(migration)).digest('hex')
const run=(cmd,args,options={})=>{const r=spawnSync(cmd,args,{encoding:'utf8',maxBuffer:24*1024*1024,...options});if(r.error||r.status)throw Error(r.error?.message??r.stderr);return r.stdout.trim()}
const api=path=>JSON.parse(run('vercel',['api',`${path}${path.includes('?')?'&':'?'}teamId=${team}`]))
const save=(name,value)=>writeFileSync(`${dir}/${name}`,JSON.stringify(value,null,2),{mode:0o600})
const config=parseEnv(readFileSync('../chinese-territory-app/.env.local','utf8')),db=new URL(config.SUPABASE_DB_URL)
assert.equal(decodeURIComponent(db.username),`postgres.${ref}`)
const env={...process.env,PGHOST:db.hostname,PGPORT:db.port||'5432',PGDATABASE:db.pathname.slice(1),PGUSER:decodeURIComponent(db.username),PGPASSWORD:decodeURIComponent(db.password),PGSSLMODE:'require',PGCONNECT_TIMEOUT:'15'}
const sql=q=>run('psql',['-X','-At','-v','ON_ERROR_STOP=1'],{env,input:q})
const protectedTables=['calendar_events','event_participants','event_card_assignments','event_card_assignment_cards','event_meeting_access']
const guards=['save_service_events_tx','guard_service_event','guard_group_service_scope','get_group_service_context','can_read_group_service_row','can_read_group_assignment']
const snapshot=()=>JSON.parse(sql(`begin read only;select jsonb_build_object(
  'installed',to_regprocedure('public.manage_service_group_tx(uuid,text,text,text,bigint)') is not null,
  'groups',(select jsonb_agg(to_jsonb(g) order by code) from public.service_groups g),
  'configured',(select value from public.app_settings where key='user_groups'),
  'memberships',(select jsonb_agg(x) from (select group_name,count(*) from public.app_users group by group_name order by group_name)x),
  'directory',(select value from public.app_settings where key='service_group_directory'),
  'guards',(select jsonb_agg(jsonb_build_array(n.nspname,p.proname,md5(pg_get_functiondef(p.oid))) order by n.nspname,p.proname)
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('private','public') and p.proname=any(array[${guards.map(s=>`'${s}'`).join(',')}])),
  'tables',jsonb_build_object(${protectedTables.map(t=>`'${t}',(select md5(coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text)::text,'[]')) from public.${t} x)`).join(',')}),
  'slotIndex',to_regclass('public.group_service_scope_slot') is not null
);rollback;`).split('\n').find(line=>line.startsWith('{')))
function audit(){const rows=JSON.parse(sql(assignmentInventorySql));const phase=rows.find(r=>r.signature.startsWith('public.assign_team_service_bulk_tx('))?.anon_execute?'compatibility':'strict';assertAssignmentInventory(rows,{environment:'production',phase});return {count:rows.length,phase}}
function checkInstalled(){
  assert.equal(sql("select to_regprocedure('public.manage_service_group_tx(uuid,text,text,text,bigint)') is not null"),'t')
  assert.equal(sql(`select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private'
    and p.proname in('publish_service_group_directory','guard_user_group_membership','guard_active_service_targets','guard_group_directory_settings')
    and (has_function_privilege('anon',p.oid,'execute') or has_function_privilege('authenticated',p.oid,'execute'))`),'0')
  assert.equal(sql("select count(*) from app_users u where nullif(btrim(group_name),'') is not null and not exists(select 1 from service_groups g where g.is_active and g.display_name=u.group_name)"),'0')
}
const mode=process.argv[2]
if(mode==='inspect'){
  mkdirSync(`${dir}/reader/.vercel`,{recursive:true,mode:0o700});chmodSync(dir,0o700)
  const p=api(`/v9/projects/${project}`);assert.equal(p.name,'chinese-territory-app');save('project-before.json',p)
  writeFileSync(`${dir}/reader/.vercel/project.json`,JSON.stringify({projectId:project,orgId:team,projectName:p.name}),{mode:0o600})
  run('vercel',['env','pull',`${dir}/production.env.local`,'--environment','production','--yes'],{cwd:`${dir}/reader`});chmodSync(`${dir}/production.env.local`,0o600)
  const flags=parseEnv(readFileSync(`${dir}/production.env.local`,'utf8'))
  assert.equal(flags.VITE_GROUP_SERVICE_ENABLED,'true');assert.equal(flags.VITE_ASSIGNMENT_REVISION_ENABLED,'true')
  assert.notEqual(flags.VITE_CALENDAR_METADATA_REFRESH_ENABLED,'true')
  const alias=JSON.parse(run('vercel',['inspect','https://chinese-territory-app.vercel.app','--json']))
  const deployment=api(`/v13/deployments/${alias.id}`);assert.equal(deployment.projectId,project);assert.equal(deployment.readyState,'READY')
  save('deployment-before.json',deployment)
  const state=snapshot();assert.equal(state.installed,false);assert.equal(state.slotIndex,true);assert.equal(state.guards.length,guards.length)
  save('database-before.json',state);save('manifest.json',{project,ref,migration,sha256:hash(),createdAt:new Date().toISOString()})
  console.log(JSON.stringify({deployment:alias.id,commit:deployment.meta.githubCommitSha,groups:state.groups,configured:state.configured,memberships:state.memberships,inventory:audit(),metadataOptimization:false,backupDirectory:dir}))
}else if(mode==='build-demo'){
  const production=parseEnv(readFileSync(`${dir}/production.env.local`,'utf8'))
  const demo=parseEnv(readFileSync('../chinese-territory-app/.env.test.local','utf8')),push=parseEnv(readFileSync('scratch/nov18-demo.env.local','utf8'))
  assert.equal(demo.VITE_SUPABASE_URL,'https://itjlykpjmlcvanqpmkmc.supabase.co')
  const flags={...Object.fromEntries(Object.entries(production).filter(([k])=>k.startsWith('VITE_'))),VITE_SUPABASE_URL:demo.VITE_SUPABASE_URL,VITE_SUPABASE_ANON_KEY:demo.VITE_SUPABASE_ANON_KEY,VITE_APP_URL:'https://chinese-territory-app-demo.vercel.app',VITE_SENTRY_DSN:'',VITE_VAPID_PUBLIC_KEY:push.VITE_VAPID_PUBLIC_KEY}
  assert.notEqual(flags.VITE_CALENDAR_METADATA_REFRESH_ENABLED,'true')
  const buildEnv={...Object.fromEntries(Object.entries(process.env).filter(([k])=>!k.startsWith('VITE_')&&!k.startsWith('SENTRY_'))),...flags}
  run('npm',['run','build','--','--outDir','scratch/dist-directory-release'],{env:buildEnv})
  const stage='scratch/directory-release-demo';mkdirSync(`${stage}/.vercel/output`,{recursive:true})
  cpSync('scratch/dist-directory-release',`${stage}/.vercel/output/static`,{recursive:true})
  const demoProject=JSON.parse(readFileSync('.vercel/project.json'));assert.equal(demoProject.projectId,'prj_txJm1ruq4OiRnZi3cjz9IXLkGKPG')
  writeFileSync(`${stage}/.vercel/project.json`,JSON.stringify(demoProject))
  writeFileSync(`${stage}/.vercel/output/config.json`,JSON.stringify({version:3,routes:[{handle:'filesystem'},{src:'/.*',dest:'/index.html'}]}))
  console.log(JSON.stringify({build:'passed',productionFlags:true,database:'demo',stage}))
}else if(mode==='apply-db'){
  assert.ok(process.argv.includes('--confirm-production'))
  const manifest=JSON.parse(readFileSync(`${dir}/manifest.json`));assert.equal(manifest.ref,ref);assert.equal(manifest.sha256,hash())
  const before=snapshot();assert.equal(before.installed,false)
  assert.deepEqual(before,JSON.parse(readFileSync(`${dir}/database-before.json`)),'Production changed since inspection; inspect again')
  const backup=`${dir}/before.dump`;assert.ok(!process.argv.includes('--skip-backup'))
  run('pg_dump',['--format=custom','--no-owner','--schema=public','--schema=private','--file',backup],{env});chmodSync(backup,0o600)
  assert.ok(statSync(backup).size>0);run('pg_restore',['--list',backup])
  const source=readFileSync(migration,'utf8')
  sql(`begin;set local lock_timeout='5s';set local statement_timeout='60s';${source}rollback;`)
  assert.deepEqual(snapshot(),before,'Rehearsal left data changed')
  run('psql',['-X','-v','ON_ERROR_STOP=1','--single-transaction','-c',"set local lock_timeout='5s';set local statement_timeout='60s'",'-f',migration],{env})
  checkInstalled();const after=snapshot();assert.deepEqual(after.tables,before.tables);assert.deepEqual(after.guards,before.guards)
  save('database-after.json',after);save('applied.json',{...manifest,appliedAt:new Date().toISOString(),backup,inventory:audit()})
  console.log(JSON.stringify({applied:true,backup,unchangedBusinessTables:protectedTables,unchangedExistingFunctions:guards,groups:JSON.parse(after.directory).groups,inventory:audit()}))
}else if(mode==='verify-release'){
  const sha=process.argv[3];assert.match(sha,/^[a-f0-9]{40}$/);checkInstalled()
  const before=JSON.parse(readFileSync(`${dir}/project-before.json`))
  const after=api(`/v9/projects/${project}`)
  const envSignature=p=>p.env.map(e=>[e.id,e.key,e.value,e.target]).sort((a,b)=>a[0].localeCompare(b[0]))
  const envHash=p=>createHash('sha256').update(JSON.stringify(envSignature(p))).digest('hex')
  assert.equal(envHash(after),envHash(before),'Production environment changed')
  for(let i=0;i<60;i++){
    const alias=JSON.parse(run('vercel',['inspect','https://chinese-territory-app.vercel.app','--json']))
    const d=api(`/v13/deployments/${alias.id}`)
    assert.equal(d.projectId,project)
    if(d.meta?.githubCommitSha===sha&&d.readyState==='READY'){
      save('deployment-after.json',d);console.log(JSON.stringify({ready:true,id:d.id,sha,alias:'https://chinese-territory-app.vercel.app',environmentUnchanged:true,inventory:audit()}));process.exit(0)
    }
    await new Promise(r=>setTimeout(r,5000))
  }
  throw Error('Expected release is not READY on the production alias')
}else throw Error('Choose inspect, build-demo, apply-db --confirm-production or verify-release SHA')
