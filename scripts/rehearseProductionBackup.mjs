// Explicitly local, offline rehearsal. Never reads .env or accepts a remote DB URL.
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, cpSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'

process.umask(0o077)
const runStarted=performance.now()
const root=mkdtempSync(join(tmpdir(),'fieldmap-recovery-'))
const source=resolve('backups/2026-11-20')
const archive=resolve('backups/service-series-production/before.dump')
const pgBin=process.env.REHEARSAL_PG_BIN
assert.ok(pgBin && existsSync(join(pgBin,'postgres')),'Set REHEARSAL_PG_BIN to a complete local PostgreSQL installation')
const psql='/opt/homebrew/opt/libpq/bin/psql', pgRestore='/opt/homebrew/opt/libpq/bin/pg_restore'
const output=resolve(`backups/recovery-rehearsal-${Date.now()}`)
mkdirSync(output,{mode:0o700})
writeFileSync(join(root,'LOCAL_REHEARSAL_ONLY'),'offline\n')
const baseEnv={PATH:process.env.PATH,HOME:process.env.HOME,PGHOST:root,PGPORT:'55442',PGUSER:'postgres',PGDATABASE:'postgres'}
const report={startedAt:new Date().toISOString(),source:'backups/2026-11-20',schemaArchive:'backups/service-series-production/before.dump',
  networkAccess:false,productionAccess:false,deployment:false,checks:[],commandTimings:[],limitations:[
    'Saved November 18 production schema plus its November 19 migration; no live schema recheck.',
    'Original restore CLI with offline SQL transport instead of PostgREST; not an HTTP/RLS verification.',
    'No real auth sessions, push secrets, cron or network extensions; crypto operations fail closed.',
  ]}
const hash=bytes=>createHash('sha256').update(bytes).digest('hex')
const q=s=>`"${s.replaceAll('"','""')}"`
const lit=s=>`'${s.replaceAll("'","''")}'`
function command(bin,args,env=baseEnv){
  const r=spawnSync(bin,args,{env,encoding:'utf8',maxBuffer:64*1024*1024})
  if(r.status!==0){writeFileSync(join(output,'local-command-error.log'),r.stderr||'Command failed');throw Error('Local command failed; protected log saved')}
  return r.stdout.trim()
}
function sql(database,body){
  assert.match(database,/^(postgres|rehearsal_[a-z_]+)$/)
  const r=spawnSync(psql,['-XqAt','--single-transaction','-v','ON_ERROR_STOP=1','-v','VERBOSITY=sqlstate'],{
    env:{...baseEnv,PGDATABASE:database},input:body,encoding:'utf8',maxBuffer:128*1024*1024,
  })
  if(r.status!==0){writeFileSync(join(output,'local-sql-error.log'),r.stderr||'SQL failed');throw Error(`Local SQL failure (${r.stderr?.match(/(?:ERROR|FATAL):\s+([A-Z0-9]{5})/)?.[1]||'unknown'})`)}
  return r.stdout.trim()
}
function clone(name,template='rehearsal_base'){
  command(join(pgBin,'createdb'),['-T',template,name])
}
let extraFixtures={}
function input(name,withFixtures=true){
  const directory=join(root,name,'2026-11-20');mkdirSync(directory,{recursive:true});cpSync(source,directory,{recursive:true})
  if(withFixtures)for(const [table,rows]of Object.entries(extraFixtures))writeFileSync(join(directory,`${table}.json`),JSON.stringify(rows))
  return join(root,name)
}
function cli(name,database,inputRoot,args=[]){
  const attempts=join(output,`${name}-attempts.jsonl`)
  writeFileSync(attempts,'')
  const commandStarted=performance.now()
  const result=spawnSync(process.execPath,['--import',resolve('scripts/rehearsal/offlineRestoreHooks.mjs'),resolve('scripts/restore.js'),'2026-11-20','--write','--maintenance',...args],{
    env:{PATH:process.env.PATH,HOME:process.env.HOME,PSQL_BIN:psql,
      VITE_SUPABASE_URL:'https://rehearsal.invalid',SUPABASE_SERVICE_ROLE_KEY:'offline-only',SUPABASE_DB_URL:'postgresql://rehearsal-only',
      REHEARSAL_SOCKET:root,REHEARSAL_DATABASE:database,REHEARSAL_INPUT:inputRoot,REHEARSAL_ATTEMPTS:attempts},
    encoding:'utf8',timeout:180000,maxBuffer:16*1024*1024,
  })
  const durationMs=Math.round(performance.now()-commandStarted)
  report.commandTimings.push({name,durationMs,exitCode:result.status})
  writeFileSync(join(output,`${name}-cli.log`),(result.stdout||'')+'\n'+(result.stderr||''))
  const calls=readFileSync(attempts,'utf8').trim().split('\n').filter(Boolean).map(line=>JSON.parse(line))
  return {exitCode:result.status,durationMs,failedCall:calls.find(c=>!c.ok)||null,successfulWrites:calls.filter(c=>c.action==='upsert'&&c.ok),calls,
    warnedRollback:(result.stderr||'').includes('SQL 오류는 전체 취소')}
}
let started=false
try{
  const manifest=JSON.parse(readFileSync(join(source,'_read_only_verification.json'),'utf8'))
  assert.equal(manifest.project,'qdxemvdorasoryfysuoq')
  const payload={}
  for(const entry of manifest.files){const bytes=readFileSync(join(source,`${entry.table}.json`));assert.equal(hash(bytes),entry.sha256);payload[entry.table]=JSON.parse(bytes)}
  assert.equal(hash(readFileSync(join(source,'private_duplicate_building_merge_audits.sql'))),manifest.privateAuditSha256)
  report.sourceHashesVerified=true
  report.schemaSha256=hash(readFileSync(archive))
  command(join(pgBin,'initdb'),['-D',join(root,'data'),'-U','postgres','-A','trust','--no-locale','--encoding=UTF8'])
  command(join(pgBin,'pg_ctl'),['-D',join(root,'data'),'-l',join(output,'server.log'),'-o',`-k ${root} -p 55442 -h ''`,'-w','start']);started=true
  sql('postgres','create role anon;create role authenticated;create role service_role bypassrls;create role supabase_admin;')
  command(join(pgBin,'createdb'),['-T','template0','rehearsal_base'])
  sql('rehearsal_base',`drop schema public;create schema extensions;create schema net;create schema rehearsal;
    create table rehearsal.blocked_http(id bigserial primary key);
    create table net._http_response(id bigint,status_code integer,created timestamptz,content text);
    create function net.http_post(url text,body jsonb default '{}'::jsonb,params jsonb default '{}'::jsonb,
      headers jsonb default '{}'::jsonb,timeout_milliseconds integer default 1000) returns bigint language plpgsql as $$
      declare i bigint;begin insert into rehearsal.blocked_http default values returning id into i;return i;end $$;
    create function extensions.gen_random_uuid() returns uuid language sql as $$select pg_catalog.gen_random_uuid()$$;
    create function extensions.crypt(text,text) returns text language plpgsql as $$begin raise exception 'Crypto not available in offline rehearsal';end$$;
    create function extensions.gen_salt(text,integer default 10) returns text language plpgsql as $$begin raise exception 'Crypto not available in offline rehearsal';end$$;
    create function extensions.digest(text,text) returns bytea language plpgsql as $$begin raise exception 'Crypto not available in offline rehearsal';end$$;
    create function extensions.gen_random_bytes(integer) returns bytea language plpgsql as $$begin raise exception 'Crypto not available in offline rehearsal';end$$;`)
  const schema=command(pgRestore,['--schema-only','--no-owner','--no-privileges','--file','-',archive])
  assert.ok(!/LANGUAGE\s+(?:c|plpython|plperlu)|CREATE FOREIGN|COPY[^;]*PROGRAM/i.test(schema),'Unexpected executable extension')
  sql('rehearsal_base',schema)
  sql('rehearsal_base',readFileSync('supabase/migrations/20261119_0010_service_series_edit_targets.sql','utf8'))
  sql('rehearsal_base',`grant usage on schema public,private,extensions to service_role;
    grant all on all tables in schema public,private to service_role;
    grant all on all sequences in schema public,private to service_role;`)
  const catalog=JSON.parse(sql('rehearsal_base',`select jsonb_agg(jsonb_build_object('name',c.relname,'kind',c.relkind,'columns',
    (select jsonb_agg(a.attname) from pg_attribute a where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped)))
    from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in('r','v');`))
  for(const [table,rows]of Object.entries(payload)){
    const entry=catalog.find(c=>c.name===table);assert.ok(entry,`Missing schema table ${table}`)
    for(const column of new Set(rows.flatMap(Object.keys)))assert.ok(entry.columns.includes(column),`Schema mismatch ${table}.${column}`)
  }
  report.backupColumnsCompatible=true
  report.unbackedPublicTables=catalog.filter(c=>c.kind==='r'&&!Object.hasOwn(payload,c.name)).map(c=>c.name)
  clone('rehearsal_data')
  extraFixtures={
    event_meeting_access:[{event_id:payload.calendar_events[0].id,join_url:'https://example.invalid/local-only',meeting_number:'TEST',passcode:'TEST'}],
    place_change_requests:[{id:700001,request_type:'other',building_id:payload.buildings[0].id,note:'offline fixture',requested_by_name:'Offline fixture',status:'pending',review_note:'',created_at:'2026-11-20T00:00:00Z',impact_snapshot:{}}],
    territory_report_shares:[{id:'00000000-0000-4000-8000-000000000001',token_hash:'offline-fixture-only',snapshot:{fixture:true},expires_at:'2026-11-21T00:00:00Z',created_by:payload.app_users[0].id,created_at:'2026-11-20T00:00:00Z',failed_attempts:0,view_count:0}],
  }
  report.fixtureOnlyTables=Object.keys(extraFixtures)
  report.limitations.push('The original backup lacks these three business tables. Fixtures test the tool, not recovery of their actual production records.')
  const expected={...payload,...extraFixtures}
  const triggerQuery=`select coalesce(jsonb_agg(jsonb_build_array(t.tgrelid::regclass::text,t.tgname,t.tgenabled) order by t.tgrelid::regclass::text,t.tgname),'[]') from pg_trigger t;`
  const triggerState=sql('rehearsal_data',triggerQuery)
  const securityQuery=`select jsonb_build_object('policies',(select jsonb_agg(to_jsonb(p) order by schemaname,tablename,policyname)
    from pg_policies p where schemaname in('public','private')),
    'table_acl',(select jsonb_agg(jsonb_build_array(n.nspname,c.relname,c.relowner,c.relacl,c.relrowsecurity,c.relforcerowsecurity) order by c.oid)
      from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in('public','private') and c.relkind in('r','v')),
    'function_acl',(select jsonb_agg(jsonb_build_array(p.oid,p.proowner,p.proacl) order by p.oid)
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('public','private')));`
  const securityState=sql('rehearsal_data',securityQuery)
  const originalInput=input('original',false)
  const incomplete=cli('incomplete_backup','rehearsal_data',originalInput)
  assert.equal(incomplete.exitCode,1);assert.equal(sql('rehearsal_data','select count(*) from app_users'),'0')
  report.checks.push({name:'incomplete_business_backup_rejected',exitCode:1,noRowsWritten:true})
  const completeInput=input('complete')
  const normal=cli('normal','rehearsal_data',completeInput)
  assert.equal(normal.exitCode,0,'Atomic full restore CLI must succeed without schema bypasses')
  report.guardedFullRestorePassed=true
  report.readyForProductionRecovery=false
  assert.equal(sql('rehearsal_data',triggerQuery),triggerState)
  assert.equal(sql('rehearsal_data',securityQuery),securityState)
  assert.equal(sql('rehearsal_data','select count(*) from rehearsal.blocked_http'),'0')
  report.checks.push({name:'atomic_restore_cli',exitCode:0,allTriggerStatesPreserved:true,policiesAndPrivilegesUnchanged:true,blockedHttpAttempts:0})
  console.log(JSON.stringify({stage:'normal_restore',exitCode:normal.exitCode}))
  // Existing private audit dump remains a separate, explicit recovery step.
  sql('rehearsal_data',readFileSync(join(source,'private_duplicate_building_merge_audits.sql'),'utf8'))
  const verified=[]
  for(const [table,rows]of Object.entries(expected)){
    const filter=table==='app_settings'?"where key not in('user_groups','service_group_directory')":''
    const difference=Number(sql('rehearsal_data',`with expected as(select to_jsonb(x) row from jsonb_populate_recordset(null::public.${q(table)},${lit(JSON.stringify(rows))}::jsonb)x),
      actual as(select to_jsonb(x) row from public.${q(table)} x ${filter})
      ${table==='app_settings' ? ", filtered_expected as(select * from expected where row->>'key' not in('user_groups','service_group_directory'))" : ''}
      select count(*) from ((select * from ${table==='app_settings'?'filtered_expected':'expected'} except all select * from actual) union all (select * from actual except all select * from ${table==='app_settings'?'filtered_expected':'expected'})) d;`))
    assert.equal(difference,0,`Data mismatch ${table}`);verified.push({table,rows:rows.length})
  }
  const sequences=JSON.parse(sql('rehearsal_data',`select coalesce(jsonb_agg(jsonb_build_object('table',c.relname,'column',a.attname,'sequence',pg_get_serial_sequence(format('public.%I',c.relname),a.attname))),'[]')
    from pg_class c join pg_namespace n on n.oid=c.relnamespace join pg_attribute a on a.attrelid=c.oid
    where n.nspname='public' and c.relkind='r' and a.attnum>0 and not a.attisdropped
    and pg_get_serial_sequence(format('public.%I',c.relname),a.attname) is not null;`))
  for(const s of sequences){
    assert.equal(sql('rehearsal_data',`select nextval(${lit(s.sequence)})>coalesce(max(${q(s.column)}),0) from public.${q(s.table)};`),'t')
  }
  report.checks.push({name:'atomic_data_comparison',userTriggersTemporarilyDisabled:true,foreignKeysEnabled:true,triggerStateRestored:true,
    verifiedTables:verified,privateAuditRows:Number(sql('rehearsal_data','select count(*) from private.duplicate_building_merge_audits')),
    nextSequenceValuesVerified:sequences.length,
    blockedHttpAttempts:Number(sql('rehearsal_data','select count(*) from rehearsal.blocked_http'))})
  console.log(JSON.stringify({stage:'data_comparison',tables:verified.length,matched:true}))

  clone('rehearsal_partial','rehearsal_data')
  sql('rehearsal_partial','truncate public.units cascade;')
  const partialInput=input('partial')
  const broken=structuredClone(payload.units);broken[500].building_id=-1
  writeFileSync(join(partialInput,'2026-11-20/units.json'),JSON.stringify(broken))
  const partial=cli('partial_failure','rehearsal_partial',partialInput,['--table','units'])
  const partialCount=Number(sql('rehearsal_partial','select count(*) from units'))
  assert.equal(partial.exitCode,1);assert.equal(partialCount,0);assert.equal(partial.warnedRollback,true)
  assert.equal(sql('rehearsal_partial',triggerQuery),triggerState)
  writeFileSync(join(partialInput,'2026-11-20/units.json'),JSON.stringify(payload.units))
  const retry=cli('partial_retry','rehearsal_partial',partialInput,['--table','units'])
  assert.equal(retry.exitCode,0);assert.equal(Number(sql('rehearsal_partial','select count(*) from units')),payload.units.length)
  const again=cli('idempotent_retry','rehearsal_partial',partialInput,['--table','units'])
  assert.equal(again.exitCode,0);assert.equal(Number(sql('rehearsal_partial','select count(*) from units')),payload.units.length)
  const unitDifferences=Number(sql('rehearsal_partial',`with expected as(select to_jsonb(x) row from jsonb_populate_recordset(null::public.units,${lit(JSON.stringify(payload.units))}::jsonb)x),
    actual as(select to_jsonb(x) row from public.units x)
    select count(*) from ((select * from expected except all select * from actual) union all (select * from actual except all select * from expected)) d;`))
  assert.equal(unitDifferences,0)
  report.checks.push({name:'failed_row_501_then_retry_twice',committedRows:partialCount,
    retryExitCode:retry.exitCode,finalRows:payload.units.length,noDuplicatePrimaryKeys:true,normalizedRowDifferences:unitDifferences})

  // A real failure after earlier TABLES have been written must also be atomic.
  clone('rehearsal_full_failure')
  const fullBadInput=input('full_failure')
  writeFileSync(join(fullBadInput,'2026-11-20/units.json'),JSON.stringify(broken))
  const fullFailure=cli('full_failure','rehearsal_full_failure',fullBadInput)
  assert.equal(fullFailure.exitCode,1)
  for(const table of catalog.filter(c=>c.kind==='r'&&Object.hasOwn(expected,c.name)).map(c=>c.name)) {
    assert.equal(sql('rehearsal_full_failure',`select count(*) from public.${q(table)}`),'0',`Earlier table leaked: ${table}`)
  }
  assert.equal(sql('rehearsal_full_failure',triggerQuery),triggerState)
  assert.equal(sql('rehearsal_full_failure','select count(*) from rehearsal.blocked_http'),'0')
  writeFileSync(join(fullBadInput,'2026-11-20/units.json'),JSON.stringify(payload.units))
  assert.equal(cli('full_retry','rehearsal_full_failure',fullBadInput).exitCode,0)
  assert.equal(cli('full_retry_again','rehearsal_full_failure',fullBadInput).exitCode,0)
  for(const [table,rows] of Object.entries(expected)) {
    assert.equal(Number(sql('rehearsal_full_failure',`select count(*) from public.${q(table)}`)),rows.length,`Retry duplicates: ${table}`)
  }
  report.checks.push({name:'full_mid_restore_failure_and_two_retries',allEarlierTablesRolledBack:true,allTriggersRestored:true,
    retriesSucceeded:2,noDuplicateRows:true})

  clone('rehearsal_missing','rehearsal_data')
  sql('rehearsal_missing','alter table public.review_tasks rename to rehearsal_missing_review_tasks;')
  const revisionQuery="select (value::jsonb->>'revision')::bigint from app_settings where key='service_group_directory'"
  const beforeRevision=Number(sql('rehearsal_missing',revisionQuery))
  const missing=cli('missing_table','rehearsal_missing',completeInput)
  assert.equal(missing.exitCode,1);assert.equal(missing.warnedRollback,true)
  assert.ok(!missing.calls.some(c=>c.action==='upsert'&&c.table==='cards'))
  const afterRevision=Number(sql('rehearsal_missing',revisionQuery));assert.equal(afterRevision,beforeRevision)
  report.checks.push({name:'missing_table_rolls_back_all_changes',exitCode:1,directoryUnchanged:true})

  const corruptInput=input('corrupt');writeFileSync(join(corruptInput,'2026-11-20/units.json'),'{broken')
  const corrupt=cli('corrupt_json','rehearsal_data',corruptInput,['--table','units'])
  assert.equal(corrupt.exitCode,1);assert.equal(corrupt.successfulWrites.length,0)
  report.checks.push({name:'corrupt_backup_rejected',exitCode:corrupt.exitCode,writes:0})

  const keyInput=input('missing_key')
  writeFileSync(join(keyInput,'2026-11-20/rehearsal_without_id.json'),JSON.stringify([{value:'offline'}]))
  sql('rehearsal_data','create table public.rehearsal_without_id(value text primary key);grant all on public.rehearsal_without_id to service_role;')
  const key=cli('missing_key','rehearsal_data',keyInput,['--table','rehearsal_without_id'])
  assert.equal(key.exitCode,1);assert.equal(key.successfulWrites.length,0)
  assert.equal(Number(sql('rehearsal_data','select count(*) from rehearsal_without_id')),0)
  report.checks.push({name:'unknown_conflict_key_rejected',exitCode:key.exitCode,writes:0})

  const rollbackInput=input('group_rollback')
  const groups=structuredClone(payload.service_groups)
  groups[0].display_name='LocalOnly'
  groups.push({...groups[1],code:'rehearsal_duplicate',legacy_name:'UniqueLegacy'})
  writeFileSync(join(rollbackInput,'2026-11-20/service_groups.json'),JSON.stringify(groups))
  const stateQuery=`select jsonb_build_object('groups',(select jsonb_agg(to_jsonb(g) order by code) from service_groups g),
    'members',(select jsonb_agg(jsonb_build_array(id,group_name) order by id) from app_users),
    'directory',(select value from app_settings where key='service_group_directory'))`
  const beforeGroups=sql('rehearsal_data',stateQuery)
  const rollback=cli('group_rollback','rehearsal_data',rollbackInput,['--table','service_groups','--replace'])
  assert.equal(rollback.exitCode,1);assert.equal(sql('rehearsal_data',stateQuery),beforeGroups)
  assert.equal(sql('rehearsal_data',triggerQuery),triggerState)
  report.checks.push({name:'group_owner_transaction_failure',exitCode:rollback.exitCode,groupsMembersDirectoryUnchanged:true,allUserTriggersUnchanged:true})

  // This feature is not installed in the saved production schema. Install only in
  // a disposable clone to exercise the real CLI's links-only maintenance path.
  clone('rehearsal_links_only','rehearsal_data')
  for(const migration of ['20261120_1600_territory_group_assignments.sql','20261120_1700_territory_group_review.sql']) {
    sql('rehearsal_links_only',readFileSync(`supabase/migrations/${migration}`,'utf8'))
  }
  const cardId=payload.cards[0].id
  const links=payload.service_groups.slice(0,2).map(g=>({card_id:cardId,group_code:g.code,assigned_by:payload.app_users[0].id}))
  assert.equal(links.length,2)
  sql('rehearsal_links_only',`insert into card_group_assignments(card_id,group_code,assigned_by) values(${Number(cardId)},${lit(links[1].group_code)},${Number(links[1].assigned_by)});`)
  const linkRevisionSql=`select group_assignment_revision from cards where id=${Number(cardId)}`
  const linkBefore=Number(sql('rehearsal_links_only',linkRevisionSql))
  const linkTriggers=sql('rehearsal_links_only',triggerQuery)
  const linkInput=input('links_only')
  writeFileSync(join(linkInput,'2026-11-20/card_group_assignments.json'),JSON.stringify(links))
  const linkRestore=cli('links_only','rehearsal_links_only',linkInput,['--table','card_group_assignments'])
  assert.equal(linkRestore.exitCode,0)
  assert.equal(sql('rehearsal_links_only','select count(*) from card_group_assignments'),'2')
  const linkAfter=Number(sql('rehearsal_links_only',linkRevisionSql));assert.ok(linkAfter>linkBefore)
  assert.equal(sql('rehearsal_links_only',triggerQuery),linkTriggers)
  sql('rehearsal_links_only',`do $$ begin begin
    update public.cards set group_assignment_revision=0 where id=${Number(cardId)};
    raise exception 'Revision guard was not restored';
    exception when insufficient_privilege then null; end; end $$;`)
  report.checks.push({name:'links_only_restore',exitCode:0,sharedGroupsPreserved:true,revisionBefore:linkBefore,
    revisionAfter:linkAfter,allTriggerStatesPreserved:true,directRevisionWriteDenied:true})
  for(const entry of manifest.files)assert.equal(hash(readFileSync(join(source,`${entry.table}.json`))),entry.sha256)
  assert.equal(hash(readFileSync(join(source,'private_duplicate_building_merge_audits.sql'))),manifest.privateAuditSha256)
  report.sourceBackupUnchanged=true
  report.completed=true
} catch(error){report.completed=false;report.error=error.message;process.exitCode=1}
finally{
  if(started)command(join(pgBin,'pg_ctl'),['-D',join(root,'data'),'-m','immediate','-w','stop'])
  rmSync(root,{recursive:true,force:true})
  report.finishedAt=new Date().toISOString();report.localClusterRemoved=true
  report.totalDurationMs=Math.round(performance.now()-runStarted)
  writeFileSync(join(output,'report.json'),JSON.stringify(report,null,2))
  console.log(JSON.stringify({output,completed:report.completed,error:report.error,checks:report.checks.map(c=>({name:c.name,exitCode:c.exitCode})),productionAccess:false}))
}
