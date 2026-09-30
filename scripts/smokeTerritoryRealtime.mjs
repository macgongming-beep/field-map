import { readFileSync, writeFileSync } from 'node:fs'
import { parseEnv } from 'node:util'
import { spawnSync } from 'node:child_process'
if (process.env.PLAYWRIGHT_ALLOW_WRITES !== 'true') throw Error('Set PLAYWRIGHT_ALLOW_WRITES=true for synthetic DEMO fixtures')
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const e = parseEnv(readFileSync(process.env.DEMO_ENV_FILE || '.env.test.local', 'utf8'))
const u = new URL(e.SUPABASE_DB_URL)
if (decodeURIComponent(u.username) !== 'postgres.itjlykpjmlcvanqpmkmc') throw Error('Demo only')
const pg = { ...process.env, PGHOST:u.hostname, PGPORT:u.port||'5432', PGDATABASE:u.pathname.slice(1), PGUSER:decodeURIComponent(u.username), PGPASSWORD:decodeURIComponent(u.password), PGSSLMODE:'require' }
function sql(input) {
  const r=spawnSync('psql',['-X','-qAt','-v','ON_ERROR_STOP=1','--single-transaction'],{env:pg,input,encoding:'utf8'})
  if(r.status)throw Error(r.stderr)
  return r.stdout.trim().split('\n').at(-1)
}
const run=Date.now().toString()
const fixture=JSON.parse(sql(`select set_config('app.suppress_notifications','true',true);
with m as(select id,name,login_id,role from public.app_users where role='user' and is_active and approval_status='approved' order by id limit 1),
s as(insert into public.auth_sessions(user_id,expires_at) select id,now()+interval '30 minutes' from m returning token),
e as(insert into public.calendar_events(event_date,time,end_time,title,leader_name) select (now() at time zone 'Asia/Seoul')::date,'00:00','23:59','synthetic realtime ${run}',(select name from public.app_users where role='admin' and is_active limit 1) returning id),
p as(insert into public.event_participants(event_id,user_name,role) select e.id,m.name,'신청' from e,m)
select jsonb_build_object('actor',(select row_to_json(m) from m),'token',(select token from s),'eventId',(select id from e),'cardId',(select id from public.cards where name <> '미배정 건물' order by id limit 1));`))
const f=fixture
const esc=(s)=>s.replaceAll("'","''")
sql(`select set_config('app.suppress_notifications','true',true);
insert into public.event_card_assignments(event_id,user_name,assigned_card_id,team_key) values(${f.eventId},'${esc(f.actor.name)}',${f.cardId},'realtime-check');
insert into public.event_card_assignment_cards(event_id,user_name,card_id) values(${f.eventId},'${esc(f.actor.name)}',${f.cardId});
update public.calendar_events set assignment_status='shared',assignment_shared_at=clock_timestamp(),assignment_team_scopes='{"realtime-check":"주택"}',assignment_team_informal='{}' where id=${f.eventId};`)
const buildingId=Number(sql(`insert into public.buildings(card_id,name,address,type,lat,lng) values(${f.cardId},'동기화검증-${run}','경기도 용인시 기흥구 데모동기화로 ${run}','주택',37.28,127.11) returning id`))
sql(`insert into public.units(building_id,number,status,usage_type) values(${buildingId},'203','미방문','주택'),(${buildingId},'204','미방문','주택')`)
const createdIds=[buildingId], report=[], privateSubscriptions=[]
const browser=await chromium.launch({channel:'chrome',headless:true})
try {
  const pages=[]
  for(let i=0;i<2;i++){
    const context=await browser.newContext({viewport:{width:390,height:844}})
    const user={id:f.actor.id,name:f.actor.name,loginId:f.actor.login_id,role:f.actor.role,authToken:f.token}
    await context.addInitScript(({user,token})=>{localStorage.setItem('auth_session',JSON.stringify(user));localStorage.setItem('auth_token',token);localStorage.setItem('currentVisitor',user.name)}, {user,token:f.token})
    const p=await context.newPage()
    p.on('websocket', socket=>socket.on('framesent', ({payload})=>{
      try {
        const frame=JSON.parse(String(payload))
        const body=Array.isArray(frame)?frame[4]:frame.payload
        for(const change of body?.config?.postgres_changes??[]){
          if(['notifications','chat_read_status'].includes(change.table))privateSubscriptions.push(change.table)
        }
      } catch {}
    }))
    p.on('console', msg=>{if(['warning','error'].includes(msg.type()))console.log('browser warning:',msg.text().slice(0,600))})
    p.on('response',async r=>{if(r.url().includes('/rpc/quick_log') || r.url().includes('/rpc/record_'))console.log('record response',r.status(),(await r.text()).slice(0,600))})
    await p.goto(`https://chinese-territory-app-demo.vercel.app/map?assignmentMap=${f.eventId}&assignmentCard=${f.cardId}`,{waitUntil:'networkidle'})
    await p.getByText('주택 봉사',{exact:true}).waitFor()
    console.log('visibility',await p.evaluate(()=>document.visibilityState))
    await p.locator(`#building-card-${buildingId} .bld-row-head-btn`).click()
    await p.locator(`#building-card-${buildingId} .unit-check-btn`).first().waitFor()
    pages.push(p)
  }
  const [a,b]=pages
  if(privateSubscriptions.length)throw Error(`Private tables subscribed: ${privateSubscriptions.join(',')}`)
  report.push({privateTableSubscriptions:0})
  // Await initial catch-up before measuring mutations, without refreshing either browser.
  await b.waitForTimeout(1500)
  const requests=[]
  b.on('response', async r=>{
    if(r.url().includes('/rest/v1/')){
      let bytes=0;try{bytes=(await r.body()).length}catch{}
      requests.push({url:r.url().split('/rest/v1/')[1],status:r.status(),bytes})
    }
  })
  const rowA=a.locator(`#building-card-${buildingId}`),rowB=b.locator(`#building-card-${buildingId}`)
  const view=()=>b.evaluate(()=>{const m=window.__mobileMapInstance,c=m.getCenter();return {lat:c.lat(),lng:c.lng(),zoom:m.getZoom(),sheet:document.querySelector('.mobile-bottom-sheet').style.height}})
  const beforeView=await view()
  const start=Date.now()
  await rowA.locator('.unit-grid-row').nth(0).locator('.unit-check-btn:not(.unit-check-btn-invitation)').nth(1).click()
  await b.waitForFunction((id)=>document.querySelectorAll(`#building-card-${id} .unit-check-btn.ucb-absent`).length===1,buildingId,{timeout:15000})
  report.push({statusSyncMs:Date.now()-start,absent203:true})
  await rowA.locator('.unit-grid-row').nth(1).locator('.unit-check-btn:not(.unit-check-btn-invitation)').nth(1).click()
  await b.waitForFunction((id)=>document.querySelectorAll(`#building-card-${id} .unit-check-btn.ucb-absent`).length===2,buildingId,{timeout:15000})
  report.push({absent204:true,header:await rowB.locator('.bld-head-right').innerText()})
  const afterView=await view()
  if(Math.abs(beforeView.lat-afterView.lat)>1e-7 || Math.abs(beforeView.lng-afterView.lng)>1e-7 || beforeView.zoom!==afterView.zoom || beforeView.sheet!==afterView.sheet)throw Error('Status sync moved map or sheet')
  report.push({mapAndSheetUnchanged:true})
  await rowA.locator('.unit-grid-row').nth(0).locator('.unit-check-btn:not(.unit-check-btn-invitation)').nth(1).click()
  await b.waitForFunction((id)=>document.querySelectorAll(`#building-card-${id} .unit-check-btn.ucb-absent`).length===1,buildingId,{timeout:15000})
  report.push({undoSync:true})
  await a.getByRole('button',{name:'지도 작업',exact:true}).click()
  await a.getByRole('button',{name:'건물 추가',exact:true}).click()
  await a.screenshot({path:'/tmp/realtime-before-map-click.png',fullPage:true})
  await a.locator('.naver-map-canvas').click({position:{x:240,y:180}})
  await a.screenshot({path:'/tmp/realtime-after-map-click.png',fullPage:true})
  const modal=a.locator('.mm-building-edit-sheet')
  await modal.waitFor()
  await a.waitForFunction(()=>!document.querySelector('.mm-add-place-coordinates')?.textContent.includes('주소 검색'),{},{timeout:10000}).catch(()=>{})
  await modal.getByRole('button',{name:'주택',exact:true}).click()
  await modal.locator('select').selectOption(String(f.cardId))
  await modal.locator('input').nth(0).fill(`동기화새건물-${run}`)
  await modal.locator('input').nth(1).fill(`경기도 용인시 기흥구 데모동기화로 2-${run}`)
  const response=a.waitForResponse(r=>r.url().includes('/rpc/create_building_tx'))
  response.catch(()=>{})
  await a.screenshot({path:'/tmp/realtime-before-save.png',fullPage:true})
  await modal.getByRole('button',{name:'추가',exact:true}).click()
  const result=await(await response).json()
  if(result.action!=='created')throw Error(JSON.stringify(result))
  createdIds.push(result.building_id)
  await b.locator(`#building-card-${result.building_id}`).waitFor({timeout:15000})
  report.push({emptyBuildingSync:true})
  const newA=a.locator(`#building-card-${result.building_id}`)
  await newA.locator('.mm-unit-add-input').fill('301')
  await newA.locator('.mm-unit-add-btn').click()
  const newB=b.locator(`#building-card-${result.building_id}`)
  await newB.locator('.bld-row-head-btn').click()
  await newB.getByText('301',{exact:true}).waitFor({timeout:15000})
  report.push({newUnitSync:true})
  if(!await rowA.locator('.unit-grid-row').count())await rowA.locator('.bld-row-head-btn').click()
  if(!await rowB.locator('.unit-grid-row').count())await rowB.locator('.bld-row-head-btn').click()
  const contextB=b.context()
  await contextB.setOffline(true)
  await b.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'))})
  await b.waitForTimeout(300)
  await rowA.locator('.unit-grid-row').nth(0).locator('.unit-check-btn:not(.unit-check-btn-invitation)').nth(1).click()
  await a.waitForTimeout(600)
  await contextB.setOffline(false)
  await b.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:false});document.dispatchEvent(new Event('visibilitychange'))})
  await b.waitForFunction((id)=>document.querySelectorAll(`#building-card-${id} .unit-check-btn.ucb-absent`).length===2,buildingId,{timeout:45000})
  report.push({foregroundResubscribeRecovery:true})
  await b.waitForTimeout(800)
  for (let cycle = 0; cycle < 3; cycle++) {
    const before = requests.length
    await b.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'))})
    await b.waitForTimeout(100)
    await b.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:false});document.dispatchEvent(new Event('visibilitychange'))})
    await b.waitForTimeout(1500)
    const reads = requests.slice(before).filter(r=>r.url.startsWith('buildings?'))
    if (reads.length) throw Error(`Unchanged foreground downloaded ${reads.length} building batches`)
    report.push({unchangedForegroundBuildingRequests:reads.length,cycle})
  }
  // Exercise the existing two-minute foreground refresh without waiting two minutes.
  const beforeLongReturn = requests.length
  await b.evaluate(()=>{
    const now=Date.now
    window.__restoreSmokeClock=()=>{Date.now=now}
    Date.now=()=>now()+125000
    Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'))
  })
  await b.waitForTimeout(100)
  await b.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:false});document.dispatchEvent(new Event('visibilitychange'))})
  await b.waitForTimeout(3000)
  await b.evaluate(()=>window.__restoreSmokeClock())
  const longReturnReads=requests.slice(beforeLongReturn).filter(r=>r.url.startsWith('buildings?'))
  const fullBuildingReads = (reads) => reads.filter(r => {
    const params=new URLSearchParams(r.url.split('?')[1])
    return r.url.startsWith('buildings?') && params.get('select') !== 'id' && !params.has('id')
  })
  if(fullBuildingReads(longReturnReads).length)throw Error('Long foreground fetched full building bodies')
  const boundaryReads=requests.slice(beforeLongReturn).filter(r=>r.url.startsWith('card_boundaries?'))
  if(boundaryReads.length!==1 || new URLSearchParams(boundaryReads[0].url.split('?')[1]).get('select')!=='card_id,updated_at')throw Error('Unchanged boundaries downloaded coordinates')
  report.push({boundaryRecoveryRequests:boundaryReads.length,boundaryRecoveryBytes:boundaryReads[0].bytes,fullBoundaryReads:0})
  report.push({longForegroundBuildingRequests:longReturnReads.length,fullBuildingReads:0,bytes:longReturnReads.reduce((n,r)=>n+r.bytes,0),urls:longReturnReads.map(r=>r.url)})

  // Reconcile deletion while offline, plus a unit update/create not delivered live.
  // Use synthetic rows only; retain the first fixture for subsequent scope tests.
  await contextB.setOffline(true)
  await b.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'))})
  await b.waitForTimeout(300)
  sql(`select set_config('app.suppress_notifications','true',true);
    delete from public.buildings where id=${result.building_id} and name='동기화새건물-${run}';
    update public.units set status='미방문' where building_id=${buildingId} and number='204';
    insert into public.units(building_id,number,status,usage_type) values(${buildingId},'205','미방문','주택');`)
  await b.waitForTimeout(300)
  const beforeRecovery=requests.length
  await contextB.setOffline(false)
  await b.evaluate(()=>{
    const now=Date.now; window.__restoreSmokeClock=()=>{Date.now=now}; Date.now=()=>now()+250000;
    Object.defineProperty(document,'hidden',{configurable:true,value:false});document.dispatchEvent(new Event('visibilitychange'))
  })
  await b.waitForFunction(id=>!document.querySelector(`#building-card-${id}`),result.building_id,{timeout:15000})
  if(!await rowB.locator('.unit-grid-row').count())await rowB.locator('.bld-row-head-btn').click()
  await rowB.getByText('205',{exact:true}).waitFor({timeout:15000})
  await b.waitForFunction(id=>document.querySelectorAll(`#building-card-${id} .unit-check-btn.ucb-absent`).length===1,buildingId,{timeout:15000})
  await b.waitForTimeout(2000)
  await b.evaluate(()=>window.__restoreSmokeClock())
  const recoveryReads=requests.slice(beforeRecovery)
  if(fullBuildingReads(recoveryReads).length)throw Error('Offline recovery fetched full building bodies')
  report.push({offlineDeletionAndUnitChangesRecovered:true,fullBuildingReads:0,buildingRequests:recoveryReads.filter(r=>r.url.startsWith('buildings?'))})
  const outsideCard=Number(sql(`select id from public.cards where id<>${f.cardId} order by id limit 1`))
  await b.waitForTimeout(1000)
  const beforeOutside=requests.length
  const outsideId=Number(sql(`insert into public.buildings(card_id,name,address,type,lat,lng) values(${outsideCard},'동기화범위밖-${run}','동기화범위밖-${run}','주택',37.29,127.12) returning id`))
  createdIds.push(outsideId)
  await b.waitForTimeout(1500)
  if(requests.length!==beforeOutside)throw Error('Unrelated card caused a data fetch')
  report.push({outsideCardIgnored:true})
  const realtimeRequests=requests.slice()
  sql(`insert into public.regular_visits(unit_id,visitor_name) select id,'${esc(f.actor.name)}' from public.units where building_id=${buildingId} and number='203'`)
  for(const scope of ['mine','regularVisits']) {
    await b.goto(`https://chinese-territory-app-demo.vercel.app/map?scope=${scope}&cardIds=${f.cardId}&return=territory`,{waitUntil:'networkidle'})
    await b.getByRole('button',{name:'통합 검색',exact:true}).click()
    await b.getByPlaceholder('구역, 건물, 주소, 식당 검색').fill(`동기화검증-${run} 203`)
    await b.getByRole('button',{name:new RegExp(`동기화검증-${run}.*203`)}).click()
    await b.waitForFunction(() => Number.parseFloat(document.querySelector('.mobile-bottom-sheet').style.height) === Math.round(Math.max(170, Math.min(200, window.innerHeight * 0.16 + 50))), null, {timeout:5000})
    const params=new URL(b.url()).searchParams
    if(params.get('scope')!==scope || params.get('cardIds')!==String(f.cardId) || params.get('return')!=='territory')throw Error('Map scope lost: '+b.url())
    report.push({searchScopePreserved:scope})
  }
  await b.route('**/rest/v1/rpc/territory_sync_clock', route=>route.fulfill({
    status:404,contentType:'application/json',body:JSON.stringify({code:'PGRST202',message:'synthetic missing clock RPC'}),
  }))
  await b.goto(`https://chinese-territory-app-demo.vercel.app/map?assignmentMap=${f.eventId}&assignmentCard=${f.cardId}`,{waitUntil:'networkidle'})
  await b.getByText('주택 봉사',{exact:true}).waitFor()
  await b.locator(`#building-card-${buildingId}`).waitFor()
  report.push({initialClockFailureTolerated:true})
  await b.unroute('**/rest/v1/rpc/territory_sync_clock')
  await b.screenshot({path:'/tmp/territory-realtime-peer.png',fullPage:true})
  report.push({peerRequests:realtimeRequests,bytes:realtimeRequests.reduce((n,r)=>n+r.bytes,0)})
  console.log(JSON.stringify(report,null,2))
} catch(error){report.push({error:error.message});console.log(JSON.stringify(report,null,2));throw error}
finally{
  await browser.close()
  sql(`select set_config('app.suppress_notifications','true',true);delete from public.buildings where id in (${createdIds.join(',')}) and name like '%-${run}';delete from public.service_sessions where calendar_event_id=${f.eventId};delete from public.calendar_events where id=${f.eventId};delete from public.auth_sessions where token='${f.token}';`)
  writeFileSync('/tmp/territory-realtime-results.json',JSON.stringify(report,null,2))
}
