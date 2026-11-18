import assert from 'node:assert/strict'
import {readFileSync,mkdirSync,chmodSync,writeFileSync} from 'node:fs'
import {parseEnv} from 'node:util'
import {spawnSync} from 'node:child_process'
import {resolve} from 'node:path'
import {assignmentInventorySql,assertAssignmentInventory} from './assignmentDefinerInventory.mjs'
const config=parseEnv(readFileSync(process.env.DEMO_ENV_FILE??'', 'utf8'))
assert.ok(process.argv.includes('--confirm-demo'))
assert.equal(config.VITE_SUPABASE_URL,'https://itjlykpjmlcvanqpmkmc.supabase.co')
const url=new URL(config.SUPABASE_DB_URL)
assert.equal(decodeURIComponent(url.username),'postgres.itjlykpjmlcvanqpmkmc')
const env={...process.env,PGHOST:url.hostname,PGPORT:url.port||'5432',PGUSER:decodeURIComponent(url.username),PGDATABASE:url.pathname.slice(1),PGPASSWORD:decodeURIComponent(url.password),PGSSLMODE:'require',PGCONNECT_TIMEOUT:'15'}
function run(command,args,input){const r=spawnSync(command,args,{env,encoding:'utf8',input,maxBuffer:30*1024*1024});if(r.error)throw r.error;if(r.status)throw new Error(r.stderr);return r.stdout.trim()}
function sql(query){return run('psql',['-X','-At','-v','ON_ERROR_STOP=1'],query)}
if(process.argv.includes('--inspect')){
  console.log(sql(`begin read only;
    select json_build_object('configured',(select value from app_settings where key='user_groups'),'groups',(select json_agg(g) from service_groups g),'installed',to_regprocedure('public.manage_service_group_tx(uuid,text,text,text,bigint)') is not null);
    select n.nspname||'.'||p.proname||': '||p.prosrc from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname in('public','private') and (p.prosrc ilike '%user_groups%' or p.proname='reset_demo_environment_tx');
    rollback;`))
}else if(process.argv.includes('--apply')){
  assert.equal(sql("select to_regprocedure('public.manage_service_group_tx(uuid,text,text,text,bigint)') is null"),'t','Already installed')
  const dir=resolve('backups',`service-group-directory-${new Date().toISOString().replaceAll(':','-')}`)
  mkdirSync(dir,{recursive:true,mode:0o700})
  const backup=resolve(dir,'before.dump')
  run('pg_dump',['--format=custom','--no-owner','--no-privileges','--schema=public','--schema=private','--file',backup]);chmodSync(backup,0o600)
  run('pg_restore',['--list',backup])
  const path='supabase/migrations/20261118_2300_service_group_directory.sql'
  sql(`begin;${readFileSync(path,'utf8')}rollback;`)
  run('psql',['-X','-v','ON_ERROR_STOP=1','--single-transaction','-f',path])
  writeFileSync(resolve(dir,'result.json'),JSON.stringify({demo:true,backup,migration:path,applied:true},null,2),{mode:0o600})
  console.log(JSON.stringify({demo:true,backup,applied:true}))
}else if(process.argv.includes('--verify')){
  const fingerprint=`select md5(jsonb_build_array(
    (select jsonb_agg(to_jsonb(t) order by id) from app_users t),
    (select jsonb_agg(to_jsonb(t) order by code) from service_groups t),
    (select jsonb_agg(to_jsonb(t) order by key) from app_settings t),
    (select jsonb_agg(to_jsonb(t) order by id) from calendar_events t),
    (select jsonb_agg(to_jsonb(t) order by event_id,user_name) from event_participants t),
    (select jsonb_agg(to_jsonb(t) order by id) from event_card_assignments t)
  )::text);`
  const before=sql(fingerprint)
  sql(`begin;
    set local app.suppress_notifications='on';
    do $$declare actor integer; token uuid; begin
      select id into strict actor from app_users where role='admin' and is_active and approval_status='approved' order by id limit 1;
      insert into auth_sessions(user_id,device_label) values(actor,'group-directory-rollback-check') returning auth_sessions.token into token;
      perform set_config('test.admin_token',token::text,true);
      select id into strict actor from app_users where role='leader' and is_active and approval_status='approved' order by id limit 1;
      insert into auth_sessions(user_id,device_label) values(actor,'group-directory-rollback-check') returning auth_sessions.token into token;
      perform set_config('test.leader_token',token::text,true);
      perform set_config('test.revision',(select value::jsonb->>'revision' from app_settings where key='service_group_directory'),true);
    end $$;
    set local role anon;
    do $$declare d jsonb; c text; r bigint:=current_setting('test.revision')::bigint; e jsonb; begin
      begin
        perform manage_service_group_tx(current_setting('test.leader_token')::uuid,'add',null,'审查拒绝',r);
        raise exception 'Leader unexpectedly allowed';
      exception when insufficient_privilege then null; end;
      d:=manage_service_group_tx(current_setting('test.admin_token')::uuid,'add',null,'审查第五组',r)::jsonb;
      select g->>'code' into strict c from jsonb_array_elements(d->'groups') g where g->>'name'='审查第五组';
      perform set_config('test.group_code',c,true);
      d:=manage_service_group_tx(current_setting('test.admin_token')::uuid,'rename',c,'审查新名称',r+1)::jsonb;
      begin
        perform manage_service_group_tx(current_setting('test.admin_token')::uuid,'rename',c,'过期覆盖',r);
        raise exception 'Stale revision unexpectedly allowed';
      exception when sqlstate 'PT409' then null; end;
      e:=save_service_events_tx(current_setting('test.admin_token')::uuid,
        jsonb_build_array(jsonb_build_object('payload',jsonb_build_object(
          'event_date','2099-11-18','time','14:30','end_time','16:30','title','审查安排',
          'service_kind','group','group_service_scope',true,'target_groups',jsonb_build_array(c),
          'meeting_mode','none','leader_name','','allow_applications',true))),gen_random_uuid(),false);
      if not (e->>'ok')::boolean then raise exception 'Event creation failed'; end if;
      perform set_config('test.event_id',e#>>'{ids,0}',true);
    end $$;
    reset role;
    do $$declare actor integer; d jsonb; c text:=current_setting('test.group_code'); begin
      select id into strict actor from app_users where role='user' and is_active and approval_status='approved' order by id limit 1;
      update app_users set group_name='审查新名称' where id=actor;
      d:=manage_service_group_tx(current_setting('test.admin_token')::uuid,'rename',c,'审查改名',current_setting('test.revision')::bigint+2)::jsonb;
      if (select group_name from app_users where id=actor) <> '审查改名' then raise exception 'Membership did not follow rename'; end if;
      if (select target_groups from calendar_events where id=current_setting('test.event_id')::int) <> array[c] then raise exception 'Stable event code changed'; end if;
      perform manage_service_group_tx(current_setting('test.admin_token')::uuid,'archive',c,null,current_setting('test.revision')::bigint+3);
      if (select group_name from app_users where id=actor) is not null then raise exception 'Archived member not cleared'; end if;
      if not exists(select 1 from calendar_events where id=current_setting('test.event_id')::int) then raise exception 'History removed'; end if;
      if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
        where n.nspname='private' and p.proname in('publish_service_group_directory','guard_user_group_membership','guard_active_service_targets','guard_group_directory_settings')
        and (has_function_privilege('anon',p.oid,'execute') or has_function_privilege('authenticated',p.oid,'execute')))
        then raise exception 'Internal helper exposed'; end if;
    end $$;
    rollback;`)
  assert.equal(sql(fingerprint),before,'Rollback left application data changed')
  const rows=JSON.parse(sql(assignmentInventorySql))
  const phase=rows.find(r=>r.signature.startsWith('public.assign_team_service_bulk_tx('))?.anon_execute?'compatibility':'strict'
  assertAssignmentInventory(rows,{environment:'demo',phase})
  console.log(JSON.stringify({demo:true,rollback:true,anonymousRpc:true,adminOnly:true,stableCodes:true,membershipRename:true,archiveHistory:true,staleRevision:true,assignmentInventory:rows.length,phase}))
}else throw new Error('Choose --inspect, --apply or --verify')
