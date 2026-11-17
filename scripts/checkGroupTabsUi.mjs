import assert from 'node:assert/strict'
import {readFileSync,writeFileSync} from 'node:fs'
import {parseEnv} from 'node:util'
import {pathToFileURL} from 'node:url'
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href)
const config=parseEnv(readFileSync(process.env.DEMO_ENV_FILE,'utf8'))
assert.equal(config.VITE_SUPABASE_URL,'https://itjlykpjmlcvanqpmkmc.supabase.co')
const root=process.env.DEMO_APP_URL||'http://localhost:5179'
assert.ok(['http://localhost:5179','https://chinese-territory-app-demo.vercel.app'].includes(root))
const fixture=JSON.parse(readFileSync('scratch/group-tabs-fixture.json','utf8'))
const browser=await chromium.launch({headless:true}),errors=[],checks=[],saves=[]
async function pageFor(width,actor){
  const context=await browser.newContext({viewport:{width,height:932},serviceWorkers:'block'})
  await context.route('**/*.supabase.co/**',route=>{
    assert.equal(new URL(route.request().url()).origin,config.VITE_SUPABASE_URL,'Production network blocked')
    return route.continue()
  })
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message))
  page.on('response',async response=>{
    if(!response.url().includes('/rpc/save_event_assignments_versioned_tx'))return
    const input=response.request().postDataJSON()
    saves.push({eventId:input.p_event_id,revision:input.p_expected_revision,status:response.status(),result:await response.json()})
  })
  let signalReady=false
  page.on('websocket',socket=>socket.on('framereceived',({payload})=>{
    const wire=JSON.parse(String(payload))
    const message=Array.isArray(wire)?{event:wire[3],topic:wire[2],payload:wire[4]}:wire
    if(message.event==='phx_reply'&&message.payload?.status==='ok'&&message.payload.response?.postgres_changes?.some(c=>c.table==='group_participant_signals'))signalReady=true
  }))
  await page.goto(root)
  await page.locator('#login-id').fill(actor?.name??config.TEST_LOGIN_ID)
  await page.locator('#pin').fill(actor?'0000':config.TEST_LOGIN_PIN)
  await page.locator('.login-form button[type=submit]').click()
  await page.waitForFunction(()=>!document.querySelector('#login-id'),{timeout:60000})
  await page.evaluate(()=>{history.pushState(null,'','/calendar');dispatchEvent(new PopStateEvent('popstate'))})
  if(width<980){
    await page.locator('.mobile-calendar-day').filter({hasText:/^18$/}).click()
    await page.locator('.gs-event-block button').first().waitFor({timeout:30000})
    assert.equal(await page.locator('.gs-event-block button').count(),2,'Four groups collapse to one row per time')
    await page.screenshot({path:`scratch/group-tabs-calendar-${width}.png`,fullPage:true})
    await page.locator('.gs-event-block button').first().click()
  }else{
    await page.locator('.day-cell').filter({has:page.locator('.gs-day-select',{hasText:/^18$/})}).locator('.gs-event-block button').first().click()
  }
  await page.locator('.gs-group-tabs [role=tab]').first().waitFor({timeout:30000})
  assert.equal(await page.getByRole('tab').count(),4)
  return {page,context,waitForSignals:async()=>{
    const deadline=Date.now()+30000
    while(!signalReady&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,100))
    assert.ok(signalReady,'Realtime group signal subscription acknowledged')
  }}
}
try{
  const {page:admin,context:adminContext}=await pageFor(430)
  for(const name of ['동탄','신갈','처인','동백']){
    await admin.getByRole('tab',{name:new RegExp(`^${name}`)}).click()
    assert.equal(await admin.getByRole('button',{name:'팀 구성 · 구역 배정'}).count(),1)
  }
  await admin.getByRole('tab',{name:/^동탄/}).click()
  const sharedResult=admin.locator('details').filter({has:admin.locator('summary',{hasText:'배정 결과'})})
  assert.equal(await sharedResult.evaluate(el=>el.open),true,'Shared result starts expanded')
  assert.equal(await admin.locator('details').filter({has:admin.locator('summary',{hasText:'모임 정보'})}).evaluate(el=>el.open),false)
  await sharedResult.locator('summary').click()
  assert.equal(await sharedResult.evaluate(el=>el.open),false,'User can still collapse shared result')
  await sharedResult.locator('summary').click()
  checks.push('shared result opens automatically, can be collapsed manually, meeting info stays collapsed')
  await admin.screenshot({path:'scratch/group-tabs-admin-mobile.png',fullPage:true})
  await admin.setViewportSize({width:320,height:740})
  await admin.evaluate(()=>{document.querySelector('#root').style.zoom='1.25';document.querySelector('#root').style.setProperty('--app-zoom','1.25')})
  assert.ok(await admin.locator('.gs-tab-body').evaluate(el=>el.scrollWidth<=el.clientWidth+1),'Narrow detail does not overflow')
  assert.ok(await admin.locator('.gs-tab-mobile').evaluate(el=>{
    const r=el.getBoundingClientRect()
    return r.top<=1&&r.bottom>=innerHeight-1&&!!document.elementFromPoint(10,innerHeight-2)?.closest('.gs-tab-mobile')
  }),'Mobile overlay covers viewport at enlarged text size')
  await admin.screenshot({path:'scratch/group-tabs-320.png'})
  checks.push('mobile two time rows, four tabs, admin manages every group, 320px at 125% fits')
  await adminContext.close()
  const {page:leader,context:leaderContext,waitForSignals}=await pageFor(430,fixture.actors[0])
  assert.equal(await leader.getByRole('tab',{name:/^동탄/}).getAttribute('aria-selected'),'true')
  assert.ok((await leader.locator('.gs-participant-list').first().innerText()).includes(fixture.actors[4].name))
  await waitForSignals()
  const visitor=fixture.actors[6]
  const authResponse=await fetch(`${config.VITE_SUPABASE_URL}/rest/v1/rpc/auth_login`,{method:'POST',headers:{apikey:config.VITE_SUPABASE_ANON_KEY,'Content-Type':'application/json'},body:JSON.stringify({p_login_id:visitor.name,p_pin:'0000'})})
  assert.ok(authResponse.ok)
  const [{token:visitorToken}]=await authResponse.json()
  const removeLiveApplicant=(id=fixture.eventIds[0])=>fetch(`${config.VITE_SUPABASE_URL}/rest/v1/event_participants?event_id=eq.${id}&user_name=eq.${encodeURIComponent(visitor.name)}`,{method:'DELETE',headers:{apikey:config.VITE_SUPABASE_ANON_KEY,'x-session-token':visitorToken}})
  const applyLiveApplicant=id=>fetch(`${config.VITE_SUPABASE_URL}/rest/v1/rpc/apply_service_activity_tx`,{method:'POST',headers:{apikey:config.VITE_SUPABASE_ANON_KEY,'Content-Type':'application/json','x-session-token':visitorToken},body:JSON.stringify({p_token:visitorToken,p_event_id:id,p_activity:'service'})})
  try{
    const applied=await applyLiveApplicant(fixture.eventIds[0])
    assert.ok(applied.ok)
    await leader.locator('.gs-participant').filter({hasText:visitor.name}).waitFor({timeout:30000})
    assert.ok((await removeLiveApplicant()).ok)
    await leader.locator('.gs-participant').filter({hasText:visitor.name}).waitFor({state:'detached',timeout:30000})
    checks.push('separate member session applies/cancels and supervisor roster updates live without reload')
  }finally{assert.ok((await removeLiveApplicant()).ok)}
  await leader.getByRole('button',{name:'팀 구성 · 구역 배정'}).click()
  await leader.locator('.asg-editor').getByText(fixture.actors[4].name,{exact:true}).first().waitFor({timeout:30000})
  const assignmentText=await leader.locator('.asg-editor').innerText()
  assert.ok(assignmentText.includes(fixture.actors[4].name))
  assert.ok(!assignmentText.includes(fixture.actors[5].name)&&!assignmentText.includes(fixture.actors[8].name),'Other group and return applicant absent from teams')
  await leader.screenshot({path:'scratch/group-tabs-supervisor-assignment.png',fullPage:true})
  await leader.locator('.asg-editor-back').click()
  await leader.getByRole('tab',{name:/^신갈/}).click()
  assert.equal(await leader.getByRole('button',{name:'팀 구성 · 구역 배정'}).count(),1)
  assert.ok(await leader.locator('.gs-participant').count()>0)
  assert.equal(await leader.getByRole('button',{name:'일정 수정'}).count(),0)
  assert.equal(await leader.getByRole('button',{name:'일정 삭제'}).count(),0)
  try{
    assert.ok((await applyLiveApplicant(fixture.eventIds[1])).ok)
    await leader.getByRole('tab',{name:/^신갈\s+2$/}).waitFor({timeout:30000})
    await leader.locator('.gs-participant').filter({hasText:visitor.name}).waitFor({timeout:30000})
    assert.ok((await removeLiveApplicant(fixture.eventIds[1])).ok)
    await leader.getByRole('tab',{name:/^신갈\s+1$/}).waitFor({timeout:30000})
    checks.push('foreign group count and applicant names update live for leader')
  }finally{assert.ok((await removeLiveApplicant(fixture.eventIds[1])).ok)}
  await leader.screenshot({path:'scratch/group-tabs-foreign-group.png',fullPage:true})
  await leader.getByRole('button',{name:'팀 구성 · 구역 배정'}).click()
  await leader.locator('.asg-editor').getByText(fixture.actors[5].name,{exact:true}).first().waitFor({timeout:30000})
  assert.ok(!(await leader.locator('.asg-editor').innerText()).includes(fixture.actors[4].name))
  await leader.locator('.asg-editor-back').click()
  checks.push('leader defaults own group, can arrange foreign group, cannot edit schedule; team candidates stay per-event')
  await leaderContext.close()
  const ungrouped=fixture.actors[8]
  const {page:member,context:memberContext}=await pageFor(430,ungrouped)
  try{
    await member.getByRole('tab',{name:/^처인/}).click()
    await member.getByRole('button',{name:'봉사 신청',exact:true}).click()
    await member.getByRole('button',{name:'추가 신청',exact:true}).click()
    await member.getByRole('button',{name:'봉사 신청 취소',exact:true}).waitFor({timeout:30000})
    assert.equal(await member.getByRole('button',{name:'팀 구성 · 구역 배정'}).count(),0)
    await member.getByRole('button',{name:'봉사 신청 취소',exact:true}).click()
    await member.getByRole('button',{name:'봉사 신청',exact:true}).waitFor({timeout:30000})
    checks.push('ungrouped member accepts overlap warning, applies to selected tab and cancels through UI')
  }finally{
    const response=await fetch(`${config.VITE_SUPABASE_URL}/rest/v1/event_participants?event_id=eq.${fixture.eventIds[2]}&user_name=eq.${encodeURIComponent(ungrouped.name)}`,{method:'DELETE',headers:{apikey:config.VITE_SUPABASE_ANON_KEY,'x-session-token':ungrouped.token}})
    assert.ok(response.ok,'Synthetic membership cleanup')
    await memberContext.close()
  }
  const {page:desktop,context:desktopContext}=await pageFor(1440)
  await desktop.getByRole('tab',{name:/^동탄/}).click()
  assert.equal(await desktop.locator('details').filter({has:desktop.locator('summary',{hasText:'배정 결과'})}).evaluate(el=>el.open),true)
  await desktop.getByRole('tab',{name:/^처인/}).click()
  await desktop.screenshot({path:'scratch/group-tabs-desktop.png',fullPage:true})
  assert.ok(await desktop.locator('.gs-tab-detail').evaluate(el=>el.scrollWidth<=el.clientWidth+1))
  checks.push('desktop grouped entry and tabs render')
  await desktopContext.close()
  const first=await pageFor(430,fixture.actors[0]),second=await pageFor(430,fixture.actors[1])
  for(const session of [first,second]){
    await session.page.getByRole('tab',{name:/^동탄/}).click()
    await session.page.getByRole('button',{name:'팀 구성 · 구역 배정'}).click()
    await session.page.locator('.asg-editor-titles').waitFor({timeout:30000})
    assert.ok(await session.page.getByRole('button',{name:'배정 공유',exact:true}).isEnabled())
  }
  assert.ok((await applyLiveApplicant(fixture.eventIds[0])).ok)
  await first.page.getByRole('button',{name:'배정 공유',exact:true}).click()
  await first.page.getByRole('tab',{name:/^동탄/}).waitFor({timeout:30000})
  checks.push('new applicant while editor is open does not cause a false save conflict')
  await second.page.getByRole('button',{name:'배정 공유',exact:true}).click()
  await second.page.getByRole('heading',{name:'배정 내용이 변경됐어요'}).waitFor({timeout:30000})
  await second.page.getByRole('button',{name:'배정 공유',exact:true}).waitFor({timeout:30000})
  assert.equal(await second.page.getByText('자료를 불러오지 못했습니다. 연결을 확인하고 다시 시도해 주세요.',{exact:true}).count(),0,'Cached calendar conflict does not produce a false connection error')
  await second.page.screenshot({path:'scratch/group-tabs-conflict.png',fullPage:true})
  checks.push('two leader editors keep original revisions; second sharing shows conflict and retains local draft')
  assert.ok((await removeLiveApplicant()).ok)
  await first.context.close();await second.context.close()
  const congregationSession=await pageFor(430,fixture.actors[1])
  const request=async(path,body,token,method='POST')=>{
    const r=await fetch(`${config.VITE_SUPABASE_URL}/rest/v1/${path}`,{method,headers:{apikey:config.VITE_SUPABASE_ANON_KEY,'Content-Type':'application/json',Prefer:'return=representation',...(token?{'x-session-token':token}:{})},...(body?{body:JSON.stringify(body)}:{})})
    assert.ok(r.ok,await r.clone().text());return r.json()
  }
  const [{token:adminToken}]=await request('rpc/auth_login',{p_login_id:config.TEST_LOGIN_ID,p_pin:config.TEST_LOGIN_PIN})
  const [congregation]=await request('calendar_events',{event_date:'2026-11-18',time:'20:00',end_time:'21:00',title:'UI congregation permission test',place:'',leader_name:fixture.actors[0].name,service_kind:'congregation',group_service_scope:false,allow_applications:true},adminToken)
  try{
    await congregationSession.page.goto(`${root}/calendar?openEvent=${congregation.id}`)
    await congregationSession.page.getByText('UI congregation permission test',{exact:true}).first().waitFor({timeout:30000})
    const arrange=congregationSession.page.getByRole('button',{name:/봉사 팀 구성 & 배정/})
    await arrange.waitFor({timeout:30000})
    assert.equal(await congregationSession.page.getByRole('button',{name:'일정 수정',exact:true}).count(),0)
    await arrange.click()
    await congregationSession.page.locator('.asg-editor-titles').waitFor({timeout:30000})
    assert.equal(await congregationSession.page.getByRole('button',{name:'배정 공유',exact:true}).count(),1,'Unnamed congregation leader has editable assignment tools')
    checks.push('unnamed congregation leader opens editable assignment screen while schedule edit stays unavailable')
  }finally{
    await request(`calendar_events?id=eq.${congregation.id}`,undefined,adminToken,'DELETE')
    await congregationSession.context.close()
  }
  assert.deepEqual(errors,[])
  writeFileSync('scratch/group-tabs-ui-results.json',JSON.stringify({root,checks,errors},null,2))
  console.log(JSON.stringify({checks,errors}))
}catch(error){
  for(const [i,page] of browser.contexts().flatMap(c=>c.pages()).entries()){
    await page.screenshot({path:`scratch/group-tabs-failure-${i}.png`,fullPage:true})
    console.error((await page.locator('body').innerText()).slice(-2000))
  }
  console.error(JSON.stringify({saves,errors,checks}))
  throw error
}finally{await browser.close()}
