import assert from 'node:assert/strict'
import {readFileSync,writeFileSync} from 'node:fs'
import {parseEnv} from 'node:util'
import {spawnSync} from 'node:child_process'
import {randomUUID} from 'node:crypto'

assert.ok(process.argv.includes('--confirm-demo'))
const config=parseEnv(readFileSync(process.env.DEMO_ENV_FILE,'utf8')),db=new URL(config.SUPABASE_DB_URL)
assert.equal(config.VITE_SUPABASE_URL,'https://itjlykpjmlcvanqpmkmc.supabase.co')
assert.equal(decodeURIComponent(db.username),'postgres.itjlykpjmlcvanqpmkmc')
assert.equal(db.port,'5432');assert.ok(db.hostname.endsWith('.pooler.supabase.com'))
const env={...process.env,PGHOST:db.hostname,PGPORT:db.port,PGUSER:decodeURIComponent(db.username),PGPASSWORD:decodeURIComponent(db.password),PGDATABASE:db.pathname.slice(1),PGSSLMODE:'require',PGCONNECT_TIMEOUT:'15'}
function sql(input){
  const r=spawnSync('psql',['-X','-qAt','-v','ON_ERROR_STOP=1'],{env,input,encoding:'utf8',maxBuffer:32*1024*1024,timeout:240000})
  if(r.status!==0)throw Error(r.stderr||r.error?.message||'Demo measurement failed')
  return r.stdout.trim().split('\n').filter(Boolean).map(line=>JSON.parse(line))
}
const tables=['app_users','auth_sessions','calendar_events','event_participants','event_card_assignments','event_card_assignment_cards','service_sessions','comments']
const countsSql=`select json_build_object(${tables.flatMap(t=>[`'${t}'`,`(select count(*) from public.${t})`]).join(',')});`
const base=1900000000,quote=s=>`'${s.replaceAll("'","''")}'`
const before=sql(countsSql)[0],results=[]
assert.equal(sql(`select to_json((${tables.map(t=>`exists(select 1 from public.${t} where ${t==='auth_sessions'?'user_id':'id'}>=${base})`).join(' or ')})) occupied;`)[0],false)
const targets={events:686,participants:1365,assignments:1123,extraCards:985,sessions:1592,comments:342}
const analyze=tables.map(t=>`analyze public.${t};`).join('\n')
try{
  for(const scale of [1,5]){
    const n=Object.fromEntries(Object.entries(targets).map(([k,v])=>[k,v*scale]))
    const tokens=[randomUUID(),randomUUID(),randomUUID()]
    const groups="array['dongtan','singal','cheoin','dongbaek']"
    const queries=[
      ['assignments-all','select * from public.event_card_assignments'],
      ['sessions-all','select * from public.service_sessions'],
      ['sessions-own',`select * from public.service_sessions where user_name='release_perf_3' order by service_date desc limit 100`],
      ['participants-one',`select * from public.event_participants where event_id=${base+1}`],
      ['group-tabs',`select public.get_group_service_context(${base+1})`],
      ['comments-rpc',`select public.read_group_event_comments(${base+1})`],
      ['comments-index',`select id,content from public.comments where target_type='calendar_event' and target_id=${base+1} and deleted_at is null order by id desc limit 20`],
      ['comments-sparse-rpc',`select public.read_group_event_comments(${base+2})`],
      ['comments-sparse-index',`select id,content from public.comments where target_type='calendar_event' and target_id=${base+2} and deleted_at is null order by id desc limit 20`],
    ]
    const measurements=[]
    for(const [index,role]of ['admin','leader','user'].entries()){
      measurements.push(`set local role anon;set local request.headers=${quote(JSON.stringify({'x-session-token':tokens[index]}))};`)
      for(const [name,query]of queries)for(let trial=0;trial<3;trial++){
        // EXPLAIN is collected within the same session/transaction as synthetic rows.
        measurements.push(`select jsonb_build_object('label',${quote(name)},'actor',${quote(role)},'trial',${trial},'plan',pg_temp.measure(${quote(query)}));`)
      }
      measurements.push('reset role;')
    }
    const input=`begin;set local statement_timeout='15s';set local lock_timeout='2s';
      create temporary table measure_session_marker(id int);
      create function pg_temp.measure(q text) returns json language plpgsql as $$declare result json;begin execute 'explain(analyze,buffers,format json) '||q into result;return result;end$$;
      do $$begin execute format('grant usage on schema %I to anon',(select nspname from pg_namespace where oid=pg_my_temp_schema()));end$$;
      set local session_replication_role=replica;
      insert into app_users(id,name,login_id,pin,role,group_name)select ${base}+i,'release_perf_'||i,'release_perf_'||i,'not-a-login-hash',case i when 1 then 'admin' when 2 then 'leader' else 'user' end,(${groups})[1+(i-1)%4] from generate_series(1,80)i;
      insert into auth_sessions(token,user_id)values ${tokens.map((token,i)=>`('${token}',${base+i+1})`).join(',')};
      insert into calendar_events(id,event_date,time,end_time,title,leader_name,service_kind,target_groups,group_service_scope,assignment_status,assignment_shared_at)
      select ${base}+i,date '2099-01-01'+((i-1)/4),'14:30','16:30','Uncommitted release performance sample','release_perf_2',case when i%5=0 then 'congregation' else 'group' end,array[(${groups})[1+(i-1)%4]],i%5<>0,'shared',now() from generate_series(1,${n.events})i;
      insert into event_participants(id,event_id,user_name,role)select ${base}+i,${base}+1+(i-1)%${n.events},'release_perf_'||(1+(i-1)%80),'신청' from generate_series(1,${n.participants})i;
      insert into event_card_assignments(id,event_id,user_name,assigned_card_id,team_key)select ${base}+i,${base}+1+(i-1)%${n.events},'release_perf_'||(1+(i-1)%80),(select min(id) from cards),'team-'||(i%4) from generate_series(1,${n.assignments})i;
      insert into event_card_assignment_cards(id,event_id,user_name,card_id)select ${base}+i,${base}+1+(i-1)%${n.events},'release_perf_'||(1+(i-1)%80),(select min(id) from cards) from generate_series(1,${n.extraCards})i;
      insert into service_sessions(id,user_name,calendar_event_id,service_date,time_slot,status,source)select ${base}+i,'release_perf_'||(1+(i-1)%80),${base}+1+(i-1)%${n.events},date '2099-01-01'+((i-1)%${n.events})/4,'오후','ended','assigned' from generate_series(1,${n.sessions})i;
      insert into comments(id,target_type,target_id,author_id,author_name,content)select ${base}+i,'calendar_event',case when i<=40 then ${base+1} else ${base}+2+(i-41)%(${n.events}-1) end,${base+3},'release_perf_3',repeat('Synthetic comment. ',10) from generate_series(1,${n.comments})i;
      set local session_replication_role=origin;
      ${analyze}
      ${countsSql}
      ${measurements.join('\n')}
      rollback;`
    const values=sql(input),totalRows=values.shift()
    const plans=values.map(({plan:[plan],...label})=>({...label,executionMs:plan['Execution Time'],planningMs:plan['Planning Time'],visibleRows:plan.Plan['Actual Rows'],plan}))
    assert.equal(plans.length,81)
    assert.deepEqual(sql(countsSql)[0],before,'Synthetic rows must never persist')
    const summary=[]
    for(const role of ['admin','leader','user'])for(const [name]of queries){const samples=plans.filter(p=>p.actor===role&&p.label===name);summary.push({role,query:name,visibleRows:samples[0].visibleRows,medianMs:samples.map(p=>p.executionMs).sort((a,b)=>a-b)[1],maxMs:Math.max(...samples.map(p=>p.executionMs))})}
    results.push({scale,addedRows:n,totalRows,summary,plans})
    console.log(JSON.stringify({scale,totalRows,summary}))
  }
}finally{
  // ANALYZE statistics are not the sample data: refresh them after rollback too.
  const r=spawnSync('psql',['-X','-qAt','-v','ON_ERROR_STOP=1'],{env,input:analyze,encoding:'utf8',timeout:60000})
  assert.equal(r.status,0,r.stderr)
  assert.deepEqual(sql(countsSql)[0],before)
}
writeFileSync('scratch/group-release-scale-demo.json',JSON.stringify({checkedAt:new Date().toISOString(),project:'itjlykpjmlcvanqpmkmc',productionContacted:false,before,results,rolledBack:true,note:'Synthetic production-count and 5x samples in uncommitted demo transactions; real installed policies, grants and functions. Triggers suppressed only for loading, restored before queries. Not a production clone, concurrent load, device latency or network billing measurement.'},null,2),{mode:0o600})
