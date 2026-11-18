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
    do $$declare e public.calendar_events; payload jsonb; rows jsonb; result jsonb; retry jsonb;
      request_id uuid:=gen_random_uuid(); roster text; assignments text; version bigint; begin
      perform set_config('request.headers',jsonb_build_object('x-session-token',current_setting('test.admin_token'))::text,true);
      select * into strict e from public.calendar_events c where c.group_service_scope
        and exists(select 1 from public.event_participants p where p.event_id=c.id)
        and exists(select 1 from public.event_card_assignments a where a.event_id=c.id) order by c.id limit 1;
      select md5(jsonb_agg(to_jsonb(p) order by p.user_name)::text) into roster from event_participants p where event_id=e.id;
      select md5(jsonb_agg(to_jsonb(a) order by a.id)::text) into assignments from event_card_assignments a where event_id=e.id;
      payload:=to_jsonb(e)||jsonb_build_object('access',case when e.meeting_mode='virtual' then get_event_meeting_access(e.id)
        else jsonb_build_object('joinUrl','','meetingNumber','','passcode','') end);
      rows:=jsonb_build_array(jsonb_build_object('id',e.id,'version',e.edit_version::text,'payload',payload),
        jsonb_build_object('payload',(payload-'series_id')||jsonb_build_object('target_groups',jsonb_build_array(current_setting('test.group_code')))));
      result:=save_service_events_tx(current_setting('test.admin_token')::uuid,rows,request_id,false);
      retry:=save_service_events_tx(current_setting('test.admin_token')::uuid,rows,request_id,false);
      if result is distinct from retry or (result#>>'{ids,0}')::int<>e.id or jsonb_array_length(result->'ids')<>2 then raise exception 'Extension retry or IDs changed'; end if;
      if roster is distinct from (select md5(jsonb_agg(to_jsonb(p) order by p.user_name)::text) from event_participants p where event_id=e.id)
        or assignments is distinct from (select md5(jsonb_agg(to_jsonb(a) order by a.id)::text) from event_card_assignments a where event_id=e.id)
        then raise exception 'Extension changed roster or assignments'; end if;
      select edit_version into version from calendar_events where id=e.id;
      begin
        perform save_service_events_tx(current_setting('test.admin_token')::uuid,rows,gen_random_uuid(),false);
        raise exception 'Stale extension unexpectedly saved';
      exception when sqlstate 'PT409' then null; end;
      rows:=jsonb_set(rows,'{0,version}',to_jsonb(version::text));
      begin
        perform save_service_events_tx(current_setting('test.admin_token')::uuid,rows,gen_random_uuid(),false);
        raise exception 'Duplicate extension unexpectedly saved';
      exception when others then
        if sqlerrm not like '%already occupies%' then raise; end if;
      end;
      if (select edit_version from calendar_events where id=e.id)<>version then raise exception 'Failed extension partly saved'; end if;
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
  console.log(JSON.stringify({demo:true,rollback:true,anonymousRpc:true,adminOnly:true,stableCodes:true,membershipRename:true,archiveHistory:true,staleRevision:true,extendExistingSlot:true,preservedRosterAndAssignments:true,idempotentRetry:true,atomicConflict:true,assignmentInventory:rows.length,phase}))
}else throw new Error('Choose --inspect, --apply or --verify')
