import assert from 'node:assert/strict'
import { readFileSync,writeFileSync,mkdirSync } from 'node:fs'
import { parseEnv } from 'node:util'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { assignmentInventorySql,assertAssignmentInventory } from './assignmentDefinerInventory.mjs'

process.umask(0o077)
const mode=process.argv[2]
assert.ok(['apply','test','rollback-test'].includes(mode));assert.ok(process.argv.includes('--confirm-demo'))
const config=parseEnv(readFileSync(process.env.DEMO_ENV_FILE,'utf8')),project='itjlykpjmlcvanqpmkmc'
const db=new URL(config.SUPABASE_DB_URL)
assert.equal(config.VITE_SUPABASE_URL,`https://${project}.supabase.co`)
assert.equal(decodeURIComponent(db.username),`postgres.${project}`)
assert.ok(db.hostname.endsWith('.pooler.supabase.com'));assert.equal(db.port,'5432')
const env={...process.env,PGHOST:db.hostname,PGPORT:db.port,PGUSER:decodeURIComponent(db.username),PGDATABASE:db.pathname.slice(1),PGPASSWORD:decodeURIComponent(db.password),PGSSLMODE:'require',PGCONNECT_TIMEOUT:'15',PGOPTIONS:'-c lock_timeout=3000 -c statement_timeout=30000'}
function run(command,args,input){const r=spawnSync(command,args,{env,input,encoding:'utf8',maxBuffer:128*1024*1024});if(r.error||r.status)throw r.error??Error(r.stderr);return r.stdout.trim()}
const sql=input=>run('psql',['-X','-qAt','-v','ON_ERROR_STOP=1'],input)
const q=s=>`'${String(s).replaceAll("'","''")}'`
if(mode==='apply'){
  assert.equal(sql("select to_regclass('private.assignment_rollout') is null"),'t')
  assertAssignmentInventory(JSON.parse(sql(assignmentInventorySql)))
  const dir=resolve('backups',`group-rollout-demo-${Date.now()}`);mkdirSync(dir,{recursive:true})
  const dump=resolve(dir,'before.dump')
  run('pg_dump',['--format=custom','--no-owner','--schema=public','--schema=private','--file',dump])
  run('pg_restore',['--list',dump])
  const signatures=['public.apply_service_activity_tx(uuid,integer,text)','public.manage_event_participant_versioned_tx(uuid,integer,text,text,bigint,text)','private.service_event_notify(jsonb,integer[],integer,integer[])','private.track_assignment_revision()']
  const old=signatures.map(s=>sql(`select pg_get_functiondef(${q(s)}::regprocedure)`)+';').join('\n')
  writeFileSync(resolve(dir,'rollback.sql'),`${old}
    drop policy service_session_owner_delete on public.service_sessions;
    create policy service_session_owner_delete on public.service_sessions as restrictive for delete using ((select private.request_is_admin()) or user_name=(select private.request_session_user_name()));
    drop function public.remove_service_participant_compat_tx(uuid,integer,text,boolean,text);
    drop function private.service_cart_user_ids(integer[]);
    drop function private.set_assignment_rollout_phase(text,text);
    drop function private.assignment_compat_session_cleanup(integer,text);
    drop function private.assignment_writes_strict();
    drop table private.assignment_rollout;
    notify pgrst,'reload schema';
  `)
  run('psql',['-X','-v','ON_ERROR_STOP=1','--single-transaction','-f','supabase/migrations/20261117_1600_optional_cart_service_contract.sql','-f','supabase/migrations/20261117_1700_assignment_rollout_control.sql'])
  assert.equal(sql('select phase from private.assignment_rollout'),'strict')
  assertAssignmentInventory(JSON.parse(sql(assignmentInventorySql)))
  console.log(JSON.stringify({project,backup:dir,phase:'strict',applied:true}));process.exit()
}

assert.equal(sql('select phase from private.assignment_rollout'),'strict')
if(mode==='rollback-test'){
  const dir=resolve(process.env.DEMO_ROLLOUT_BACKUP??'')
  assert.ok(dir.startsWith(resolve('backups')+'/group-rollout-demo-'))
  const before=sql("select md5(string_agg(pg_get_functiondef(p.oid),'' order by p.oid::regprocedure::text)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private') and p.proname in ('track_assignment_revision','apply_service_activity_tx','manage_event_participant_versioned_tx','service_event_notify')")
  sql(`begin;${readFileSync(resolve(dir,'rollback.sql'),'utf8')}
    do $$begin if to_regclass('private.assignment_rollout') is not null then raise exception 'Rollback failed';end if;end$$;
    ${readFileSync('supabase/migrations/20261117_1600_optional_cart_service_contract.sql','utf8')}
    ${readFileSync('supabase/migrations/20261117_1700_assignment_rollout_control.sql','utf8')}
    do $$begin if (select phase from private.assignment_rollout)<>'strict' then raise exception 'Reapply failed';end if;end$$;
    rollback;`)
  const after=sql("select md5(string_agg(pg_get_functiondef(p.oid),'' order by p.oid::regprocedure::text)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private') and p.proname in ('track_assignment_revision','apply_service_activity_tx','manage_event_participant_versioned_tx','service_event_notify')")
  assert.equal(after,before);assertAssignmentInventory(JSON.parse(sql(assignmentInventorySql)))
  console.log(JSON.stringify({project,rollbackArtifact:true,reapply:true,finalDefinitionsUnchanged:true,rolledBack:true}));process.exit()
}
const f=JSON.parse(readFileSync('scratch/group-tabs-fixture.json','utf8'))
assert.ok(f.actors.every(a=>a.name.startsWith('gt_demo_')))
const leader=f.actors[0],other=f.actors[1],member=f.actors[4]
const headers=a=>`select set_config('request.headers',${q(JSON.stringify({'x-session-token':a.token}))},true);`
const payload=JSON.stringify([{userName:member.name,teamKey:'rollout',cardIds:[f.cardIds[0]],cardScope:'전체',informalAssetIds:[]}])
const checks=sql(`begin;
set local app.suppress_notifications='on';
create function pg_temp.expect(b boolean,label text) returns void language plpgsql as $$begin if b is distinct from true then raise exception 'FAILED %',label;end if;end$$;
create temp table check_results(label text);
create function pg_temp.record(b boolean,label text) returns void language plpgsql as $$begin perform pg_temp.expect(b,label);insert into check_results values(label);end$$;
create temp table ctx(eid integer,r bigint);
with e as(insert into calendar_events(event_date,time,title,leader_name)values('2099-11-18','14:30','rollout_rollback_only',${q(leader.name)})returning id)insert into ctx(eid)select id from e;
${headers(member)}
select apply_service_activity_tx(${q(member.token)},eid,'service') from ctx;
select private.set_assignment_rollout_phase('compatibility','Demo rollback-only transition rehearsal with synthetic accounts');
${headers(leader)}
grant select,update on ctx to anon;
grant insert on check_results to anon;
set local role anon;
select pg_temp.record((assign_team_service_bulk_tx(${q(leader.token)},eid,${q(payload)},null,null)->>'ok')::boolean,'legacy save works during compatibility') from ctx;
update ctx set r=(select assignment_revision(e) from calendar_events e where e.id=ctx.eid);
select assign_team_service_bulk_tx(${q(leader.token)},eid,${q(payload)},null,null) from ctx;
select pg_temp.record((save_event_assignments_versioned_tx(${q(other.token)},eid,${q(payload)},r,null,null)->>'conflict')::boolean,'legacy change invalidates new editor version')from ctx;
reset role;
select private.set_assignment_rollout_phase('strict','Demo strict phase after simulated client transition review');
select pg_temp.record(not has_function_privilege('anon','public.assign_team_service_bulk_tx(uuid,integer,jsonb,text,text)','execute'),'old bulk endpoint closed in strict');
select pg_temp.record(not has_function_privilege('anon','public.remove_service_participant_compat_tx(uuid,integer,text,boolean,text)','execute'),'compat removal endpoint closed in strict');
${headers(other)}set local role anon;
update ctx set r=(select assignment_revision(e) from calendar_events e where e.id=ctx.eid);
select pg_temp.record((save_event_assignments_versioned_tx(${q(other.token)},eid,${q(payload)},r,null,null)->>'ok')::boolean,'new save works after strict switch')from ctx;
select pg_temp.record((save_event_assignments_versioned_tx(${q(leader.token)},eid,${q(payload)},r,null,null)->>'conflict')::boolean,'same draft revision cannot overwrite after switch')from ctx;
reset role;
select private.set_assignment_rollout_phase('compatibility','Demo rollback retains all new revisions and assignment data');
${headers(leader)}set local role anon;
select pg_temp.record((remove_service_participant_compat_tx(${q(leader.token)},eid,${q(member.name)},false,null)->>'ok')::boolean,'compat rollback permits atomic generic removal')from ctx;
reset role;
select pg_temp.record(not exists(select 1 from event_card_assignments where event_id=ctx.eid),'atomic removal cleaned assignment')from ctx;
select pg_temp.record(not has_function_privilege('anon','private.set_assignment_rollout_phase(text,text)','execute') and not has_function_privilege('authenticated','private.service_cart_user_ids(integer[])','execute'),'operator and optional-cart helpers inaccessible to app');
select 'RESULT:'||json_agg(label)::text from check_results;
rollback;`)
const line=checks.split('\n').find(s=>s.startsWith('RESULT:'))
assert.ok(line)
const inventory=assertAssignmentInventory(JSON.parse(sql(assignmentInventorySql)))
assert.equal(sql('select phase from private.assignment_rollout'),'strict')
const report={project,checks:JSON.parse(line.slice(7)),inventoryCount:inventory.length,phaseAfter:'strict',rolledBack:true,at:new Date().toISOString()}
writeFileSync('scratch/group-rollout-demo-results.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report))
