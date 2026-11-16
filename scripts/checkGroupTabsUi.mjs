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
const browser=await chromium.launch({headless:true}),errors=[],checks=[]
async function pageFor(width,actor){
  const context=await browser.newContext({viewport:{width,height:932},serviceWorkers:'block'})
  await context.route('**/*.supabase.co/**',route=>{
    assert.equal(new URL(route.request().url()).origin,config.VITE_SUPABASE_URL,'Production network blocked')
    return route.continue()
  })
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message))
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
  return {page,context}
}
try{
  const {page:admin,context:adminContext}=await pageFor(430)
  for(const name of ['동탄','신갈','처인','동백']){
    await admin.getByRole('tab',{name:new RegExp(`^${name}`)}).click()
    assert.equal(await admin.getByRole('button',{name:'팀 구성 · 구역 배정'}).count(),1)
  }
  await admin.getByRole('tab',{name:/^동탄/}).click()
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
  const {page:leader,context:leaderContext}=await pageFor(430,fixture.actors[0])
  assert.equal(await leader.getByRole('tab',{name:/^동탄/}).getAttribute('aria-selected'),'true')
  assert.ok((await leader.locator('.gs-participant-list').first().innerText()).includes(fixture.actors[4].name))
  await leader.getByRole('button',{name:'팀 구성 · 구역 배정'}).click()
  await leader.locator('.asg-editor').waitFor({timeout:30000})
  const assignmentText=await leader.locator('.asg-editor').innerText()
  assert.ok(assignmentText.includes(fixture.actors[4].name))
  assert.ok(!assignmentText.includes(fixture.actors[5].name)&&!assignmentText.includes(fixture.actors[8].name),'Other group and return applicant absent from teams')
  await leader.screenshot({path:'scratch/group-tabs-supervisor-assignment.png',fullPage:true})
  await leader.locator('.asg-editor-back').click()
  await leader.getByRole('tab',{name:/^신갈/}).click()
  assert.equal(await leader.getByRole('button',{name:'팀 구성 · 구역 배정'}).count(),0)
  assert.equal(await leader.locator('.gs-participant').count(),0)
  await leader.screenshot({path:'scratch/group-tabs-foreign-group.png',fullPage:true})
  checks.push('supervisor defaults own group; own assignment opens; return and foreign members absent; foreign tab no names or manage tools')
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
  await desktop.getByRole('tab',{name:/^처인/}).click()
  await desktop.screenshot({path:'scratch/group-tabs-desktop.png',fullPage:true})
  assert.ok(await desktop.locator('.gs-tab-detail').evaluate(el=>el.scrollWidth<=el.clientWidth+1))
  checks.push('desktop grouped entry and tabs render')
  await desktopContext.close()
  assert.deepEqual(errors,[])
  writeFileSync('scratch/group-tabs-ui-results.json',JSON.stringify({root,checks,errors},null,2))
  console.log(JSON.stringify({checks,errors}))
}finally{await browser.close()}
