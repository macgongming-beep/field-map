// @vitest-environment node
import {readFileSync} from 'node:fs'
import {PGlite} from '@electric-sql/pglite'
import {afterAll,beforeAll,beforeEach,expect,test} from 'vitest'
let db:PGlite
let source=readFileSync('supabase/migrations/20261117_1400_group_event_comments.sql','utf8')
if(process.env.GROUP_COMMENT_MUTATION==='privacy')source=source.replace("or (select private.request_session_user_id()) is not null",'or true')
beforeAll(async()=>{
  db=new PGlite()
  await db.exec(`create role anon;create role authenticated;create schema private;create publication supabase_realtime;
    create table app_users(id int primary key,name text,is_active boolean default true,approval_status text default 'approved');
    create table calendar_events(id int primary key,group_service_scope boolean,leader_name text);
    create table event_participants(event_id int,user_name text);
    create table comments(id bigserial primary key,target_type text,target_id int,author_id int,author_name text,content text,mention_ids int[],deleted_at timestamptz);
    alter table comments enable row level security;create policy legacy_read on comments for select using(true);grant select on comments,calendar_events to anon,authenticated;
    create function private.request_session_user_id()returns int language sql security definer as $$select id from public.app_users where id=nullif(current_setting('test.actor',true),'')::int and is_active and approval_status='approved'$$;
    create table delivered(ids int[],kind text,link text,related int,transport text);
    create function public.get_comment_target_author_id(text,integer)returns int language sql as $$select null::int$$;
    create function public.insert_notifications(ids int[],kind text,title text,body text,link text,related int)returns void language sql as $$insert into delivered values(ids,kind,link,related,'app')$$;
    create function public.dispatch_push_notification(ids int[],kind text,title text,body text,link text,related int)returns void language sql as $$insert into delivered values(ids,kind,link,related,'push')$$;
    ${readFileSync('supabase/migrations/20260826_2500_comment_notify_participants.sql','utf8').replace('v_body := new.author_name','v_body:=new.author_name')}
    create trigger notify_comments after insert on comments for each row execute function notify_on_comment();
    ${source}
  `)
},30000)
afterAll(async()=>db?.close())
beforeEach(async()=>{
  await db.exec(`reset role;set test.actor='';truncate comments,calendar_events,event_participants,app_users,delivered restart identity cascade;
    insert into app_users(id,name)values(1,'Writer'),(2,'Applicant'),(3,'Leader'),(4,'Unrelated leader'),(5,'Mentioned');
    insert into calendar_events values(1,true,'Leader'),(2,true,'Unrelated leader'),(3,false,'Leader');
    insert into event_participants values(1,'Writer'),(1,'Applicant');`)
})
const insert=()=>db.exec("insert into comments(target_type,target_id,author_id,author_name,content,mention_ids)values('calendar_event',1,1,'Writer','text',array[2,5])")
test('comments stay per event but approved members from any group can read; anonymous/pending/inactive cannot',async()=>{
  await insert()
  await db.exec("insert into comments(target_type,target_id,author_id,author_name,content)values('calendar_event',3,1,'Writer','legacy');set role anon")
  expect((await db.query('select target_id from comments')).rows).toEqual([{target_id:3}])
  await db.exec("set test.actor='4'")
  expect((await db.query('select * from comments where target_id=1')).rows).toHaveLength(1)
  for(const change of ["is_active=false","is_active=true,approval_status='pending'"]){
    await db.exec(`reset role;update app_users set ${change} where id=4;set role anon`)
    expect((await db.query('select * from comments where target_id=1')).rows).toHaveLength(0)
  }
})
test('recipient union excludes author/unrelated leaders and mentions are sent once with exact group comment link',async()=>{
  await insert()
  expect((await db.query('select ids,kind,link,transport from delivered order by transport,kind')).rows).toEqual([
    {ids:[3],kind:'comment',link:'/calendar?openEvent=1&comment=1',transport:'app'},
    {ids:[2,5],kind:'mention',link:'/calendar?openEvent=1&comment=1',transport:'app'},
    {ids:[3],kind:'comment',link:'/calendar?openEvent=1&comment=1',transport:'push'},
    {ids:[2,5],kind:'mention',link:'/calendar?openEvent=1&comment=1',transport:'push'},
  ])
  await db.exec("update comments set content='edit' where id=1")
  expect((await db.query('select * from delivered')).rows).toHaveLength(4)
})
test('signals contain identifiers only, cover edits/deletions and cannot be written by clients',async()=>{
  await insert();await db.exec("update comments set deleted_at=now() where id=1")
  expect((await db.query('select * from group_comment_signals')).rows).toEqual([{event_id:1,comment_id:1,revision:2}])
  await db.exec('delete from comments where id=1;set role anon')
  expect((await db.query('select * from group_comment_signals')).rows).toEqual([{event_id:1,comment_id:1,revision:3}])
  await expect(db.exec('update group_comment_signals set comment_id=99')).rejects.toThrow('permission')
  await db.exec('reset role')
  expect((await db.query("select has_function_privilege('anon','private.signal_group_comment()','execute') allowed")).rows[0]).toEqual({allowed:false})
})
test('notification patch refuses two matching assignments even when whitespace differs',async()=>{
  await db.exec(`create or replace function public.notify_on_comment() returns trigger language plpgsql as $$declare v_body text;begin v_body:=new.author_name;v_body := new.author_name;return new;end $$;`)
  const patch=source.slice(source.indexOf('do $$ declare definition'))
  await expect(db.exec(patch)).rejects.toThrow('Unexpected comment notification implementation')
  // Restore the ordinary implementation for independent reruns.
  await db.exec(readFileSync('supabase/migrations/20260826_2500_comment_notify_participants.sql','utf8'))
  await db.exec(patch)
})
