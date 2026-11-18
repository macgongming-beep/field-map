import assert from 'node:assert/strict'
import {readFileSync,writeFileSync,mkdirSync,chmodSync} from 'node:fs'
import {parseEnv} from 'node:util'
import {spawnSync} from 'node:child_process'
import {createHash} from 'node:crypto'
import {assignmentInventorySql,assertAssignmentInventory} from './assignmentDefinerInventory.mjs'

const environment=process.argv[2],action=process.argv[3]
assert.ok(['demo','production'].includes(environment))
const ref=environment==='demo'?'itjlykpjmlcvanqpmkmc':'qdxemvdorasoryfysuoq'
const config=parseEnv(readFileSync(`../chinese-territory-app/.env.${environment==='demo'?'test.local':'local'}`,'utf8'))
const url=new URL(config.SUPABASE_DB_URL)
assert.equal(decodeURIComponent(url.username),`postgres.${ref}`)
const env={...process.env,PGHOST:url.hostname,PGPORT:url.port||'5432',PGDATABASE:url.pathname.slice(1),PGUSER:decodeURIComponent(url.username),PGPASSWORD:decodeURIComponent(url.password),PGSSLMODE:'require',PGCONNECT_TIMEOUT:'15'}
const migration='supabase/migrations/20261119_0010_service_series_edit_targets.sql',source=readFileSync(migration,'utf8')
const hash=createHash('sha256').update(source).digest('hex'),dir=`backups/service-series-${environment}`
mkdirSync(dir,{recursive:true,mode:0o700})
const run=(cmd,args,input)=>{const r=spawnSync(cmd,args,{env,input,encoding:'utf8',maxBuffer:30*1024*1024});if(r.error||r.status)throw Error(r.error?.message??r.stderr);return r.stdout.trim()}
const sql=q=>run('psql',['-X','-At','-v','ON_ERROR_STOP=1'],q)
const save=(file,value)=>writeFileSync(`${dir}/${file}`,JSON.stringify(value,null,2),{mode:0o600})
const fingerprint=()=>{const value=sql(`begin read only;select md5(jsonb_build_array(${['calendar_events','event_participants','event_card_assignments','event_card_assignment_cards','event_meeting_access','app_settings'].map(t=>`(select jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text) from public.${t} t)`).join(',')})::text);rollback;`).split('\n')[1];assert.match(value,/^[a-f0-9]{32}$/);return value}
const inventory=()=>{const rows=JSON.parse(sql(assignmentInventorySql));const phase=rows.find(r=>r.signature.startsWith('public.assign_team_service_bulk_tx('))?.anon_execute?'compatibility':'strict';assertAssignmentInventory(rows,{environment,phase});return {count:rows.length,phase}}
if(action==='apply'){
  assert.ok(process.argv.includes(`--confirm-${environment}`))
  if(environment==='production')assert.equal(JSON.parse(readFileSync('backups/service-series-demo/verified.json')).hash,hash)
  assert.equal(sql("select to_regprocedure('public.read_service_series_edit_targets(uuid,jsonb)') is null"),'t','Already installed; do not repeat migration')
  const before=fingerprint();save('before.json',{ref,migration,hash,before,inventory:inventory()})
  const backup=`${dir}/before.dump`
  run('pg_dump',['--format=custom','--no-owner','--schema=public','--schema=private','--file',backup]);chmodSync(backup,0o600)
  run('pg_restore',['--list',backup])
  sql(`begin;set local lock_timeout='5s';set local statement_timeout='60s';${source}rollback;`)
  assert.equal(fingerprint(),before)
  run('psql',['-X','-v','ON_ERROR_STOP=1','--single-transaction','-c',"set local lock_timeout='5s';set local statement_timeout='60s'",'-f',migration])
  assert.equal(fingerprint(),before)
  assert.equal(sql("select has_function_privilege('anon','public.read_service_series_edit_targets(uuid,jsonb)','execute')"),'t')
  save('applied.json',{hash,backup,appliedAt:new Date().toISOString(),inventory:inventory()})
  console.log(JSON.stringify({environment,applied:true,businessDataUnchanged:true,inventory:inventory(),backup}))
}else if(action==='verify'){
  assert.equal(environment,'demo','Write tests are demo only')
  const before=fingerprint()
  sql(`begin;set local app.suppress_notifications='on';
    do $$declare actor int; token uuid; begin
      select id into strict actor from app_users where role='admin' and is_active and approval_status='approved' order by id limit 1;
      insert into auth_sessions(user_id,device_label) values(actor,'series-rollback-check') returning auth_sessions.token into token;
      perform set_config('test.admin',token::text,true);
      select id into strict actor from app_users where role='leader' and is_active and approval_status='approved' order by id limit 1;
      insert into auth_sessions(user_id,device_label) values(actor,'series-rollback-check') returning auth_sessions.token into token;
      perform set_config('test.leader',token::text,true);
    end $$;
    set local role anon;
    do $$declare base jsonb; series uuid:=gen_random_uuid(); ids jsonb; roots jsonb; rows jsonb; result jsonb;
      request uuid:=gen_random_uuid(); begin
      perform set_config('request.headers',jsonb_build_object('x-session-token',current_setting('test.admin'))::text,true);
      base:=jsonb_build_object('event_date','2098-11-18','time','12:01','end_time','13:01','title','Series rollback check',
        'service_kind','group','group_service_scope',true,'target_groups',jsonb_build_array('dongtan'),
        'meeting_mode','virtual','leader_name','','allow_applications',true,'series_id',series,
        'access',jsonb_build_object('joinUrl','','meetingNumber','123','passcode','rollback-only'));
      result:=save_service_events_tx(current_setting('test.admin')::uuid,jsonb_build_array(
        jsonb_build_object('payload',base),jsonb_build_object('payload',base||'{"event_date":"2098-11-25"}'),
        jsonb_build_object('payload',base||'{"event_date":"2098-12-02"}')) ,gen_random_uuid(),false);
      ids:=result->'ids';roots:=jsonb_build_array(jsonb_build_object('id',ids->1,'version','1'));
      begin
        perform read_service_series_edit_targets(current_setting('test.leader')::uuid,roots);
        raise exception 'Leader could read edit targets';
      exception when insufficient_privilege then null;end;
      rows:=read_service_series_edit_targets(current_setting('test.admin')::uuid,roots);
      if jsonb_array_length(rows)<>2 or rows#>>'{1,payload,event_date}'<>'2098-12-02' or rows#>>'{1,payload,access,passcode}'<>'rollback-only'
        then raise exception 'Future series scope or access lost';end if;
      select jsonb_agg(jsonb_set(r,'{payload,title}','"Changed"')) into rows from jsonb_array_elements(rows) r;
      result:=save_service_events_tx(current_setting('test.admin')::uuid,rows,request,false);
      if result is distinct from save_service_events_tx(current_setting('test.admin')::uuid,rows,request,false)
        then raise exception 'Retry was not idempotent';end if;
      begin
        perform save_service_events_tx(current_setting('test.admin')::uuid,rows,gen_random_uuid(),false);
        raise exception 'Stale rows accepted';
      exception when sqlstate 'PT409' then null;end;
      roots:=jsonb_build_array(jsonb_build_object('id',ids->0,'version','1'));
      rows:=read_service_series_edit_targets(current_setting('test.admin')::uuid,roots);
      if rows#>>'{0,payload,title}'<>'Series rollback check' or rows#>>'{1,payload,title}'<>'Changed'
        then raise exception 'Past or future update incorrect';end if;
    end $$;rollback;`)
  assert.equal(fingerprint(),before)
  save('verified.json',{hash,verifiedAt:new Date().toISOString(),rollback:true,inventory:inventory()})
  console.log(JSON.stringify({demo:true,rollback:true,adminOnly:true,beyondMonth:true,pastPreserved:true,privateAccess:true,versions:true,idempotency:true,inventory:inventory()}))
}else if(action==='verify-app'){
  assert.equal(environment,'production')
  const sha=process.argv[4];assert.match(sha,/^[a-f0-9]{40}$/)
  const api=path=>JSON.parse(run('vercel',['api',`${path}?teamId=team_x5DMFAR7DAqaqjoochn7Af5q`]))
  const before=JSON.parse(readFileSync('backups/nov18-service-directory-release/project-before.json','utf8'))
  const after=api('/v9/projects/prj_cdo2L78J2YEEaBgxMMnNDfA5BDZs')
  const envHash=p=>createHash('sha256').update(JSON.stringify(p.env.map(e=>[e.id,e.key,e.value,e.target]).sort((a,b)=>a[0].localeCompare(b[0])))).digest('hex')
  assert.equal(envHash(after),envHash(before),'Production environment changed')
  for(let i=0;i<60;i++){
    const alias=JSON.parse(run('vercel',['inspect','https://chinese-territory-app.vercel.app','--json']))
    const d=api(`/v13/deployments/${alias.id}`)
    assert.equal(d.projectId,'prj_cdo2L78J2YEEaBgxMMnNDfA5BDZs')
    if(d.readyState==='READY'&&d.meta?.githubCommitSha===sha){
      const result={ready:true,id:d.id,url:d.url,sha,environmentUnchanged:true,inventory:inventory()}
      save('deployment.json',result);console.log(JSON.stringify(result));process.exit(0)
    }
    await new Promise(r=>setTimeout(r,5000))
  }
  throw Error('Expected production deployment not ready')
}else if(action==='audit'){
  assert.equal(sql("select to_regprocedure('public.read_service_series_edit_targets(uuid,jsonb)') is not null"),'t')
  console.log(JSON.stringify({environment,installed:true,inventory:inventory()}))
}else throw Error('Use demo|production apply|verify|audit')
