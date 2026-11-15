// Read a CSV exported from Excel. Preview by default; this tool never targets production.
import assert from 'node:assert/strict'
import { readFileSync,writeFileSync } from 'node:fs'
import { parseEnv } from 'node:util'
import { createHash } from 'node:crypto'
import { previewServiceSchedule } from './serviceScheduleInput.mjs'

const config=parseEnv(readFileSync(process.env.DEMO_ENV_FILE,'utf8'))
assert.equal(config.VITE_SUPABASE_URL,'https://itjlykpjmlcvanqpmkmc.supabase.co')
const file=process.argv[2]
assert.ok(file?.endsWith('.csv'),'Supply an Excel CSV export')
const csv=readFileSync(file,'utf8')
async function rest(path,body,token) {
  const r=await fetch(`${config.VITE_SUPABASE_URL}/rest/v1/${path}`,{method:body===undefined?'GET':'POST',headers:{apikey:config.VITE_SUPABASE_ANON_KEY,'Content-Type':'application/json',...(token?{'x-session-token':token}:{})},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(30000)})
  const data=await r.json();if(!r.ok)throw Error(data.message||'Request failed');return data
}
const token=(await rest('rpc/auth_login',{p_login_id:config.TEST_LOGIN_ID,p_pin:config.TEST_LOGIN_PIN}))[0]?.token
assert.ok(token,'Demo sign-in failed')
const users=await rest('rpc/get_user_directory',{},token)
const first=previewServiceSchedule(csv,users)
if(first.errors.length){console.log(JSON.stringify(first.errors,null,2));process.exitCode=1}
else {
  const dates=first.rows.map(r=>r.payload.event_date).sort(),existing=[]
  for(let offset=0;;offset+=1000){const page=await rest(`calendar_events?select=id,event_date,time,service_kind,target_groups&event_date=gte.${dates[0]}&event_date=lte.${dates.at(-1)}&order=id&offset=${offset}&limit=1000`,undefined,token);existing.push(...page);if(page.length<1000)break}
  const result=previewServiceSchedule(csv,users,existing)
  const hash=createHash('sha256').update(JSON.stringify(first.rows)).digest('hex')
  const requestId=`${hash.slice(0,8)}-${hash.slice(8,12)}-4${hash.slice(13,16)}-a${hash.slice(17,20)}-${hash.slice(20,32)}`
  const report={project:'demo',requestId,count:first.rows.length,errors:result.errors,events:first.rows.map(r=>({date:r.payload.event_date,time:r.payload.time,groups:r.payload.target_groups,leader:r.payload.leader_name}))}
  writeFileSync(`${file}.preview.json`,JSON.stringify(report,null,2),{mode:0o600})
  console.log(JSON.stringify(report,null,2))
  if(process.argv.includes('--apply-demo')) {
    assert.ok(process.argv.includes(`--confirm=${hash.slice(0,12)}`),`Review preview, then use --confirm=${hash.slice(0,12)}`)
    // Server rejects unrelated occupied slots, while recognizing a retry of the same batch.
    console.log(await rest('rpc/save_service_events_tx',{p_token:token,p_rows:first.rows,p_request_id:requestId,p_notify:false},token))
  } else console.log(`Preview only. Confirmation: --confirm=${hash.slice(0,12)}`)
}
