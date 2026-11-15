import assert from 'node:assert/strict'
import { readFileSync,writeFileSync,mkdirSync } from 'node:fs'
import { parseEnv } from 'node:util'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { randomUUID } from 'node:crypto'

process.umask(0o077)
const project='itjlykpjmlcvanqpmkmc'
const config=parseEnv(readFileSync(process.env.DEMO_ENV_FILE,'utf8'))
assert.equal(config.VITE_SUPABASE_URL,`https://${project}.supabase.co`)
const db=new URL(config.SUPABASE_DB_URL)
assert.equal(decodeURIComponent(db.username),`postgres.${project}`)
assert.ok(db.hostname.endsWith('.pooler.supabase.com'))
assert.equal(db.port,'5432')
const mode=process.argv[2]
assert.ok(['check','apply','apply-conflict','apply-templates','apply-compatibility','fixture','smoke'].includes(mode))
if(mode!=='check')assert.ok(process.argv.includes('--confirm-demo'))
const env={...process.env,PGHOST:db.hostname,PGPORT:db.port,PGUSER:decodeURIComponent(db.username),PGDATABASE:db.pathname.slice(1),PGPASSWORD:decodeURIComponent(db.password),PGSSLMODE:'require',PGCONNECT_TIMEOUT:'15'}
function run(command,args,input) {const r=spawnSync(command,args,{env,input,encoding:'utf8',maxBuffer:128*1024*1024});if(r.error||r.status)throw r.error??Error(r.stderr);return r.stdout.trim()}
const sql=q=>run('psql',['-X','-At','-v','ON_ERROR_STOP=1'],q)
const quote=s=>`'${s.replaceAll("'","''")}'`
const installed=()=>sql("select count(*) from information_schema.columns where table_schema='public' and table_name='calendar_events' and column_name='edit_version'")
if(mode==='check') {
  console.log(JSON.stringify({project,installed:installed(),version:sql('show server_version'),events:sql('select count(*) from calendar_events')}));process.exit()
}
if(mode.startsWith('apply')) {
  assert.equal(installed(),mode==='apply'?'0':'1','Unexpected schema state')
  const dir=resolve('backups',`group-service-demo-${Date.now()}`);mkdirSync(dir,{recursive:true})
  const dump=resolve(dir,'before.dump')
  run('pg_dump',['--format=custom','--no-owner','--schema=public','--schema=private','--file',dump]);run('pg_restore',['--list',dump])
  const oldFunctions=sql("select pg_get_functiondef('public.notify_on_calendar_event_change()'::regprocedure)||E'\\n'||pg_get_functiondef('public.update_calendar_event_series_tx(uuid,uuid,date,jsonb,boolean)'::regprocedure)")
  const oldTrigger=sql("select pg_get_triggerdef(oid)||';' from pg_trigger where tgname='on_calendar_event_update'")
  const rollback=`-- Demo rollback only; deploy old app first. New service metadata and meeting secrets are removed.\nDROP TRIGGER on_calendar_event_update ON public.calendar_events;\nDROP TRIGGER service_event_guard ON public.calendar_events;\n${oldFunctions}\n${oldTrigger}\nDROP FUNCTION public.save_service_events_tx(uuid,jsonb,uuid,boolean);\nDROP FUNCTION public.get_event_meeting_access(integer);\nDROP FUNCTION public.get_event_application_overlaps(integer);\nDROP FUNCTION private.guard_service_event();\nDROP FUNCTION private.service_event_notify(jsonb,integer[],integer,integer[]);\nDROP FUNCTION private.validate_service_event_input(jsonb);\nDROP TABLE public.event_meeting_access;\nDROP TABLE private.service_event_imports;\nALTER TABLE public.calendar_events DROP COLUMN service_kind,DROP COLUMN target_groups,DROP COLUMN primary_leader_user_id,DROP COLUMN meeting_mode,DROP COLUMN edit_version;\nDROP TABLE public.service_groups;\nNOTIFY pgrst,'reload schema';\n`
  const previous=mode==='apply-templates'?'private.validate_service_event_input(jsonb)':'public.save_service_events_tx(uuid,jsonb,uuid,boolean)'
  const undo=mode==='apply-compatibility'?sql("select pg_get_functiondef('private.service_event_notify(jsonb,integer[],integer,integer[])'::regprocedure)||E'\\n'||pg_get_functiondef('public.update_calendar_event_series_tx(uuid,uuid,date,jsonb,boolean)'::regprocedure)"):mode==='apply'?'':sql(`select pg_get_functiondef('${previous}'::regprocedure)`)
  writeFileSync(resolve(dir,'rollback.sql'),mode==='apply'?rollback:undo+"\nNOTIFY pgrst,'reload schema';\n")
  const files=mode==='apply'?['20261116_1000_group_service.sql','20261116_1010_service_event_conflict_response.sql','20261116_1020_unassigned_service_templates.sql','20261116_1030_preserve_cart_schedule_contract.sql']:[mode==='apply-conflict'?'20261116_1010_service_event_conflict_response.sql':mode==='apply-templates'?'20261116_1020_unassigned_service_templates.sql':'20261116_1030_preserve_cart_schedule_contract.sql']
  run('psql',['-X','-v','ON_ERROR_STOP=1','--single-transaction',...files.flatMap(file=>['-f',`supabase/migrations/${file}`])])
  console.log(JSON.stringify({project,backup:dir,installed:installed()}));process.exit()
}
assert.equal(installed(),'1')
mkdirSync('scratch',{recursive:true})
async function rest(path,body,token,method='POST',ok=true) {
  const response=await fetch(`${config.VITE_SUPABASE_URL}/rest/v1/${path}`,{method,headers:{apikey:config.VITE_SUPABASE_ANON_KEY,'Content-Type':'application/json',Prefer:'return=representation',...(token?{'x-session-token':token}:{})},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(90000)})
  const data=await response.json();assert.equal(response.ok,ok,JSON.stringify(data));return data
}
const marker=`gs_demo_${randomUUID().slice(0,8)}`
const fixture={marker,actors:[],eventIds:[]}
try {
  for(const role of ['admin','leader','user','leader']) {
    const suffix=fixture.actors.length
    const name=`${marker}_${suffix}`
    const id=Number(sql(`insert into app_users(login_id,name,pin,role,is_active,approval_status,group_name) values(${quote(name)},${quote(name)},extensions.crypt('0000',extensions.gen_salt('bf',6)),${quote(role)},true,'approved',${suffix===2?'null':"'东滩'"}) returning id;`).split('\n')[0])
    const token=(await rest('rpc/auth_login',{p_login_id:name,p_pin:'0000'}))[0].token
    fixture.actors.push({id,name,role,token})
  }
  const [admin,leader,user,replacement]=fixture.actors
  const payload=(date,time,end,groups)=>({event_date:date,time,end_time:end,title:groups.length===2?'[데모] 연합 집단봉사':'[데모] 집단봉사',place:'데모 모임 장소',leader_name:leader.name,memo:marker,allow_applications:true,meeting_map_url:'',service_kind:'group',target_groups:groups,primary_leader_user_id:leader.id,meeting_mode:'virtual',access:{joinUrl:'https://example.com/demo-meeting',meetingNumber:'000 000 0000',passcode:'DEMO'}})
  const wed=mode==='fixture'?'2026-11-25':'2099-11-25',sat=mode==='fixture'?'2026-11-28':'2099-11-28'
  const rows=[payload(wed,'14:30','16:30',['dongtan','singal']),payload(wed,'17:00','19:00',['dongtan','singal']),payload(sat,'14:30','16:30',['dongtan']),payload(sat,'17:00','19:00',['dongtan'])].map(payload=>({payload}))
  const key=randomUUID()
  const saved=await rest('rpc/save_service_events_tx',{p_token:admin.token,p_rows:rows,p_request_id:key,p_notify:false},admin.token)
  fixture.eventIds=saved.ids
  assert.equal(fixture.eventIds.length,4)
  if(mode==='fixture') {
    writeFileSync('scratch/group-service-fixture.json',JSON.stringify(fixture,null,2))
    console.log(JSON.stringify({project,eventIds:fixture.eventIds,accounts:fixture.actors.map(({id,name,role})=>({id,name,role}))}))
  } else {
    const checks=[]
    const check=(name,value)=>{assert.ok(value,name);checks.push(name);console.log(`PASS ${name}`)}
    const again=await rest('rpc/save_service_events_tx',{p_token:admin.token,p_rows:rows,p_request_id:key,p_notify:false},admin.token)
    check('idempotent retry',JSON.stringify(again.ids)===JSON.stringify(saved.ids))
    await rest('event_meeting_access?select=*',undefined,undefined,'GET',false);checks.push('anon direct read denied')
    await rest('rpc/get_event_meeting_access',{p_event_id:saved.ids[0]},undefined,'POST',false);checks.push('anon RPC denied')
    const access=await rest('rpc/get_event_meeting_access',{p_event_id:saved.ids[0]},user.token)
    check('approved ungrouped nonapplicant reads access',access.passcode==='DEMO')
    check('meeting table not published',sql("select count(*) from pg_publication_tables where schemaname='public' and tablename='event_meeting_access'")==='0')
    for(const id of saved.ids.slice(0,2))await rest('event_participants',{event_id:id,user_name:user.name,role:'신청'},user.token)
    fixture.cardId=Number(sql(`insert into cards(name,area,region,type,leader_name) values(${quote(marker)},'demo','demo','전체',${quote(leader.name)}) returning id`).split('\n')[0])
    for(const actor of [leader,replacement])sql(`insert into card_leader_assignments(card_id,user_name) values(${fixture.cardId},${quote(actor.name)})`)
    const assignment=[{userName:user.name,teamKey:'demo-team',cardIds:[fixture.cardId],cardScope:'전체',informalAssetIds:[]}]
    for(const id of saved.ids.slice(0,2)) {
      const result=await rest('rpc/assign_team_service_bulk_tx',{p_token:leader.token,p_event_id:id,p_assignments:assignment,p_status:'shared',p_expected_shared_at:null},leader.token)
      check(`slot ${id} team shared by assigned leader`,result.ok)
    }
    const beforeSecond=await rest(`event_card_assignment_cards?event_id=eq.${saved.ids[1]}&select=event_id,user_name,card_id`,undefined,user.token,'GET')
    check('applicant reads own shared card',beforeSecond.length===1&&beforeSecond[0].card_id===fixture.cardId)
    await rest(`event_participants?event_id=eq.${saved.ids[0]}&user_name=eq.${user.name}`,undefined,user.token,'DELETE')
    check('second slot remains applied',(await rest(`event_participants?event_id=eq.${saved.ids[1]}&user_name=eq.${user.name}`,undefined,user.token,'GET')).length===1)
    check('second slot card unchanged after first slot cancellation',JSON.stringify(await rest(`event_card_assignment_cards?event_id=eq.${saved.ids[1]}&select=event_id,user_name,card_id`,undefined,user.token,'GET'))===JSON.stringify(beforeSecond))
    check('cancelled slot card removed',sql(`select count(*) from event_card_assignment_cards where event_id=${saved.ids[0]}`)==='0')
    const updated=rows.slice(0,2).map((r,i)=>({id:saved.ids[i],version:sql(`select edit_version from calendar_events where id=${saved.ids[i]}`),payload:{...r.payload,leader_name:replacement.name,primary_leader_user_id:replacement.id}}))
    await rest('rpc/save_service_events_tx',{p_token:admin.token,p_rows:updated,p_request_id:randomUUID(),p_notify:true},admin.token)
    const notices=JSON.parse(sql(`select coalesce(json_agg(user_id order by user_id),'[]') from notifications where type='event_change' and user_id in (${fixture.actors.map(a=>a.id).join(',')})`))
    check('one notification each old/new leader and applicant',JSON.stringify(notices)===JSON.stringify([leader.id,user.id,replacement.id].sort((a,b)=>a-b)))
    const stale=await rest('rpc/save_service_events_tx',{p_token:admin.token,p_rows:updated,p_request_id:randomUUID()},admin.token,'POST',false)
    check('stale update rejected',stale.code==='PT409')
    const permissions=JSON.parse(sql(`select json_build_object('old',private.user_can_manage_event(${leader.id},${saved.ids[0]}),'new',private.user_can_manage_event(${replacement.id},${saved.ids[0]}))`))
    check('leader permission transfer',!permissions.old&&permissions.new)
    const shared=sql(`select assignment_shared_at from calendar_events where id=${saved.ids[1]}`)
    const reassigned=await rest('rpc/assign_team_service_bulk_tx',{p_token:replacement.token,p_event_id:saved.ids[1],p_assignments:assignment,p_status:'shared',p_expected_shared_at:shared},replacement.token)
    check('replacement can save existing team card assignment',reassigned.ok)
    await rest('rpc/assign_team_service_bulk_tx',{p_token:leader.token,p_event_id:saved.ids[1],p_assignments:assignment,p_status:'shared',p_expected_shared_at:shared},leader.token,'POST',false)
    checks.push('removed leader cannot save team assignment')
    writeFileSync('scratch/group-service-smoke.json',JSON.stringify({project,checks,at:new Date().toISOString()},null,2));console.log(JSON.stringify({project,checks}))
  }
} finally {
  if(mode!=='fixture') {
    const ids=fixture.actors.map(a=>a.id).join(',')
    // Remove only this run's exact fixture identities and marker-owned events.
    sql(`delete from service_sessions where calendar_event_id in (select id from calendar_events where memo=${quote(marker)});delete from calendar_events where memo=${quote(marker)};`)
    if(fixture.cardId)sql(`delete from cards where id=${fixture.cardId} and name=${quote(marker)};`)
    if(ids)sql(`delete from private.service_event_imports where actor_id in (${ids});delete from notifications where user_id in (${ids});delete from service_logs where actor_id in (${ids});delete from login_logs where user_id in (${ids});delete from auth_sessions where user_id in (${ids});delete from private.login_attempt_guard where user_id in (${ids});delete from app_users where id in (${ids}) and login_id like ${quote(marker+'%')};`)
  }
}
