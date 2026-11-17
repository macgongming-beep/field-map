import assert from 'node:assert/strict'
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs'
import {parseEnv} from 'node:util'
import {spawnSync} from 'node:child_process'
import {createECDH,randomBytes} from 'node:crypto'

const project='itjlykpjmlcvanqpmkmc',origin=`https://${project}.supabase.co`
const app='https://chinese-territory-app-demo.vercel.app'
assert.ok(process.argv.includes('--confirm-demo'))
const config=parseEnv(readFileSync(process.env.DEMO_ENV_FILE,'utf8')),db=new URL(config.SUPABASE_DB_URL)
assert.equal(config.VITE_SUPABASE_URL,origin)
assert.equal(decodeURIComponent(db.username),`postgres.${project}`)
assert.equal(db.port,'5432');assert.ok(db.hostname.endsWith('.pooler.supabase.com'))
assert.equal(JSON.parse(readFileSync('.vercel/project.json','utf8')).projectName,'chinese-territory-app-demo')
const env={...process.env,PGHOST:db.hostname,PGPORT:db.port,PGUSER:decodeURIComponent(db.username),PGPASSWORD:decodeURIComponent(db.password),PGDATABASE:db.pathname.slice(1),PGSSLMODE:'require',PGCONNECT_TIMEOUT:'15'}
const sql=input=>{
  const r=spawnSync('psql',['-X','-qAt','-v','ON_ERROR_STOP=1'],{env,input,encoding:'utf8'})
  if(r.status)throw Error('Demo SQL failed: '+r.stderr)
  return r.stdout.trim()
}
const quote=s=>`'${String(s).replaceAll("'","''")}'`
const stateFile='scratch/demo-physical-push.json'
const mode=process.argv[2]
if(mode==='bootstrap'){
  assert.equal(sql("select count(*) from app_private_settings where key in ('push_edge_function_url','push_edge_function_key')"),'0','Existing settings must not be replaced')
  assert.ok(!existsSync(stateFile),'Bootstrap already prepared; inspect saved state instead of rotating keys')
  const dir=`backups/demo-physical-push-${Date.now()}`;mkdirSync(dir,{recursive:true,mode:0o700})
  const prior=sql("select coalesce(json_agg(x),'[]') from(select * from app_private_settings where key in ('push_edge_function_url','push_edge_function_key'))x")
  writeFileSync(`${dir}/before-settings.json`,prior,{mode:0o600})
  const ecdh=createECDH('prime256v1');ecdh.generateKeys()
  const keys={VAPID_PUBLIC_KEY:ecdh.getPublicKey().toString('base64url'),VAPID_PRIVATE_KEY:ecdh.getPrivateKey().toString('base64url'),VAPID_SUBJECT:app,PUSH_EDGE_FUNCTION_KEY:randomBytes(32).toString('base64url')}
  writeFileSync(`${dir}/secrets.env`,Object.entries(keys).map(([k,v])=>`${k}=${v}`).join('\n'),{mode:0o600})
  writeFileSync(stateFile,JSON.stringify({project,dir,configured:false},null,2),{mode:0o600})
  console.log(JSON.stringify({prepared:true,backup:dir,next:'configure'}))
}else if(mode==='configure'){
  const state=JSON.parse(readFileSync(stateFile,'utf8'));assert.equal(state.project,project);assert.equal(state.configured,false)
  const keys=parseEnv(readFileSync(`${state.dir}/secrets.env`,'utf8'))
  for(const [cmd,args,input]of [
    ['supabase',['secrets','set','--project-ref',project,'--env-file',`${state.dir}/secrets.env`]],
    ['supabase',['functions','deploy','send-push','--project-ref',project,'--no-verify-jwt']],
    ['vercel',['env','add','VITE_VAPID_PUBLIC_KEY','production'],keys.VAPID_PUBLIC_KEY]
  ]){
    const result=spawnSync(cmd,args,{input,encoding:'utf8',timeout:180000})
    if(result.status!==0)throw Error(`${cmd} failed; inspect setup before retry (no secret values logged)`)
    console.log(`${cmd} setup completed`)
  }
  const endpoint=`${origin}/functions/v1/send-push`
  const rejected=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({recipient_ids:[]})})
  assert.equal(rejected.status,401)
  const probe=await fetch(endpoint,{method:'POST',headers:{Authorization:`Bearer ${keys.PUSH_EDGE_FUNCTION_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({recipient_ids:[]})})
  assert.equal(probe.status,200);assert.equal((await probe.json()).sent,0)
  sql(`begin;insert into app_private_settings(key,value)values('push_edge_function_url',${quote(endpoint)}),('push_edge_function_key',${quote(keys.PUSH_EDGE_FUNCTION_KEY)});commit;`)
  state.configured=true;writeFileSync(stateFile,JSON.stringify(state,null,2),{mode:0o600})
  console.log(JSON.stringify({configured:true,unauthorizedStatus:401,emptyDeliveryProbe:true,realPushSent:false,needsDemoAppRebuild:true}))
}else if(mode==='probe'){
  const state=JSON.parse(readFileSync(stateFile,'utf8'));assert.equal(state.project,project)
  const keys=parseEnv(readFileSync(`${state.dir}/secrets.env`,'utf8'))
  assert.equal(sql('select count(*) from app_users where id=2147483647'),'0')
  const response=await fetch(`${origin}/functions/v1/send-push`,{method:'POST',headers:{Authorization:`Bearer ${keys.PUSH_EDGE_FUNCTION_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({recipient_ids:[2147483647],type:'comment',title:'No-recipient configuration check'})})
  const result=await response.json();assert.equal(response.status,200);assert.equal(result.sent,0)
  console.log(JSON.stringify({backendConfigurationValidated:true,sent:0}))
}else if(mode==='status'){
  const recipient=existsSync(stateFile)?JSON.parse(readFileSync(stateFile,'utf8')).admin:null
  console.log(sql(`begin read only;select json_build_object('recipient',(select json_build_object('id',id,'name',name,'subscriptions',(select count(*) from push_subscriptions s where s.user_id=u.id)) from app_users u where ${recipient?`id=${Number(recipient.id)}`:`login_id=${quote(config.TEST_LOGIN_ID)}` }),'totalSubscriptions',(select count(*) from push_subscriptions),'configured',exists(select 1 from app_private_settings where key='push_edge_function_url'));rollback;`))
}else if(mode==='recipient'){
  const id=Number(process.argv[3]);assert.ok(Number.isSafeInteger(id)&&id>0)
  const state=JSON.parse(readFileSync(stateFile,'utf8'));assert.equal(state.project,project);assert.ok(state.events);assert.equal(state.deliveries.length,0)
  const admin=JSON.parse(sql(`select json_build_object('id',id,'name',name) from app_users u where id=${id} and is_active and approval_status='approved' and role in('admin','developer') and exists(select 1 from push_subscriptions where user_id=u.id)`))
  assert.ok(admin?.id)
  const event=Number(state.events.find(e=>e.group==='singal').id)
  const login=await fetch(`${origin}/rest/v1/rpc/auth_login`,{method:'POST',headers:{apikey:config.VITE_SUPABASE_ANON_KEY,'Content-Type':'application/json'},body:JSON.stringify({p_login_id:config.TEST_LOGIN_ID,p_pin:config.TEST_LOGIN_PIN})})
  assert.ok(login.ok);const [{token}]=await login.json();assert.ok(token)
  sql(`begin;do $$declare result jsonb;rev bigint;begin
    perform 1 from calendar_events where id=${event} and title='[데모] 휴대폰 알림 확인' for update;
    if not found then raise exception 'Test event required';end if;
    if exists(select 1 from event_participants where event_id=${event} and user_name<>${quote(state.admin.name)})then raise exception 'Unexpected participant';end if;
    select assignment_revision(e) into rev from calendar_events e where id=${event};
    result:=manage_event_participant_versioned_tx(${quote(token)}::uuid,${event},${quote(state.admin.name)},'remove',rev);
    if result->>'ok' is distinct from 'true' then raise exception 'Removal failed';end if;
    select assignment_revision(e) into rev from calendar_events e where id=${event};
    result:=manage_event_participant_versioned_tx(${quote(token)}::uuid,${event},${quote(admin.name)},'add',rev);
    if result->>'ok' is distinct from 'true' then raise exception 'Addition failed';end if;
  end$$;commit;`)
  state.admin=admin;writeFileSync(stateFile,JSON.stringify(state,null,2),{mode:0o600})
  console.log(JSON.stringify({recipient:admin.name,realPushSent:false}))
}else if(mode==='prepare'){
  const state=JSON.parse(readFileSync(stateFile,'utf8'));assert.equal(state.project,project);assert.ok(state.configured);assert.ok(!state.events)
  const admin=JSON.parse(sql(`select json_build_object('id',id,'name',name) from app_users where login_id=${quote(config.TEST_LOGIN_ID)} and role in('admin','developer') and is_active and approval_status='approved'`))
  assert.ok(Number(admin.id)>0)
  const login=await fetch(`${origin}/rest/v1/rpc/auth_login`,{method:'POST',headers:{apikey:config.VITE_SUPABASE_ANON_KEY,'Content-Type':'application/json'},body:JSON.stringify({p_login_id:config.TEST_LOGIN_ID,p_pin:config.TEST_LOGIN_PIN})})
  assert.ok(login.ok);const [{token}]=await login.json();assert.ok(token)
  const events=JSON.parse(sql(`begin;select set_config('app.suppress_notifications','on',true) is not null as suppressed \\gset
    with added as(insert into calendar_events(event_date,time,end_time,title,service_kind,target_groups,group_service_scope)
      select current_date,'23:47','23:57','[데모] 휴대폰 알림 확인','group',array[g],true from unnest(array['dongtan','singal','cheoin','dongbaek'])g returning id,target_groups)
    select json_agg(json_build_object('id',id,'group',target_groups[1])) from added;
    set local request.headers=${quote(JSON.stringify({'x-session-token':token}))};set local role anon;
    insert into event_participants(event_id,user_name,role)select id,${quote(admin.name)},'신청' from calendar_events where title='[데모] 휴대폰 알림 확인' and event_date=current_date and time='23:47' and target_groups=array['singal'];commit;`))
  state.events=events;state.admin=admin;state.deliveries=[];writeFileSync(stateFile,JSON.stringify(state,null,2),{mode:0o600})
  console.log(JSON.stringify({prepared:true,recipient:admin.name,link:`${app}/calendar?openEvent=${events.find(e=>e.group==='singal').id}`,realPushSent:false}))
}else if(mode==='send'){
  const kind=process.argv[3];assert.ok(['comment','mention'].includes(kind))
  const state=JSON.parse(readFileSync(stateFile,'utf8'));assert.equal(state.project,project);assert.ok(state.events)
  assert.ok(Number(sql(`select count(*) from push_subscriptions where user_id=${Number(state.admin.id)}`))>0,'Recipient has not registered an actual device')
  const event=state.events.find(e=>e.group==='singal').id
  const target=JSON.parse(sql(`select json_build_object('title',title,'leaders',leader_name,'participants',(select json_agg(user_name) from event_participants where event_id=e.id)) from calendar_events e where id=${Number(event)}`))
  assert.equal(target.title,'[데모] 휴대폰 알림 확인');assert.equal(target.leaders,'');assert.deepEqual(target.participants,[state.admin.name])
  const writer=JSON.parse(readFileSync('scratch/group-tabs-fixture.json','utf8')).actors[4]
  assert.ok(writer.name.startsWith('gt_demo_'));assert.notEqual(writer.id,state.admin.id)
  const login=await fetch(`${origin}/rest/v1/rpc/auth_login`,{method:'POST',headers:{apikey:config.VITE_SUPABASE_ANON_KEY,'Content-Type':'application/json'},body:JSON.stringify({p_login_id:writer.name,p_pin:'0000'})})
  assert.ok(login.ok);const [{token}]=await login.json();assert.ok(token)
  const marker=`[휴대폰 확인 ${kind==='mention'?'멘션':'댓글'}] ${new Date().toISOString()}`
  const result=JSON.parse(sql(`begin;set local request.headers=${quote(JSON.stringify({'x-session-token':token}))};set local role anon;
    insert into comments(target_type,target_id,author_id,author_name,content,mention_ids,mention_names)
    values('calendar_event',${Number(event)},${Number(writer.id)},${quote(writer.name)},${quote(marker)},${kind==='mention'?`array[${Number(state.admin.id)}]`:'array[]::integer[]'},${kind==='mention'?`array[${quote(state.admin.name)}]`:'array[]::text[]'}) returning id as comment_id \\gset
    reset role;
    do $$begin if exists(select 1 from notifications where type in('comment','mention') and related_id=(select id from comments where content=${quote(marker)}) and user_id<>${Number(state.admin.id)})then raise exception 'Unexpected recipient; delivery rolled back';end if;end$$;
    select json_build_object('commentId',:comment_id,'recipients',(select json_agg(json_build_object('userId',user_id,'type',type,'link',link)) from notifications where related_id=:comment_id and type in('comment','mention')));commit;`))
  state.deliveries.push({kind,at:new Date().toISOString(),...result,physicalReceipt:'awaiting-user'})
  writeFileSync(stateFile,JSON.stringify(state,null,2),{mode:0o600})
  console.log(JSON.stringify({sent:true,...result,physicalReceipt:'awaiting-user'}))
}else throw Error('Use bootstrap, configure, probe, status, prepare, recipient ID or send comment/mention')
