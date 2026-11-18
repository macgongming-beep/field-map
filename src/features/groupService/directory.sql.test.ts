// @vitest-environment node
import {readFileSync} from 'node:fs'
import {PGlite} from '@electric-sql/pglite'
import {afterAll,beforeAll,beforeEach,expect,test} from 'vitest'
let db:PGlite
let migration=readFileSync('supabase/migrations/20261118_2300_service_group_directory.sql','utf8')
if(process.env.GROUP_DIRECTORY_MUTATION==='revision')migration=migration.replace('p_expected_revision is distinct from rev','false')
if(process.env.GROUP_DIRECTORY_MUTATION==='members')migration=migration.replace('update public.app_users set group_name=n where','update public.app_users set group_name=group_name where')
if(process.env.GROUP_DIRECTORY_MUTATION==='admin')migration=migration.replace("and role in('admin','developer')","and role in('admin','developer','leader')")
const token=(id:number)=>`00000000-0000-0000-0000-${String(id).padStart(12,'0')}`
const directory=async()=>JSON.parse((await db.query<{value:string}>("select value from app_settings where key='service_group_directory'")).rows[0].value)
async function manage(action:string,code:string|null,name:string|null,actor=1,revision?:string){
  const rev=revision??(await directory()).revision
  const result=await db.query<{result:string}>('select manage_service_group_tx($1,$2,$3,$4,$5) result',[token(actor),action,code,name,rev])
  return JSON.parse(result.rows[0].result)
}
async function rejected(action:()=>Promise<unknown>,message:string){
  await db.exec('savepoint rejected_action')
  try{await expect(action()).rejects.toThrow(message)}finally{await db.exec('rollback to rejected_action;release rejected_action')}
}
beforeAll(async()=>{
  db=new PGlite()
  await db.exec(`create role anon;create role authenticated;create schema private;
    create table app_settings(key text primary key,value text);
    insert into app_settings values('user_groups','["东滩","新葛","处仁","东柏"]');
    create table service_groups(code text primary key,label_ko text not null,label_zh text not null,legacy_name text unique not null);
    insert into service_groups values('dongtan','동탄','东滩','东滩'),('singal','신갈','新葛','新葛'),('cheoin','처인','处仁','处仁'),('dongbaek','동백','东柏','东柏');
    create table app_users(id int primary key,name text,role text,group_name text,is_active boolean default true,approval_status text default 'approved');
    insert into app_users(id,name,role,group_name) values(1,'Admin','admin',null),(2,'Leader','leader','新葛'),(3,'Member','user','동탄'),(4,'Foreign','user','新葛'),(5,'Empty','user',null),(6,'Inactive','admin',null);
    update app_users set is_active=false where id=6;
    create function verify_session(t uuid) returns int language sql as $$select id from public.app_users where id=right(t::text,12)::int and is_active and approval_status='approved'$$;
    create function private.request_session_user_id() returns int language sql stable as $$select nullif(current_setting('test.actor',true),'')::int$$;
    create table calendar_events(id int primary key,group_service_scope boolean default true,target_groups text[]);
    insert into calendar_events values(1,true,array['dongtan']);
    create table event_participants(event_id int,user_name text);
    insert into event_participants values(1,'Member');
    create table event_card_assignments(event_id int,user_name text,team_key text);
    insert into event_card_assignments values(1,'Member','team1');
    ${readFileSync('supabase/migrations/20261117_1000_assignment_and_schedule_permissions.sql','utf8').split('create or replace function public.can_read_group_service_row')[1].split('create function public.can_read_group_assignment')[0].replace(/^/, 'create or replace function public.can_read_group_service_row')}
    ${migration}
  `)
},30000)
beforeEach(async()=>{await db.exec('rollback;begin')})
afterAll(async()=>{await db.close()})
test('bootstrap preserves codes and normalizes existing mixed-language memberships',async()=>{
  expect((await directory()).groups.map(g=>[g.code,g.name])).toEqual([['dongtan','东滩'],['singal','新葛'],['cheoin','处仁'],['dongbaek','东柏']])
  expect((await db.query('select group_name from app_users where id=3')).rows[0]).toEqual({group_name:'东滩'})
})
test('arbitrary rename keeps old event, applicants and assignments with the same group',async()=>{
  await manage('rename','dongtan','第一小组')
  expect((await db.query('select group_name from app_users where id=3')).rows[0]).toEqual({group_name:'第一小组'})
  expect((await db.query('select target_groups from calendar_events where id=1')).rows[0]).toEqual({target_groups:['dongtan']})
  expect((await db.query('select * from event_card_assignments')).rows).toEqual([{event_id:1,user_name:'Member',team_key:'team1'}])
  expect((await db.query('select * from event_participants')).rows).toHaveLength(1)
  await db.exec("set test.actor='3'")
  expect((await db.query('select can_read_group_service_row(1,null) ok')).rows[0]).toEqual({ok:true})
  await db.exec("set test.actor='4'")
  expect((await db.query('select can_read_group_service_row(1,null) ok')).rows[0]).toEqual({ok:false})
  await expect(db.exec("update app_users set group_name='东滩' where id=4")).rejects.toThrow('Unknown')
})
test('fifth group and empty group rename work; stale admin does not overwrite changes',async()=>{
  const initial=await directory()
  const added=await manage('add',null,'第五小组')
  expect(added.groups).toHaveLength(5)
  const fifth=added.groups.find(g=>g.name==='第五小组')
  await db.query('insert into calendar_events values(2,true,array[$1])',[fifth.code])
  await manage('rename',fifth.code,'新名称')
  await expect(manage('rename',fifth.code,'Old screen',1,initial.revision)).rejects.toThrow('Group directory changed')
})
test('archive preserves history and clears members, cannot use retired name or code for new work',async()=>{
  const result=await manage('archive','dongtan',null)
  expect(result.groups.find(g=>g.code==='dongtan')).toMatchObject({name:'东滩',active:false})
  expect((await db.query('select group_name from app_users where id=3')).rows[0].group_name).toBeNull()
  expect((await db.query('select * from event_participants')).rows).toHaveLength(1)
  expect((await db.query('select * from event_card_assignments')).rows).toHaveLength(1)
  await db.exec("update calendar_events set target_groups=array['dongtan'] where id=1")
  await expect(db.exec("insert into calendar_events values(2,true,array['dongtan'])")).rejects.toThrow('retired')
})
test('admin-only transaction and internal helpers cannot be invoked anonymously',async()=>{
  for(const id of [2,3,6,99])await rejected(()=>manage('add',null,'Denied',id),'Admin required')
  expect((await db.query("select has_function_privilege('anon','private.publish_service_group_directory(bigint)','execute') allowed")).rows[0]).toEqual({allowed:false})
  await expect(db.exec("update app_settings set value='[]' where key='user_groups'")).rejects.toThrow('directory management')
})
test('duplicate aliases and unknown memberships cannot create ambiguous access',async()=>{
  await rejected(()=>manage('add',null,'동탄'),'Duplicate')
  await expect(db.exec("update app_users set group_name='Made up' where id=5")).rejects.toThrow('Unknown')
})
