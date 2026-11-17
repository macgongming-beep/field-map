import assert from 'node:assert/strict'
import {readFileSync,writeFileSync} from 'node:fs'
import {parseEnv} from 'node:util'
import {spawnSync} from 'node:child_process'
import {createClient} from '@supabase/supabase-js'
import {randomUUID} from 'node:crypto'
const config=parseEnv(readFileSync(process.env.DEMO_ENV_FILE,'utf8')),project='itjlykpjmlcvanqpmkmc'
const origin=`https://${project}.supabase.co`,db=new URL(config.SUPABASE_DB_URL),app=process.env.DEMO_APP_URL||'https://chinese-territory-app-demo.vercel.app'
assert.equal(config.VITE_SUPABASE_URL,origin);assert.equal(decodeURIComponent(db.username),`postgres.${project}`)
assert.equal(db.port,'5432');assert.ok(db.hostname.endsWith('.pooler.supabase.com'))
assert.ok(['http://localhost:5181','https://chinese-territory-app-demo.vercel.app'].includes(app))
const env={...process.env,PGHOST:db.hostname,PGPORT:db.port,PGUSER:decodeURIComponent(db.username),PGPASSWORD:decodeURIComponent(db.password),PGDATABASE:db.pathname.slice(1),PGSSLMODE:'require'}
const sql=q=>{const r=spawnSync('psql',['-X','-qAt','-v','ON_ERROR_STOP=1'],{env,input:q,encoding:'utf8'});if(r.status)throw Error(r.stderr);return r.stdout.trim()}
const quote=s=>`'${String(s).replaceAll("'","''")}'`
const fixture=JSON.parse(readFileSync('scratch/group-tabs-fixture.json','utf8')),actors=fixture.actors
assert.ok(actors.every(a=>a.name.startsWith('gt_demo_')))
const marker=`comments_demo_${Date.now()}`,ids=[],commentIds=[],checks=[],traffic=[],calendarReads=[],errors=[]
const recoveryTraffic=[],recoveryFrames=[],recoveryPhases=new Set(['foreground-20','foreground-40','reconnect-40'])
const expiredToken=randomUUID()
const check=(label,ok)=>{assert.ok(ok,label);checks.push(label);console.log(`PASS ${label}`)}
async function request(path,body,token,method='POST'){
  const r=await fetch(`${origin}/rest/v1/${path}`,{method,headers:{apikey:config.VITE_SUPABASE_ANON_KEY,'Content-Type':'application/json',Prefer:'return=representation',...(token?{'x-session-token':token}:{})},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(20000)})
  const data=await r.json();assert.ok(r.ok,JSON.stringify(data));return data
}
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE)
const browser=await chromium.launch({headless:true})
const anonymousClient=createClient(origin,config.VITE_SUPABASE_ANON_KEY,{auth:{persistSession:false}}),anonymousBodies=[],anonymousSignals=[]
let phase='setup'
const flush=()=>new Promise(r=>setTimeout(r,700))
try{
  for(const a of actors)a.token=(await request('rpc/auth_login',{p_login_id:a.name,p_pin:'0000'}))[0].token
  const writer=actors[4],reader=actors[6],applicant=actors[5],leader=actors[1]
  sql(`insert into auth_sessions(token,user_id,expires_at)values(${quote(expiredToken)},${reader.id},now()-interval '1 hour');`)
  for(const group of ['dongtan','singal','cheoin','dongbaek'])ids.push(Number(sql(`insert into calendar_events(event_date,time,end_time,title,leader_name,service_kind,target_groups,group_service_scope,allow_applications)
    values('2026-11-18','21:30','22:30',${quote(marker)},'','group',array[${quote(group)}],true,true) returning id;`)))
  const target=ids[1]
  sql(`insert into comments(target_type,target_id,author_id,author_name,content) select 'calendar_event',${target},${writer.id},${quote(writer.name)},${quote(marker+' seed ')}||n from generate_series(1,45)n;`)
  sql(`update calendar_events set leader_name=${quote(leader.name)} where id=${target};`)
  await request('event_participants',{event_id:target,user_name:applicant.name,role:'신청'},applicant.token)
  const anonymous=await request(`comments?target_type=eq.calendar_event&target_id=eq.${target}&select=id`,undefined,undefined,'GET')
  check('anonymous cannot read group comments',anonymous.length===0)
  const foreign=await request(`comments?target_type=eq.calendar_event&target_id=eq.${target}&select=id&limit=1`,undefined,reader.token,'GET')
  check('approved foreign-group member can read comments',foreign.length===1)
  const expired=await fetch(`${origin}/rest/v1/rpc/read_group_event_comments`,{method:'POST',headers:{apikey:config.VITE_SUPABASE_ANON_KEY,'Content-Type':'application/json','x-session-token':expiredToken},body:JSON.stringify({p_event_id:target})})
  const expiredError=await expired.json();check(`expired actual session produces explicit error instead of an empty array (HTTP ${expired.status})`,[401,403].includes(expired.status)&&expiredError.code==='42501'&&expiredError.message==='COMMENT_SESSION_REQUIRED')
  const cartRecipients=JSON.parse(sql(`begin;
    insert into event_cart_applications(event_id,user_id)values(${target},${actors[7].id});
    insert into comments(target_type,target_id,author_id,author_name,content)values('calendar_event',${target},${writer.id},${quote(writer.name)},${quote(marker+' cart')});
    select coalesce(json_agg(user_id),'[]') from notifications where type='comment' and related_id in(select id from comments where content=${quote(marker+' cart')});rollback;`))
  check('installed notification includes a cart-only applicant',cartRecipients.includes(actors[7].id))
  const subscribe=(table,filter,rows)=>new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(Error('Anonymous realtime probe timed out')),15000)
    anonymousClient.channel(`${marker}:${table}`).on('postgres_changes',{event:'*',schema:'public',table,filter},payload=>rows.push(payload.new)).subscribe(status=>{
      if(status==='SUBSCRIBED'){clearTimeout(timer);resolve()}
      if(status==='CHANNEL_ERROR'||status==='TIMED_OUT'){clearTimeout(timer);reject(Error(status))}
    })
  })
  await subscribe('comments',`target_id=eq.${target}`,anonymousBodies)
  await subscribe('group_comment_signals',`event_id=eq.${target}`,anonymousSignals)
  const context=await browser.newContext({viewport:{width:430,height:932},serviceWorkers:'block'})
  await context.addInitScript(()=>{const Original=window.WebSocket;window.__commentSockets=[];window.WebSocket=class extends Original{constructor(...args){super(...args);window.__commentSockets.push(this)}}})
  await context.route('**/*.supabase.co/**',route=>{assert.equal(new URL(route.request().url()).origin,origin);return route.continue()})
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message))
  page.on('websocket',socket=>{
    if(!socket.url().includes('.supabase.co'))return
    for(const [event,direction]of [['framesent','sent'],['framereceived','received']])socket.on(event,({payload})=>{
      if(recoveryPhases.has(phase))recoveryFrames.push({phase,direction,bytes:Buffer.byteLength(payload)})
    })
  })
  page.on('request',request=>{
    const url=new URL(request.url())
    if(url.origin===origin&&url.pathname.endsWith('/calendar_events')&&request.method()==='GET')calendarReads.push({phase,query:url.search})
  })
  page.on('response',async response=>{
    const url=new URL(response.url());if(url.origin!==origin)return
    const stamp=phase
    if(recoveryPhases.has(stamp))try{recoveryTraffic.push({phase:stamp,endpoint:url.pathname,method:response.request().method(),status:response.status(),bodyBytes:(await response.body()).length})}catch{}
    if(!url.pathname.endsWith('/comments')&&!url.pathname.endsWith('/read_group_event_comments'))return
    try{const body=await response.body();const rows=JSON.parse(body.toString());traffic.push({phase:stamp,method:response.request().method(),kind:url.pathname.endsWith('/read_group_event_comments')?'read':'write',eventId:response.request().postDataJSON()?.p_event_id,query:url.search,rows:Array.isArray(rows)?rows.length:rows?.id?1:null,jsonBytes:body.length})}catch{}
  })
  await page.goto(app);await page.locator('#login-id').fill(reader.name);await page.locator('#pin').fill('0000');await page.locator('.login-form button[type=submit]').click()
  await page.waitForFunction(()=>!document.querySelector('#login-id'))
  phase='open'
  await page.goto(`${app}/calendar?openEvent=${ids[0]}`)
  await page.getByRole('tab',{name:/^신갈/}).waitFor();await page.getByRole('tab',{name:/^신갈/}).click()
  await page.getByText(marker+' seed 45',{exact:true}).waitFor({timeout:15000});await flush()
  check('comments and shared composer are visible without expanding',await page.locator('.gs-event-comments .comment-composer').isVisible()&&await page.locator('.gs-event-comments summary').count()===0&&await page.locator('.gs-event-comments .comment-section__head').isVisible())
  check('first selection reads one bounded page of 20 for selected group',traffic.filter(r=>r.phase==='open'&&r.kind==='read'&&r.eventId===target).length===1&&traffic.find(r=>r.phase==='open'&&r.eventId===target).rows===20)
  const waitReads=async(expected)=>{const deadline=Date.now()+20000;while(traffic.filter(r=>r.phase===phase&&r.kind==='read').length<expected&&Date.now()<deadline)await new Promise(r=>setTimeout(r,100));await flush()}
  const foreground=async(label,expected)=>{
    phase=`${label}-hidden`
    await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});document.dispatchEvent(new Event('visibilitychange'))});await flush()
    check(`${label}: background issues no comment reads`,traffic.filter(r=>r.phase===phase).length===0)
    phase=label
    await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'});document.dispatchEvent(new Event('visibilitychange'))})
    await waitReads(expected)
    check(`${label}: keeps visible feed and reads only loaded pages`,await page.locator('.gs-event-comments .comment-composer').isVisible()&&traffic.filter(r=>r.phase===label&&r.kind==='read').length===expected)
  }
  await foreground('foreground-20',1)
  phase='older';await page.getByRole('button',{name:'이전 댓글 보기',exact:true}).click();await page.getByText(marker+' seed 6',{exact:true}).waitFor();await flush()
  check('older page loads only next 20',traffic.filter(r=>r.phase==='older').length===1&&traffic.find(r=>r.phase==='older').rows===20)
  await foreground('foreground-40',2)
  phase='reconnect-40'
  await page.evaluate(()=>window.__commentSockets.filter(socket=>socket.readyState===1&&socket.url.includes('.supabase.co')).forEach(socket=>socket.close()))
  await waitReads(2)
  check('socket reconnection reloads just two loaded pages',traffic.filter(r=>r.phase==='reconnect-40'&&r.kind==='read').length===2)
  const post=async(content,mentions=[])=>{
    const [r]=await request('comments?select=id',{target_type:'calendar_event',target_id:target,author_id:writer.id,author_name:writer.name,content,mention_ids:mentions.map(a=>a.id),mention_names:mentions.map(a=>a.name)},writer.token)
    commentIds.push(r.id);return r
  }
  phase='live'
  const posted=await post(marker+' live',[applicant,reader]);await page.getByText(marker+' live',{exact:true}).waitFor({timeout:15000});await flush()
  check('live insertion reads only changed comment',traffic.filter(r=>r.phase==='live').length===1&&traffic.find(r=>r.phase==='live').rows===1)
  check('anonymous realtime receives identifiers only, never group comment bodies',anonymousBodies.length===0&&anonymousSignals.length>0&&anonymousSignals.every(row=>Object.keys(row).every(key=>['event_id','comment_id','revision'].includes(key))))
  const recipients=JSON.parse(sql(`select json_agg(x order by user_id) from (select user_id,type,link from notifications where related_id=${posted.id} and type in ('comment','mention'))x;`))
  check('only event leader/applicant/mentions notified once; author and unrelated leaders excluded',JSON.stringify(recipients.map(r=>[r.user_id,r.type]))===JSON.stringify([[leader.id,'comment'],[applicant.id,'mention'],[reader.id,'mention']].sort((a,b)=>a[0]-b[0])))
  check('notification link identifies exact group and comment',recipients.every(r=>r.link===`/calendar?openEvent=${target}&comment=${posted.id}`))
  phase='edit';await request(`comments?id=eq.${posted.id}`,{content:marker+' edited'},writer.token,'PATCH');await page.getByText(marker+' edited',{exact:true}).waitFor();await flush()
  check('edit refreshes one comment only',traffic.filter(r=>r.phase==='edit').length===1&&traffic.find(r=>r.phase==='edit').rows===1)
  phase='delete';await request(`comments?id=eq.${posted.id}`,{deleted_at:new Date().toISOString()},writer.token,'PATCH');await page.getByText(marker+' edited',{exact:true}).waitFor({state:'hidden'});await flush()
  check('delete uses one ID lookup, not history reload',traffic.filter(r=>r.phase==='delete').length===1&&traffic.find(r=>r.phase==='delete').rows===0)
  check('live comment/edit/delete never reload calendar events',calendarReads.filter(r=>['live','edit','delete'].includes(r.phase)).length===0)
  phase='write';await page.locator('.comment-composer textarea').fill(marker+' reader');await page.locator('.comment-composer button').last().click()
  await page.getByText(marker+' reader',{exact:true}).waitFor();await flush()
  check('own write returns row and never reloads full history',traffic.filter(r=>r.phase==='write'&&r.kind==='read').every(r=>r.rows<=1)&&traffic.some(r=>r.phase==='write'&&r.kind==='write'&&r.rows===1))
  phase='other-tab';await page.getByRole('tab',{name:/^동탄/}).click();await page.locator('.comment-empty').waitFor();await flush()
  check('empty meeting information is absent',await page.getByText('모임 정보',{exact:true}).count()===0)
  check('other group does not show previous comments',await page.locator('.comment-item').count()===0)
  await post(marker+' while-other');await flush();check('inactive group does not fetch on incoming comment',traffic.filter(r=>r.phase==='other-tab').length===1)
  phase='notification'
  const mention=await post(marker+' notification',[reader]);await page.reload()
  const bell=page.getByRole('button',{name:/^알림(?: \d+개)?$/}).first();await bell.click()
  const notification=page.locator('.notification-row').filter({hasText:marker+' notification'});await notification.waitFor({timeout:15000});await notification.click()
  await page.getByText(marker+' notification',{exact:true}).waitFor({timeout:15000})
  check('actual mention click selects foreign group with comments visible',await page.getByRole('tab',{name:/^신갈/}).getAttribute('aria-selected')==='true'&&await page.locator('.gs-event-comments .comment-composer').isVisible())
  check('populated meeting information remains available',await page.getByText('모임 정보',{exact:true}).count()===1)
  await page.screenshot({path:'scratch/group-comments-mobile.png',fullPage:true})
  await page.setViewportSize({width:320,height:740});await page.evaluate(()=>{document.querySelector('#root').style.zoom='1.25';document.querySelector('#root').style.setProperty('--app-zoom','1.25')})
  await page.getByText(marker+' notification',{exact:true}).scrollIntoViewIfNeeded()
  check('comments fit 320px at large text',await page.locator('.gs-tab-body').evaluate(el=>el.scrollWidth<=el.clientWidth+1))
  check('long author names fit inside comment bodies',await page.locator('.comment-item__body').evaluateAll(elements=>elements.every(el=>el.scrollWidth<=el.clientWidth+1)))
  await page.screenshot({path:'scratch/group-comments-320.png'})
  const desktop=await context.newPage();await desktop.setViewportSize({width:1440,height:1000});desktop.on('pageerror',e=>errors.push(e.message))
  await desktop.goto(`${app}/calendar?openEvent=${target}&comment=${mention.id}`)
  await desktop.getByText(marker+' notification',{exact:true}).waitFor({timeout:15000})
  check('desktop notification chooses exact group too',await desktop.getByRole('tab',{name:/^신갈/}).getAttribute('aria-selected')==='true')
  await desktop.screenshot({path:'scratch/group-comments-desktop.png',fullPage:true})
  await desktop.getByRole('tab',{name:/^동탄/}).click()
  const desktopBell=desktop.getByRole('button',{name:/^알림(?: \d+개)?$/}).first();await desktopBell.click()
  await desktop.locator('.notification-row').filter({hasText:marker+' notification'}).click()
  await desktop.getByText(marker+' notification',{exact:true}).waitFor()
  check('repeated same notification returns to its group on desktop',await desktop.getByRole('tab',{name:/^신갈/}).getAttribute('aria-selected')==='true')
  await request(`comments?id=eq.${mention.id}`,{deleted_at:new Date().toISOString()},writer.token,'PATCH')
  await desktop.getByText('삭제되었거나 찾을 수 없는 댓글입니다.',{exact:true}).waitFor()
  check('deleted notification target has an explicit notice',true)
  phase='expired-visible'
  await page.route('**/rpc/read_group_event_comments',route=>route.continue({headers:{...route.request().headers(),'x-session-token':expiredToken}}))
  const oldCount=await page.locator('.comment-item').count()
  await post(marker+' session-expired')
  await page.getByRole('alert').filter({hasText:'다시 로그인'}).waitFor()
  check('expired session UI asks to sign in without pretending comments were deleted',await page.locator('.comment-item').count()===oldCount&&await page.locator('.comment-composer button').last().isDisabled())
  await page.getByRole('tab',{name:/^동탄/}).click()
  await page.getByRole('alert').filter({hasText:'다시 로그인'}).waitFor()
  check('expired initial page is login guidance, not an empty-list message',await page.locator('.comment-empty').count()===0)
  const pushTypes=JSON.parse(sql(`begin;
    select set_config('app.push_edge_function_url','https://comment-probe.invalid/push',true) is not null;
    select set_config('app.push_edge_function_key','transaction-only-probe',true) is not null;
    insert into comments(target_type,target_id,author_id,author_name,content,mention_ids,mention_names)values('calendar_event',${target},${writer.id},${quote(writer.name)},${quote(marker+' push')},array[${reader.id}],array[${quote(reader.name)}]);
    select coalesce(json_agg(convert_from(body,'UTF8')::jsonb->>'type'),'[]') from net.http_request_queue where (convert_from(body,'UTF8')::jsonb->>'related_id')::bigint in(select id from comments where content=${quote(marker+' push')});rollback;`).split('\n').at(-1))
  check('ordinary and mention push requests queue without sending device notifications',pushTypes.includes('comment')&&pushTypes.includes('mention'))
  check('no browser errors',errors.length===0)
  const report={app,checks,traffic,calendarReads,recoveryTraffic,recoveryFrames,errors,pushTypes,note:'Foreground uses controlled visibilitychange in Chromium; reconnection closes real Supabase sockets. HTTP bytes are decoded bodies and WS bytes are payloads, not billed/network bytes. No monthly extrapolation, physical device lifecycle or physical push receipt claim.'}
  writeFileSync('scratch/group-comments-results.json',JSON.stringify(report,null,2))
  console.log(JSON.stringify(report))
}finally{
  await anonymousClient.removeAllChannels()
  await browser.close()
  sql(`delete from auth_sessions where token=${quote(expiredToken)};`)
  if(ids.length)sql(`delete from notifications where type in('comment','mention') and related_id in(select id from comments where target_type='calendar_event' and target_id in(${ids.join(',')}));delete from comments where target_type='calendar_event' and target_id in(${ids.join(',')});delete from calendar_events where id in(${ids.join(',')}) and title=${quote(marker)};`)
}
