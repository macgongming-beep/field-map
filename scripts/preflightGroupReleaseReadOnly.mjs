import assert from 'node:assert/strict'
import {readFileSync,writeFileSync} from 'node:fs'
import {parseEnv} from 'node:util'
import {spawnSync} from 'node:child_process'
import {compatibilityReadinessSql} from './groupServiceRolloutBundle.mjs'

// This audit has no apply mode and never logs in or calls application RPCs.
const target=process.argv[2]
assert.ok(['demo','production'].includes(target),'Specify demo or production')
assert.ok(process.argv.includes('--read-only'),'Explicit --read-only required')
const project=target==='demo'?'itjlykpjmlcvanqpmkmc':'qdxemvdorasoryfysuoq'
const config=parseEnv(readFileSync(process.env.PREFLIGHT_ENV_FILE,'utf8'))
const db=new URL(config.SUPABASE_DB_URL)
assert.equal(config.VITE_SUPABASE_URL,`https://${project}.supabase.co`)
assert.equal(decodeURIComponent(db.username),`postgres.${project}`)
assert.equal(db.port,'5432')
assert.ok(db.hostname.endsWith('.pooler.supabase.com'))
const env={...process.env,PGHOST:db.hostname,PGPORT:db.port,PGUSER:decodeURIComponent(db.username),PGDATABASE:db.pathname.slice(1),
  PGPASSWORD:decodeURIComponent(db.password),PGSSLMODE:'require',PGCONNECT_TIMEOUT:'15',
  PGOPTIONS:'-c default_transaction_read_only=on -c statement_timeout=15000 -c lock_timeout=2000'}
const read=query=>{
  const r=spawnSync('psql',['-X','-qAt','-v','ON_ERROR_STOP=1'],{env,input:`begin read only;\n${query}\nrollback;`,encoding:'utf8',maxBuffer:8*1024*1024})
  if(r.error||r.status)throw r.error??Error(r.stderr)
  return JSON.parse(r.stdout.trim())
}
const tables=['calendar_events','event_participants','event_card_assignments','event_card_assignment_cards','event_informal_assignments','event_restaurant_assignments','service_sessions','comments','event_cart_applications']
const compatibilityReadiness=read(compatibilityReadinessSql)
if(process.argv.includes('--require-compat-ready')) {
  assert.ok(Object.values(compatibilityReadiness).every(value=>value===true),
    'First deployment blocked: prepare bundle and executable compatibility removal RPC required before main merge. Strict installations require the separate strict-stage audit.')
}
const list=values=>values.map(v=>`'${v}'`).join(',')
const metadata=read(`select json_build_object(
 'readOnly',current_setting('transaction_read_only'),
 'tables',(select coalesce(json_agg(table_name order by table_name),'[]') from information_schema.tables where table_schema='public' and table_name in (${list(tables)})),
 'columns',(select coalesce(json_agg(column_name order by column_name),'[]') from information_schema.columns where table_schema='public' and table_name='calendar_events' and column_name in ('service_kind','target_groups','group_service_scope','meeting_mode','edit_version','primary_leader_user_id')),
 'assignmentRevisionTable',to_regclass('private.event_assignment_revisions') is not null,
 'functions',(select coalesce(json_agg(x),'[]') from (select n.nspname||'.'||p.proname||'('||oidvectortypes(p.proargtypes)||')' signature,p.prosecdef definer,
   has_function_privilege('anon',p.oid,'execute') anon_execute,has_function_privilege('authenticated',p.oid,'execute') authenticated_execute,md5(p.prosrc) body_hash
   from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private') and p.proname in (
    'save_service_events_tx','get_group_service_context','read_group_event_comments','get_event_meeting_access','check_service_application_overlap',
    'save_event_assignments_versioned_tx','manage_event_participant_versioned_tx','mutate_personal_assignment_versioned_tx',
    'assign_team_service_bulk_tx','assign_scoped_cards_bulk_tx','assign_cards_bulk_tx','remove_team_event_participant_tx','remove_service_participant_compat_tx',
    'rename_user_name_references','purge_user_name_references','merge_duplicate_buildings_tx',
    'rename_user_name_references_before_assignment_guard','purge_user_name_references_before_assignment_guard','merge_duplicate_buildings_before_assignment_guard') order by 1)x),
 'notification',(select json_build_object('bodyHash',md5(p.prosrc),'cartRecipients',position('event_cart_applications' in p.prosrc)>0,'commentLink',position('&comment=' in p.prosrc)>0) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='notify_on_comment'),
 'assignmentDefiners',(select coalesce(json_agg(x),'[]') from (select n.nspname||'.'||p.proname||'('||oidvectortypes(p.proargtypes)||')' signature,
   has_function_privilege('anon',p.oid,'execute') anon_execute,has_function_privilege('authenticated',p.oid,'execute') authenticated_execute
   from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.prosecdef and n.nspname in ('public','private')
   and p.prosrc ~* 'event_(card_assignments|card_assignment_cards|informal_assignments|restaurant_assignments)' order by 1)x)
);`)
assert.equal(metadata.readOnly,'on')
const present=tables.filter(t=>metadata.tables.includes(t))
const counts=read(`select json_object_agg(name,n) from (${present.map(t=>`select '${t}' name,count(*) n from public.${t}`).join(' union all ')})c;`)
const indexes=read(`select coalesce(json_agg(x),'[]') from (select tablename,indexname,indexdef from pg_indexes where schemaname='public' and tablename in ('comments','service_sessions','event_card_assignments') order by tablename,indexname)x;`)
const report={target,project,checkedAt:new Date().toISOString(),compatibilityReadiness,metadata,counts,indexes,note:'Read-only catalog and aggregate counts only. No login, application RPC, writes, migration, deployment or notification. Not a load/performance measurement.'}
writeFileSync(`scratch/group-release-${target}-readonly.json`,JSON.stringify(report,null,2),{mode:0o600})
console.log(JSON.stringify(report))
