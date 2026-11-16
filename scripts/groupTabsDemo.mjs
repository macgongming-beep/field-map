import assert from 'node:assert/strict'
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs'
import {parseEnv} from 'node:util'
import {spawnSync} from 'node:child_process'
import {randomUUID} from 'node:crypto'
import {resolve} from 'node:path'
process.umask(0o077)
const project='itjlykpjmlcvanqpmkmc'
const config=parseEnv(readFileSync(process.env.DEMO_ENV_FILE,'utf8'))
assert.equal(config.VITE_SUPABASE_URL,`https://${project}.supabase.co`)
const db=new URL(config.SUPABASE_DB_URL)
assert.equal(decodeURIComponent(db.username),`postgres.${project}`)
assert.ok(db.hostname.endsWith('.pooler.supabase.com'));assert.equal(db.port,'5432')
assert.ok(process.argv.includes('--confirm-demo'))
const env={...process.env,PGHOST:db.hostname,PGPORT:db.port,PGUSER:decodeURIComponent(db.username),PGDATABASE:db.pathname.slice(1),PGPASSWORD:decodeURIComponent(db.password),PGSSLMODE:'require',PGCONNECT_TIMEOUT:'15'}
function run(command,args,input){const r=spawnSync(command,args,{env,input,encoding:'utf8',maxBuffer:128*1024*1024});if(r.error||r.status)throw r.error??Error(r.stderr);return r.stdout.trim()}
const sql=q=>run('psql',['-X','-At','-v','ON_ERROR_STOP=1'],q)
const quote=s=>`'${s.replaceAll("'","''")}'`
const mode=process.argv[2]
assert.ok(['apply','apply-integrity','fixture','smoke'].includes(mode))
const tables=['event_participants','event_card_assignments','event_card_assignment_cards','event_informal_assignments','event_restaurant_assignments']
if(mode==='apply'||mode==='apply-integrity'){
  assert.equal(sql("select count(*) from information_schema.columns where table_name='calendar_events' and column_name='group_service_scope'"),mode==='apply'?'0':'1')
  const dir=resolve('backups',`group-tabs-demo-${Date.now()}`);mkdirSync(dir,{recursive:true})
  run('pg_dump',['--format=custom','--no-owner','--schema=public','--schema=private','--file',resolve(dir,'before.dump')]);run('pg_restore',['--list',resolve(dir,'before.dump')])
  if(mode==='apply-integrity'){
    writeFileSync(resolve(dir,'rollback.sql'),"drop policy group_service_scoped_read on public.service_sessions;drop index public.group_service_scope_slot;notify pgrst,'reload schema';\n")
    run('psql',['-X','-v','ON_ERROR_STOP=1','--single-transaction','-f','supabase/migrations/20261116_1210_group_service_scope_integrity.sql'])
    console.log(JSON.stringify({project,backup:dir,integrityApplied:true}));process.exit()
  }
  const old=sql("select pg_get_functiondef('private.user_can_manage_event(integer,integer)'::regprocedure)||E'\\n'||pg_get_functiondef('public.save_service_events_tx(uuid,jsonb,uuid,boolean)'::regprocedure)")
  writeFileSync(resolve(dir,'rollback.sql'),`${old}\n${tables.map(t=>`drop policy group_service_scoped_read on public.${t};`).join('\n')}
drop function public.get_group_service_context(integer);
drop function public.can_read_group_service_row(integer,text);
drop trigger guard_group_service_scope on public.calendar_events;
drop function private.guard_group_service_scope();
drop table private.service_group_supervisors;
alter table public.calendar_events drop column group_service_scope;
notify pgrst,'reload schema';\n`)
  run('psql',['-X','-v','ON_ERROR_STOP=1','--single-transaction','-f','supabase/migrations/20261116_1200_group_service_tabs.sql'])
  console.log(JSON.stringify({project,backup:dir,applied:true}));process.exit()
}
async function rest(path,body,token,method='POST',ok=true){
  const response=await fetch(`${config.VITE_SUPABASE_URL}/rest/v1/${path}`,{method,headers:{apikey:config.VITE_SUPABASE_ANON_KEY,'Content-Type':'application/json',Prefer:'return=representation',...(token?{'x-session-token':token}:{})},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(60000)})
  const data=await response.json();assert.equal(response.ok,ok,JSON.stringify(data));return data
}
const file='scratch/group-tabs-fixture.json'
const groups=['dongtan','singal','cheoin','dongbaek'],labels=['东滩','新葛','处仁','东柏']
if(mode==='fixture'){
  assert.ok(!existsSync(file),'Fixture already exists; preserve it')
  assert.equal(sql('select count(*) from private.service_group_supervisors'),'0','Do not overwrite supervisor bindings')
  const marker=`gt_demo_${randomUUID().slice(0,8)}`,fixture={marker,actors:[],eventIds:[],cardIds:[]}
  const admin=(await rest('rpc/auth_login',{p_login_id:config.TEST_LOGIN_ID,p_pin:config.TEST_LOGIN_PIN}))[0]
  for(let i=0;i<9;i++){
    const role=i<4?'leader':'user',group=i===8?null:groups[i%4],name=`${marker}_${i}`
    const id=Number(sql(`insert into app_users(login_id,name,pin,role,is_active,approval_status,group_name) values(${quote(name)},${quote(name)},extensions.crypt('0000',extensions.gen_salt('bf',6)),${quote(role)},true,'approved',${group?quote(labels[i%4]):'null'}) returning id`).split('\n')[0])
    const token=(await rest('rpc/auth_login',{p_login_id:name,p_pin:'0000'}))[0].token
    fixture.actors.push({id,name,role,group,token})
    if(i<4)sql(`insert into private.service_group_supervisors values(${quote(group)},${id})`)
  }
  const payload=(group,time,end)=>({event_date:'2026-11-18',time,end_time:end,title:'집단 봉사',place:'',memo:'집단 탭 확인용 데모',leader_name:'',allow_applications:true,meeting_map_url:'',service_kind:'group',target_groups:[group],group_service_scope:true,primary_leader_user_id:null,meeting_mode:'none',access:{joinUrl:'',meetingNumber:'',passcode:''}})
  const rows=[['14:30','16:30'],['17:00','19:00']].flatMap(([time,end])=>groups.map(g=>({payload:payload(g,time,end)})))
  fixture.eventIds=(await rest('rpc/save_service_events_tx',{p_token:admin.token,p_rows:rows,p_request_id:randomUUID(),p_notify:false},admin.token)).ids
  for(let i=0;i<4;i++){
    await rest('rpc/apply_service_activity_tx',{p_token:fixture.actors[i+4].token,p_event_id:fixture.eventIds[i],p_activity:'service'},fixture.actors[i+4].token)
    const cardId=Number(sql(`insert into cards(name,area,region,type,leader_name) values(${quote(marker+'_'+groups[i])},'demo','demo','전체',${quote(fixture.actors[i].name)}) returning id`).split('\n')[0])
    fixture.cardIds.push(cardId)
    sql(`insert into card_leader_assignments(card_id,user_name)values(${cardId},${quote(fixture.actors[i].name)})`)
  }
  await rest('rpc/apply_service_activity_tx',{p_token:fixture.actors[8].token,p_event_id:fixture.eventIds[0],p_activity:'return_visit'},fixture.actors[8].token)
  mkdirSync('scratch',{recursive:true});writeFileSync(file,JSON.stringify(fixture,null,2))
  console.log(JSON.stringify({project,eventIds:fixture.eventIds,supervisors:fixture.actors.slice(0,4).map(({id,name,group})=>({id,name,group}))}));process.exit()
}
const fixture=JSON.parse(readFileSync(file,'utf8'))
for(const actor of fixture.actors)actor.token=(await rest('rpc/auth_login',{p_login_id:actor.name,p_pin:'0000'}))[0].token
writeFileSync(file,JSON.stringify(fixture,null,2))
const checks=[],check=(label,truth)=>{assert.ok(truth,label);checks.push(label);console.log(`PASS ${label}`)}
const [a,b]=fixture.actors,[own,other]=fixture.eventIds
for(let i=0;i<4;i++){
  const actor=fixture.actors[i],id=fixture.eventIds[i]
  const ctx=await rest('rpc/get_group_service_context',{p_event_id:own},actor.token)
  check(`supervisor ${groups[i]} owns exactly one tab`,ctx.ownGroup===groups[i]&&ctx.events.filter(e=>e.canManage).length===1&&ctx.events.find(e=>e.id===id).canManage)
  const members=await rest(`event_participants?event_id=in.(${fixture.eventIds.join(',')})&select=event_id,user_name`,undefined,actor.token,'GET')
  check(`supervisor ${groups[i]} only reads own roster`,members.length>0&&members.every(r=>r.event_id===id))
}
for(const table of tables){
  const result=await rest(`${table}?event_id=eq.${other}&select=*`,undefined,a.token,'GET')
  check(`${table} foreign read empty`,result.length===0)
}
await rest('rpc/get_group_service_context',{p_event_id:own},undefined,'POST',false);checks.push('anonymous context rejected')
check('anonymous scoped roster empty',(await rest(`event_participants?event_id=eq.${own}`,undefined,undefined,'GET')).length===0)
const assignment=(i)=>[{userName:fixture.actors[i+4].name,teamKey:`${fixture.marker}_team${i}`,cardIds:[fixture.cardIds[i]],cardScope:'전체',informalAssetIds:[]}]
const shared=id=>sql(`select coalesce(assignment_shared_at::text,'') from calendar_events where id=${id}`)||null
await rest('rpc/assign_team_service_bulk_tx',{p_token:a.token,p_event_id:other,p_assignments:assignment(1),p_status:'shared',p_expected_shared_at:shared(other)},a.token,'POST',false);checks.push('forged foreign assignment denied')
await rest('event_participants',{event_id:other,user_name:fixture.actors[8].name,role:'신청'},a.token,'POST',false);checks.push('foreign manual participant insert denied')
for(let i=0;i<2;i++){
  const actor=fixture.actors[i],id=fixture.eventIds[i]
  const result=await rest('rpc/assign_team_service_bulk_tx',{p_token:actor.token,p_event_id:id,p_assignments:assignment(i),p_status:'shared',p_expected_shared_at:shared(id)},actor.token)
  check(`own group ${i} assignment succeeds`,result.ok)
}
check('other supervisor cannot read assigned names',(await rest(`event_card_assignments?event_id=eq.${other}&select=user_name`,undefined,a.token,'GET')).length===0)
check('own member can read assigned team',(await rest(`event_card_assignments?event_id=eq.${other}&select=user_name`,undefined,fixture.actors[5].token,'GET')).length>0)
check('derived session names hidden',(await rest(`service_sessions?calendar_event_id=eq.${other}&select=user_name`,undefined,a.token,'GET')).length===0)
const ungrouped=fixture.actors[8],end=fixture.eventIds[7]
await rest('rpc/apply_service_activity_tx',{p_token:ungrouped.token,p_event_id:end,p_activity:'return_visit'},ungrouped.token)
check('ungrouped user can apply to chosen group',(await rest(`event_participants?event_id=eq.${end}`,undefined,ungrouped.token,'GET')).some(r=>r.user_name===ungrouped.name))
await rest(`event_participants?event_id=eq.${end}&user_name=eq.${ungrouped.name}`,undefined,ungrouped.token,'DELETE')
check('ungrouped user can cancel own application',(await rest(`event_participants?event_id=eq.${end}`,undefined,ungrouped.token,'GET')).length===0)
writeFileSync('scratch/group-tabs-smoke.json',JSON.stringify({project,checks,at:new Date().toISOString()},null,2))
console.log(JSON.stringify({project,passed:checks.length}))
