// @vitest-environment node
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { beforeAll, beforeEach, afterAll, expect, test } from 'vitest'

let db:PGlite
const token=(id:number)=>`00000000-0000-0000-0000-${String(id).padStart(12,'0')}`
let source=readFileSync('supabase/migrations/20261116_1000_group_service.sql','utf8')
  +readFileSync('supabase/migrations/20261116_1010_service_event_conflict_response.sql','utf8')
  +readFileSync('supabase/migrations/20261116_1020_unassigned_service_templates.sql','utf8')
  +readFileSync('supabase/migrations/20261116_1030_preserve_cart_schedule_contract.sql','utf8')
if(process.env.GROUP_SERVICE_MUTATION==='version')source=source.replace("if r->>'version' is null or (r->>'version')::bigint<>e.edit_version then",'if false then')
if(process.env.GROUP_SERVICE_MUTATION==='privacy')source=source.replaceAll("if v_actor is null then raise exception 'Approved session required' using errcode='42501'; end if;",'-- mutation: session check removed')
const helperSource=readFileSync('supabase/migrations/20260828_1000_session_helper_and_signup.sql','utf8')
const helper=(name:string)=>helperSource.match(new RegExp(`create or replace function private\\.${name}\\(\\)[\\s\\S]+?\\$\\$;`))![0]
const permission=readFileSync('supabase/migrations/20260907_1100_finalize_calendar_assignment_policies.sql','utf8').match(/create or replace function private.user_can_manage_event[\s\S]+?\$\$;/)![0]
const seriesImpl=readFileSync('supabase/migrations/20260827_1000_series_update_tx.sql','utf8').match(/create or replace function public.update_calendar_event_series_tx\([\s\S]+?\$\$;/)![0].replace('public.update_calendar_event_series_tx(', 'public.update_calendar_event_series_tx_impl_20260907(')
beforeAll(async()=>{
  db=new PGlite()
  await db.exec(`create role anon; create role authenticated; create schema private;
    create table app_users(id int primary key,name text,role text,is_active boolean default true,approval_status text default 'approved');
    create table auth_sessions(token uuid primary key,user_id int,expires_at timestamptz);
    create table calendar_events(id serial primary key,event_date date,time text,end_time text,title text,place text default '',leader_name text,memo text,has_meeting boolean,allow_applications boolean,meeting_map_url text,series_id uuid,allow_cart_applications boolean default false,cart_capacity int);
    create table event_participants(event_id int references calendar_events on delete cascade,user_name text,role text,unique(event_id,user_name));
    create table event_cart_applications(event_id int references calendar_events on delete cascade,user_id int);
    create table test_notices(recipient int,title text,body text);
    ${helper('request_session_token')} ${helper('request_session_user_id')} ${permission}
    create function public.verify_session(t uuid) returns int language sql as $$ select u.id from public.app_users u join public.auth_sessions a on a.user_id=u.id where a.token=t and a.expires_at>now() and u.is_active and u.approval_status='approved' $$;
    create function public.user_ids_in_name_list(s text) returns int[] language sql as $$ select array_agg(id) from public.app_users where name=any(regexp_split_to_array(s,'\\s*,\\s*')) $$;
    create function public.filter_notification_recipients(ids int[],kind text) returns int[] language sql as $$ select ids $$;
    create function public.insert_notifications(ids int[],kind text,t text,b text,l text,e int) returns void language sql as $$ insert into public.test_notices select unnest(ids),t,b $$;
    create function public.dispatch_push_notification(ids int[],kind text,t text,b text,l text,e int) returns void language sql as $$ select $$;
    create function public.notify_on_calendar_event_change() returns trigger language plpgsql as $$ begin return new; end $$;
    create trigger on_calendar_event_update after update on calendar_events for each row execute function notify_on_calendar_event_change();
    ${seriesImpl}
    ${source}`)
},30000)
afterAll(async()=>{await db?.close()})
beforeEach(async()=>{
  await db.exec(`reset role; set request.headers='{}'; truncate calendar_events,app_users,auth_sessions,test_notices,private.service_event_imports cascade;
    insert into app_users(id,name,role) values(1,'Admin','admin'),(2,'Leader','leader'),(3,'Member','user'),(4,'Replacement','leader');`)
  for(let i=1;i<=4;i++)await db.query("insert into auth_sessions values($1,$2,now()+interval '1 day')",[token(i),i])
})
function payload(time='14:30',end='16:30') { return {event_date:'2099-11-25',time,end_time:end,title:'Test',place:'Place',leader_name:'Leader',memo:'',allow_applications:true,meeting_map_url:'',service_kind:'group',target_groups:['singal','dongtan'],primary_leader_user_id:2,meeting_mode:'virtual',access:{joinUrl:'https://example.com/join?pwd=secret',meetingNumber:'123',passcode:'secret'}} }
async function save(rows:unknown[],actor=1,id=crypto.randomUUID()) {
  return (await db.query<{r:{ids:number[]}}>('select save_service_events_tx($1,$2,$3,true) r',[token(actor),JSON.stringify(rows),id])).rows[0].r
}
async function version(id:number) {return String((await db.query<{edit_version:number}>('select edit_version from calendar_events where id=$1',[id])).rows[0].edit_version)}
async function session(id:number|null) {await db.query("select set_config('request.headers',$1,false)",[JSON.stringify(id?{'x-session-token':token(id)}:{})])}
test('creates independent two slots atomically and canonicalizes group codes',async()=>{
  const r=await save([{payload:payload()},{payload:payload('17:00','19:00')}])
  expect(r.ids).toHaveLength(2)
  expect((await db.query('select time,target_groups,edit_version from calendar_events order by time')).rows).toEqual([
    {time:'14:30',target_groups:['dongtan','singal'],edit_version:1},{time:'17:00',target_groups:['dongtan','singal'],edit_version:1}])
  await db.query("insert into event_participants values($1,'Member','신청'),($2,'Member','신청')",r.ids)
  await db.query('delete from event_participants where event_id=$1',[r.ids[0]])
  expect((await db.query('select event_id from event_participants')).rows).toEqual([{event_id:r.ids[1]}])
})
test('batch retry is idempotent, duplicate import slot and mismatched retries fail',async()=>{
  const id=crypto.randomUUID(),rows=[{payload:payload()}]
  const first=await save(rows,1,id)
  expect(await save(rows,1,id)).toEqual(first)
  await expect(save([{payload:payload('17:00','19:00')}],1,id)).rejects.toThrow('Request ID')
  await expect(save(rows)).rejects.toThrow('already occupies')
  expect((await db.query('select count(*)::int n from calendar_events')).rows[0]).toEqual({n:1})
})
test('invalid second row rolls back first row and access information',async()=>{
  await expect(save([{payload:payload()},{payload:{...payload('17:00','19:00'),target_groups:['unknown']}}])).rejects.toThrow()
  expect((await db.query('select count(*)::int n from calendar_events')).rows[0]).toEqual({n:0})
  expect((await db.query('select count(*)::int n from event_meeting_access')).rows[0]).toEqual({n:0})
})
test('member cannot create; primary must be approved active leader and included by exact name',async()=>{
  await expect(save([{payload:payload()}],3)).rejects.toThrow('Administrator')
  for(const p of [{...payload(),primary_leader_user_id:3,leader_name:'Member'}, {...payload(),leader_name:'Other'}])await expect(save([{payload:p}])).rejects.toThrow('Primary leader')
  await db.exec('update app_users set is_active=false where id=2')
  await expect(save([{payload:payload()}])).rejects.toThrow('Primary leader')
})
test('wrong permission, missing or duplicate IDs and stale versions reject entire update',async()=>{
  const {ids}=await save([{payload:payload()},{payload:payload('17:00','19:00')}])
  const rows=ids.map((id,i)=>({id,version:'1',payload:payload(i?'17:00':'14:30',i?'19:00':'16:30')}))
  await expect(save(rows,3)).rejects.toThrow('permission')
  await expect(save([...rows,{...rows[0],id:999}])).rejects.toThrow('permission')
  await expect(save([rows[0],rows[0]])).rejects.toThrow('Duplicate')
  await db.query("update calendar_events set memo='other admin' where id=$1",[ids[1]])
  await expect(save(rows)).rejects.toThrow('reload')
  expect(await version(ids[0])).toBe('1')
})
test('leader transfer changes permissions and notifies old/new leader and applicant only once',async()=>{
  const {ids}=await save([{payload:payload()},{payload:payload('17:00','19:00')}])
  await db.query("insert into event_participants values($1,'Member','신청'),($2,'Member','신청')",ids)
  await save(ids.map((id,i)=>({id,version:'1',payload:{...payload(i?'17:00':'14:30',i?'19:00':'16:30'),leader_name:'Replacement',primary_leader_user_id:4}})))
  expect((await db.query('select recipient from test_notices order by recipient')).rows).toEqual([{recipient:2},{recipient:3},{recipient:4}])
  expect(JSON.stringify((await db.query('select * from test_notices')).rows)).not.toContain('secret')
  expect((await db.query('select private.user_can_manage_event(2,$1) old,private.user_can_manage_event(4,$1) replacement',[ids[0]])).rows[0]).toEqual({old:false,replacement:true})
})
test('end-only and protected-access-only updates notify, memo-only does not',async()=>{
  const {ids:[id]}=await save([{payload:payload()}])
  await db.query("update calendar_events set end_time='16:45' where id=$1",[id])
  expect((await db.query('select count(*)::int n from test_notices')).rows[0]).toEqual({n:1})
  await db.exec('truncate test_notices')
  await save([{id,version:await version(id),payload:{...payload('14:30','16:45'),memo:'new'}}])
  expect((await db.query('select count(*)::int n from test_notices')).rows[0]).toEqual({n:0})
  await save([{id,version:await version(id),payload:{...payload('14:30','16:45'),access:{...payload().access,passcode:'changed'}}}])
  expect((await db.query('select count(*)::int n from test_notices')).rows[0]).toEqual({n:1})
})
test('private meeting info denies direct reads and invalid sessions; approved nonapplicant can read',async()=>{
  const {ids:[id]}=await save([{payload:payload()}])
  await db.exec('set role anon')
  await expect(db.query('select * from event_meeting_access')).rejects.toThrow('permission')
  await expect(db.query('select get_event_meeting_access($1)',[id])).rejects.toThrow('Approved')
  await session(3)
  expect((await db.query<{a:{passcode:string}}>('select get_event_meeting_access($1) a',[id])).rows[0].a.passcode).toBe('secret')
  await db.exec('reset role; update app_users set is_active=false where id=3; set role anon')
  await expect(db.query('select get_event_meeting_access($1)',[id])).rejects.toThrow('Approved')
  await db.exec('reset role')
})
test('overlap checks partial intervals, adjoining times, unknown times and self only',async()=>{
  const {ids}=await save([{payload:payload()},{payload:payload('16:30','18:30')},{payload:payload('15:00','17:00')}])
  await db.query("insert into event_participants values($1,'Member','신청')",[ids[0]])
  await session(3)
  expect((await db.query<{r:unknown[]}>('select get_event_application_overlaps($1) r',[ids[1]])).rows[0].r).toHaveLength(0)
  expect((await db.query<{r:{id:number}[]}>('select get_event_application_overlaps($1) r',[ids[2]])).rows[0].r[0].id).toBe(ids[0])
  await db.query('update calendar_events set end_time=null where id=$1',[ids[0]])
  expect((await db.query<{r:{unknown:boolean}[]}>('select get_event_application_overlaps($1) r',[ids[1]])).rows[0].r[0].unknown).toBe(true)
  await session(2)
  expect((await db.query<{r:unknown[]}>('select get_event_application_overlaps($1) r',[ids[2]])).rows[0].r).toHaveLength(0)
})
test('unassigned templates have separate series; series edits preserve dated primary assignments',async()=>{
  const morning=crypto.randomUUID(),evening=crypto.randomUUID()
  const {ids}=await save([
    {payload:{...payload(),series_id:morning}},
    {payload:{...payload('17:00','19:00'),series_id:evening}},
    {payload:{...payload(),series_id:morning,event_date:'2099-12-02',leader_name:'Replacement',primary_leader_user_id:4}},
  ])
  const change=(data:unknown,actor=1)=>db.query('select update_calendar_event_series_tx($1,$2,$3,$4,true)',[token(actor),morning,'2099-11-25',JSON.stringify(data)])
  await expect(change({leader_name:'Leader'})).rejects.toThrow('one date at a time')
  await expect(change({end_time:'16:45'},2)).rejects.toThrow('permission')
  await change({end_time:'16:45'})
  expect((await db.query('select time,end_time,primary_leader_user_id from calendar_events where id=$1',[ids[1]])).rows[0]).toEqual({time:'17:00',end_time:'19:00',primary_leader_user_id:2})
  expect((await db.query('select recipient from test_notices order by recipient')).rows).toEqual([{recipient:2},{recipient:4}])
  const result=await save([{payload:{...payload(),event_date:'2099-12-09',leader_name:'',primary_leader_user_id:null,series_id:morning}}])
  expect(result.ids).toHaveLength(1)
  await expect(save([{payload:{...payload('17:00','19:00'),event_date:'2099-12-09',series_id:morning}}])).rejects.toThrow('separate series')
})
test('legacy cart-only applicants still receive changes and repeated cart settings remain editable',async()=>{
  const series=crypto.randomUUID()
  const {ids:[id]}=await save([{payload:{...payload(),series_id:series}}])
  await db.query('insert into event_cart_applications values($1,3)',[id])
  await db.query('select update_calendar_event_series_tx($1,$2,$3,$4,true)',[token(1),series,'2099-11-25',JSON.stringify({end_time:'16:45',allow_cart_applications:true,cart_capacity:4})])
  expect((await db.query('select recipient from test_notices order by recipient')).rows).toEqual([{recipient:2},{recipient:3}])
  expect((await db.query('select allow_cart_applications,cart_capacity from calendar_events where id=$1',[id])).rows[0]).toEqual({allow_cart_applications:true,cart_capacity:4})
})
