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
  const starts=new WeakMap(),pending=new Set()
  let lastActivity=performance.now()
  page.on('request',req=>{
   starts.set(req,performance.now());pending.add(req);lastActivity=performance.now()
  })
  const finished=req=>{pending.delete(req);lastActivity=performance.now()}
  page.on('requestfailed',req=>{
   if(new URL(req.url()).pathname.startsWith('/rest/v1/'))errors.push('Data request failed')
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
   return route.abort()
  })
  page.on('pageerror',e=>errors.push(e.message))
  page.on('requestfinished',async req=>{
   try{
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
  async function step(name,action,ready){
   await settled()
   await page.evaluate(kind=>{
    window.__serviceTiming=null
    document.addEventListener('click',()=>{
     const start=performance.now()
     const check=()=>{
      const element=document.querySelector(kind==='detail'?'.gs-application-actions button:not(:disabled)':'.mobile-today-service-section')
      if(element?.getClientRects().length)requestAnimationFrame(()=>{window.__serviceTiming=Math.round(performance.now()-start)})
      else requestAnimationFrame(check)
     }
     requestAnimationFrame(check)
    },{once:true,capture:true})
   },name.startsWith('detail')?'detail':'service')
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
   const detailReady=async()=>{
    await page.locator('.gs-roster-heading').waitFor({timeout:45000})
    await page.locator('.gs-application-actions button:not(:disabled)').first().waitFor()
   }
   await step('detail-first',()=>page.locator('.gs-event-block>button').first().click(),detailReady)
   if(run===0)await page.screenshot({path:`scratch/speed-${label}-${role}-detail.png`,fullPage:true})
   await page.getByRole('button',{name:'뒤로',exact:true}).click()
   await step('detail-repeat',()=>page.locator('.gs-event-block>button').first().click(),detailReady)
   await page.getByRole('button',{name:'뒤로',exact:true}).click()
   const nav=page.locator('.bottom-nav')
   if(role!=='admin'){
    const service=()=>nav.getByRole('button',{name:/나의\s*봉사/}).click()
    const serviceReady=()=>page.locator('.mobile-today-service-section').waitFor({timeout:45000})
    await step('service-first',service,serviceReady)
    if(run===0)await page.screenshot({path:`scratch/speed-${label}-${role}-service.png`,fullPage:true})
    await nav.getByRole('button',{name:'홈',exact:true}).click()
    await step('service-repeat',service,serviceReady)
   }
   assert.deepEqual(errors,[])
   assert.ok(reads.every(r=>r.status<400))
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1))
  }finally{await context.close()}
 }
}finally{
 await browser.close()
 writeFileSync(`scratch/speed-${label}.json`,JSON.stringify({label,delay,repeats,engine:process.env.ENGINE??'chromium',base,results},null,2))
}
