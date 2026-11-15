// @vitest-environment node
import {readFileSync} from 'node:fs'
import {PGlite} from '@electric-sql/pglite'
import {beforeAll,beforeEach,afterAll,expect,test} from 'vitest'
let db:PGlite
let source=readFileSync('supabase/migrations/20261116_1100_service_application_activity.sql','utf8')
if(process.env.SERVICE_ACTIVITY_MUTATION==='assignment')source=source.replace("if exists(select 1 from public.event_participants where event_id=new.event_id and user_name=new.user_name and service_activity='return_visit') then",'if false then')
const token=(id:number)=>`00000000-0000-0000-0000-${String(id).padStart(12,'0')}`
const tables=['event_card_assignments','event_card_assignment_cards','event_informal_assignments','event_restaurant_assignments']
beforeAll(async()=>{
  db=new PGlite()
  await db.exec(`create role anon;create role authenticated;create schema private;
    create table app_users(id int primary key,name text,is_active boolean default true,approval_status text default 'approved');
    create table auth_sessions(token uuid,user_id int,expires_at timestamptz);
    create table calendar_events(id int primary key,allow_applications boolean);
    create table event_participants(id serial primary key,event_id int references calendar_events,user_name text,role text,unique(event_id,user_name));
    create table event_cart_applications(event_id int,user_id int);
    ${tables.map(t=>`create table ${t}(event_id int,user_name text);`).join('')}
    create function verify_session(t uuid) returns int language sql as $$select user_id from public.auth_sessions where token=t and expires_at>now()$$;
    ${source}`)
},30000)
afterAll(async()=>db?.close())
beforeEach(async()=>{
  await db.exec(`reset role;truncate event_participants,calendar_events,app_users,auth_sessions,event_cart_applications,${tables.join(',')} cascade;
    insert into app_users(id,name)values(1,'A'),(2,'B');insert into calendar_events values(7,true),(8,false);`)
  for(const id of [1,2])await db.query("insert into auth_sessions values($1,$2,now()+interval '1 day')",[token(id),id])
})
async function apply(activity='return_visit',actor=1,event=7){return(await db.query<{r:{ok:boolean;created:boolean}}>('select apply_service_activity_tx($1,$2,$3) r',[token(actor),event,activity])).rows[0].r}
test('both activities share one membership/count and retry cannot toggle or overwrite',async()=>{
  expect(await apply()).toEqual({ok:true,created:true})
  expect(await apply()).toEqual({ok:true,created:false})
  await apply('service',2)
  expect((await db.query('select user_name,role,service_activity from event_participants order by user_name')).rows).toEqual([
    {user_name:'A',role:'신청',service_activity:'return_visit'},{user_name:'B',role:'신청',service_activity:'service'}])
  await expect(apply('service')).rejects.toThrow('Cancel existing')
  await expect(db.exec("update event_participants set service_activity='service' where user_name='A'")).rejects.toThrow('Cancel the existing')
  await db.exec("delete from event_participants where user_name='A'")
  expect(await apply('service')).toEqual({ok:true,created:true})
})
test('approved session and open event required; invalid activity and cart conflicts fail',async()=>{
  await db.exec('set role anon')
  await expect(apply('return_visit',9)).rejects.toThrow('Approved session')
  await db.exec('reset role')
  await expect(apply('bogus')).rejects.toThrow('Invalid service')
  await expect(apply('return_visit',1,8)).rejects.toThrow('closed')
  await expect(apply('return_visit',1,99)).rejects.toThrow('not found')
  await db.exec("update app_users set approval_status='pending' where id=1")
  await expect(apply()).rejects.toThrow('Approved session')
  await db.exec("update app_users set approval_status='approved',is_active=false where id=1")
  await expect(apply()).rejects.toThrow('Approved session')
  await db.exec("update app_users set is_active=true where id=1;insert into event_cart_applications values(7,1)")
  await expect(apply()).rejects.toThrow('cart application')
})
test('stale assignment writes reject returns for every assignment surface but permit service',async()=>{
  await apply();await apply('service',2)
  for(const table of tables){
    await expect(db.exec(`insert into ${table} values(7,'A')`)).rejects.toThrow('cannot receive')
    await db.exec(`insert into ${table} values(7,'B')`)
    await expect(db.exec(`update ${table} set user_name='A' where user_name='B'`)).rejects.toThrow('cannot receive')
  }
})
test('existing assignment also prevents a late return application; role cannot become assigned',async()=>{
  await db.exec("insert into event_card_assignments values(7,'A')")
  await expect(apply()).rejects.toThrow('cannot receive')
  await db.exec('delete from event_card_assignments')
  await apply()
  await expect(db.exec("update event_participants set role='입명'")).rejects.toThrow('cannot receive')
  expect((await db.query('select count(*)::int n from event_participants')).rows[0].n).toBe(1)
})
test('rollback preserves applications and removes only activity metadata',async()=>{
  await apply()
  await db.exec(readFileSync('supabase/tools/rollbacks/_ROLLBACK_20261116_service_application_activity.sql','utf8'))
  expect((await db.query('select user_name,role from event_participants')).rows).toEqual([{user_name:'A',role:'신청'}])
  await db.exec(source)
})
