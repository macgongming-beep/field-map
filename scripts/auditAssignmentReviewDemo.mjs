import assert from 'node:assert/strict'
import {readFileSync,writeFileSync} from 'node:fs'
import {parseEnv} from 'node:util'
import {spawnSync} from 'node:child_process'
import {assignmentInventorySql,assertAssignmentInventory} from './assignmentDefinerInventory.mjs'
const config=parseEnv(readFileSync(process.env.DEMO_ENV_FILE,'utf8'))
const db=new URL(config.SUPABASE_DB_URL)
assert.equal(config.VITE_SUPABASE_URL,'https://itjlykpjmlcvanqpmkmc.supabase.co')
assert.equal(decodeURIComponent(db.username),'postgres.itjlykpjmlcvanqpmkmc')
assert.ok(db.hostname.endsWith('.pooler.supabase.com'));assert.equal(db.port,'5432')
const env={...process.env,PGHOST:db.hostname,PGPORT:db.port,PGUSER:decodeURIComponent(db.username),PGDATABASE:db.pathname.slice(1),PGPASSWORD:decodeURIComponent(db.password),PGSSLMODE:'require',PGCONNECT_TIMEOUT:'15'}
const sql=input=>{
  const r=spawnSync('psql',['-X','-qAt','-v','ON_ERROR_STOP=1'],{env,input,encoding:'utf8'})
  if(r.status)throw Error(r.stderr)
  return r.stdout.trim()
}
const quote=s=>`'${s.replaceAll("'","''")}'`
const fixture=JSON.parse(readFileSync('scratch/group-tabs-fixture.json','utf8'))
// The normal security audit includes pre-existing endpoints; persist it locally only.
const audit=sql(readFileSync('supabase/tools/_AUDIT_anon이_부를수있는_definer.sql','utf8'))
writeFileSync('scratch/assignment-review-definer-audit.txt',audit,{mode:0o600})
const plans=[]
for(const actor of [fixture.actors[0],fixture.actors[5]])for(const table of ['event_card_assignments','service_sessions']){
  const result=JSON.parse(sql(`begin;set local role anon;set local request.headers=${quote(JSON.stringify({'x-session-token':actor.token}))};explain(analyze,buffers,format json) select * from public.${table};rollback;`))[0]
  plans.push({role:actor.role,table,visibleRows:result.Plan['Actual Rows'],executionMs:result['Execution Time']})
}
const grants=JSON.parse(sql(`select json_agg(x) from (select p.proname,has_function_privilege('anon',p.oid,'execute') as anon_execute from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.proname in ('save_event_assignments_versioned_tx','manage_event_participant_versioned_tx','mutate_personal_assignment_versioned_tx','rename_user_name_references_before_assignment_guard','purge_user_name_references_before_assignment_guard','user_can_edit_event','track_assignment_revision','assign_team_service_bulk_tx','assign_scoped_cards_bulk_tx','assign_cards_bulk_tx','remove_team_event_participant_tx') and n.nspname in ('public','private') order by p.proname)x;`))
for(const grant of grants)assert.equal(grant.anon_execute,['save_event_assignments_versioned_tx','manage_event_participant_versioned_tx','mutate_personal_assignment_versioned_tx'].includes(grant.proname),grant.proname)
const inventory=assertAssignmentInventory(JSON.parse(sql(assignmentInventorySql)))
const report={project:'itjlykpjmlcvanqpmkmc',plans,grants,inventory,note:'Demo data only. Not a production-scale performance result.'}
writeFileSync('scratch/assignment-review-audit.json',JSON.stringify(report,null,2))
console.log(JSON.stringify(report))
