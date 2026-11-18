// Demo-only navigation benchmark. No schedule, participant, assignment or comment writes.
// Login and the app's existing automatic session-close call may write demo session data.
import assert from 'node:assert/strict'
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs'
import {parseEnv} from 'node:util'
const {chromium,webkit}=await import(process.env.PLAYWRIGHT_MODULE??'playwright')
const config=parseEnv(readFileSync(process.env.TEST_ENV_FILE??'.env.test.local','utf8'))
assert.equal(config.VITE_SUPABASE_URL,'https://itjlykpjmlcvanqpmkmc.supabase.co')
const fixture=JSON.parse(readFileSync(process.env.FIXTURE_FILE??'scratch/group-tabs-fixture.json','utf8'))
const label=process.argv[2],base=process.env.PREVIEW_URL??'http://127.0.0.1:5187'
assert.ok(label&&/^[a-zA-Z0-9_-]+$/.test(label)&&['127.0.0.1','chinese-territory-app-demo.vercel.app'].includes(new URL(base).hostname))
const delay=Number(process.env.REST_DELAY??120),repeats=Number(process.env.REPEATS??3)
const journey=process.env.JOURNEY??'service'
const verifyExtra=process.env.VERIFY_EXTRA==='true'
assert.ok(['service','settings','calendar','zone'].includes(journey))
assert.ok(Number.isFinite(delay)&&delay>=0&&Number.isInteger(repeats)&&repeats>0)
mkdirSync('scratch',{recursive:true})
const browser=await (process.env.ENGINE==='webkit'?webkit:chromium).launch()
const results=[]
try{
 for(const role of (process.env.ROLES??'leader,user,admin').split(','))for(let run=0;run<repeats;run++){
  assert.ok(['leader','user','admin'].includes(role))
  const actor=role==='admin'?null:fixture.actors.find(a=>a.role===role)
  assert.ok(role==='admin'||actor,'Missing demo actor for this role')
  const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'})
  const page=await context.newPage(),reads=[],errors=[]
  const starts=new WeakMap(),pending=new Set(),completedHeads=new WeakSet()
  let lastActivity=performance.now()
  page.on('request',req=>{
   starts.set(req,performance.now());pending.add(req);lastActivity=performance.now()
  })
  const finished=req=>{pending.delete(req);lastActivity=performance.now()}
  // HEAD has no body. Chromium may report ERR_ABORTED after delivering its 200 headers.
  page.on('response',response=>{
   const req=response.request(),u=new URL(req.url())
   if(req.method()!=='HEAD'||!u.pathname.startsWith('/rest/v1/'))return
   completedHeads.add(req)
   reads.push({path:u.pathname.slice(9),query:u.search,started:starts.get(req),bytes:0,status:response.status(),method:'HEAD'})
   finished(req)
  })
  page.on('requestfailed',req=>{
   if(completedHeads.has(req)){finished(req);return}
   if(new URL(req.url()).pathname.startsWith('/rest/v1/'))errors.push(`${new URL(req.url()).pathname}: ${req.failure()?.errorText}`)
   finished(req)
  })
  await page.addInitScript(()=>{
   window.__mountTrace=[]
   new MutationObserver(records=>{
    for(const r of records)for(const [action,nodes] of [['add',r.addedNodes],['remove',r.removedNodes]])for(const n of nodes){
     if(!(n instanceof Element))continue
     const matches=[...(n.matches('header,.app-loading')?[n]:[]),...n.querySelectorAll('header,.app-loading')]
     for(const el of matches)window.__mountTrace.push({at:Date.now(),action,tag:el.tagName,cls:el.className,path:location.pathname})
    }
   }).observe(document,{childList:true,subtree:true})
  })
  await context.route('**/*',async route=>{
   const url=new URL(route.request().url())
   if(url.hostname.endsWith('.supabase.co')){
    assert.equal(url.origin,config.VITE_SUPABASE_URL)
    if(url.pathname.startsWith('/rest/v1/')&&delay)await new Promise(r=>setTimeout(r,delay))
    return route.continue()
   }
   if(url.origin===new URL(base).origin)return route.continue()
   if(verifyExtra&&journey==='zone'&&(url.hostname.endsWith('.naver.com')||url.hostname.endsWith('.pstatic.net')))return route.continue()
   return route.abort()
  })
  page.on('pageerror',e=>errors.push(e.message))
  page.on('requestfinished',async req=>{
   try{
    if(completedHeads.has(req))return
    const u=new URL(req.url());if(!u.pathname.startsWith('/rest/v1/'))return
    const response=await req.response(),body=await response.body()
    reads.push({path:u.pathname.slice(9),query:u.search,started:starts.get(req),bytes:body.length,status:response.status()})
   }catch{errors.push('Could not measure response body')}finally{finished(req)}
  })
  // Include intercepted/delayed requests and body reads; networkidle alone misses these.
  async function settled(){
   const entered=performance.now(),deadline=entered+30000
   while(pending.size||performance.now()-Math.max(lastActivity,entered)<600){
    assert.ok(performance.now()<deadline,'Requests did not settle; discard this measurement')
    await page.waitForTimeout(50)
   }
  }
  async function step(name,action,ready,selector){
   await settled()
   await page.evaluate(({kind,selector})=>{
    window.__serviceTiming=null
    document.addEventListener('click',()=>{
     const start=performance.now()
     const check=()=>{
      const element=document.querySelector(selector??(kind==='detail'?'.gs-application-actions button:not(:disabled)':'.mobile-today-service-section'))
      if(element?.getClientRects().length)requestAnimationFrame(()=>{window.__serviceTiming=Math.round(performance.now()-start)})
      else requestAnimationFrame(check)
     }
     requestAnimationFrame(check)
    },{once:true,capture:true})
   },{kind:name.startsWith('detail')?'detail':'service',selector})
   const wallStart=Date.now(),start=performance.now();await action();await ready()
   await page.waitForFunction(()=>window.__serviceTiming!==null)
   const readyMs=await page.evaluate(()=>window.__serviceTiming)
   await settled()
   const requests=reads.filter(r=>r.started>=start)
   const trace=await page.evaluate(start=>window.__mountTrace.filter(r=>r.at>=start),wallStart)
   const row={role,run,name,readyMs,requests:requests.length,bytes:requests.reduce((n,r)=>n+r.bytes,0),resources:requests.map(r=>r.path),trace,reads:requests}
   results.push(row);console.log(JSON.stringify({role,run,name,readyMs,requests:row.requests,bytes:row.bytes}))
  }
  try{
   await page.goto(base)
   await page.locator('#login-id').fill(actor?.name??config.TEST_LOGIN_ID)
   await page.locator('#pin').fill(actor?'0000':config.TEST_LOGIN_PIN)
   await page.locator('.login-form button[type=submit]').click()
   await page.locator('.gs-event-block>button').first().waitFor({timeout:60000})
   const nav=page.locator('.bottom-nav')
   const go=name=>nav.getByRole('button',{name,exact:true}).click()
   if(journey==='settings'){
    const settings=()=>page.locator('.mobile-settings-profile').waitFor()
    await step('settings-first',()=>go('설정'),settings,'.mobile-settings-profile')
    await step('profile',()=>page.locator('.mobile-settings-profile').click(),()=>page.locator('.mobile-profile-page').waitFor(),'.mobile-profile-page')
    await page.getByRole('button',{name:'뒤로',exact:true}).click()
    await go('홈')
    await step('settings-repeat',()=>go('설정'),settings,'.mobile-settings-profile')
    if(verifyExtra){
     await page.getByRole('button',{name:/푸시 알림/}).click()
     await page.getByRole('heading',{name:'푸시 알림',exact:true}).waitFor()
     await settled()
     assert.equal(new URL(page.url()).pathname,'/notification-settings')
    }
   }else if(journey==='calendar'){
    const heading=page.locator('h3').filter({hasText:/\d+년 \d+월/})
    await step('calendar-first',()=>go('캘린더'),()=>heading.waitFor(),'h3')
    await step('calendar-next',()=>heading.locator('..').getByRole('button').last().click(),()=>heading.waitFor(),'h3')
    await step('calendar-back',()=>heading.locator('..').getByRole('button').first().click(),()=>heading.waitFor(),'h3')
    await go('홈')
    await step('calendar-repeat',()=>go('캘린더'),()=>heading.waitFor(),'h3')
    if(verifyExtra){
     for(let i=0;i<2;i++){
      const previous=await heading.textContent()
      await heading.locator('..').getByRole('button').last().click()
      await page.waitForFunction(text=>[...document.querySelectorAll('h3')].some(el=>/\d+년 \d+월/.test(el.textContent)&&el.textContent!==text),previous)
      await settled()
     }
    }
   }else if(journey==='zone'){
    const ready=()=>page.getByRole('button',{name:'지도',exact:true}).waitFor()
    await step('zone-first',()=>go('구역'),ready,'button[aria-label="지도"]')
    if(verifyExtra)await page.getByRole('button',{name:'전체 구역',exact:true}).click()
    await step('map-first',()=>page.getByRole('button',{name:'지도',exact:true}).click(),()=>page.locator('.mm-back-btn').waitFor(),'.mm-back-btn')
    await page.locator('.mm-back-btn').click()
    await step('map-repeat',()=>page.getByRole('button',{name:'지도',exact:true}).click(),()=>page.locator('.mm-back-btn').waitFor(),'.mm-back-btn')
    if(verifyExtra){
     await page.waitForFunction(()=>[...document.querySelectorAll('.naver-map-canvas img')].some(img=>img.complete&&img.naturalWidth>=256),undefined,{timeout:30000})
     assert.ok(await page.locator('.naver-map-canvas img').count()>0)
    }
   }else{
   const detailReady=async()=>{
    await page.locator('.gs-roster-heading').waitFor({timeout:45000})
    await page.locator('.gs-application-actions button:not(:disabled)').first().waitFor()
   }
   await step('detail-first',()=>page.locator('.gs-event-block>button').first().click(),detailReady)
   if(run===0)await page.screenshot({path:`scratch/speed-${label}-${role}-detail.png`,fullPage:true})
   await page.getByRole('button',{name:'뒤로',exact:true}).click()
   await step('detail-repeat',()=>page.locator('.gs-event-block>button').first().click(),detailReady)
   await page.getByRole('button',{name:'뒤로',exact:true}).click()
   if(role!=='admin'){
    const service=()=>nav.getByRole('button',{name:/나의\s*봉사/}).click()
    const serviceReady=()=>page.locator('.mobile-today-service-section').waitFor({timeout:45000})
    await step('service-first',service,serviceReady)
    if(run===0)await page.screenshot({path:`scratch/speed-${label}-${role}-service.png`,fullPage:true})
    await nav.getByRole('button',{name:'홈',exact:true}).click()
    await step('service-repeat',service,serviceReady)
   }
   }
   await page.screenshot({path:`scratch/speed-${label}-${role}-${journey}.png`,fullPage:true})
   assert.deepEqual(errors,[])
   assert.ok(reads.every(r=>r.status<400))
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1))
  }finally{await context.close()}
 }
}finally{
 await browser.close()
 writeFileSync(`scratch/speed-${label}.json`,JSON.stringify({label,journey,delay,repeats,engine:process.env.ENGINE??'chromium',base,results},null,2))
}
