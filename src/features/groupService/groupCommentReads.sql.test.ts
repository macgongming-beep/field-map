// @vitest-environment node
import {readFileSync} from 'node:fs'
import {PGlite} from '@electric-sql/pglite'
import {afterAll,beforeAll,beforeEach,expect,test} from 'vitest'
const helperSource=readFileSync('supabase/migrations/20260828_1000_session_helper_and_signup.sql','utf8')
const helper=(name:string)=>helperSource.match(new RegExp(`create or replace function private\\.${name}\\(\\)[\\s\\S]+?\\$\\$;`))![0]
let source=readFileSync('supabase/migrations/20261117_1500_group_comment_authenticated_reads.sql','utf8')
if(process.env.GROUP_COMMENT_MUTATION==='session')source=source.replace('if private.request_session_user_id() is null then','if false then')
const token='00000000-0000-0000-0000-000000000001'
let db:PGlite
beforeAll(async()=>{
  db=new PGlite();await db.exec(`create role anon;create role authenticated;create schema private;
    create table app_users(id int primary key,is_active boolean,approval_status text);
    create table auth_sessions(token uuid,user_id int,expires_at timestamptz);
    create table calendar_events(id int primary key,group_service_scope boolean);
    create table comments(id bigint primary key,target_type text,target_id int,author_id int,author_name text,content text,mention_ids int[],mention_names text[],created_at timestamptz,deleted_at timestamptz);
    ${helper('request_session_token')}${helper('request_session_user_id')}
    revoke all on schema private from public,anon,authenticated;
    revoke all on function private.request_session_user_id() from public,anon,authenticated;
    ${source}`)
},30000)
afterAll(()=>db?.close())
beforeEach(async()=>{
  await db.exec(`reset role;set request.headers='{}';truncate app_users,auth_sessions,calendar_events,comments;
    insert into app_users values(1,true,'approved');insert into auth_sessions values('${token}',1,now()+interval '1 day');
    insert into calendar_events values(1,true),(2,true),(3,false);
    insert into comments(id,target_type,target_id,author_name,content)select n,'calendar_event',1,'Writer','Body' from generate_series(1,45)n;
    insert into comments(id,target_type,target_id,content)values(46,'calendar_event',2,'foreign'),(47,'notice',1,'notice'),(48,'calendar_event',1,'deleted');
    update comments set deleted_at=now() where id=48;`)
})
async function client(headers:object,query='select read_group_event_comments(1) result'){
  await db.query("select set_config('request.headers',$1,false)",[JSON.stringify(headers)]);await db.exec('set role anon')
  try{return (await db.query<{result:{id:number}[]}>(query)).rows[0].result}finally{await db.exec('reset role')}
}
test('missing, malformed, unknown, expired, revoked, inactive and pending sessions throw rather than return empty',async()=>{
  for(const headers of [{},{'x-session-token':'bad'},{'x-session-token':'00000000-0000-0000-0000-000000000099'}])
    await expect(client(headers)).rejects.toMatchObject({code:'42501',message:'COMMENT_SESSION_REQUIRED'})
  for(const change of ["update auth_sessions set expires_at=now()-interval '1 second'",'delete from auth_sessions','update app_users set is_active=false',"update app_users set approval_status='pending'"]){
    await db.exec(change)
    await expect(client({'x-session-token':token})).rejects.toMatchObject({code:'42501',message:'COMMENT_SESSION_REQUIRED'})
    await db.exec(`truncate auth_sessions;insert into auth_sessions values('${token}',1,now()+interval '1 day');update app_users set is_active=true,approval_status='approved';`)
  }
})
test('approved foreign-group users get bounded exact-event pages and empty means genuinely missing',async()=>{
  const headers={'x-session-token':token}
  expect((await client(headers)).map(r=>r.id)).toEqual(Array.from({length:20},(_,i)=>45-i))
  expect((await client(headers,'select read_group_event_comments(1,26) result')).map(r=>r.id)).toEqual(Array.from({length:20},(_,i)=>25-i))
  expect((await client(headers,'select read_group_event_comments(1,null,array[1,46,47,48]::bigint[]) result')).map(r=>r.id)).toEqual([1])
  expect(await client(headers,'select read_group_event_comments(1,null,array[999]::bigint[]) result')).toEqual([])
  await expect(client(headers,'select read_group_event_comments(3) result')).rejects.toMatchObject({code:'22023'})
  await expect(client(headers,'select read_group_event_comments(1,null,array(select generate_series(1,21))::bigint[]) result')).rejects.toMatchObject({code:'22023'})
})
